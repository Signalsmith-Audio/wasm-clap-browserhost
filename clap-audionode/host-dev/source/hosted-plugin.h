#pragma once

#include "./common.h"

//__attribute__((import_module("_wclapInstance"), import_name("registerHost64")))
//extern uint64_t _wclapInstanceRegisterHost64(const void *handle, void *context, size_t fn, const char *sig, size_t sigLength);

// A WCLAP plugin and its host
namespace wclap32 {

struct HostedPlugin {
	uint32_t pluginIndex = uint32_t(-1);

	Instance *instance;
	using Arena = wclap::MemoryArena<Instance, false>;
	using ArenaPtr = std::unique_ptr<Arena>;
	ArenaPtr arena;
		
	Pointer<const wclap_plugin> pluginPtr;
	wclap_plugin wclapPlugin;
	Pointer<const wclap_plugin_audio_ports> audioPortsExtPtr;
	Pointer<const wclap_plugin_gui> guiExtPtr;
	Pointer<const wclap_plugin_latency> latencyExtPtr;
	Pointer<const wclap_plugin_note_ports> notePortsExtPtr;
	Pointer<const wclap_plugin_params> paramsExtPtr;
	Pointer<const wclap_plugin_state> stateExtPtr;
	Pointer<const wclap_plugin_tail> tailExtPtr;
	Pointer<const wclap_plugin_webview> webviewExtPtr;
	
	// TODO: better queue for this
	std::mutex pendingEventsMutex;
	std::vector<unsigned char> pendingEventBytes;
	std::vector<size_t> pendingEventStarts;
	void addEvent32(const wclap_event_header *event) {
		std::unique_lock<std::mutex> lock(pendingEventsMutex);
		auto index = pendingEventBytes.size();
		pendingEventStarts.push_back(index);
		pendingEventBytes.resize(index + event->size);
		std::memcpy(pendingEventBytes.data() + index, event, event->size);
	}
	bool acceptEvent(const void *ptr) {
		// These are events coming from other plugins.
		// It's our job to only pass through appropriate events - i.e. only events which require no 32/64 translation, or effect-specific IDs / cookie pointers.
		auto *event = (const wclap_event_header *)ptr;
		if (event->type == WCLAP_EVENT_NOTE_ON || event->type == WCLAP_EVENT_NOTE_OFF || event->type == WCLAP_EVENT_NOTE_CHOKE || event->type == WCLAP_EVENT_MIDI || event->type == WCLAP_EVENT_MIDI_SYSEX || event->type == WCLAP_EVENT_MIDI2) {
			addEvent32(event);
			return true;
		}
		return false;
	}

	template<class FnPtr, class... Args>
	auto callPlugin(FnPtr fn, Args... args) {
		return instance->call(fn, pluginPtr, args...);
	}

	HostedPlugin(Pointer<const wclap_plugin> pluginPtr, Instance *instance, ArenaPtr arena) : pluginPtr(pluginPtr), instance(instance), arena(std::move(arena)) {
		pendingEventBytes.reserve(8192);
		pendingEventStarts.reserve(1024);
	}
	~HostedPlugin() {
		if (pluginPtr) {
			callPlugin(pluginPtr[&wclap_plugin::destroy]);
		}
		arena->pool.returnToPool(arena);
	}

	void init() {
		auto scoped = arena->pool.scoped();
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
	
	CborValue * getInfo() {
		auto plugin = instance->get(pluginPtr);
		auto scoped = arena->pool.scoped();
		auto cbor = getCbor();
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
		return cborValue();
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
	CborValue * getParam(wclap_id paramId) {
		auto scoped = arena->scoped();
		auto cbor = getCbor();

		double value = 0;
		auto valuePtr = scoped.copyAcross(value);

		if (!callPlugin(paramsExtPtr[&wclap_plugin_params::get_value], paramId, valuePtr)) {
			cbor.addNull();
			return cborValue();
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
		return cborValue();
	}
	CborValue * getParams() {
		auto scoped = arena->pool.scoped();
		auto cbor = getCbor();
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
		return cborValue();
	}
	bool start(double sRate, uint32_t minFrames, uint32_t maxFrames) {
		if (!callPlugin(pluginPtr[&wclap_plugin::activate], sRate, minFrames, maxFrames)) return false;
		if (!callPlugin(pluginPtr[&wclap_plugin::start_processing])) return false;
		return true;
	}
	void stop() {
		callPlugin(pluginPtr[&wclap_plugin::stop_processing]);
		callPlugin(pluginPtr[&wclap_plugin::deactivate]);
	}

	void hostRequestRestart() {
		LOG_EXPR("host.request_restart()");
	}
	void hostRequestProcess() {
		LOG_EXPR("host.request_process()");
	}
	void hostRequestCallback() {
		LOG_EXPR("host.request_callback()");
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
		LOG_EXPR("host_params.rescan()");
	}
	void paramsClear(uint32_t paramId, uint32_t flags) {
		LOG_EXPR("host_params.clear()");
	}
	void paramsRequestFlush() {
		LOG_EXPR("host_params.request_flush()");
	}
	
	void stateMarkDirty() {
		LOG_EXPR("host_state.mark_dirty()");
	}

	void tailChanged() {
		LOG_EXPR("host_tail.changed()");
	}

	bool webviewSend(Pointer<const void> buffer, uint32_t size) {
		LOG_EXPR("host_webview.send()");
		return false;
	}
	void message(unsigned char *bytes, uint32_t length) {
		if (!webviewExtPtr) return;

		// TODO: send directly to the Instance's memory, instead of bouncing through the host memory
		auto scoped = arena->scoped();
		auto ptr = scoped.array<unsigned char>(length);
		instance->setArray(ptr, bytes, length);

		callPlugin(webviewExtPtr[&wclap_plugin_webview::receive], ptr.cast<const void>(), length);
	}
};

}
using HostedPlugin = wclap32::HostedPlugin;
