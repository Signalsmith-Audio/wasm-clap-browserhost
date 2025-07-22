import addExtension from "./add-extension.mjs"

addExtension("clap.params", {
	wasm: {
		ext_params_rescan: 'vpi',
		ext_params_clear: 'vpii',
		ext_params_request_flush: 'vp'
	},
	js: {
		ext_params_rescan(flags) {
			throw Error("not implemented");
		},
		ext_params_clear(paramId, flags) {
			throw Error("not implemented");
		},
		ext_params_request_flush() {
			throw Error("not implemented");
		},
	},
	// Add any supporting types to the API, and (optionally) return a static pointer for the extension, so all host instances can re-use the same one.
	addTypes: (api, methods) => {
		let clap_param_info_flags = api.clap_param_info_flags = api.u32;
		api.clap_param_info = api.makeStruct(
			{id: api.clap_id},
			{flags: clap_param_info_flags},
			{cookie: api.pointer},
			{name: api.clap_name},
			{module: api.clap_path},
			{min_value: api.f64},
			{max_value: api.f64},
			{default_value: api.f64}
		);
		let func = api.makeFunc;
		api.clap_plugin_params = api.makeStruct(
			{count: func('pointer')},
			{get_info: func('pointer', 'u32', 'pointer')},
			{get_value: func('pointer', 'clap_id', 'pointer')},
			{value_to_text: func('pointer', 'clap_id', 'f64', 'pointer', 'u32')},
			{text_to_value: func('pointer', 'clap_id', 'string', 'pointer')},
			{flush: func('pointer', 'pointer', 'pointer')}
		);
		let clap_param_rescan_flags = api.clap_param_rescan_flags = api.u32;
		let clap_param_clear_flags = api.clap_param_clear_flags = api.u32;
		api.clap_host_params = api.makeStruct(
			{rescan: func('pointer', 'clap_param_rescan_flags')},
			{clear: func('pointer', 'clap_id', 'clap_param_clear_flags')},
			{request_flush: func('pointer')}
		);
		Object.assign(api, {
			CLAP_PARAM_IS_STEPPED: 1<<0,
			CLAP_PARAM_IS_PERIODIC: 1<<1,
			CLAP_PARAM_IS_HIDDEN: 1<<2,
			CLAP_PARAM_IS_READONLY: 1<<3,
			CLAP_PARAM_IS_BYPASS: 1<<4,
			CLAP_PARAM_IS_AUTOMATABLE: 1<<5,
			CLAP_PARAM_IS_AUTOMATABLE_PER_NOTE_ID: 1<<6,
			CLAP_PARAM_IS_AUTOMATABLE_PER_KEY: 1<<7,
			CLAP_PARAM_IS_AUTOMATABLE_PER_CHANNEL: 1<<8,
			CLAP_PARAM_IS_AUTOMATABLE_PER_PORT: 1<<9,
			CLAP_PARAM_IS_MODULATABLE: 1<<10,
			CLAP_PARAM_IS_MODULATABLE_PER_NOTE_ID: 1<<11,
			CLAP_PARAM_IS_MODULATABLE_PER_KEY: 1<<12,
			CLAP_PARAM_IS_MODULATABLE_PER_CHANNEL: 1<<13,
			CLAP_PARAM_IS_MODULATABLE_PER_PORT: 1<<14,
			CLAP_PARAM_REQUIRES_PROCESS: 1<<15,
			CLAP_PARAM_IS_ENUM: 1<<16,

			CLAP_PARAM_RESCAN_VALUES: 1<<0,
			CLAP_PARAM_RESCAN_TEXT: 1<<1,
			CLAP_PARAM_RESCAN_INFO: 1<<2,
			CLAP_PARAM_RESCAN_ALL: 1<<3,

			CLAP_PARAM_CLEAR_ALL: 1<<0,
			CLAP_PARAM_CLEAR_AUTOMATIONS: 1<<1,
			CLAP_PARAM_CLEAR_MODULATIONS: 1<<2,
		});
		
		return api.save(api.clap_host_params, {
			rescan: methods.ext_params_rescan,
			clear: methods.ext_params_clear,
			request_flush: methods.ext_params_request_flush
		});
	},
	// Read the plugin struct (if the plugin supports it) - the result goes in ext['clap.log']
	readPlugin(api, pointer, pluginPtr) {
		return api.clap_plugin_params(pointer, pluginPtr);
	},
});
