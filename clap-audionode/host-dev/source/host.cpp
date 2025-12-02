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
	CborValue * pluginGetParams(HostedPlugin *plugin) {
		return plugin->getParams();
	}
	CborValue * pluginGetParam(HostedPlugin *plugin, uint32_t paramId) {
		return plugin->getParam(paramId);
	}
	void pluginSetParam(HostedPlugin *plugin, uint32_t paramId, double value) {
		return plugin->setParam(paramId, value);
	}
	CborValue * pluginStart(HostedPlugin *plugin, double sRate, uint32_t minFrames, uint32_t maxFrames) {
		return plugin->start(sRate, minFrames, maxFrames);
	}
	void pluginStop(HostedPlugin *plugin) {
		return plugin->stop();
	}
	bool pluginAcceptEvent(HostedPlugin *plugin, const void *header) {
		return plugin->acceptEvent(header);
	}

	uint32_t pluginProcess(HostedPlugin *plugin, uint32_t blockLength) {
		return plugin->process(blockLength);
	}
}
