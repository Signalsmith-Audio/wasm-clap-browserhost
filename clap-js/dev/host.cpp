#include "wclap/wclap.hpp"

#include "./browser-wasm-instance.h"

__attribute__((import_module("env"), import_name("log")))
extern void log_bytes(const char *ptr, size_t length);

extern "C" {
	void connectInstance(Instance *instance) {
		instance->init32();
	}
}
