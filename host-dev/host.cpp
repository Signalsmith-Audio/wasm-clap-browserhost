/*
	Hosts a single WCLAP instance, and exports a simpler API for use in JS
 */
#include "wclap/wclap.hpp"
#include "./wclap-instance-js.h"

static Instance *wclapInstance;

extern "C" {
	bool setInstance(Instance *instance) {
		if (instance->is64()) return false;
		wclapInstance = instance;
		return true;
	}
}
