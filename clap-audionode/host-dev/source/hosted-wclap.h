#pragma once

#include "./common.h"
#include "./hosted-plugin.h"

#include <memory>
#include <vector>
#include <iostream>

// Takes ownership of an Instance
struct HostedWclap {
	bool ok = false;

	// Host structures
	wclap32::wclap_host host;

	std::unique_ptr<Instance> instance;
	wclap::MemoryArenaPool<Instance, false> arenaPool;
	std::unique_ptr<wclap::MemoryArena<Instance, false>> globalArena;
	
	std::shared_mutex mutex;
	std::vector<std::unique_ptr<HostedPlugin>> pluginList;
	
	wclap32::Pointer<wclap32::wclap_plugin_factory> pluginFactoryPtr;
	wclap32::wclap_plugin_factory pluginFactory;
	
	static wclap32::Pointer<const void> hostGetExtension32(void *context, wclap32::Pointer<const wclap32::wclap_host> host, wclap32::Pointer<const char> extensionIdPtr) {
		auto &self = *(HostedWclap *)context;
		char extensionId[256] = {};
		self.instance->getArray(extensionIdPtr, extensionId, 255);
		
		LOG_EXPR(extensionId);
		return {0}; // no extensions for now
	}

	static void hostRequestRestart32(void *context, wclap32::Pointer<const wclap32::wclap_host> host) {
LOG_EXPR("host.request_restart()");
	}
	static void hostRequestProcess32(void *context, wclap32::Pointer<const wclap32::wclap_host> host) {
LOG_EXPR("host.request_process()");
	}
	static void hostRequestCallback32(void *context, wclap32::Pointer<const wclap32::wclap_host> host) {
LOG_EXPR("host.request_callback()");
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
		pluginFactory = instance->get(pluginFactoryPtr);

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
	
	HostedPlugin * createPlugin(const char *pluginId) {
		auto arena = arenaPool.getOrCreate();
		std::unique_lock guard{mutex};
		
		// Find a plugin-list entry
		size_t pluginIndex = pluginList.size();
		for (size_t i = 0; i < pluginList.size(); ++i) {
			if (!pluginList[i]) { // entries get nulled, not removed, so we search for an empty one first
				pluginIndex = i;
				break;
			}
		}
		if (pluginIndex >= pluginList.size()) pluginList.emplace_back(nullptr);
		pluginList[pluginIndex] = std::unique_ptr<HostedPlugin>{new HostedPlugin(instance.get(), arenaPool)};
		auto &plugin = *pluginList[pluginIndex];
		
		host.host_data = {uint32_t(pluginIndex)};
		{
			// Write the WCLAP host structures to the plugin's memory arena
			auto scoped = plugin.arena->scoped();
			auto hostPtr = scoped.copyAcross(host);
			scoped.commit(); // keep that host for the lifetime of the plugin

			// Attempt to actually create the plugin using the plugin factory
			plugin.pluginPtr = instance->call(pluginFactory.create_plugin, pluginFactoryPtr, hostPtr, scoped.writeString(pluginId));
		}

		if (!plugin.pluginPtr) {
			std::cerr << "Failed to create WCLAP plugin: " << pluginId << "\n";
			pluginList[pluginIndex] = nullptr;
			return nullptr;
		}
		std::cout << "Created WCLAP plugin: " << pluginId << "\n";
		plugin.init();
		return pluginList[pluginIndex].get();
	}
};
