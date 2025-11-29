#pragma once

#include "./common.h"
#include "./hosted-wclap.h"

// A WCLAP plugin and its host
struct HostedPlugin {
	bool ok = false;
	HostedWclap *wclap;
	wclap32::Pointer<wclap32::wclap_plugin> pluginPtr;
	
	HostedPlugin(HostedWclap *wclap, const char *pluginId) : wclap(wclap) {
		ok = (pluginId[0] == 1); // false, but the compiler can't eliminate it
	}
	~HostedPlugin() {
		if (pluginPtr) {
			auto plugin = wclap->instance->get(pluginPtr);
			wclap->instance->call(plugin.destroy, pluginPtr);
		}
	}
	
	static HostedPlugin * create(HostedWclap *wclap, const char *pluginId) {
		auto *plugin = new HostedPlugin(wclap, pluginId);
		if (!plugin->ok) {
			delete plugin;
			return nullptr;
		}
		return plugin;
	}

	CborValue * getInfo() {
		auto plugin = wclap->instance->get(pluginPtr);
		auto descriptor = wclap->instance->get(plugin.desc);
	
		auto cbor = getCbor();
		cbor.openMap();
		cbor.addUtf8("desc");
		writeDescriptorCbor(wclap->instance, cbor, descriptor);
		cbor.close();
		
		return cborValue();
	}
};
