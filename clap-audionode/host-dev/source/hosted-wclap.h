#pragma once

#include "./common.h"
#include "./hosted-plugin.h"
#include "wclap/index-lookup.hpp"

#include <memory>
#include <vector>
#include <iostream>

// Takes ownership of an Instance
struct HostedWclap {
	bool ok = false;

	// Host structures
	wclap32::wclap_host host;
	wclap32::Pointer<wclap32::wclap_host_params> paramsExtPtr;
	wclap32::Pointer<wclap32::wclap_host_gui> guiExtPtr;
	wclap32::Pointer<wclap32::wclap_host_webview> webviewExtPtr;

	// Instance and supporting state
	std::unique_ptr<Instance> instance;
	wclap::MemoryArenaPool<Instance, false> arenaPool;
	std::unique_ptr<wclap::MemoryArena<Instance, false>> globalArena;
	
	wclap::IndexLookup<HostedPlugin> pluginLookup;
	wclap32::Pointer<wclap32::wclap_plugin_factory> pluginFactoryPtr;
	
	static wclap32::Pointer<const void> hostGetExtension32(void *context, wclap32::Pointer<const wclap32::wclap_host> host, wclap32::Pointer<const char> extensionIdPtr) {
		auto &self = *(HostedWclap *)context;
		char extensionId[256] = {};
		self.instance->getArray(extensionIdPtr, extensionId, 255);
		
		if (!std::strcmp(extensionId, "clap.params")) return self.paramsExtPtr.cast<const void>();
		if (!std::strcmp(extensionId, "clap.gui")) return self.paramsExtPtr.cast<const void>();
		if (!std::strcmp(extensionId, "clap.webview/3")) return self.paramsExtPtr.cast<const void>();
		
		std::cout << "Unsupported WCLAP host extension: " << extensionId << std::endl;
		return {0}; // no extensions for now
	}

	static void hostRequestRestart32(void *context, wclap32::Pointer<const wclap32::wclap_host> host) {
		auto *plugin = getPlugin(context, host);
		if (plugin) plugin->hostRequestRestart();
	}
	static void hostRequestProcess32(void *context, wclap32::Pointer<const wclap32::wclap_host> host) {
		auto *plugin = getPlugin(context, host);
		if (plugin) plugin->hostRequestProcess();
	}
	static void hostRequestCallback32(void *context, wclap32::Pointer<const wclap32::wclap_host> host) {
		auto *plugin = getPlugin(context, host);
		if (plugin) plugin->hostRequestCallback();
	}

	static void paramsRescan32(void *context, wclap32::Pointer<const wclap32::wclap_host> host, uint32_t flags) {
		auto *plugin = getPlugin(context, host);
		if (plugin) plugin->paramsRescan(flags);
	}
	static void paramsClear32(void *context, wclap32::Pointer<const wclap32::wclap_host> host, uint32_t paramId, uint32_t flags) {
		auto *plugin = getPlugin(context, host);
		if (plugin) plugin->paramsClear(paramId, flags);
	}
	static void paramsRequestFlush32(void *context, wclap32::Pointer<const wclap32::wclap_host> host) {
		auto *plugin = getPlugin(context, host);
		if (plugin) plugin->paramsRequestFlush();
	}
	
	static void guiResizeHintsChanged32(void *context, wclap32::Pointer<const wclap32::wclap_host> host) {
		auto *plugin = getPlugin(context, host);
		if (plugin) plugin->guiResizeHintsChanged();
	}
	static bool guiRequestResize32(void *context, wclap32::Pointer<const wclap32::wclap_host> host, uint32_t width, uint32_t height) {
		auto *plugin = getPlugin(context, host);
		if (plugin) return plugin->guiRequestResize(width, height);
		return false;
	}
	static bool guiRequestShow32(void *context, wclap32::Pointer<const wclap32::wclap_host> host) {
		auto *plugin = getPlugin(context, host);
		if (plugin) return plugin->guiRequestShow();
		return false;
	}
	static bool guiRequestHide32(void *context, wclap32::Pointer<const wclap32::wclap_host> host) {
		auto *plugin = getPlugin(context, host);
		if (plugin) return plugin->guiRequestHide();
		return false;
	}
	static void guiClosed32(void *context, wclap32::Pointer<const wclap32::wclap_host> host, bool wasDestroyed) {
		auto *plugin = getPlugin(context, host);
		if (plugin) plugin->guiClosed(wasDestroyed);
	}
	
	static bool webviewSend32(void *context, wclap32::Pointer<const wclap32::wclap_host> host, wclap32::Pointer<const void> buffer, uint32_t size) {
		auto *plugin = getPlugin(context, host);
		if (plugin) return plugin->webviewSend(buffer, size);
		return false;
	}

	HostedWclap(Instance *instance) : instance(instance), arenaPool(instance), globalArena(arenaPool.getOrCreate()) {
		if (instance->is64()) return;

		// Set up all the host structures we'll need later
		// This registers all the host methods, before the instance gets locked by `.init()`
		auto globalScoped = globalArena->scoped();
		// Host is a template - the `.host_data` will get filled in later, as an index into `pluginList`
		host.wclap_version = {1, 2, 7};
		host.name = globalScoped.writeString("CLAP AudioNode (WCLAP host)");
		host.vendor = globalScoped.writeString("Signalsmith Audio");
		host.url = globalScoped.writeString("https://github.com/Signalsmith-Audio/wasm-clap-browserhost");
		host.version = globalScoped.writeString("1.0.0");
		host.get_extension = instance->registerHost32(this, hostGetExtension32);
		host.request_restart = instance->registerHost32(this, hostRequestRestart32);
		host.request_process = instance->registerHost32(this, hostRequestRestart32);
		host.request_callback = instance->registerHost32(this, hostRequestCallback32);
		
		// Host extensions - functions defined above
		wclap32::wclap_host_params paramsExt{
			.rescan=instance->registerHost32(this, paramsRescan32),
			.clear=instance->registerHost32(this, paramsClear32),
			.request_flush=instance->registerHost32(this, paramsRequestFlush32),
		};
		wclap32::wclap_host_gui guiExt{
			.resize_hints_changed=instance->registerHost32(this, guiResizeHintsChanged32),
			.request_resize=instance->registerHost32(this, guiRequestResize32),
			.request_show=instance->registerHost32(this, guiRequestShow32),
			.request_hide=instance->registerHost32(this, guiRequestHide32),
			.closed=instance->registerHost32(this, guiClosed32),
		};
		guiExtPtr = globalScoped.copyAcross(guiExt);
		wclap32::wclap_host_webview webviewExt{
			.send=instance->registerHost32(this, webviewSend32),
		};
		webviewExtPtr = globalScoped.copyAcross(webviewExt);

		globalScoped.commit(); // Save this stuff for the WCLAP lifetime
		
		instance->init();
		
		if (!instance->entry32) return;
		auto entry = instance->get(instance->entry32);
		
		// Call clap_entry.init();
		auto scoped = arenaPool.scoped();
		if (!instance->call(entry.init, scoped.writeString(instance->path()))) return;

		// Get the plugin factory
		pluginFactoryPtr = instance->call(entry.get_factory, scoped.writeString("clap.plugin-factory"))
			.cast<wclap32::wclap_plugin_factory>();
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
	
	static HostedPlugin * getPlugin(void *context, wclap32::Pointer<const wclap32::wclap_host> hostPtr) {
		auto &self = *(HostedWclap *)context;
		wclap32::Pointer<wclap32::Pointer<void>> hostDataPtr = {hostPtr.wasmPointer + offsetof(wclap32::wclap_host, host_data)};
		wclap32::Pointer<void> hostData = self.instance->get(hostDataPtr);
		return self.pluginLookup.get(int32_t(hostData.wasmPointer));
	}
	
	HostedPlugin * createPlugin(const char *pluginId) {
		auto scoped = arenaPool.scoped();

		// Write the host structures into WCLAP memory
		auto hostPtr = scoped.copyAcross(host);
		// Attempt to actually create the plugin using the plugin factory
		auto pluginFactory = instance->get(pluginFactoryPtr);
		auto pluginPtr = instance->call(pluginFactory.create_plugin, pluginFactoryPtr, hostPtr, scoped.writeString(pluginId));
		if (!pluginPtr) {
			std::cerr << "Failed to create WCLAP plugin: " << pluginId << "\n";
			return nullptr;
		}

		// `scoped.commit()` keeps the host structures above for the plugin's lifetime, and also claims the arena
		auto *plugin = new HostedPlugin(pluginPtr, instance.get(), scoped.commit());
		uint32_t pluginIndex = plugin->pluginIndex = pluginLookup.retain(plugin);
		
		// Write the plugin index into the `host.host_data` pointer
		wclap32::Pointer<wclap32::Pointer<void>> hostDataPtr = {hostPtr.wasmPointer + offsetof(wclap32::wclap_host, host_data)};
		wclap32::Pointer<void> indexAsPointer{pluginIndex};
		instance->set(hostDataPtr, indexAsPointer);
		
		std::cout << "Created WCLAP plugin: " << pluginId << "\n";
		plugin->init();
		return plugin;
	}
};
