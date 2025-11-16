import addExtension from "./add-extension.mjs"

addExtension("clap.webview/3", {
	wasm: {
		ext_webview_send: 'ippi'
	},
	js: {
		// This is the name on the host struct, so it means the plugin has sent us a message
		ext_webview_send(voidPointer, length) {
			return false;
		}
	},
	addTypes(api, methods) {
		api.clap_plugin_webview = api.makeStruct(
			{get_uri: api.makeFunc(api.pointer, api.pointer, api.u32)},
			{get_resource: api.makeFunc(api.pointer, api.string, api.pointer, api.u32, api.pointer)},
			{receive: api.makeFunc(api.pointer, api.pointer, api.u32)}
		);
		api.clap_host_webview = api.makeStruct(
			{send: api.makeFunc(api.pointer, api.pointer, api.u32)}
		);
		return api.save(api.clap_host_webview, {
			send: methods.ext_webview_send
		});
	},
	readPlugin(api, pointer, pluginPtr) {
		return api.clap_plugin_webview(pointer, pluginPtr);
	}
});
