#pragma once

#include "./common.h"
#include <memory>

struct HostedPlugin;

// Takes ownership of an Instance
struct HostedWclap {
	bool ok = false;

	std::unique_ptr<Instance> instance;
	wclap::MemoryArena<Instance, false> arena;
	
	HostedWclap(Instance *instance) : instance(instance) {
		if (instance->is64()) return;

		// TODO: register host methods here, before it gets locked by `.init()`
		instance->init();
		if (!instance->entry32) return;
		arena = {instance}; // We have to wait until after `init()`, since this calls malloc
		
		// Call clap_entry.init();
		auto scoped = arena.scoped();
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
		
		auto scoped = arena.scoped();

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
};
