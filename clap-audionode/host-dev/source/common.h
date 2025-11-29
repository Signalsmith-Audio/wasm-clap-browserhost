#pragma once

// Use `wclap-cpp` and the JS implementation of Instance
#include "wclap/wclap.hpp"
#include "wclap/memory-arena.hpp"
#include "./wclap-js-instance.h"

#include "./cbor-value.h"

template<class InstancePtr, class Cbor, class Descriptor>
void writeDescriptorCbor(InstancePtr &instance, Cbor &cbor, Descriptor descriptor) {
	char str[256] = "";
	auto copyString = [&](const char *key, wclap32::Pointer<const char> ptr) {
		if (!ptr) return;
		if (key) cbor.addUtf8(key);
		auto length = instance->countUntil(ptr, 0, 255);
		instance->getArray(ptr, str, length + 1);
		cbor.addUtf8(str);
	};
	
	cbor.openMap();
	copyString("id", descriptor.id);
	copyString("name", descriptor.name);
	copyString("vendor", descriptor.vendor);
	copyString("description", descriptor.description);
	
	cbor.addUtf8("features");
	cbor.openArray();
	auto featuresPtr = descriptor.features;
	if (featuresPtr) {
		while (1) {
			auto strPtr = instance->get(featuresPtr);
			if (!strPtr) break;
			copyString(nullptr, strPtr);
			featuresPtr += 1;
		}
	}
	cbor.close(); // features array
	
	cbor.close(); // description
}
