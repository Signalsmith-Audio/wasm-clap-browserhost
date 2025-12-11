#pragma once

#include "./common.h"

#include <algorithm> // we need stable_sort
#include <atomic>

__attribute__((import_module("env"), import_name("eventsOutTryPush")))
extern bool pluginOutputEventsTryPush32(const void *plugin, uint32_t remotePtr, uint32_t length);
__attribute__((import_module("env"), import_name("webviewSend")))
extern bool pluginWebviewSend(const void *plugin, uint32_t remotePtr, uint32_t length);
__attribute__((import_module("env"), import_name("stateMarkDirty")))
extern bool pluginStateMarkDirty(const void *plugin);
__attribute__((import_module("env"), import_name("paramsRescan")))
extern bool pluginParamsRescan(const void *plugin, uint32_t flags);
__attribute__((import_module("env"), import_name("log")))
extern bool pluginLog(const void *plugin, int32_t severity, uint32_t remotePtr, uint32_t length);

namespace impl32 {
using namespace wclap32;

// A WCLAP plugin and its host
struct HostedPlugin {
	uint32_t pluginIndex = uint32_t(-1);
	
	std::atomic_flag mainThreadCallbackDone = ATOMIC_FLAG_INIT;

	Instance *instance;
	using Arena = wclap::MemoryArena<Instance, false>;
	using ArenaPool = wclap::MemoryArenaPool<Instance, false>;
	using ArenaPtr = std::unique_ptr<Arena>;
	ArenaPtr audioThreadArena;
	Arena::Scoped audioThreadScope;
	ArenaPool &arenaPool;
		
	Pointer<const wclap_plugin> pluginPtr;
	Pointer<const wclap_input_events> inputEventsPtr;
	Pointer<const wclap_output_events> outputEventsPtr;
	Pointer<const wclap_istream> istreamPtr;
	Pointer<const wclap_ostream> ostreamPtr;
	wclap_plugin wclapPlugin;
	Pointer<const wclap_plugin_audio_ports> audioPortsExtPtr;
	Pointer<const wclap_plugin_gui> guiExtPtr;
	Pointer<const wclap_plugin_latency> latencyExtPtr;
	Pointer<const wclap_plugin_note_ports> notePortsExtPtr;
	Pointer<const wclap_plugin_params> paramsExtPtr;
	Pointer<const wclap_plugin_state> stateExtPtr;
	Pointer<const wclap_plugin_tail> tailExtPtr;
	Pointer<const wclap_plugin_webview> webviewExtPtr;
	
	// When active, this points to a struct in the Instance's memory, including buffers which the JS-side host knows how to fill out
	Pointer<wclap_process> processStructPtr;
	
	// TODO: lock-free queue to let us `addEvent32` safely
	std::recursive_mutex pendingEventsMutex;
	std::vector<unsigned char> pendingEventBytes;
	std::vector<size_t> pendingEventStarts;
	struct CopiedEvent {
		uint32_t time;
		Pointer<wclap_event_header> pointer;
	};
	std::vector<CopiedEvent> copiedInputEventPtrs;
	void addEvent32(const wclap_event_header *event) {
		std::unique_lock<std::recursive_mutex> lock{pendingEventsMutex};
		auto index = pendingEventBytes.size();
		while (index%alignof(wclap_event_header)) ++index;
		
		pendingEventStarts.push_back(index);
		pendingEventBytes.resize(index + event->size);
		std::memcpy(pendingEventBytes.data() + index, event, event->size);
	}
	bool acceptEvent(const void *ptr) {
		// These are events coming from other plugins.
		// As the host, it's our job to only pass through appropriate events - in particular, only events which require no 32/64 translation, or effect-specific IDs / cookie pointers.
		auto *event = (const wclap_event_header *)ptr;
		if (event->type == WCLAP_EVENT_NOTE_ON || event->type == WCLAP_EVENT_NOTE_OFF || event->type == WCLAP_EVENT_NOTE_CHOKE || event->type == WCLAP_EVENT_MIDI || event->type == WCLAP_EVENT_MIDI_SYSEX || event->type == WCLAP_EVENT_MIDI2) {
			addEvent32(event);
			return true;
		}
		return false;
	}
	wclap_event_header * getEvent(size_t pendingIndex) {
		std::unique_lock<std::recursive_mutex> lock{pendingEventsMutex};
		size_t start = pendingEventStarts[pendingIndex];
		return (wclap_event_header *)(pendingEventBytes.data() + start);
	}
	void copyEvent(Arena::Scoped &scoped, size_t pendingIndex) {
		std::unique_lock<std::recursive_mutex> lock{pendingEventsMutex};
		auto *event = getEvent(pendingIndex);
		
		// Copy bytes across, store remote pointer
		auto eventPtr = scoped.reserve(event->size, alignof(wclap_event_header));
		instance->setArray(eventPtr.cast<unsigned char>(), (unsigned char *)event, event->size);
		copiedInputEventPtrs.push_back(CopiedEvent{event->time, eventPtr.cast<wclap_event_header>()});
		
		// Remove start from the list
		pendingEventStarts.erase(pendingEventStarts.begin() + pendingIndex);
		if (pendingEventStarts.empty()) {
			// If this was the last event, clear the pending bytes as well
			pendingEventBytes.clear();
		}
	}
	void sortCopiedEvents() {
		std::unique_lock<std::recursive_mutex> lock{pendingEventsMutex};
		std::stable_sort(copiedInputEventPtrs.begin(), copiedInputEventPtrs.end(), [](const CopiedEvent &a, const CopiedEvent &b){
			return a.time < b.time;
		});
	}
	void clearEvents() {
		std::unique_lock<std::recursive_mutex> lock{pendingEventsMutex};
		pendingEventStarts.clear();
		pendingEventBytes.clear();
		copiedInputEventPtrs.clear();
	}
	
	std::recursive_mutex streamMutex;
	size_t streamPos = 0;
	std::vector<unsigned char> streamData;
	void clearStreamAlreadyLocked() {
		streamPos = 0;
		streamData.resize(0);
	}
	int64_t istreamRead(Pointer<void> ptr, uint64_t length) {
		auto scoped = arenaPool.scoped();
		if (streamPos >= streamData.size()) return 0;
		if (streamPos + length > streamData.size()) {
			length = streamData.size() - streamPos;
		}
		instance->setArray(ptr.cast<unsigned char>(), streamData.data() + streamPos, length);
		streamPos += length;
		return length;
	}
	int64_t ostreamWrite(Pointer<const void> ptr, uint64_t length) {
		auto start = streamData.size();
		streamData.resize(start + length);
		instance->getArray(ptr.cast<const unsigned char>(), streamData.data() + start, uint32_t(length));
		return length;
	}

	template<class FnPtr, class... Args>
	auto callPlugin(FnPtr fn, Args... args) {
		return instance->call(fn, pluginPtr, args...);
	}

	HostedPlugin(Pointer<const wclap_plugin> pluginPtr, Instance *instance, ArenaPtr arena) : pluginPtr(pluginPtr), instance(instance), audioThreadArena(std::move(arena)), audioThreadScope(audioThreadArena->scoped()), arenaPool(audioThreadArena->pool) {
		pendingEventBytes.reserve(8192);
		pendingEventStarts.reserve(512);
		copiedInputEventPtrs.reserve(512);
		streamData.reserve(8192);
	}
	~HostedPlugin() {
		if (pluginPtr) {
			callPlugin(pluginPtr[&wclap_plugin::destroy]);
		}
		arenaPool.returnToPool(audioThreadArena);
	}

	void init() {
		auto scoped = arenaPool.scoped();
		auto plugin = instance->get(pluginPtr);
		callPlugin(plugin.init);
		audioPortsExtPtr = callPlugin(plugin.get_extension, scoped.writeString("clap.audio-ports")).cast<wclap_plugin_audio_ports>();
		guiExtPtr = callPlugin(plugin.get_extension, scoped.writeString("clap.gui")).cast<wclap_plugin_gui>();
		latencyExtPtr = callPlugin(plugin.get_extension, scoped.writeString("clap.latency")).cast<wclap_plugin_latency>();
		notePortsExtPtr = callPlugin(plugin.get_extension, scoped.writeString("clap.note-ports")).cast<wclap_plugin_note_ports>();
		paramsExtPtr = callPlugin(plugin.get_extension, scoped.writeString("clap.params")).cast<wclap_plugin_params>();
		stateExtPtr = callPlugin(plugin.get_extension, scoped.writeString("clap.state")).cast<wclap_plugin_state>();
		tailExtPtr = callPlugin(plugin.get_extension, scoped.writeString("clap.tail")).cast<wclap_plugin_tail>();
		webviewExtPtr = callPlugin(plugin.get_extension, scoped.writeString("clap.webview/3")).cast<wclap_plugin_webview>();
	}
	
	void mainThread() {
		// Only call if requested
		if (!mainThreadCallbackDone.test_and_set()) {
			callPlugin(pluginPtr[&wclap_plugin::on_main_thread]);
		}
	}
	
	void getInfo(CborWriter &cbor) {
		auto plugin = instance->get(pluginPtr);
		auto scoped = arenaPool.scoped();
		cbor.openMap();

		cbor.addUtf8("desc");
		writeDescriptorCbor(instance, cbor, instance->get(plugin.desc));

		cbor.addUtf8("webview");
		if (webviewExtPtr) {
			auto webviewExt = instance->get(webviewExtPtr);
			auto buffer = scoped.array<char>(2048);
			auto length = callPlugin(webviewExt.get_uri, buffer, 2047);
			if (length <= 0 || length >= 2048) {
				cbor.addNull();
			} else {
				char str[2048] = "";
				instance->getArray(buffer, str, 2047);
				cbor.addUtf8(str);
			}
		} else {
			cbor.addNull();
		}

		cbor.close();
	}
	void setParam(wclap_id paramId, double value) {
		wclap_event_param_value event{
			.header={
				.size=sizeof(wclap_event_param_value),
				.time=0,
				.space_id=WCLAP_CORE_EVENT_SPACE_ID,
				.type=WCLAP_EVENT_PARAM_VALUE,
				.flags=WCLAP_EVENT_IS_LIVE
			},
			.param_id=paramId,
			// Plugin will have to look it up by event ID
			.cookie={0},
			// not note-specific
			.note_id=-1,
			.port_index=-1,
			.channel=-1,
			.key=-1,
			.value=value
		};
		addEvent32(&event.header);
	}
	void getParam(wclap_id paramId, CborWriter &cbor) {
		auto scoped = arenaPool.scoped();
		if (!paramsExtPtr) { // how would this even happen?
			cbor.addNull();
			return;
		}

		double value = 0;
		auto valuePtr = scoped.copyAcross(value);

		if (!callPlugin(paramsExtPtr[&wclap_plugin_params::get_value], paramId, valuePtr)) {
			cbor.addUtf8("plugin_params.get_value() returned false");
			return;
		}
		value = instance->get(valuePtr);
		auto textPtr = scoped.array<char>(255);
		bool hasText = callPlugin(paramsExtPtr[&wclap_plugin_params::value_to_text], paramId, value, textPtr, 255);

		cbor.openMap();
		cbor.addUtf8("value");
		cbor.addFloat(value);
		if (hasText) {
			char text[256] = {};
			instance->getArray(textPtr, text, 255);
			cbor.addUtf8("text");
			cbor.addUtf8(text);
		}
		cbor.close();
	}
	void getParams(CborWriter &cbor) {
		auto scoped = arenaPool.scoped();
		cbor.openArray();

		wclap_param_info info;
		auto infoPtr = scoped.copyAcross(info);
		
		auto paramsExt = instance->get(paramsExtPtr);
		auto count = callPlugin(paramsExt.count);
		for (uint32_t i = 0; i < count; ++i) {
			if (!callPlugin(paramsExt.get_info, i, infoPtr)) continue;
			info = instance->get(infoPtr);
			cbor.openMap();

			cbor.addUtf8("id");
			cbor.addInt(info.id);
			cbor.addUtf8("flags");
			cbor.addInt(info.flags);
			cbor.addUtf8("name");
			info.name[255] = 0; // ensure null-terminated
			cbor.addUtf8(info.name);
			cbor.addUtf8("module");
			info.module[1023] = 0;
			cbor.addUtf8(info.module);
			cbor.addUtf8("min");
			cbor.addFloat(info.min_value);
			cbor.addUtf8("max");
			cbor.addFloat(info.max_value);
			cbor.addUtf8("default");
			cbor.addFloat(info.default_value);
			
			cbor.close();
		}
		cbor.close(); // array
	}
	bool start(double sRate, uint32_t minFrames, uint32_t maxFrames, CborWriter &cbor) {
		if (!callPlugin(pluginPtr[&wclap_plugin::activate], sRate, minFrames, maxFrames)) {
			cbor.addNull();
			return false;
		}
		if (!callPlugin(pluginPtr[&wclap_plugin::start_processing])) {
			cbor.addNull();
			return false;
		}

		// Set up a single process struct (to be re-used each time) with sufficiently big buffers
		wclap_process processStruct{
			.steady_time=-1,
			.frames_count=0,
			.transport={0},
			.audio_inputs={0},
			.audio_outputs={0},
			.audio_inputs_count=0,
			.audio_outputs_count=0,
			.in_events=inputEventsPtr,
			.out_events=outputEventsPtr
		};
		audioThreadScope.reset();

		if (audioPortsExtPtr) {
			wclap_audio_port_info portInfo;
			auto portInfoPtr = audioThreadScope.copyAcross(portInfo);

			auto audioPorts = instance->get(audioPortsExtPtr);
			auto inputPortCount = callPlugin(audioPorts.count, true);
			processStruct.audio_inputs_count = inputPortCount;
			auto inputBuffersPtr = audioThreadScope.array<wclap_audio_buffer>(inputPortCount);
			processStruct.audio_inputs = inputBuffersPtr;
			for (uint32_t p = 0; p < inputPortCount; ++p) {
				callPlugin(audioPorts.get, p, true, portInfoPtr);
				portInfo = instance->get(portInfoPtr);

				auto channelCount = portInfo.channel_count;
				auto data32Ptr = audioThreadScope.array<Pointer<float>>(channelCount);
				for (uint32_t c = 0; c < channelCount; ++c) {
					instance->set(data32Ptr, audioThreadScope.array<float>(maxFrames), c);
				}
				wclap_audio_buffer inputBuffer{
					.data32=data32Ptr,
					.data64={0},
					.channel_count=channelCount,
					.latency=0,
					.constant_mask=0
				};
				instance->set(inputBuffersPtr, inputBuffer, p);
			}
			auto outputPortCount = callPlugin(audioPorts.count, false);
			processStruct.audio_outputs_count = outputPortCount;
			processStruct.audio_outputs = audioThreadScope.array<wclap_audio_buffer>(outputPortCount);
			for (uint32_t p = 0; p < outputPortCount; ++p) {
				callPlugin(audioPorts.get, p, true, portInfoPtr);
				portInfo = instance->get(portInfoPtr);

				auto channelCount = portInfo.channel_count;
				auto data32Ptr = audioThreadScope.array<Pointer<float>>(channelCount);
				for (uint32_t c = 0; c < channelCount; ++c) {
					instance->set(data32Ptr, audioThreadScope.array<float>(maxFrames), c);
				}
				wclap_audio_buffer outputBuffer{
					.data32=data32Ptr,
					.data64={0},
					.channel_count=channelCount,
					.latency=0,
					.constant_mask=0
				};
				instance->set(processStruct.audio_outputs, outputBuffer, p);
			}
		}
		processStructPtr = audioThreadScope.copyAcross(processStruct);
		
		// Also return pointers to those buffers
		cbor.openMap(2);
		cbor.addUtf8("inputs");
		cbor.openArray(processStruct.audio_inputs_count);
		for (uint32_t i = 0; i < processStruct.audio_inputs_count; ++i) {
			auto buffer = instance->get(processStruct.audio_inputs, i);
			cbor.openArray(buffer.channel_count);
			for (uint32_t c = 0; c < buffer.channel_count; ++c) {
				cbor.addInt(instance->get(buffer.data32, c).wasmPointer);
			}
		}
		cbor.addUtf8("outputs");
		cbor.openArray(processStruct.audio_outputs_count);
		for (uint32_t i = 0; i < processStruct.audio_outputs_count; ++i) {
			auto buffer = instance->get(processStruct.audio_outputs, i);
			cbor.openArray(buffer.channel_count);
			for (uint32_t c = 0; c < buffer.channel_count; ++c) {
				cbor.addInt(instance->get(buffer.data32, c).wasmPointer);
			}
		}
		return true;
	}
	void stop() {
		callPlugin(pluginPtr[&wclap_plugin::stop_processing]);
		callPlugin(pluginPtr[&wclap_plugin::deactivate]);
	}
	
	uint32_t process(uint32_t blockLength) {
		std::unique_lock<std::recursive_mutex> lock{pendingEventsMutex};
		auto scoped = audioThreadArena->scoped();
		while (!pendingEventStarts.empty()) {
			copyEvent(scoped, pendingEventStarts.size() - 1);
		}
		sortCopiedEvents();
	
		instance->set(processStructPtr[&wclap_process::frames_count], blockLength);
		auto status = callPlugin(pluginPtr[&wclap_plugin::process], processStructPtr);
		clearEvents();
		return status;
	}
	uint32_t inputEventsSize() {
		std::unique_lock<std::recursive_mutex> lock{pendingEventsMutex};
		return uint32_t(copiedInputEventPtrs.size());
	}
	Pointer<const wclap_event_header> inputEventsGet(uint32_t index) {
		std::unique_lock<std::recursive_mutex> lock{pendingEventsMutex};
		if (index >= copiedInputEventPtrs.size()) return {0};
		return copiedInputEventPtrs[index].pointer;
	}
	bool outputEventsTryPush(Pointer<const wclap_event_header> event) {
		auto eventSize = instance->get(event[&wclap_event_header::size]);
		return pluginOutputEventsTryPush32(this, event.wasmPointer, eventSize);
	}
	void paramsFlush() {
		if (!paramsExtPtr) return;
		std::unique_lock<std::recursive_mutex> lock{pendingEventsMutex};
		
		auto scoped = audioThreadArena->scoped();
		for (size_t i = pendingEventStarts.size(); i-- > 0;) {
			auto *event = getEvent(i);
			if (event->type == WCLAP_EVENT_PARAM_VALUE || event->type == WCLAP_EVENT_PARAM_MOD || event->type == WCLAP_EVENT_PARAM_GESTURE_BEGIN || event->type == WCLAP_EVENT_PARAM_GESTURE_END) {
				copyEvent(scoped, i);
			}
		}
		sortCopiedEvents();
		
		callPlugin(paramsExtPtr[&wclap_plugin_params::flush], inputEventsPtr, outputEventsPtr);
	}

	void hostRequestRestart() {
		LOG_EXPR("host.request_restart()");
	}
	void hostRequestProcess() {
		LOG_EXPR("host.request_process()");
	}
	void hostRequestCallback() {
		mainThreadCallbackDone.clear();
	}
	
	bool audioPortsIsRescanFlagSupported(uint32_t flag) {
		LOG_EXPR("host_audio_ports.is_rescan_flag_supported()");
		return false;
	}
	void audioPortsRescan(uint32_t flag) {
		LOG_EXPR("host_audio_ports.rescan()");
	}
		
	void guiResizeHintsChanged() {
		LOG_EXPR("host_gui.resize_hints_changed()");
	}
	bool guiRequestResize(uint32_t width, uint32_t height) {
		LOG_EXPR("host_gui.request_resize()");
		return false;
	}
	bool guiRequestShow() {
		LOG_EXPR("host_gui.request_show()");
		return false;
	}
	bool guiRequestHide() {
		LOG_EXPR("host_gui.request_hide()");
		return false;
	}
	bool guiClosed(bool wasDestroyed) {
		LOG_EXPR("host_gui.closed()");
		return false;
	}
	
	void latencyChanged() {
		LOG_EXPR("host_latency.changed()");
	}

	uint32_t notePortsSupportedDialects() {
		LOG_EXPR("host_note_ports.supported_dialects()");
		return 0;
	}
	void notePortsRescan(uint32_t flags) {
		LOG_EXPR("host_note_ports.rescan()");
	}

	void paramsRescan(uint32_t flags) {
		pluginParamsRescan(this, flags);
	}
	void paramsClear(uint32_t paramId, uint32_t flags) {
		LOG_EXPR("host_params.clear()");
	}
	void paramsRequestFlush() {
		LOG_EXPR("host_params.request_flush()");
	}
	
	void stateMarkDirty() {
		pluginStateMarkDirty(this);
	}

	void tailChanged() {
		LOG_EXPR("host_tail.changed()");
	}

	bool saveState(std::vector<unsigned char> &buffer) {
		std::unique_lock<std::recursive_mutex> lock{streamMutex};
		clearStreamAlreadyLocked();
		if (!callPlugin(stateExtPtr[&wclap_plugin_state::save], ostreamPtr)) {
			buffer.resize(0);
			return false;
		}
		buffer = streamData;
		return true;
	}
	bool loadState(const std::vector<unsigned char> &buffer) {
		std::unique_lock<std::recursive_mutex> lock{streamMutex};
		clearStreamAlreadyLocked();
		streamData = buffer;
		return callPlugin(stateExtPtr[&wclap_plugin_state::load], istreamPtr);
	}

	bool webviewSend(Pointer<const void> buffer, uint32_t size) {
		// JS can copy directly from instance memory
		return pluginWebviewSend(this, buffer.wasmPointer, size);
	}
	bool getResource(const std::string &path, CborWriter &cbor) {
		if (!webviewExtPtr) {
			cbor.addNull();
			return false;
		}
		
		auto scoped = arenaPool.scoped();
		auto mimePtr = scoped.array<char>(255);
		std::unique_lock<std::recursive_mutex> lock{streamMutex};
		clearStreamAlreadyLocked();
		if (!callPlugin(webviewExtPtr[&wclap_plugin_webview::get_resource], scoped.writeString(path.c_str()), mimePtr, 255, ostreamPtr)) {
			cbor.addNull();
			return false;
		}
		char mime[256] = "";
		instance->getArray(mimePtr, mime, 255);

		cbor.openMap(2);
		cbor.addUtf8("type");
		cbor.addUtf8(mime);
		cbor.addUtf8("bytes");
		cbor.addBytes(streamData.data(), streamData.size());
		return true;
	}
	void message(unsigned char *bytes, uint32_t length) {
		if (!webviewExtPtr) return;

		// TODO: send directly to the Instance's memory, instead of bouncing through the host memory
		auto scoped = arenaPool.scoped();
		auto ptr = scoped.array<unsigned char>(length);
		instance->setArray(ptr, bytes, length);

		callPlugin(webviewExtPtr[&wclap_plugin_webview::receive], ptr.cast<const void>(), length);
	}
	void log(int32_t severity, Pointer<const char> msg) {
		auto strLength = instance->countUntil(msg, 0, 8192);
		pluginLog(this, severity, msg.wasmPointer, strLength);
	}
};

}// namespace
using HostedPlugin = impl32::HostedPlugin;
