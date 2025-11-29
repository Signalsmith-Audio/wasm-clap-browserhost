#pragma once

#include "./common.h"

// A WCLAP plugin and its host
struct HostedPlugin {
	Instance *instance;
	wclap::MemoryArenaPool<Instance, false> &arenaPool;
	std::unique_ptr<wclap::MemoryArena<Instance, false>> arena;
	
	wclap32::Pointer<const wclap32::wclap_plugin> pluginPtr;
	
	HostedPlugin(Instance *instance, wclap::MemoryArenaPool<Instance, false> &arenaPool) : instance(instance), arenaPool(arenaPool), arena(arenaPool.getOrCreate()) {
	}
	~HostedPlugin() {
		if (pluginPtr) {
			auto plugin = instance->get(pluginPtr);
			instance->call(plugin.destroy, pluginPtr);
		}
		arenaPool.returnToPool(arena);
	}
	
	CborValue * getInfo() {
		auto plugin = instance->get(pluginPtr);
		auto descriptor = instance->get(plugin.desc);
	
		auto cbor = getCbor();
		cbor.openMap();
		cbor.addUtf8("desc");
		writeDescriptorCbor(instance, cbor, descriptor);
		cbor.close();
		
		return cborValue();
	}
};
