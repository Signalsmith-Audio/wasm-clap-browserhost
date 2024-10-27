import addExtension from "./add-extension.mjs"

addExtension("clap.audio-ports", {
	wasm: {
		ext_audio_ports_is_rescan_flag_supported: 'bpi',
		ext_audio_ports_rescan: 'vpi',
	},
	js: {
		ext_audio_ports_is_rescan_flag_supported(flags) {
			return false;
		},
		ext_audio_ports_rescan(paramId, flags) {
			throw Error("not implemented");
		},
	},
	// Add any supporting types to the API, and (optionally) return a static pointer for the extension, so all host instances can re-use the same one.
	addTypes: (api, methods) => {
		let func = api.makeFunc;
		let clap_audio_port_info = api.clap_audio_port_info = api.makeStruct(
			{id: api.clap_id},
			{name: api.clap_name},
			{flags: api.u32},
			{channel_count: api.u32},
			{port_type: api.string},
			{in_place_pair: api.clap_id}
		);
		api.clap_plugin_audio_ports = api.makeStruct(
			{count: func('pointer', 'bool')},
			{get: func('pointer', 'u32', 'bool', 'pointer')}
		);
		api.clap_host_audio_ports = api.makeStruct(
			{is_rescan_flag_supported: func('pointer', 'u32')},
			{rescan: func('pointer', 'u32')}
		);

		Object.assign(api, {
			CLAP_PORT_MONO: "mono",
			CLAP_PORT_STEREO: "stereo",

			CLAP_AUDIO_PORT_IS_MAIN: 1<<0,
			CLAP_AUDIO_PORT_SUPPORTS_64BITS: 1<<1,
			CLAP_AUDIO_PORT_PREFERS_64BITS: 1<<2,
			CLAP_AUDIO_PORT_REQUIRES_COMMON_SAMPLE_SIZE: 1<<3,

			CLAP_AUDIO_PORTS_RESCAN_NAMES: 1<<0,
			CLAP_AUDIO_PORTS_RESCAN_FLAGS: 1<<1,
			CLAP_AUDIO_PORTS_RESCAN_CHANNEL_COUNT: 1<<2,
			CLAP_AUDIO_PORTS_RESCAN_PORT_TYPE: 1<<3,
			CLAP_AUDIO_PORTS_RESCAN_IN_PLACE_PAIR: 1<<4,
			CLAP_AUDIO_PORTS_RESCAN_LIST: 1<<5,
   		});
		
		return api.save(api.clap_host_audio_ports, {
			is_rescan_flag_supported: methods.ext_audio_ports_is_rescan_flag_supported,
			rescan: methods.ext_audio_ports_rescan,
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
	// Read the plugin struct (if the plugin supports it) - the result goes in ext['clap.log']
	readPlugin(api, pointer, pluginPtr) {
		return api.clap_plugin_audio_ports(pointer, pluginPtr);
	},
});
