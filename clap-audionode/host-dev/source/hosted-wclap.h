#pragma once

#include "./common.h"
#include "./hosted-plugin.h"
#include "wclap/index-lookup.hpp"

#include <memory>
#include <vector>
#include <iostream>

namespace impl32 {
using namespace wclap32;

// Takes ownership of an Instance
struct HostedWclap {
	bool ok = false;

	// Host structures
	wclap_host host;
	Pointer<wclap_host_audio_ports> audioPortsExtPtr;
	Pointer<wclap_host_gui> guiExtPtr;
	Pointer<wclap_host_latency> latencyExtPtr;
	Pointer<wclap_host_note_ports> notePortsExtPtr;
	Pointer<wclap_host_params> paramsExtPtr;
	Pointer<wclap_host_state> stateExtPtr;
	Pointer<wclap_host_tail> tailExtPtr;
	Pointer<wclap_host_webview> webviewExtPtr;
	wclap_input_events inputEvents;
	wclap_output_events outputEvents;
	wclap_istream istream;
	wclap_ostream ostream;

	// Instance and supporting state
	std::unique_ptr<Instance> instance;
	wclap::MemoryArenaPool<Instance, false> arenaPool;
	std::unique_ptr<wclap::MemoryArena<Instance, false>> globalArena;
	
	wclap::IndexLookup<HostedPlugin> pluginLookup;
	Pointer<wclap_plugin_factory> pluginFactoryPtr;
	
	static Pointer<const void> hostGetExtension32(void *context, Pointer<const wclap_host> host, Pointer<const char> extensionIdPtr) {
		auto &self = *(HostedWclap *)context;
		char extensionId[256] = {};
		self.instance->getArray(extensionIdPtr, extensionId, 255);
		
		if (!std::strcmp(extensionId, "clap.audio-ports")) return self.audioPortsExtPtr.cast<const void>();
		if (!std::strcmp(extensionId, "clap.gui")) return self.guiExtPtr.cast<const void>();
		if (!std::strcmp(extensionId, "clap.latency")) return self.latencyExtPtr.cast<const void>();
		if (!std::strcmp(extensionId, "clap.note-ports")) return self.notePortsExtPtr.cast<const void>();
		if (!std::strcmp(extensionId, "clap.params")) return self.paramsExtPtr.cast<const void>();
		if (!std::strcmp(extensionId, "clap.state")) return self.stateExtPtr.cast<const void>();
		if (!std::strcmp(extensionId, "clap.tail")) return self.tailExtPtr.cast<const void>();
		if (!std::strcmp(extensionId, "clap.webview/3")) return self.webviewExtPtr.cast<const void>();
		
		std::cout << "Unsupported WCLAP host extension: " << extensionId << std::endl;
		return {0}; // no extensions for now
	}
	static void hostRequestRestart32(void *context, Pointer<const wclap_host> host) {
		auto *plugin = getPlugin(context, host);
		if (plugin) plugin->hostRequestRestart();
	}
	static void hostRequestProcess32(void *context, Pointer<const wclap_host> host) {
		auto *plugin = getPlugin(context, host);
		if (plugin) plugin->hostRequestProcess();
	}
	static void hostRequestCallback32(void *context, Pointer<const wclap_host> host) {
		auto *plugin = getPlugin(context, host);
		if (plugin) plugin->hostRequestCallback();
	}

	static uint32_t inputEventsSize32(void *context, Pointer<const wclap_input_events> events) {
		auto *plugin = getPlugin(context, events);
		if (plugin) return plugin->inputEventsSize();
		return 0;
	}
	static Pointer<const wclap_event_header> inputEventsGet32(void *context, Pointer<const wclap_input_events> events, uint32_t index) {
		auto *plugin = getPlugin(context, events);
		if (plugin) return plugin->inputEventsGet(index);
		return {0};
	}
	static bool outputEventsTryPush32(void *context, Pointer<const wclap_output_events> events, Pointer<const wclap_event_header> event) {
		auto *plugin = getPlugin(context, events);
		if (plugin) return plugin->outputEventsTryPush(event);
		return false;
	}
	
	static int64_t istreamRead32(void *context, Pointer<const wclap_istream> stream, Pointer<void> buffer, uint64_t size) {
		auto *plugin = getPlugin(context, stream);
		if (plugin) return plugin->istreamRead(buffer, size);
		return -1;
	}
	static int64_t ostreamWrite32(void *context, Pointer<const wclap_ostream> stream, Pointer<const void> buffer, uint64_t size) {
		auto *plugin = getPlugin(context, stream);
		if (plugin) return plugin->ostreamWrite(buffer, size);
		return -1;
	}

	static bool audioPortsIsRescanFlagSupported32(void *context, Pointer<const wclap_host> host, uint32_t flag) {
		auto *plugin = getPlugin(context, host);
		if (plugin) return plugin->audioPortsIsRescanFlagSupported(flag);
		return false;
	}
	static void audioPortsRescan32(void *context, Pointer<const wclap_host> host, uint32_t flags) {
		auto *plugin = getPlugin(context, host);
		if (plugin) plugin->audioPortsRescan(flags);
	}

	static void guiResizeHintsChanged32(void *context, Pointer<const wclap_host> host) {
		auto *plugin = getPlugin(context, host);
		if (plugin) plugin->guiResizeHintsChanged();
	}
	static bool guiRequestResize32(void *context, Pointer<const wclap_host> host, uint32_t width, uint32_t height) {
		auto *plugin = getPlugin(context, host);
		if (plugin) return plugin->guiRequestResize(width, height);
		return false;
	}
	static bool guiRequestShow32(void *context, Pointer<const wclap_host> host) {
		auto *plugin = getPlugin(context, host);
		if (plugin) return plugin->guiRequestShow();
		return false;
	}
	static bool guiRequestHide32(void *context, Pointer<const wclap_host> host) {
		auto *plugin = getPlugin(context, host);
		if (plugin) return plugin->guiRequestHide();
		return false;
	}
	static void guiClosed32(void *context, Pointer<const wclap_host> host, bool wasDestroyed) {
		auto *plugin = getPlugin(context, host);
		if (plugin) plugin->guiClosed(wasDestroyed);
	}
	
	static void latencyChanged32(void *context, Pointer<const wclap_host> host) {
		auto *plugin = getPlugin(context, host);
		if (plugin) plugin->latencyChanged();
	}
	
	static uint32_t notePortsSupportedDialects32(void *context, Pointer<const wclap_host> host) {
		auto *plugin = getPlugin(context, host);
		if (plugin) return plugin->notePortsSupportedDialects();
		return 0;
	}
	static void notePortsRescan32(void *context, Pointer<const wclap_host> host, uint32_t flags) {
		auto *plugin = getPlugin(context, host);
		if (plugin) plugin->notePortsRescan(flags);
	}

	static void paramsRescan32(void *context, Pointer<const wclap_host> host, uint32_t flags) {
		auto *plugin = getPlugin(context, host);
		if (plugin) plugin->paramsRescan(flags);
	}
	static void paramsClear32(void *context, Pointer<const wclap_host> host, uint32_t paramId, uint32_t flags) {
		auto *plugin = getPlugin(context, host);
		if (plugin) plugin->paramsClear(paramId, flags);
	}
	static void paramsRequestFlush32(void *context, Pointer<const wclap_host> host) {
		auto *plugin = getPlugin(context, host);
		if (plugin) plugin->paramsRequestFlush();
	}
	
	static void stateMarkDirty32(void *context, Pointer<const wclap_host> host) {
		auto *plugin = getPlugin(context, host);
		if (plugin) plugin->stateMarkDirty();
	}

	static void tailChanged32(void *context, Pointer<const wclap_host> host) {
		auto *plugin = getPlugin(context, host);
		if (plugin) plugin->tailChanged();
	}

	static bool webviewSend32(void *context, Pointer<const wclap_host> host, Pointer<const void> buffer, uint32_t size) {
		auto *plugin = getPlugin(context, host);
		if (plugin) return plugin->webviewSend(buffer, size);
		return false;
	}

	HostedWclap(Instance *instance) : instance(instance), arenaPool(instance), globalArena(arenaPool.getOrCreate()) {
		if (instance->is64()) return;

		// Set up all the host structures we'll need later
		// This registers all the host methods, before the instance gets locked by `.init()`
		auto globalScoped = globalArena->scoped();
		// Host is a template - we don't store it here, but separately for each plugin
		host.wclap_version = {1, 2, 7};
		host.host_data = {0}; // this will get filled in later, as an index into `pluginList`
		host.name = globalScoped.writeString("CLAP AudioNode (WCLAP host)");
		host.vendor = globalScoped.writeString("Signalsmith Audio");
		host.url = globalScoped.writeString("https://github.com/Signalsmith-Audio/wasm-clap-browserhost");
		host.version = globalScoped.writeString("1.0.0");
		host.get_extension = instance->registerHost32(this, hostGetExtension32);
		host.request_restart = instance->registerHost32(this, hostRequestRestart32);
		host.request_process = instance->registerHost32(this, hostRequestRestart32);
		host.request_callback = instance->registerHost32(this, hostRequestCallback32);
		inputEvents.ctx = {0};
		inputEvents.size = instance->registerHost32(this, inputEventsSize32);
		inputEvents.get = instance->registerHost32(this, inputEventsGet32);
		outputEvents.ctx = {0};
		outputEvents.try_push = instance->registerHost32(this, outputEventsTryPush32);
		istream.ctx = {0};
		istream.read = instance->registerHost32(this, istreamRead32);
		ostream.ctx = {0};
		ostream.write = instance->registerHost32(this, ostreamWrite32);
		
		// Host extensions - functions defined above
		audioPortsExtPtr = globalScoped.copyAcross(wclap_host_audio_ports{
			.is_rescan_flag_supported=instance->registerHost32(this, audioPortsIsRescanFlagSupported32),
			.rescan=instance->registerHost32(this, audioPortsRescan32),
		});
		guiExtPtr = globalScoped.copyAcross(wclap_host_gui{
			.resize_hints_changed=instance->registerHost32(this, guiResizeHintsChanged32),
			.request_resize=instance->registerHost32(this, guiRequestResize32),
			.request_show=instance->registerHost32(this, guiRequestShow32),
			.request_hide=instance->registerHost32(this, guiRequestHide32),
			.closed=instance->registerHost32(this, guiClosed32),
		});
		latencyExtPtr = globalScoped.copyAcross(wclap_host_latency{
			.changed=instance->registerHost32(this, latencyChanged32),
		});
		notePortsExtPtr = globalScoped.copyAcross(wclap_host_note_ports{
			.supported_dialects=instance->registerHost32(this, notePortsSupportedDialects32),
			.rescan=instance->registerHost32(this, notePortsRescan32),
		});
		paramsExtPtr = globalScoped.copyAcross(wclap_host_params{
			.rescan=instance->registerHost32(this, paramsRescan32),
			.clear=instance->registerHost32(this, paramsClear32),
			.request_flush=instance->registerHost32(this, paramsRequestFlush32),
		});
		stateExtPtr = globalScoped.copyAcross(wclap_host_state{
			.mark_dirty=instance->registerHost32(this, stateMarkDirty32),
		});
		tailExtPtr = globalScoped.copyAcross(wclap_host_tail{
			.changed=instance->registerHost32(this, tailChanged32),
		});
		webviewExtPtr = globalScoped.copyAcross(wclap_host_webview{
			.send=instance->registerHost32(this, webviewSend32),
		});

		globalScoped.commit(); // Save this stuff for the WCLAP lifetime
		
		instance->init();
		
		if (!instance->entry32) return;
		auto entry = instance->get(instance->entry32);
		
		// Call clap_entry.init();
		auto scoped = arenaPool.scoped();
		if (!instance->call(entry.init, scoped.writeString(instance->path()))) return;

		// Get the plugin factory
		pluginFactoryPtr = instance->call(entry.get_factory, scoped.writeString("clap.plugin-factory"))
			.cast<wclap_plugin_factory>();
		if (!pluginFactoryPtr) return;

		ok = true;
	}
	~HostedWclap() {
		if (ok) { // Call clap_entry.deinit()
			auto entry = instance->get(instance->entry32);
			instance->call(entry.deinit);
		}
	}
	
	static HostedWclap * create(Instance *instance) {
		auto *hosted = new HostedWclap(instance);
		if (!hosted->ok) {
			delete hosted;
			return nullptr;
		}
		return hosted;
	}

	CborValue * getInfo() {
		auto cbor = getCbor();
		cbor.openMap();
		
		auto scoped = arenaPool.scoped();

		auto entry = instance->get(instance->entry32);

		cbor.addUtf8("clapVersion");
		cbor.openArray(3);
		cbor.addInt(entry.wclap_version.major);
		cbor.addInt(entry.wclap_version.minor);
		cbor.addInt(entry.wclap_version.revision);

		cbor.addUtf8("path");
		cbor.addUtf8(instance->path());

		cbor.addUtf8("plugins");
		cbor.openArray();
		
		auto pluginFactory = instance->get(pluginFactoryPtr);
		auto count = instance->call(pluginFactory.get_plugin_count, pluginFactoryPtr);
		for (uint32_t i = 0; i < count; ++i) {
			auto ptr = instance->call(pluginFactory.get_plugin_descriptor, pluginFactoryPtr, i);
			if (!ptr) continue;
			auto descriptor = instance->get(ptr);
			writeDescriptorCbor(instance, cbor, descriptor);
		}
		
		cbor.close(); // array
		cbor.close(); // map
		return cborValue();
	}
	
	// Get the plugin pointer from the context pointer of various host-provided objects
	static HostedPlugin * getPlugin(void *context, Pointer<const wclap_host> hostPtr) {
		auto &self = *(HostedWclap *)context;
		Pointer<void> dataPtr = self.instance->get(hostPtr[&wclap_host::host_data]);
		return self.pluginLookup.get(int32_t(dataPtr.wasmPointer));
	}
	template<class WclapType>
	static HostedPlugin * getPlugin(void *context, Pointer<const WclapType> events) {
		auto &self = *(HostedWclap *)context;
		Pointer<void> dataPtr = self.instance->get(events[&WclapType::ctx]);
		return self.pluginLookup.get(int32_t(dataPtr.wasmPointer));
	}
	
	HostedPlugin * createPlugin(const char *pluginId) {
		auto scoped = arenaPool.scoped();

		// Write the host structures into WCLAP memory
		auto hostPtr = scoped.copyAcross(host);
		auto inputEventsPtr = scoped.copyAcross(inputEvents);
		auto outputEventsPtr = scoped.copyAcross(outputEvents);
		auto istreamPtr = scoped.copyAcross(istream);
		auto ostreamPtr = scoped.copyAcross(ostream);
		// Attempt to actually create the plugin using the plugin factory
		auto fnPtr = pluginFactoryPtr[&wclap_plugin_factory::create_plugin];
		auto pluginPtr = instance->call(fnPtr, pluginFactoryPtr, hostPtr, scoped.writeString(pluginId));
		if (!pluginPtr) {
			std::cerr << "Failed to create WCLAP plugin: " << pluginId << "\n";
			return nullptr;
		}

		// `scoped.commit()` keeps the host structures above for the plugin's lifetime, and also claims the arena
		auto *plugin = new HostedPlugin(pluginPtr, instance.get(), scoped.commit());
		uint32_t pluginIndex = pluginLookup.retain(plugin);
		plugin->pluginIndex = pluginIndex;
		plugin->inputEventsPtr = inputEventsPtr;
		plugin->outputEventsPtr = outputEventsPtr;
		plugin->istreamPtr = istreamPtr;
		plugin->ostreamPtr = ostreamPtr;
		
		// Write the plugin index into the context pointers
		instance->set(hostPtr[&wclap_host::host_data], {pluginIndex});
		instance->set(inputEventsPtr[&wclap_input_events::ctx], {pluginIndex});
		instance->set(outputEventsPtr[&wclap_output_events::ctx], {pluginIndex});
		instance->set(istreamPtr[&wclap_istream::ctx], {pluginIndex});
		instance->set(ostreamPtr[&wclap_ostream::ctx], {pluginIndex});
		
		std::cout << "Created WCLAP plugin: " << pluginId << "\n";
		plugin->init();
		return plugin;
	}
};
} // namespace

using HostedWclap = impl32::HostedWclap;
