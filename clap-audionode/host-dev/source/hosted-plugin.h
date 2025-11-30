#pragma once

#include "./common.h"

// A WCLAP plugin and its host
struct HostedPlugin {
	uint32_t pluginIndex = uint32_t(-1);

	Instance *instance;
	using Arena = wclap::MemoryArena<Instance, false>;
	using ArenaPtr = std::unique_ptr<Arena>;
	ArenaPtr arena;
		
	wclap32::Pointer<const wclap32::wclap_plugin> pluginPtr;
	wclap32::wclap_plugin wclapPlugin;
	
	HostedPlugin(wclap32::Pointer<const wclap32::wclap_plugin> pluginPtr, Instance *instance, ArenaPtr arena) : pluginPtr(pluginPtr), instance(instance), arena(std::move(arena)) {}
	~HostedPlugin() {
		if (pluginPtr) {
			auto plugin = instance->get(pluginPtr);
			instance->call(plugin.destroy, pluginPtr);
		}
		arena->pool.returnToPool(arena);
	}

	void init() {
		wclapPlugin = instance->get(pluginPtr);
		instance->call(wclapPlugin.init, pluginPtr);
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
