#pragma once

#include "./common.h"
#include "./hosted-plugin.h"

#include <memory>
#include <vector>

// Takes ownership of an Instance
struct HostedWclap {
	bool ok = false;

	wclap32::wclap_host host;

	std::unique_ptr<Instance> instance;
	wclap::MemoryArenaPool<Instance, false> arenaPool;
	
	std::shared_mutex mutex;
	std::vector<std::unique_ptr<HostedPlugin>> pluginList;
	
	HostedWclap(Instance *instance) : instance(instance), arenaPool(instance) {
		if (instance->is64()) return;

		// Set up copies of all structures the plugins might need - they'll only differ by context pointer
		// This registers all the host methods, before the instance gets locked by `.init()`
		host.wclap_version = {1, 2, 7};
		
		instance->init();
		if (!instance->entry32) return;
		
		// Call clap_entry.init();
		auto scoped = arenaPool.scoped();
		auto entry = instance->get(instance->entry32);
		if (!instance->call(entry.init, scoped.writeString(instance->path()))) return;

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
		
		auto pluginFactory = instance->call(entry.get_factory, scoped.writeString("clap.plugin-factory"))
			.cast<wclap32::wclap_plugin_factory>();
		if (pluginFactory) {
			auto factory = instance->get(pluginFactory);
			auto count = instance->call(factory.get_plugin_count, pluginFactory);
			for (uint32_t i = 0; i < count; ++i) {
				auto ptr = instance->call(factory.get_plugin_descriptor, pluginFactory, i);
				if (!ptr) continue;
				auto descriptor = instance->get(ptr);
				writeDescriptorCbor(instance, cbor, descriptor);
			}
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
			// Write the WCLAP host to the plugin's memory arena
			auto scoped = plugin.arena->scoped();
			auto hostPtr = scoped.copyAcross(host);
			scoped.commit(); // keep that host for the lifetime of the plugin

			// Attempt to actually create the plugin using the plugin factory
			auto entry = instance->get(instance->entry32);
			auto pluginFactory = instance->call(entry.get_factory, scoped.writeString("clap.plugin-factory"))
				.cast<wclap32::wclap_plugin_factory>();
			if (pluginFactory) {
				auto factory = instance->get(pluginFactory);
				plugin.pluginPtr = instance->call(factory.create_plugin, pluginFactory, hostPtr, scoped.writeString(pluginId));
			}
		}

		if (!plugin.pluginPtr) {
			pluginList[pluginIndex] = nullptr;
			return nullptr;
		}
		return pluginList[pluginIndex].get();
	}
};
