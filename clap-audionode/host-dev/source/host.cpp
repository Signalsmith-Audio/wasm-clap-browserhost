#include <iostream>
#ifndef LOG_EXPR
#	define LOG_EXPR(expr) std::cout << #expr " = " << (expr) << std::endl;
#endif

/*
	Hosts WCLAP instances, manages plugins, and exports a simpler API for use from JS
*/
#include "./hosted-wclap.h"
#include "./hosted-plugin.h"

#include "./cbor-bytes.h"

extern "C" {
	HostedWclap * makeHosted(Instance *instance) {
		return HostedWclap::create(instance);
	}
	void removeHosted(HostedWclap *hosted) {
		delete hosted;
	}
	void getInfo(HostedWclap *hosted, Bytes *bytes) {
		auto cbor = bytes->write();
		return hosted->getInfo(cbor);
	}

	HostedPlugin * createPlugin(HostedWclap *hosted, Bytes *bytes) {
		auto pluginId = bytes->readString();
		LOG_EXPR(pluginId);
		return hosted->createPlugin(pluginId.c_str());
	}
	void destroyPlugin(HostedPlugin *plugin) {
		delete plugin;
	}
	void pluginMainThread(HostedPlugin *plugin) {
		plugin->mainThread();
	}
	void pluginGetInfo(HostedPlugin *plugin, Bytes *bytes) {
		auto cbor = bytes->write();
		return plugin->getInfo(cbor);
	}
	void pluginMessage(HostedPlugin *plugin, Bytes *bytes) {
		plugin->message(bytes->buffer.data(), bytes->buffer.size());
	}
	bool pluginGetResource(HostedPlugin *plugin, Bytes *bytes) {
		auto pathStr = bytes->readString();
		auto cbor = bytes->write();
		return plugin->getResource(pathStr, cbor);
	}
	void pluginGetParams(HostedPlugin *plugin, Bytes *bytes) {
		auto cbor = bytes->write();
		plugin->getParams(cbor);
	}
	void pluginGetParam(HostedPlugin *plugin, uint32_t paramId, Bytes *bytes) {
		auto cbor = bytes->write();
		plugin->getParam(paramId, cbor);
	}
	void pluginSetParam(HostedPlugin *plugin, uint32_t paramId, double value) {
		plugin->setParam(paramId, value);
	}
	void pluginParamsFlush(HostedPlugin *plugin) {
		plugin->paramsFlush();
	}
	bool pluginStart(HostedPlugin *plugin, double sRate, uint32_t minFrames, uint32_t maxFrames, Bytes *bytes) {
		auto cbor = bytes->write();
		return plugin->start(sRate, minFrames, maxFrames, cbor);
	}
	void pluginStop(HostedPlugin *plugin) {
		return plugin->stop();
	}
	bool pluginAcceptEvent(HostedPlugin *plugin, Bytes *bytes) {
		return plugin->acceptEvent(bytes->buffer.data());
	}

	bool pluginSaveState(HostedPlugin *plugin, Bytes *bytes) {
		return plugin->saveState(bytes->buffer);
	}
	bool pluginLoadState(HostedPlugin *plugin, Bytes *bytes) {
		return plugin->loadState(bytes->buffer);
	}

	uint32_t pluginProcess(HostedPlugin *plugin, uint32_t blockLength) {
		return plugin->process(blockLength);
	}
}
