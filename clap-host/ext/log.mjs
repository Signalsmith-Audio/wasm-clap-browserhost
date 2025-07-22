import addExtension from "./add-extension.mjs"

addExtension("clap.log", {
	wasm: {
		ext_log_log: 'vpip'
	},
	js: {
		ext_log_log(severity, message) {
			let api = this.api;
			message = api.fromArg(api.string, message);
			api.log(`host log (${severity}): ${message}`);
		}
	},
	// Add any supporting types to the API, and (optionally) return a static pointer for the extension, so all host instances can re-use the same one.
	addTypes: (api, methods) => {
		let clap_log_severity = api.clap_log_severity = api.i32;
		api.clap_host_log = api.makeStruct(
			{log: api.makeFunc(api.pointer, clap_log_severity, api.string)}
		);
		Object.assign(api, {
			CLAP_LOG_DEBUG: 0,
			CLAP_LOG_INFO: 1,
			CLAP_LOG_WARNING: 2,
			CLAP_LOG_ERROR: 3,
			CLAP_LOG_FATAL: 4,
			CLAP_LOG_HOST_MISBEHAVING: 5,
			CLAP_LOG_PLUGIN_MISBEHAVING: 6,
		});

		return api.save(api.clap_host_log, {
			log: methods.ext_log_log // WASM function pointer which proxies to the JS version
		})
	},
	// Read the plugin struct (if the plugin supports it) - the result goes in ext['clap.log']
	readPlugin(api, pointer, pluginPtr) {
		throw Error("Plugins shouldn't return clap.log: " + pointer);
	},
});
