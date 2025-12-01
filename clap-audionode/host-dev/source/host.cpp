#include <iostream>
#ifndef LOG_EXPR
#	define LOG_EXPR(expr) std::cout << #expr " = " << (expr) << std::endl;
#endif

/*
	Hosts WCLAP instances, manages plugins, and exports a simpler API for use from JS
*/
#include "./hosted-wclap.h"
#include "./hosted-plugin.h"

extern "C" {
	HostedWclap * makeHosted(Instance *instance) {
		return HostedWclap::create(instance);
	}
	void removeHosted(HostedWclap *hosted) {
		delete hosted;
	}
	CborValue * getInfo(HostedWclap *hosted) {
		return hosted->getInfo();
	}

	HostedPlugin * createPlugin(HostedWclap *hosted, CborValue *cbor) {
		 auto pluginId = cbor->read().utf8();
		 return hosted->createPlugin(pluginId.c_str());
	}
	void destroyPlugin(HostedPlugin *plugin) {
		delete plugin;
	}
	CborValue * pluginGetInfo(HostedPlugin *plugin) {
		return plugin->getInfo();
	}
	void pluginMessage(HostedPlugin *plugin, unsigned char *bytes, uint32_t length) {
		plugin->message(bytes, length);
	}
}
