/*
	Hosts a single WCLAP instance, and exports a simpler API for use in JS
 */
#include "wclap/wclap.hpp"
#include "./wclap-instance-js.h"

#include "cbor-walker/cbor-walker.h"

#include <cstring>

__attribute__((import_module("env"), import_name("cborResult")))
extern void cborResult(unsigned char *bytes, size_t length);

static Instance *wclapInstance = nullptr;
static wclap32::wclap_plugin_entry wclapEntry;

extern "C" {
	bool setInstance(Instance *instance) {
		if (instance->is64()) return false;

		// TODO: register host methods here
		auto entryPtr = instance->init32();
		if (!entryPtr) return false;

		const char *path = instance->path();
		auto remoteStr = instance->malloc32(std::strlen(path) + 1).cast<char>();
		instance->setArray(remoteStr, path, std::strlen(path) + 1);

		wclapInstance = instance;
		wclapEntry = instance->get(entryPtr);

		return instance->call(wclapEntry.init, remoteStr);
	}
	
	void getInfo(Instance *instance) {
		std::vector<unsigned char> reply;
		signalsmith::cbor::CborWriter cbor{reply};
		cbor.openMap();
		
		const char *factoryId = "clap.plugin-factory";
		auto remoteStr = instance->malloc32(std::strlen(factoryId) + 1).cast<char>();
		instance->setArray(remoteStr, factoryId, std::strlen(factoryId) + 1);
		
		cbor.addUtf8("CLAP");
		cbor.openArray(3);
		cbor.addInt(wclapEntry.wclap_version.major);
		cbor.addInt(wclapEntry.wclap_version.minor);
		cbor.addInt(wclapEntry.wclap_version.revision);

		cbor.addUtf8("path");
		cbor.addUtf8(instance->path());

		cbor.addUtf8("plugins");
		cbor.openArray();
		
		auto pluginFactory = instance->call(wclapEntry.get_factory, remoteStr)
			.cast<wclap32::wclap_plugin_factory>();
		if (pluginFactory) {
			auto factory = instance->get(pluginFactory);
			auto count = instance->call(factory.get_plugin_count, pluginFactory);
			for (uint32_t i = 0; i < count; ++i) {
				auto ptr = instance->call(factory.get_plugin_descriptor, pluginFactory, i);
				if (!ptr) continue;
				auto descriptor = instance->get(ptr);

				char str[256] = "";
				auto copyString = [&](const char *key, wclap32::Pointer<const char> ptr) {
					if (!ptr) return;
					cbor.addUtf8(key);
					instance->getArray(ptr, str, 255);
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
		cborResult(reply.data(), reply.size());
	}
}
