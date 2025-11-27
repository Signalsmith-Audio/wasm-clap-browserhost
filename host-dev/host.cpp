/*
	Hosts WCLAP instances, manages plugins, and exports a simpler API for use from JS
*/
#include "wclap/wclap.hpp"
#include "./wclap-js-instance.h"

#include "cbor-walker/cbor-walker.h"

#include <cstring>
#include <memory>

// CBOR responses - thread-local
inline std::vector<unsigned char> & getCborVector() {
	static thread_local std::vector<unsigned char> threadVector;
	return threadVector;
}
inline signalsmith::cbor::CborWriter getCbor() {
	return signalsmith::cbor::CborWriter(getCborVector());
}
struct CborReturn {
	const unsigned char *ptr;
	size_t length;
};
inline CborReturn * cborReturn() {
	static thread_local CborReturn c;
	auto &vector = getCborVector();
	c.ptr = vector.data();
	c.length = vector.size();
	return &c;
}

// Takes ownership of an Instance
struct HostedWclap {
	bool ok = false;

	std::unique_ptr<Instance> instance;
	
	HostedWclap(Instance *instance) : instance(instance) {
		if (instance->is64()) return;

		// TODO: register host methods here, before it gets locked by `.init()`
		instance->init();
		if (!instance->entry32) return;

		// Call clap_entry.init()
		const char *path = instance->path();
		auto remoteStr = instance->malloc32(std::strlen(path) + 1).cast<char>();
		instance->setArray(remoteStr, path, std::strlen(path) + 1);

		auto entry = instance->get(instance->entry32);
		if (!instance->call(entry.init, remoteStr)) return;

		ok = true;
	}
};

extern "C" {
	HostedWclap * makeHosted(Instance *instance) {
		auto *hosted = new HostedWclap(instance);
		if (!hosted->ok) {
			delete hosted;
			return nullptr;
		}
		return hosted;
	}
	
	void removeHosted(HostedWclap *hosted) {
		delete hosted;
	}
	
	CborReturn * getInfo(HostedWclap *hosted) {
		auto &instance = *hosted->instance;

		auto cbor = getCbor();
		cbor.openMap();
		
		const char *factoryId = "clap.plugin-factory";
		auto remoteStr = instance.malloc32(std::strlen(factoryId) + 1).cast<char>();
		instance.setArray(remoteStr, factoryId, std::strlen(factoryId) + 1);

		auto entry = instance.get(instance.entry32);

		cbor.addUtf8("CLAP");
		cbor.openArray(3);
		cbor.addInt(entry.wclap_version.major);
		cbor.addInt(entry.wclap_version.minor);
		cbor.addInt(entry.wclap_version.revision);

		cbor.addUtf8("path");
		cbor.addUtf8(instance.path());

		cbor.addUtf8("plugins");
		cbor.openArray();
		
		auto pluginFactory = instance.call(entry.get_factory, remoteStr)
			.cast<wclap32::wclap_plugin_factory>();
		if (pluginFactory) {
			auto factory = instance.get(pluginFactory);
			auto count = instance.call(factory.get_plugin_count, pluginFactory);
			for (uint32_t i = 0; i < count; ++i) {
				auto ptr = instance.call(factory.get_plugin_descriptor, pluginFactory, i);
				if (!ptr) continue;
				auto descriptor = instance.get(ptr);

				char str[256] = "";
				auto copyString = [&](const char *key, wclap32::Pointer<const char> ptr) {
					if (!ptr) return;
					cbor.addUtf8(key);
					instance.getArray(ptr, str, 255);
					cbor.addUtf8(str);
				};

				cbor.openMap();
				copyString("id", descriptor.id);
				copyString("name", descriptor.name);
				copyString("vendor", descriptor.vendor);
				copyString("description", descriptor.description);
				cbor.close();
			}
		}
		
		cbor.close(); // array
		cbor.close(); // map
		return cborReturn();
	}
}
