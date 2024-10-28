import addExtension from "./add-extension.mjs"

addExtension("clap.state", {
	wasm: {
		ext_state_mark_dirty: 'vp'
	},
	js: {
		ext_state_mark_dirty(severity, message) {
			// nothing by default
		}
	},
	// Add any supporting types to the API, and (optionally) return a static pointer for the extension, so all host instances can re-use the same one.
	addTypes: (api, methods) => {
		api.clap_plugin_state = api.makeStruct(
			{save: api.makeFunc(api.pointer, api.pointer)},
			{load: api.makeFunc(api.pointer, api.pointer)}
		);
		api.clap_host_state = api.makeStruct(
			{mark_dirty: api.makeFunc(api.pointer)}
		);

		return api.save(api.clap_host_state, {
			mark_dirty: methods.ext_state_mark_dirty
		});
	},
	// Write the host struct, returning the pointer for `get_extension()`
	/*
	writeHost(api, methods) {
		return api.save(api.clap_host_log, {
			log: methods.ext_log_log // WASM function pointer which proxies to the JS version
		})
	},
	*/
	// Read the plugin struct (if the plugin supports it) - the result goes in ext['clap.???']
	readPlugin(api, pointer, pluginPtr) {
		return api.clap_plugin_state(pointer, pluginPtr);
	},
});
