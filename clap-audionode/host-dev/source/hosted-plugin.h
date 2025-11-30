#pragma once

#include "./common.h"

// A WCLAP plugin and its host
struct HostedPlugin {
	uint32_t pluginIndex = uint32_t(-1);

	Instance *instance;
	using Arena = wclap::MemoryArena<Instance, false>;
	using ArenaPtr = std::unique_ptr<Arena>;
	ArenaPtr arena;
		
	wclap32::Pointer<const wclap32::wclap_plugin> pluginPtr;
	wclap32::wclap_plugin wclapPlugin;
	
	HostedPlugin(wclap32::Pointer<const wclap32::wclap_plugin> pluginPtr, Instance *instance, ArenaPtr arena) : pluginPtr(pluginPtr), instance(instance), arena(std::move(arena)) {}
	~HostedPlugin() {
		if (pluginPtr) {
			auto plugin = instance->get(pluginPtr);
			instance->call(plugin.destroy, pluginPtr);
		}
		arena->pool.returnToPool(arena);
	}

	void init() {
		wclapPlugin = instance->get(pluginPtr);
		instance->call(wclapPlugin.init, pluginPtr);
	}
	
	CborValue * getInfo() {
		auto plugin = instance->get(pluginPtr);
		auto descriptor = instance->get(plugin.desc);
	
		auto cbor = getCbor();
		cbor.openMap();
		cbor.addUtf8("desc");
		writeDescriptorCbor(instance, cbor, descriptor);
		cbor.close();
		
		return cborValue();
	}
	
	void hostRequestRestart() {
		LOG_EXPR("host.request_restart()");
	}
	void hostRequestProcess() {
		LOG_EXPR("host.request_process()");
	}
	void hostRequestCallback() {
		LOG_EXPR("host.request_callback()");
	}
	
	void paramsRescan(uint32_t flags) {
		LOG_EXPR("host_params.rescan()");
	}
	void paramsClear(uint32_t paramId, uint32_t flags) {
		LOG_EXPR("host_params.clear()");
	}
	void paramsRequestFlush() {
		LOG_EXPR("host_params.request_flush()");
	}
	
	void guiResizeHintsChanged() {
		LOG_EXPR("host_gui.resize_hints_changed()");
	}
	bool guiRequestResize(uint32_t width, uint32_t height) {
		LOG_EXPR("host_gui.request_resize()");
		return false;
	}
	bool guiRequestShow() {
		LOG_EXPR("host_gui.request_show()");
		return false;
	}
	bool guiRequestHide() {
		LOG_EXPR("host_gui.request_hide()");
		return false;
	}
	bool guiClosed(bool wasDestroyed) {
		LOG_EXPR("host_gui.closed()");
		return false;
	}
	
	bool webviewSend(wclap32::Pointer<const void> buffer, uint32_t size) {
		LOG_EXPR("host_webview.send()");
		return false;
	}
};
