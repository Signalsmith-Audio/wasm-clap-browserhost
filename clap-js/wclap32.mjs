const WCLAP32 = (mem, functionTable, scratchArena) => {
function read(addr) {
	return this.readWith(addr, new DataView(mem.buffer));
}
function write(addr, value) {
	return this.writeWith(addr, value, new DataView(mem.buffer));
}

let api = {
	// Typed pointer
	pointer: type => ({
		fromUntyped: pointer => ({
			pointer: pointer,
			valueOf() {
				return this.pointer;
			},
			getAs(otherType, index) {
				if (typeof otherType == 'string') otherType = api[otherType];
				let itemPointer = this.pointer + (index || 0)*otherType.size;
				return otherType.read(itemPointer);
			},
			get(index) {
				let itemPointer = this.pointer + (index || 0)*type.size;
				return type.read(itemPointer);
			},
			set(value, index) {
				let itemPointer = this.pointer + (index || 0)*type.size;
				return type.write(itemPointer, value);
			}
		}),
		read: read,
		readWith(addr, dataView) {
			return this.fromUntyped(api.uint32.readWith(addr, dataView));
		},
		write: write,
		writeWith(addr, ptr, dataView) {
			if (ptr == null) ptr = 0;
			if (typeof ptr.pointer == 'number') ptr = ptr.pointer;
			if (typeof ptr != 'number') throw Error("invalid pointer value");
			api.uint32.writeWith(addr, ptr, dataView);
		},
		size: 4,
		align: 4
	}),
	// Fixed-length arrays
	array: (type, length) => ({
		read: read,
		readWith(addr, dataView) {
			let result = [];
			for (let i = 0; i < length; ++i) {
				result.push(type.readWith(addr + i*type.size, dataView));
			}
			return result;
		},
		write: write,
		writeWith(addr, list, dataView) {
			for (let i = 0; i < length; ++i) {
				type.writeWith(addr + i*type.size, list[i], dataView);
			}
		},
		size: type.size*length,
		align: type.align
	}),
	// Functions
	method: (retType, ...argTypes) => ({
		read: read,
		readWith(addr, dataView) {
			let fnIndex = api.uint32.readWith(addr, dataView);
			let fn = functionTable.get(fnIndex);
			return (...args) => {
				let result = scratchArena.scoped(_ => {
					args = args.map(arg => {
						if (arg === null) arg = 0;
						if (typeof arg == 'boolean') return +arg;
						if (typeof arg?.pointer == 'number') return arg.pointer;
						if (typeof arg == 'number') return arg;
						if (typeof arg == 'string') return scratchArena.writeString(arg);
						console.error(typeof arg, arg);
						throw Error("all WASM arguments need to be number/bool/pointer");
					});
					return fn(...args);
				});
				if (retType?.fromUntyped) {
					return retType.fromUntyped(result);
				}
				return result;
			};
		},
		write: write,
		writeWith(addr, jsFn) {
			throw Error("writing methods not implemented");
		},
		size: 4,
		align: 4
	}),
	// Numeric types
	float: {
		readWith: (addr, dataView) => dataView.getFloat32(addr, true),
		writeWith: (addr, value, dataView) => dataView.setFloat32(addr, value, true),
		size: 4,
		align: 4
	},
	double: {
		readWith: (addr, dataView) => dataView.getFloat64(addr, true),
		writeWith: (addr, value, dataView) => dataView.setFloat64(addr, value, true),
		size: 8,
		align: 8
	},
	int8: {
		readWith: (addr, dataView) => dataView.getInt8(addr),
		writeWith: (addr, value, dataView) => dataView.setInt8(addr, value),
		size: 1,
		align: 1
	},
	uint8: {
		readWith: (addr, dataView) => dataView.getUint8(addr),
		writeWith: (addr, value, dataView) => dataView.setUint8(addr, value),
		size: 1,
		align: 1
	},
	int16: {
		readWith: (addr, dataView) => dataView.getInt16(addr, true),
		writeWith: (addr, value, dataView) => dataView.setInt16(addr, value, true),
		size: 2,
		align: 2
	},
	uint16: {
		readWith: (addr, dataView) => dataView.getUint16(addr, true),
		writeWith: (addr, value, dataView) => dataView.setUint16(addr, value, true),
		size: 2,
		align: 2
	},
	int32: {
		readWith: (addr, dataView) => dataView.getInt32(addr, true),
		writeWith: (addr, value, dataView) => dataView.setInt32(addr, value, true),
		size: 4,
		align: 4
	},
	uint32: {
		readWith: (addr, dataView) => dataView.getUint32(addr, true),
		writeWith: (addr, value, dataView) => dataView.setUint32(addr, value, true),
		size: 4,
		align: 4
	},
	int64: {
		readWith: (addr, dataView) => dataView.getBigInt64(addr, true),
		writeWith: (addr, value, dataView) => dataView.setBigInt64(addr, value, true),
		size: 8,
		align: 8
	},
	uint64: {
		readWith: (addr, dataView) => dataView.getBigUint64(addr, true),
		writeWith: (addr, value, dataView) => dataView.setBigUint64(addr, value, true),
		size: 8,
		align: 8
	},
	// CLAP types
	CLAP_VERSION_MAJOR: 1,
	CLAP_VERSION_MINOR: 2,
	CLAP_VERSION_REVISION: 7,
	CLAP_EVENT_NOTE_ON: 0,
	CLAP_EVENT_NOTE_OFF: 1,
	CLAP_EVENT_NOTE_CHOKE: 2,
	CLAP_EVENT_NOTE_END: 3,
	CLAP_EVENT_NOTE_EXPRESSION: 4,
	CLAP_EVENT_PARAM_VALUE: 5,
	CLAP_EVENT_PARAM_MOD: 6,
	CLAP_EVENT_PARAM_GESTURE_BEGIN: 7,
	CLAP_EVENT_PARAM_GESTURE_END: 8,
	CLAP_EVENT_TRANSPORT: 9,
	CLAP_EVENT_MIDI: 10,
	CLAP_EVENT_MIDI_SYSEX: 11,
	CLAP_EVENT_MIDI2: 12,
	CLAP_NOTE_EXPRESSION_VOLUME: 0,
	CLAP_NOTE_EXPRESSION_PAN: 1,
	CLAP_NOTE_EXPRESSION_TUNING: 2,
	CLAP_NOTE_EXPRESSION_VIBRATO: 3,
	CLAP_NOTE_EXPRESSION_EXPRESSION: 4,
	CLAP_NOTE_EXPRESSION_BRIGHTNESS: 5,
	CLAP_NOTE_EXPRESSION_PRESSURE: 6,
	CLAP_PROCESS_ERROR: 0,
	CLAP_PROCESS_CONTINUE: 1,
	CLAP_PROCESS_CONTINUE_IF_NOT_QUIET: 2,
	CLAP_PROCESS_TAIL: 3,
	CLAP_PROCESS_SLEEP: 4,
	CLAP_NAME_SIZE: 256,
	CLAP_PATH_SIZE: 1024,
	CLAP_AUDIO_PORT_IS_MAIN: 1,
	CLAP_AUDIO_PORT_SUPPORTS_64BITS: 2,
	CLAP_AUDIO_PORT_PREFERS_64BITS: 4,
	CLAP_AUDIO_PORT_REQUIRES_COMMON_SAMPLE_SIZE: 8,
	CLAP_AUDIO_PORTS_RESCAN_NAMES: 1,
	CLAP_AUDIO_PORTS_RESCAN_FLAGS: 2,
	CLAP_AUDIO_PORTS_RESCAN_CHANNEL_COUNT: 4,
	CLAP_AUDIO_PORTS_RESCAN_PORT_TYPE: 8,
	CLAP_AUDIO_PORTS_RESCAN_IN_PLACE_PAIR: 16,
	CLAP_AUDIO_PORTS_RESCAN_LIST: 32,
	CLAP_CONTEXT_MENU_TARGET_KIND_GLOBAL: 0,
	CLAP_CONTEXT_MENU_TARGET_KIND_PARAM: 1,
	CLAP_LOG_DEBUG: 0,
	CLAP_LOG_INFO: 1,
	CLAP_LOG_WARNING: 2,
	CLAP_LOG_ERROR: 3,
	CLAP_LOG_FATAL: 4,
	CLAP_LOG_HOST_MISBEHAVING: 5,
	CLAP_LOG_PLUGIN_MISBEHAVING: 6,
	CLAP_NOTE_PORTS_RESCAN_ALL: 1,
	CLAP_NOTE_PORTS_RESCAN_NAMES: 2,
	CLAP_PARAM_IS_STEPPED: 1,
	CLAP_PARAM_IS_PERIODIC: 2,
	CLAP_PARAM_IS_HIDDEN: 4,
	CLAP_PARAM_IS_READONLY: 8,
	CLAP_PARAM_IS_BYPASS: 16,
	CLAP_PARAM_IS_AUTOMATABLE: 32,
	CLAP_PARAM_IS_AUTOMATABLE_PER_NOTE_ID: 64,
	CLAP_PARAM_IS_AUTOMATABLE_PER_KEY: 128,
	CLAP_PARAM_IS_AUTOMATABLE_PER_CHANNEL: 256,
	CLAP_PARAM_IS_AUTOMATABLE_PER_PORT: 512,
	CLAP_PARAM_IS_MODULATABLE: 1024,
	CLAP_PARAM_IS_MODULATABLE_PER_NOTE_ID: 2048,
	CLAP_PARAM_IS_MODULATABLE_PER_KEY: 4096,
	CLAP_PARAM_IS_MODULATABLE_PER_CHANNEL: 8192,
	CLAP_PARAM_IS_MODULATABLE_PER_PORT: 16384,
	CLAP_PARAM_REQUIRES_PROCESS: 32768,
	CLAP_PARAM_IS_ENUM: 65536,
	CLAP_PARAM_RESCAN_VALUES: 1,
	CLAP_PARAM_RESCAN_TEXT: 2,
	CLAP_PARAM_RESCAN_INFO: 4,
	CLAP_PARAM_RESCAN_ALL: 8,
	CLAP_PARAM_CLEAR_ALL: 1,
	CLAP_PARAM_CLEAR_AUTOMATIONS: 2,
	CLAP_PARAM_CLEAR_MODULATIONS: 4,
	CLAP_PARAM_INDICATION_AUTOMATION_NONE: 0,
	CLAP_PARAM_INDICATION_AUTOMATION_PRESENT: 1,
	CLAP_PARAM_INDICATION_AUTOMATION_PLAYING: 2,
	CLAP_PARAM_INDICATION_AUTOMATION_RECORDING: 3,
	CLAP_PARAM_INDICATION_AUTOMATION_OVERRIDING: 4,
	CLAP_POSIX_FD_READ: 1,
	CLAP_POSIX_FD_WRITE: 2,
	CLAP_POSIX_FD_ERROR: 4,
	CLAP_REMOTE_CONTROLS_COUNT: 8,
	CLAP_RENDER_REALTIME: 0,
	CLAP_RENDER_OFFLINE: 1,
	CLAP_SURROUND_FL: 0,
	CLAP_SURROUND_FR: 1,
	CLAP_SURROUND_FC: 2,
	CLAP_SURROUND_LFE: 3,
	CLAP_SURROUND_BL: 4,
	CLAP_SURROUND_BR: 5,
	CLAP_SURROUND_FLC: 6,
	CLAP_SURROUND_FRC: 7,
	CLAP_SURROUND_BC: 8,
	CLAP_SURROUND_SL: 9,
	CLAP_SURROUND_SR: 10,
	CLAP_SURROUND_TC: 11,
	CLAP_SURROUND_TFL: 12,
	CLAP_SURROUND_TFC: 13,
	CLAP_SURROUND_TFR: 14,
	CLAP_SURROUND_TBL: 15,
	CLAP_SURROUND_TBC: 16,
	CLAP_SURROUND_TBR: 17,
	CLAP_SURROUND_TSL: 18,
	CLAP_SURROUND_TSR: 19,
	CLAP_TRACK_INFO_HAS_TRACK_NAME: 1,
	CLAP_TRACK_INFO_HAS_TRACK_COLOR: 2,
	CLAP_TRACK_INFO_HAS_AUDIO_CHANNEL: 4,
	CLAP_TRACK_INFO_IS_FOR_RETURN_TRACK: 8,
	CLAP_TRACK_INFO_IS_FOR_BUS: 16,
	CLAP_TRACK_INFO_IS_FOR_MASTER: 32,
	CLAP_VOICE_INFO_SUPPORTS_OVERLAPPING_NOTES: 1,
	CLAP_TRIGGER_IS_AUTOMATABLE_PER_NOTE_ID: 1,
	CLAP_TRIGGER_IS_AUTOMATABLE_PER_KEY: 2,
	CLAP_TRIGGER_IS_AUTOMATABLE_PER_CHANNEL: 4,
	CLAP_TRIGGER_IS_AUTOMATABLE_PER_PORT: 8,
	CLAP_EVENT_TRIGGER: 0,
	CLAP_TRIGGER_RESCAN_INFO: 1,
	CLAP_TRIGGER_RESCAN_ALL: 2,
	CLAP_TRIGGER_CLEAR_ALL: 1,
	CLAP_TRIGGER_CLEAR_AUTOMATIONS: 2,
	CLAP_PLUGIN_FEATURE_INSTRUMENT: "instrument",
	CLAP_PLUGIN_FEATURE_AUDIO_EFFECT: "audio-effect",
	CLAP_PLUGIN_FEATURE_NOTE_EFFECT: "note-effect",
	CLAP_PLUGIN_FEATURE_NOTE_DETECTOR: "note-detector",
	CLAP_PLUGIN_FEATURE_ANALYZER: "analyzer",
	CLAP_PLUGIN_FEATURE_SYNTHESIZER: "synthesizer",
	CLAP_PLUGIN_FEATURE_SAMPLER: "sampler",
	CLAP_PLUGIN_FEATURE_DRUM: "drum",
	CLAP_PLUGIN_FEATURE_DRUM_MACHINE: "drum-machine",
	CLAP_PLUGIN_FEATURE_FILTER: "filter",
	CLAP_PLUGIN_FEATURE_PHASER: "phaser",
	CLAP_PLUGIN_FEATURE_EQUALIZER: "equalizer",
	CLAP_PLUGIN_FEATURE_DEESSER: "de-esser",
	CLAP_PLUGIN_FEATURE_PHASE_VOCODER: "phase-vocoder",
	CLAP_PLUGIN_FEATURE_GRANULAR: "granular",
	CLAP_PLUGIN_FEATURE_FREQUENCY_SHIFTER: "frequency-shifter",
	CLAP_PLUGIN_FEATURE_PITCH_SHIFTER: "pitch-shifter",
	CLAP_PLUGIN_FEATURE_DISTORTION: "distortion",
	CLAP_PLUGIN_FEATURE_TRANSIENT_SHAPER: "transient-shaper",
	CLAP_PLUGIN_FEATURE_COMPRESSOR: "compressor",
	CLAP_PLUGIN_FEATURE_EXPANDER: "expander",
	CLAP_PLUGIN_FEATURE_GATE: "gate",
	CLAP_PLUGIN_FEATURE_LIMITER: "limiter",
	CLAP_PLUGIN_FEATURE_FLANGER: "flanger",
	CLAP_PLUGIN_FEATURE_CHORUS: "chorus",
	CLAP_PLUGIN_FEATURE_DELAY: "delay",
	CLAP_PLUGIN_FEATURE_REVERB: "reverb",
	CLAP_PLUGIN_FEATURE_TREMOLO: "tremolo",
	CLAP_PLUGIN_FEATURE_GLITCH: "glitch",
	CLAP_PLUGIN_FEATURE_UTILITY: "utility",
	CLAP_PLUGIN_FEATURE_PITCH_CORRECTION: "pitch-correction",
	CLAP_PLUGIN_FEATURE_RESTORATION: "restoration",
	CLAP_PLUGIN_FEATURE_MULTI_EFFECTS: "multi-effects",
	CLAP_PLUGIN_FEATURE_MIXING: "mixing",
	CLAP_PLUGIN_FEATURE_MASTERING: "mastering",
	CLAP_PLUGIN_FEATURE_MONO: "mono",
	CLAP_PLUGIN_FEATURE_STEREO: "stereo",
	CLAP_PLUGIN_FEATURE_SURROUND: "surround",
	CLAP_PLUGIN_FEATURE_AMBISONIC: "ambisonic",
	CLAP_PLUGIN_FACTORY_ID: "clap.plugin-factory",
	CLAP_PRESET_DISCOVERY_FACTORY_ID: "clap.preset-discovery-factory/2",
	CLAP_PRESET_DISCOVERY_FACTORY_ID_COMPAT: "clap.preset-discovery-factory/draft-2",
	CLAP_EXT_AMBISONIC: "clap.ambisonic/3",
	CLAP_EXT_AMBISONIC_COMPAT: "clap.ambisonic.draft/3",
	CLAP_PORT_AMBISONIC: "ambisonic",
	CLAP_EXT_AUDIO_PORTS_ACTIVATION: "clap.audio-ports-activation/2",
	CLAP_EXT_AUDIO_PORTS_ACTIVATION_COMPAT: "clap.audio-ports-activation/draft-2",
	CLAP_EXT_AUDIO_PORTS: "clap.audio-ports",
	CLAP_PORT_MONO: "mono",
	CLAP_PORT_STEREO: "stereo",
	CLAP_EXT_AUDIO_PORTS_CONFIG: "clap.audio-ports-config",
	CLAP_EXT_AUDIO_PORTS_CONFIG_INFO: "clap.audio-ports-config-info/1",
	CLAP_EXT_AUDIO_PORTS_CONFIG_INFO_COMPAT: "clap.audio-ports-config-info/draft-0",
	CLAP_EXT_CONFIGURABLE_AUDIO_PORTS: "clap.configurable-audio-ports/1",
	CLAP_EXT_CONFIGURABLE_AUDIO_PORTS_COMPAT: "clap.configurable-audio-ports.draft1",
	CLAP_EXT_CONTEXT_MENU: "clap.context-menu/1",
	CLAP_EXT_CONTEXT_MENU_COMPAT: "clap.context-menu.draft/0",
	CLAP_EXT_EVENT_REGISTRY: "clap.event-registry",
	CLAP_EXT_GUI: "clap.gui",
	CLAP_WINDOW_API_WIN32: "win32",
	CLAP_WINDOW_API_COCOA: "cocoa",
	CLAP_WINDOW_API_X11: "x11",
	CLAP_WINDOW_API_WAYLAND: "wayland",
	CLAP_EXT_LATENCY: "clap.latency",
	CLAP_EXT_LOG: "clap.log",
	CLAP_EXT_NOTE_NAME: "clap.note-name",
	CLAP_EXT_NOTE_PORTS: "clap.note-ports",
	CLAP_EXT_PARAMS: "clap.params",
	CLAP_EXT_PARAM_INDICATION: "clap.param-indication/4",
	CLAP_EXT_PARAM_INDICATION_COMPAT: "clap.param-indication.draft/4",
	CLAP_EXT_POSIX_FD_SUPPORT: "clap.posix-fd-support",
	CLAP_EXT_PRESET_LOAD: "clap.preset-load/2",
	CLAP_EXT_PRESET_LOAD_COMPAT: "clap.preset-load.draft/2",
	CLAP_EXT_REMOTE_CONTROLS: "clap.remote-controls/2",
	CLAP_EXT_REMOTE_CONTROLS_COMPAT: "clap.remote-controls.draft/2",
	CLAP_EXT_RENDER: "clap.render",
	CLAP_EXT_STATE_CONTEXT: "clap.state-context/2",
	CLAP_EXT_STATE: "clap.state",
	CLAP_EXT_SURROUND: "clap.surround/4",
	CLAP_EXT_SURROUND_COMPAT: "clap.surround.draft/4",
	CLAP_PORT_SURROUND: "surround",
	CLAP_EXT_TAIL: "clap.tail",
	CLAP_EXT_THREAD_CHECK: "clap.thread-check",
	CLAP_EXT_THREAD_POOL: "clap.thread-pool",
	CLAP_EXT_TIMER_SUPPORT: "clap.timer-support",
	CLAP_EXT_TRACK_INFO: "clap.track-info/1",
	CLAP_EXT_TRACK_INFO_COMPAT: "clap.track-info.draft/1",
	CLAP_EXT_VOICE_INFO: "clap.voice-info",
	CLAP_PLUGIN_INVALIDATION_FACTORY_ID: "clap.plugin-invalidation-factory/1",
	CLAP_PLUGIN_STATE_CONVERTER_FACTORY_ID: "clap.plugin-state-converter-factory/1",
	CLAP_EXT_EXTENSIBLE_AUDIO_PORTS: "clap.extensible-audio-ports/1",
	CLAP_EXT_GAIN_ADJUSTMENT_METERING: "clap.gain-adjustment-metering/0",
	CLAP_EXT_MINI_CURVE_DISPLAY: "clap.mini-curve-display/3",
	CLAP_EXT_PROJECT_LOCATION: "clap.project-location/2",
	CLAP_EXT_RESOURCE_DIRECTORY: "clap.resource-directory/1",
	CLAP_EXT_SCRATCH_MEMORY: "clap.scratch-memory/1",
	CLAP_EXT_TRANSPORT_CONTROL: "clap.transport-control/1",
	CLAP_EXT_TRIGGERS: "clap.triggers/1",
	CLAP_EXT_TUNING: "clap.tuning/2",
	CLAP_EXT_UNDO: "clap.undo/4",
	CLAP_EXT_UNDO_CONTEXT: "clap.undo_context/4",
	CLAP_EXT_UNDO_DELTA: "clap.undo_delta/4",
	CLAP_EXT_WEBVIEW: "clap.webview/3",
	CLAP_WINDOW_API_WEBVIEW: "webview",
	clap_version: {
		readWith:(addr, dataView) => ({
			major: api.uint32.readWith(addr, dataView),
			minor: api.uint32.readWith(addr + 4, dataView),
			revision: api.uint32.readWith(addr + 8, dataView)
		}),
		writeWith(addr, value, dataView) {
			major: api.uint32.writeWith(addr, dataView)
			minor: api.uint32.writeWith(addr + 4, dataView)
			revision: api.uint32.writeWith(addr + 8, dataView)
		},
		size: 12,
		align: 1
	},
	clap_plugin_entry: {
		readWith:(addr, dataView) => ({
			clap_version: api.clap_version.readWith(addr, dataView),
			init: api.method(api.bool,api.pointer(api.int8)).readWith(addr + 12, dataView),
			deinit: api.method(null).readWith(addr + 16, dataView),
			get_factory: api.method(api.pointer(null),api.pointer(api.int8)).readWith(addr + 20, dataView)
		}),
		writeWith(addr, value, dataView) {
			clap_version: api.clap_version.writeWith(addr, dataView)
			init: api.method(api.bool,api.pointer(api.int8)).writeWith(addr + 12, dataView)
			deinit: api.method(null).writeWith(addr + 16, dataView)
			get_factory: api.method(api.pointer(null),api.pointer(api.int8)).writeWith(addr + 20, dataView)
		},
		size: 24,
		align: 1
	},
	clap_host: {
		readWith:(addr, dataView) => ({
			clap_version: api.clap_version.readWith(addr, dataView),
			host_data: api.pointer(null).readWith(addr + 12, dataView),
			name: api.pointer(api.int8).readWith(addr + 16, dataView),
			vendor: api.pointer(api.int8).readWith(addr + 20, dataView),
			url: api.pointer(api.int8).readWith(addr + 24, dataView),
			version: api.pointer(api.int8).readWith(addr + 28, dataView),
			get_extension: api.method(api.pointer(null),api.pointer(api.clap_host),api.pointer(api.int8)).readWith(addr + 32, dataView),
			request_restart: api.method(null,api.pointer(api.clap_host)).readWith(addr + 36, dataView),
			request_process: api.method(null,api.pointer(api.clap_host)).readWith(addr + 40, dataView),
			request_callback: api.method(null,api.pointer(api.clap_host)).readWith(addr + 44, dataView)
		}),
		writeWith(addr, value, dataView) {
			clap_version: api.clap_version.writeWith(addr, dataView)
			host_data: api.pointer(null).writeWith(addr + 12, dataView)
			name: api.pointer(api.int8).writeWith(addr + 16, dataView)
			vendor: api.pointer(api.int8).writeWith(addr + 20, dataView)
			url: api.pointer(api.int8).writeWith(addr + 24, dataView)
			version: api.pointer(api.int8).writeWith(addr + 28, dataView)
			get_extension: api.method(api.pointer(null),api.pointer(api.clap_host),api.pointer(api.int8)).writeWith(addr + 32, dataView)
			request_restart: api.method(null,api.pointer(api.clap_host)).writeWith(addr + 36, dataView)
			request_process: api.method(null,api.pointer(api.clap_host)).writeWith(addr + 40, dataView)
			request_callback: api.method(null,api.pointer(api.clap_host)).writeWith(addr + 44, dataView)
		},
		size: 48,
		align: 1
	},
	clap_event_header: {
		readWith:(addr, dataView) => ({
			size: api.uint32.readWith(addr, dataView),
			time: api.uint32.readWith(addr + 4, dataView),
			space_id: api.uint16.readWith(addr + 8, dataView),
			type: api.uint16.readWith(addr + 10, dataView),
			flags: api.uint32.readWith(addr + 12, dataView)
		}),
		writeWith(addr, value, dataView) {
			size: api.uint32.writeWith(addr, dataView)
			time: api.uint32.writeWith(addr + 4, dataView)
			space_id: api.uint16.writeWith(addr + 8, dataView)
			type: api.uint16.writeWith(addr + 10, dataView)
			flags: api.uint32.writeWith(addr + 12, dataView)
		},
		size: 16,
		align: 1
	},
	clap_event_note: {
		readWith:(addr, dataView) => ({
			header: api.clap_event_header.readWith(addr, dataView),
			note_id: api.int32.readWith(addr + 16, dataView),
			port_index: api.int16.readWith(addr + 20, dataView),
			channel: api.int16.readWith(addr + 22, dataView),
			key: api.int16.readWith(addr + 24, dataView),
			velocity: api.double.readWith(addr + 32, dataView)
		}),
		writeWith(addr, value, dataView) {
			header: api.clap_event_header.writeWith(addr, dataView)
			note_id: api.int32.writeWith(addr + 16, dataView)
			port_index: api.int16.writeWith(addr + 20, dataView)
			channel: api.int16.writeWith(addr + 22, dataView)
			key: api.int16.writeWith(addr + 24, dataView)
			velocity: api.double.writeWith(addr + 32, dataView)
		},
		size: 40,
		align: 1
	},
	clap_event_note_expression: {
		readWith:(addr, dataView) => ({
			header: api.clap_event_header.readWith(addr, dataView),
			expression_id: api.int32.readWith(addr + 16, dataView),
			note_id: api.int32.readWith(addr + 20, dataView),
			port_index: api.int16.readWith(addr + 24, dataView),
			channel: api.int16.readWith(addr + 26, dataView),
			key: api.int16.readWith(addr + 28, dataView),
			value: api.double.readWith(addr + 32, dataView)
		}),
		writeWith(addr, value, dataView) {
			header: api.clap_event_header.writeWith(addr, dataView)
			expression_id: api.int32.writeWith(addr + 16, dataView)
			note_id: api.int32.writeWith(addr + 20, dataView)
			port_index: api.int16.writeWith(addr + 24, dataView)
			channel: api.int16.writeWith(addr + 26, dataView)
			key: api.int16.writeWith(addr + 28, dataView)
			value: api.double.writeWith(addr + 32, dataView)
		},
		size: 40,
		align: 1
	},
	clap_event_param_value: {
		readWith:(addr, dataView) => ({
			header: api.clap_event_header.readWith(addr, dataView),
			param_id: api.uint32.readWith(addr + 16, dataView),
			cookie: api.pointer(null).readWith(addr + 20, dataView),
			note_id: api.int32.readWith(addr + 24, dataView),
			port_index: api.int16.readWith(addr + 28, dataView),
			channel: api.int16.readWith(addr + 30, dataView),
			key: api.int16.readWith(addr + 32, dataView),
			value: api.double.readWith(addr + 40, dataView)
		}),
		writeWith(addr, value, dataView) {
			header: api.clap_event_header.writeWith(addr, dataView)
			param_id: api.uint32.writeWith(addr + 16, dataView)
			cookie: api.pointer(null).writeWith(addr + 20, dataView)
			note_id: api.int32.writeWith(addr + 24, dataView)
			port_index: api.int16.writeWith(addr + 28, dataView)
			channel: api.int16.writeWith(addr + 30, dataView)
			key: api.int16.writeWith(addr + 32, dataView)
			value: api.double.writeWith(addr + 40, dataView)
		},
		size: 48,
		align: 1
	},
	clap_event_param_mod: {
		readWith:(addr, dataView) => ({
			header: api.clap_event_header.readWith(addr, dataView),
			param_id: api.uint32.readWith(addr + 16, dataView),
			cookie: api.pointer(null).readWith(addr + 20, dataView),
			note_id: api.int32.readWith(addr + 24, dataView),
			port_index: api.int16.readWith(addr + 28, dataView),
			channel: api.int16.readWith(addr + 30, dataView),
			key: api.int16.readWith(addr + 32, dataView),
			amount: api.double.readWith(addr + 40, dataView)
		}),
		writeWith(addr, value, dataView) {
			header: api.clap_event_header.writeWith(addr, dataView)
			param_id: api.uint32.writeWith(addr + 16, dataView)
			cookie: api.pointer(null).writeWith(addr + 20, dataView)
			note_id: api.int32.writeWith(addr + 24, dataView)
			port_index: api.int16.writeWith(addr + 28, dataView)
			channel: api.int16.writeWith(addr + 30, dataView)
			key: api.int16.writeWith(addr + 32, dataView)
			amount: api.double.writeWith(addr + 40, dataView)
		},
		size: 48,
		align: 1
	},
	clap_event_param_gesture: {
		readWith:(addr, dataView) => ({
			header: api.clap_event_header.readWith(addr, dataView),
			param_id: api.uint32.readWith(addr + 16, dataView)
		}),
		writeWith(addr, value, dataView) {
			header: api.clap_event_header.writeWith(addr, dataView)
			param_id: api.uint32.writeWith(addr + 16, dataView)
		},
		size: 20,
		align: 1
	},
	clap_event_transport: {
		readWith:(addr, dataView) => ({
			header: api.clap_event_header.readWith(addr, dataView),
			flags: api.uint32.readWith(addr + 16, dataView),
			song_pos_beats: api.int64.readWith(addr + 24, dataView),
			song_pos_seconds: api.int64.readWith(addr + 32, dataView),
			tempo: api.double.readWith(addr + 40, dataView),
			tempo_inc: api.double.readWith(addr + 48, dataView),
			loop_start_beats: api.int64.readWith(addr + 56, dataView),
			loop_end_beats: api.int64.readWith(addr + 64, dataView),
			loop_start_seconds: api.int64.readWith(addr + 72, dataView),
			loop_end_seconds: api.int64.readWith(addr + 80, dataView),
			bar_start: api.int64.readWith(addr + 88, dataView),
			bar_number: api.int32.readWith(addr + 96, dataView),
			tsig_num: api.uint16.readWith(addr + 100, dataView),
			tsig_denom: api.uint16.readWith(addr + 102, dataView)
		}),
		writeWith(addr, value, dataView) {
			header: api.clap_event_header.writeWith(addr, dataView)
			flags: api.uint32.writeWith(addr + 16, dataView)
			song_pos_beats: api.int64.writeWith(addr + 24, dataView)
			song_pos_seconds: api.int64.writeWith(addr + 32, dataView)
			tempo: api.double.writeWith(addr + 40, dataView)
			tempo_inc: api.double.writeWith(addr + 48, dataView)
			loop_start_beats: api.int64.writeWith(addr + 56, dataView)
			loop_end_beats: api.int64.writeWith(addr + 64, dataView)
			loop_start_seconds: api.int64.writeWith(addr + 72, dataView)
			loop_end_seconds: api.int64.writeWith(addr + 80, dataView)
			bar_start: api.int64.writeWith(addr + 88, dataView)
			bar_number: api.int32.writeWith(addr + 96, dataView)
			tsig_num: api.uint16.writeWith(addr + 100, dataView)
			tsig_denom: api.uint16.writeWith(addr + 102, dataView)
		},
		size: 104,
		align: 1
	},
	clap_event_midi: {
		readWith:(addr, dataView) => ({
			header: api.clap_event_header.readWith(addr, dataView),
			port_index: api.uint16.readWith(addr + 16, dataView),
			data: api.array(api.uint8, 3).readWith(addr + 18, dataView)
		}),
		writeWith(addr, value, dataView) {
			header: api.clap_event_header.writeWith(addr, dataView)
			port_index: api.uint16.writeWith(addr + 16, dataView)
			data: api.array(api.uint8, 3).writeWith(addr + 18, dataView)
		},
		size: 21,
		align: 1
	},
	clap_event_midi_sysex: {
		readWith:(addr, dataView) => ({
			header: api.clap_event_header.readWith(addr, dataView),
			port_index: api.uint16.readWith(addr + 16, dataView),
			buffer: api.pointer(api.uint8).readWith(addr + 20, dataView),
			size: api.uint32.readWith(addr + 24, dataView)
		}),
		writeWith(addr, value, dataView) {
			header: api.clap_event_header.writeWith(addr, dataView)
			port_index: api.uint16.writeWith(addr + 16, dataView)
			buffer: api.pointer(api.uint8).writeWith(addr + 20, dataView)
			size: api.uint32.writeWith(addr + 24, dataView)
		},
		size: 28,
		align: 1
	},
	clap_event_midi2: {
		readWith:(addr, dataView) => ({
			header: api.clap_event_header.readWith(addr, dataView),
			port_index: api.uint16.readWith(addr + 16, dataView),
			data: api.array(api.uint32, 4).readWith(addr + 20, dataView)
		}),
		writeWith(addr, value, dataView) {
			header: api.clap_event_header.writeWith(addr, dataView)
			port_index: api.uint16.writeWith(addr + 16, dataView)
			data: api.array(api.uint32, 4).writeWith(addr + 20, dataView)
		},
		size: 36,
		align: 1
	},
	clap_input_events: {
		readWith:(addr, dataView) => ({
			ctx: api.pointer(null).readWith(addr, dataView),
			size: api.method(api.uint32,api.pointer(api.clap_input_events)).readWith(addr + 4, dataView),
			get: api.method(api.pointer(api.clap_event_header),api.pointer(api.clap_input_events),api.uint32).readWith(addr + 8, dataView)
		}),
		writeWith(addr, value, dataView) {
			ctx: api.pointer(null).writeWith(addr, dataView)
			size: api.method(api.uint32,api.pointer(api.clap_input_events)).writeWith(addr + 4, dataView)
			get: api.method(api.pointer(api.clap_event_header),api.pointer(api.clap_input_events),api.uint32).writeWith(addr + 8, dataView)
		},
		size: 12,
		align: 1
	},
	clap_output_events: {
		readWith:(addr, dataView) => ({
			ctx: api.pointer(null).readWith(addr, dataView),
			try_push: api.method(api.bool,api.pointer(api.clap_output_events),api.pointer(api.clap_event_header)).readWith(addr + 4, dataView)
		}),
		writeWith(addr, value, dataView) {
			ctx: api.pointer(null).writeWith(addr, dataView)
			try_push: api.method(api.bool,api.pointer(api.clap_output_events),api.pointer(api.clap_event_header)).writeWith(addr + 4, dataView)
		},
		size: 8,
		align: 1
	},
	clap_audio_buffer: {
		readWith:(addr, dataView) => ({
			data32: api.pointer(api.pointer(api.float)).readWith(addr, dataView),
			data64: api.pointer(api.pointer(api.double)).readWith(addr + 4, dataView),
			channel_count: api.uint32.readWith(addr + 8, dataView),
			latency: api.uint32.readWith(addr + 12, dataView),
			constant_mask: api.uint64.readWith(addr + 16, dataView)
		}),
		writeWith(addr, value, dataView) {
			data32: api.pointer(api.pointer(api.float)).writeWith(addr, dataView)
			data64: api.pointer(api.pointer(api.double)).writeWith(addr + 4, dataView)
			channel_count: api.uint32.writeWith(addr + 8, dataView)
			latency: api.uint32.writeWith(addr + 12, dataView)
			constant_mask: api.uint64.writeWith(addr + 16, dataView)
		},
		size: 24,
		align: 1
	},
	clap_process: {
		readWith:(addr, dataView) => ({
			steady_time: api.int64.readWith(addr, dataView),
			frames_count: api.uint32.readWith(addr + 8, dataView),
			transport: api.pointer(api.clap_event_transport).readWith(addr + 12, dataView),
			audio_inputs: api.pointer(api.clap_audio_buffer).readWith(addr + 16, dataView),
			audio_outputs: api.pointer(api.clap_audio_buffer).readWith(addr + 20, dataView),
			audio_inputs_count: api.uint32.readWith(addr + 24, dataView),
			audio_outputs_count: api.uint32.readWith(addr + 28, dataView),
			in_events: api.pointer(api.clap_input_events).readWith(addr + 32, dataView),
			out_events: api.pointer(api.clap_output_events).readWith(addr + 36, dataView)
		}),
		writeWith(addr, value, dataView) {
			steady_time: api.int64.writeWith(addr, dataView)
			frames_count: api.uint32.writeWith(addr + 8, dataView)
			transport: api.pointer(api.clap_event_transport).writeWith(addr + 12, dataView)
			audio_inputs: api.pointer(api.clap_audio_buffer).writeWith(addr + 16, dataView)
			audio_outputs: api.pointer(api.clap_audio_buffer).writeWith(addr + 20, dataView)
			audio_inputs_count: api.uint32.writeWith(addr + 24, dataView)
			audio_outputs_count: api.uint32.writeWith(addr + 28, dataView)
			in_events: api.pointer(api.clap_input_events).writeWith(addr + 32, dataView)
			out_events: api.pointer(api.clap_output_events).writeWith(addr + 36, dataView)
		},
		size: 40,
		align: 1
	},
	clap_plugin_descriptor: {
		readWith:(addr, dataView) => ({
			clap_version: api.clap_version.readWith(addr, dataView),
			id: api.pointer(api.int8).readWith(addr + 12, dataView),
			name: api.pointer(api.int8).readWith(addr + 16, dataView),
			vendor: api.pointer(api.int8).readWith(addr + 20, dataView),
			url: api.pointer(api.int8).readWith(addr + 24, dataView),
			manual_url: api.pointer(api.int8).readWith(addr + 28, dataView),
			support_url: api.pointer(api.int8).readWith(addr + 32, dataView),
			version: api.pointer(api.int8).readWith(addr + 36, dataView),
			description: api.pointer(api.int8).readWith(addr + 40, dataView),
			features: api.pointer(api.pointer(api.int8)).readWith(addr + 44, dataView)
		}),
		writeWith(addr, value, dataView) {
			clap_version: api.clap_version.writeWith(addr, dataView)
			id: api.pointer(api.int8).writeWith(addr + 12, dataView)
			name: api.pointer(api.int8).writeWith(addr + 16, dataView)
			vendor: api.pointer(api.int8).writeWith(addr + 20, dataView)
			url: api.pointer(api.int8).writeWith(addr + 24, dataView)
			manual_url: api.pointer(api.int8).writeWith(addr + 28, dataView)
			support_url: api.pointer(api.int8).writeWith(addr + 32, dataView)
			version: api.pointer(api.int8).writeWith(addr + 36, dataView)
			description: api.pointer(api.int8).writeWith(addr + 40, dataView)
			features: api.pointer(api.pointer(api.int8)).writeWith(addr + 44, dataView)
		},
		size: 48,
		align: 1
	},
	clap_plugin: {
		readWith:(addr, dataView) => ({
			desc: api.pointer(api.clap_plugin_descriptor).readWith(addr, dataView),
			plugin_data: api.pointer(null).readWith(addr + 4, dataView),
			init: api.method(api.bool,api.pointer(api.clap_plugin)).readWith(addr + 8, dataView),
			destroy: api.method(null,api.pointer(api.clap_plugin)).readWith(addr + 12, dataView),
			activate: api.method(api.bool,api.pointer(api.clap_plugin),api.double,api.uint32,api.uint32).readWith(addr + 16, dataView),
			deactivate: api.method(null,api.pointer(api.clap_plugin)).readWith(addr + 20, dataView),
			start_processing: api.method(api.bool,api.pointer(api.clap_plugin)).readWith(addr + 24, dataView),
			stop_processing: api.method(null,api.pointer(api.clap_plugin)).readWith(addr + 28, dataView),
			reset: api.method(null,api.pointer(api.clap_plugin)).readWith(addr + 32, dataView),
			process: api.method(api.int32,api.pointer(api.clap_plugin),api.pointer(api.clap_process)).readWith(addr + 36, dataView),
			get_extension: api.method(api.pointer(null),api.pointer(api.clap_plugin),api.pointer(api.int8)).readWith(addr + 40, dataView),
			on_main_thread: api.method(null,api.pointer(api.clap_plugin)).readWith(addr + 44, dataView)
		}),
		writeWith(addr, value, dataView) {
			desc: api.pointer(api.clap_plugin_descriptor).writeWith(addr, dataView)
			plugin_data: api.pointer(null).writeWith(addr + 4, dataView)
			init: api.method(api.bool,api.pointer(api.clap_plugin)).writeWith(addr + 8, dataView)
			destroy: api.method(null,api.pointer(api.clap_plugin)).writeWith(addr + 12, dataView)
			activate: api.method(api.bool,api.pointer(api.clap_plugin),api.double,api.uint32,api.uint32).writeWith(addr + 16, dataView)
			deactivate: api.method(null,api.pointer(api.clap_plugin)).writeWith(addr + 20, dataView)
			start_processing: api.method(api.bool,api.pointer(api.clap_plugin)).writeWith(addr + 24, dataView)
			stop_processing: api.method(null,api.pointer(api.clap_plugin)).writeWith(addr + 28, dataView)
			reset: api.method(null,api.pointer(api.clap_plugin)).writeWith(addr + 32, dataView)
			process: api.method(api.int32,api.pointer(api.clap_plugin),api.pointer(api.clap_process)).writeWith(addr + 36, dataView)
			get_extension: api.method(api.pointer(null),api.pointer(api.clap_plugin),api.pointer(api.int8)).writeWith(addr + 40, dataView)
			on_main_thread: api.method(null,api.pointer(api.clap_plugin)).writeWith(addr + 44, dataView)
		},
		size: 48,
		align: 1
	},
	clap_plugin_factory: {
		readWith:(addr, dataView) => ({
			get_plugin_count: api.method(api.uint32,api.pointer(api.clap_plugin_factory)).readWith(addr, dataView),
			get_plugin_descriptor: api.method(api.pointer(api.clap_plugin_descriptor),api.pointer(api.clap_plugin_factory),api.uint32).readWith(addr + 4, dataView),
			create_plugin: api.method(api.pointer(api.clap_plugin),api.pointer(api.clap_plugin_factory),api.pointer(api.clap_host),api.pointer(api.int8)).readWith(addr + 8, dataView)
		}),
		writeWith(addr, value, dataView) {
			get_plugin_count: api.method(api.uint32,api.pointer(api.clap_plugin_factory)).writeWith(addr, dataView)
			get_plugin_descriptor: api.method(api.pointer(api.clap_plugin_descriptor),api.pointer(api.clap_plugin_factory),api.uint32).writeWith(addr + 4, dataView)
			create_plugin: api.method(api.pointer(api.clap_plugin),api.pointer(api.clap_plugin_factory),api.pointer(api.clap_host),api.pointer(api.int8)).writeWith(addr + 8, dataView)
		},
		size: 12,
		align: 1
	},
	clap_universal_plugin_id: {
		readWith:(addr, dataView) => ({
			abi: api.pointer(api.int8).readWith(addr, dataView),
			id: api.pointer(api.int8).readWith(addr + 4, dataView)
		}),
		writeWith(addr, value, dataView) {
			abi: api.pointer(api.int8).writeWith(addr, dataView)
			id: api.pointer(api.int8).writeWith(addr + 4, dataView)
		},
		size: 8,
		align: 1
	},
	clap_preset_discovery_metadata_receiver: {
		readWith:(addr, dataView) => ({
			receiver_data: api.pointer(null).readWith(addr, dataView),
			on_error: api.method(null,api.pointer(api.clap_preset_discovery_metadata_receiver),api.int32,api.pointer(api.int8)).readWith(addr + 4, dataView),
			begin_preset: api.method(api.bool,api.pointer(api.clap_preset_discovery_metadata_receiver),api.pointer(api.int8),api.pointer(api.int8)).readWith(addr + 8, dataView),
			add_plugin_id: api.method(null,api.pointer(api.clap_preset_discovery_metadata_receiver),api.pointer(api.clap_universal_plugin_id)).readWith(addr + 12, dataView),
			set_soundpack_id: api.method(null,api.pointer(api.clap_preset_discovery_metadata_receiver),api.pointer(api.int8)).readWith(addr + 16, dataView),
			set_flags: api.method(null,api.pointer(api.clap_preset_discovery_metadata_receiver),api.uint32).readWith(addr + 20, dataView),
			add_creator: api.method(null,api.pointer(api.clap_preset_discovery_metadata_receiver),api.pointer(api.int8)).readWith(addr + 24, dataView),
			set_description: api.method(null,api.pointer(api.clap_preset_discovery_metadata_receiver),api.pointer(api.int8)).readWith(addr + 28, dataView),
			set_timestamps: api.method(null,api.pointer(api.clap_preset_discovery_metadata_receiver),api.uint64,api.uint64).readWith(addr + 32, dataView),
			add_feature: api.method(null,api.pointer(api.clap_preset_discovery_metadata_receiver),api.pointer(api.int8)).readWith(addr + 36, dataView),
			add_extra_info: api.method(null,api.pointer(api.clap_preset_discovery_metadata_receiver),api.pointer(api.int8),api.pointer(api.int8)).readWith(addr + 40, dataView)
		}),
		writeWith(addr, value, dataView) {
			receiver_data: api.pointer(null).writeWith(addr, dataView)
			on_error: api.method(null,api.pointer(api.clap_preset_discovery_metadata_receiver),api.int32,api.pointer(api.int8)).writeWith(addr + 4, dataView)
			begin_preset: api.method(api.bool,api.pointer(api.clap_preset_discovery_metadata_receiver),api.pointer(api.int8),api.pointer(api.int8)).writeWith(addr + 8, dataView)
			add_plugin_id: api.method(null,api.pointer(api.clap_preset_discovery_metadata_receiver),api.pointer(api.clap_universal_plugin_id)).writeWith(addr + 12, dataView)
			set_soundpack_id: api.method(null,api.pointer(api.clap_preset_discovery_metadata_receiver),api.pointer(api.int8)).writeWith(addr + 16, dataView)
			set_flags: api.method(null,api.pointer(api.clap_preset_discovery_metadata_receiver),api.uint32).writeWith(addr + 20, dataView)
			add_creator: api.method(null,api.pointer(api.clap_preset_discovery_metadata_receiver),api.pointer(api.int8)).writeWith(addr + 24, dataView)
			set_description: api.method(null,api.pointer(api.clap_preset_discovery_metadata_receiver),api.pointer(api.int8)).writeWith(addr + 28, dataView)
			set_timestamps: api.method(null,api.pointer(api.clap_preset_discovery_metadata_receiver),api.uint64,api.uint64).writeWith(addr + 32, dataView)
			add_feature: api.method(null,api.pointer(api.clap_preset_discovery_metadata_receiver),api.pointer(api.int8)).writeWith(addr + 36, dataView)
			add_extra_info: api.method(null,api.pointer(api.clap_preset_discovery_metadata_receiver),api.pointer(api.int8),api.pointer(api.int8)).writeWith(addr + 40, dataView)
		},
		size: 44,
		align: 1
	},
	clap_preset_discovery_filetype: {
		readWith:(addr, dataView) => ({
			name: api.pointer(api.int8).readWith(addr, dataView),
			description: api.pointer(api.int8).readWith(addr + 4, dataView),
			file_extension: api.pointer(api.int8).readWith(addr + 8, dataView)
		}),
		writeWith(addr, value, dataView) {
			name: api.pointer(api.int8).writeWith(addr, dataView)
			description: api.pointer(api.int8).writeWith(addr + 4, dataView)
			file_extension: api.pointer(api.int8).writeWith(addr + 8, dataView)
		},
		size: 12,
		align: 1
	},
	clap_preset_discovery_location: {
		readWith:(addr, dataView) => ({
			flags: api.uint32.readWith(addr, dataView),
			name: api.pointer(api.int8).readWith(addr + 4, dataView),
			kind: api.uint32.readWith(addr + 8, dataView),
			location: api.pointer(api.int8).readWith(addr + 12, dataView)
		}),
		writeWith(addr, value, dataView) {
			flags: api.uint32.writeWith(addr, dataView)
			name: api.pointer(api.int8).writeWith(addr + 4, dataView)
			kind: api.uint32.writeWith(addr + 8, dataView)
			location: api.pointer(api.int8).writeWith(addr + 12, dataView)
		},
		size: 16,
		align: 1
	},
	clap_preset_discovery_soundpack: {
		readWith:(addr, dataView) => ({
			flags: api.uint32.readWith(addr, dataView),
			id: api.pointer(api.int8).readWith(addr + 4, dataView),
			name: api.pointer(api.int8).readWith(addr + 8, dataView),
			description: api.pointer(api.int8).readWith(addr + 12, dataView),
			homepage_url: api.pointer(api.int8).readWith(addr + 16, dataView),
			vendor: api.pointer(api.int8).readWith(addr + 20, dataView),
			image_path: api.pointer(api.int8).readWith(addr + 24, dataView),
			release_timestamp: api.uint64.readWith(addr + 32, dataView)
		}),
		writeWith(addr, value, dataView) {
			flags: api.uint32.writeWith(addr, dataView)
			id: api.pointer(api.int8).writeWith(addr + 4, dataView)
			name: api.pointer(api.int8).writeWith(addr + 8, dataView)
			description: api.pointer(api.int8).writeWith(addr + 12, dataView)
			homepage_url: api.pointer(api.int8).writeWith(addr + 16, dataView)
			vendor: api.pointer(api.int8).writeWith(addr + 20, dataView)
			image_path: api.pointer(api.int8).writeWith(addr + 24, dataView)
			release_timestamp: api.uint64.writeWith(addr + 32, dataView)
		},
		size: 40,
		align: 1
	},
	clap_preset_discovery_provider_descriptor: {
		readWith:(addr, dataView) => ({
			clap_version: api.clap_version.readWith(addr, dataView),
			id: api.pointer(api.int8).readWith(addr + 12, dataView),
			name: api.pointer(api.int8).readWith(addr + 16, dataView),
			vendor: api.pointer(api.int8).readWith(addr + 20, dataView)
		}),
		writeWith(addr, value, dataView) {
			clap_version: api.clap_version.writeWith(addr, dataView)
			id: api.pointer(api.int8).writeWith(addr + 12, dataView)
			name: api.pointer(api.int8).writeWith(addr + 16, dataView)
			vendor: api.pointer(api.int8).writeWith(addr + 20, dataView)
		},
		size: 24,
		align: 1
	},
	clap_preset_discovery_provider: {
		readWith:(addr, dataView) => ({
			desc: api.pointer(api.clap_preset_discovery_provider_descriptor).readWith(addr, dataView),
			provider_data: api.pointer(null).readWith(addr + 4, dataView),
			init: api.method(api.bool,api.pointer(api.clap_preset_discovery_provider)).readWith(addr + 8, dataView),
			destroy: api.method(null,api.pointer(api.clap_preset_discovery_provider)).readWith(addr + 12, dataView),
			get_metadata: api.method(api.bool,api.pointer(api.clap_preset_discovery_provider),api.uint32,api.pointer(api.int8),api.pointer(api.clap_preset_discovery_metadata_receiver)).readWith(addr + 16, dataView),
			get_extension: api.method(api.pointer(null),api.pointer(api.clap_preset_discovery_provider),api.pointer(api.int8)).readWith(addr + 20, dataView)
		}),
		writeWith(addr, value, dataView) {
			desc: api.pointer(api.clap_preset_discovery_provider_descriptor).writeWith(addr, dataView)
			provider_data: api.pointer(null).writeWith(addr + 4, dataView)
			init: api.method(api.bool,api.pointer(api.clap_preset_discovery_provider)).writeWith(addr + 8, dataView)
			destroy: api.method(null,api.pointer(api.clap_preset_discovery_provider)).writeWith(addr + 12, dataView)
			get_metadata: api.method(api.bool,api.pointer(api.clap_preset_discovery_provider),api.uint32,api.pointer(api.int8),api.pointer(api.clap_preset_discovery_metadata_receiver)).writeWith(addr + 16, dataView)
			get_extension: api.method(api.pointer(null),api.pointer(api.clap_preset_discovery_provider),api.pointer(api.int8)).writeWith(addr + 20, dataView)
		},
		size: 24,
		align: 1
	},
	clap_preset_discovery_indexer: {
		readWith:(addr, dataView) => ({
			clap_version: api.clap_version.readWith(addr, dataView),
			name: api.pointer(api.int8).readWith(addr + 12, dataView),
			vendor: api.pointer(api.int8).readWith(addr + 16, dataView),
			url: api.pointer(api.int8).readWith(addr + 20, dataView),
			version: api.pointer(api.int8).readWith(addr + 24, dataView),
			indexer_data: api.pointer(null).readWith(addr + 28, dataView),
			declare_filetype: api.method(api.bool,api.pointer(api.clap_preset_discovery_indexer),api.pointer(api.clap_preset_discovery_filetype)).readWith(addr + 32, dataView),
			declare_location: api.method(api.bool,api.pointer(api.clap_preset_discovery_indexer),api.pointer(api.clap_preset_discovery_location)).readWith(addr + 36, dataView),
			declare_soundpack: api.method(api.bool,api.pointer(api.clap_preset_discovery_indexer),api.pointer(api.clap_preset_discovery_soundpack)).readWith(addr + 40, dataView),
			get_extension: api.method(api.pointer(null),api.pointer(api.clap_preset_discovery_indexer),api.pointer(api.int8)).readWith(addr + 44, dataView)
		}),
		writeWith(addr, value, dataView) {
			clap_version: api.clap_version.writeWith(addr, dataView)
			name: api.pointer(api.int8).writeWith(addr + 12, dataView)
			vendor: api.pointer(api.int8).writeWith(addr + 16, dataView)
			url: api.pointer(api.int8).writeWith(addr + 20, dataView)
			version: api.pointer(api.int8).writeWith(addr + 24, dataView)
			indexer_data: api.pointer(null).writeWith(addr + 28, dataView)
			declare_filetype: api.method(api.bool,api.pointer(api.clap_preset_discovery_indexer),api.pointer(api.clap_preset_discovery_filetype)).writeWith(addr + 32, dataView)
			declare_location: api.method(api.bool,api.pointer(api.clap_preset_discovery_indexer),api.pointer(api.clap_preset_discovery_location)).writeWith(addr + 36, dataView)
			declare_soundpack: api.method(api.bool,api.pointer(api.clap_preset_discovery_indexer),api.pointer(api.clap_preset_discovery_soundpack)).writeWith(addr + 40, dataView)
			get_extension: api.method(api.pointer(null),api.pointer(api.clap_preset_discovery_indexer),api.pointer(api.int8)).writeWith(addr + 44, dataView)
		},
		size: 48,
		align: 1
	},
	clap_preset_discovery_factory: {
		readWith:(addr, dataView) => ({
			count: api.method(api.uint32,api.pointer(api.clap_preset_discovery_factory)).readWith(addr, dataView),
			get_descriptor: api.method(api.pointer(api.clap_preset_discovery_provider_descriptor),api.pointer(api.clap_preset_discovery_factory),api.uint32).readWith(addr + 4, dataView),
			create: api.method(api.pointer(api.clap_preset_discovery_provider),api.pointer(api.clap_preset_discovery_factory),api.pointer(api.clap_preset_discovery_indexer),api.pointer(api.int8)).readWith(addr + 8, dataView)
		}),
		writeWith(addr, value, dataView) {
			count: api.method(api.uint32,api.pointer(api.clap_preset_discovery_factory)).writeWith(addr, dataView)
			get_descriptor: api.method(api.pointer(api.clap_preset_discovery_provider_descriptor),api.pointer(api.clap_preset_discovery_factory),api.uint32).writeWith(addr + 4, dataView)
			create: api.method(api.pointer(api.clap_preset_discovery_provider),api.pointer(api.clap_preset_discovery_factory),api.pointer(api.clap_preset_discovery_indexer),api.pointer(api.int8)).writeWith(addr + 8, dataView)
		},
		size: 12,
		align: 1
	},
	clap_ambisonic_config: {
		readWith:(addr, dataView) => ({
			ordering: api.uint32.readWith(addr, dataView),
			normalization: api.uint32.readWith(addr + 4, dataView)
		}),
		writeWith(addr, value, dataView) {
			ordering: api.uint32.writeWith(addr, dataView)
			normalization: api.uint32.writeWith(addr + 4, dataView)
		},
		size: 8,
		align: 1
	},
	clap_plugin_ambisonic: {
		readWith:(addr, dataView) => ({
			is_config_supported: api.method(api.bool,api.pointer(api.clap_plugin),api.pointer(api.clap_ambisonic_config)).readWith(addr, dataView),
			get_config: api.method(api.bool,api.pointer(api.clap_plugin),api.bool,api.uint32,api.pointer(api.clap_ambisonic_config)).readWith(addr + 4, dataView)
		}),
		writeWith(addr, value, dataView) {
			is_config_supported: api.method(api.bool,api.pointer(api.clap_plugin),api.pointer(api.clap_ambisonic_config)).writeWith(addr, dataView)
			get_config: api.method(api.bool,api.pointer(api.clap_plugin),api.bool,api.uint32,api.pointer(api.clap_ambisonic_config)).writeWith(addr + 4, dataView)
		},
		size: 8,
		align: 1
	},
	clap_host_ambisonic: {
		readWith:(addr, dataView) => ({
			changed: api.method(null,api.pointer(api.clap_host)).readWith(addr, dataView)
		}),
		writeWith(addr, value, dataView) {
			changed: api.method(null,api.pointer(api.clap_host)).writeWith(addr, dataView)
		},
		size: 4,
		align: 1
	},
	clap_plugin_audio_ports_activation: {
		readWith:(addr, dataView) => ({
			can_activate_while_processing: api.method(api.bool,api.pointer(api.clap_plugin)).readWith(addr, dataView),
			set_active: api.method(api.bool,api.pointer(api.clap_plugin),api.bool,api.uint32,api.bool,api.uint32).readWith(addr + 4, dataView)
		}),
		writeWith(addr, value, dataView) {
			can_activate_while_processing: api.method(api.bool,api.pointer(api.clap_plugin)).writeWith(addr, dataView)
			set_active: api.method(api.bool,api.pointer(api.clap_plugin),api.bool,api.uint32,api.bool,api.uint32).writeWith(addr + 4, dataView)
		},
		size: 8,
		align: 1
	},
	clap_audio_port_info: {
		readWith:(addr, dataView) => ({
			id: api.uint32.readWith(addr, dataView),
			name: api.array(api.int8, 256).readWith(addr + 4, dataView),
			flags: api.uint32.readWith(addr + 260, dataView),
			channel_count: api.uint32.readWith(addr + 264, dataView),
			port_type: api.pointer(api.int8).readWith(addr + 268, dataView),
			in_place_pair: api.uint32.readWith(addr + 272, dataView)
		}),
		writeWith(addr, value, dataView) {
			id: api.uint32.writeWith(addr, dataView)
			name: api.array(api.int8, 256).writeWith(addr + 4, dataView)
			flags: api.uint32.writeWith(addr + 260, dataView)
			channel_count: api.uint32.writeWith(addr + 264, dataView)
			port_type: api.pointer(api.int8).writeWith(addr + 268, dataView)
			in_place_pair: api.uint32.writeWith(addr + 272, dataView)
		},
		size: 276,
		align: 1
	},
	clap_plugin_audio_ports: {
		readWith:(addr, dataView) => ({
			count: api.method(api.uint32,api.pointer(api.clap_plugin),api.bool).readWith(addr, dataView),
			get: api.method(api.bool,api.pointer(api.clap_plugin),api.uint32,api.bool,api.pointer(api.clap_audio_port_info)).readWith(addr + 4, dataView)
		}),
		writeWith(addr, value, dataView) {
			count: api.method(api.uint32,api.pointer(api.clap_plugin),api.bool).writeWith(addr, dataView)
			get: api.method(api.bool,api.pointer(api.clap_plugin),api.uint32,api.bool,api.pointer(api.clap_audio_port_info)).writeWith(addr + 4, dataView)
		},
		size: 8,
		align: 1
	},
	clap_host_audio_ports: {
		readWith:(addr, dataView) => ({
			is_rescan_flag_supported: api.method(api.bool,api.pointer(api.clap_host),api.uint32).readWith(addr, dataView),
			rescan: api.method(null,api.pointer(api.clap_host),api.uint32).readWith(addr + 4, dataView)
		}),
		writeWith(addr, value, dataView) {
			is_rescan_flag_supported: api.method(api.bool,api.pointer(api.clap_host),api.uint32).writeWith(addr, dataView)
			rescan: api.method(null,api.pointer(api.clap_host),api.uint32).writeWith(addr + 4, dataView)
		},
		size: 8,
		align: 1
	},
	clap_audio_ports_config: {
		readWith:(addr, dataView) => ({
			id: api.uint32.readWith(addr, dataView),
			name: api.array(api.int8, 256).readWith(addr + 4, dataView),
			input_port_count: api.uint32.readWith(addr + 260, dataView),
			output_port_count: api.uint32.readWith(addr + 264, dataView),
			has_main_input: api.bool.readWith(addr + 268, dataView),
			main_input_channel_count: api.uint32.readWith(addr + 272, dataView),
			main_input_port_type: api.pointer(api.int8).readWith(addr + 276, dataView),
			has_main_output: api.bool.readWith(addr + 280, dataView),
			main_output_channel_count: api.uint32.readWith(addr + 284, dataView),
			main_output_port_type: api.pointer(api.int8).readWith(addr + 288, dataView)
		}),
		writeWith(addr, value, dataView) {
			id: api.uint32.writeWith(addr, dataView)
			name: api.array(api.int8, 256).writeWith(addr + 4, dataView)
			input_port_count: api.uint32.writeWith(addr + 260, dataView)
			output_port_count: api.uint32.writeWith(addr + 264, dataView)
			has_main_input: api.bool.writeWith(addr + 268, dataView)
			main_input_channel_count: api.uint32.writeWith(addr + 272, dataView)
			main_input_port_type: api.pointer(api.int8).writeWith(addr + 276, dataView)
			has_main_output: api.bool.writeWith(addr + 280, dataView)
			main_output_channel_count: api.uint32.writeWith(addr + 284, dataView)
			main_output_port_type: api.pointer(api.int8).writeWith(addr + 288, dataView)
		},
		size: 292,
		align: 1
	},
	clap_plugin_audio_ports_config: {
		readWith:(addr, dataView) => ({
			count: api.method(api.uint32,api.pointer(api.clap_plugin)).readWith(addr, dataView),
			get: api.method(api.bool,api.pointer(api.clap_plugin),api.uint32,api.pointer(api.clap_audio_ports_config)).readWith(addr + 4, dataView),
			select: api.method(api.bool,api.pointer(api.clap_plugin),api.uint32).readWith(addr + 8, dataView)
		}),
		writeWith(addr, value, dataView) {
			count: api.method(api.uint32,api.pointer(api.clap_plugin)).writeWith(addr, dataView)
			get: api.method(api.bool,api.pointer(api.clap_plugin),api.uint32,api.pointer(api.clap_audio_ports_config)).writeWith(addr + 4, dataView)
			select: api.method(api.bool,api.pointer(api.clap_plugin),api.uint32).writeWith(addr + 8, dataView)
		},
		size: 12,
		align: 1
	},
	clap_plugin_audio_ports_config_info: {
		readWith:(addr, dataView) => ({
			current_config: api.method(api.uint32,api.pointer(api.clap_plugin)).readWith(addr, dataView),
			get: api.method(api.bool,api.pointer(api.clap_plugin),api.uint32,api.uint32,api.bool,api.pointer(api.clap_audio_port_info)).readWith(addr + 4, dataView)
		}),
		writeWith(addr, value, dataView) {
			current_config: api.method(api.uint32,api.pointer(api.clap_plugin)).writeWith(addr, dataView)
			get: api.method(api.bool,api.pointer(api.clap_plugin),api.uint32,api.uint32,api.bool,api.pointer(api.clap_audio_port_info)).writeWith(addr + 4, dataView)
		},
		size: 8,
		align: 1
	},
	clap_host_audio_ports_config: {
		readWith:(addr, dataView) => ({
			rescan: api.method(null,api.pointer(api.clap_host)).readWith(addr, dataView)
		}),
		writeWith(addr, value, dataView) {
			rescan: api.method(null,api.pointer(api.clap_host)).writeWith(addr, dataView)
		},
		size: 4,
		align: 1
	},
	clap_audio_port_configuration_request: {
		readWith:(addr, dataView) => ({
			is_input: api.bool.readWith(addr, dataView),
			port_index: api.uint32.readWith(addr + 4, dataView),
			channel_count: api.uint32.readWith(addr + 8, dataView),
			port_type: api.pointer(api.int8).readWith(addr + 12, dataView),
			port_details: api.pointer(null).readWith(addr + 16, dataView)
		}),
		writeWith(addr, value, dataView) {
			is_input: api.bool.writeWith(addr, dataView)
			port_index: api.uint32.writeWith(addr + 4, dataView)
			channel_count: api.uint32.writeWith(addr + 8, dataView)
			port_type: api.pointer(api.int8).writeWith(addr + 12, dataView)
			port_details: api.pointer(null).writeWith(addr + 16, dataView)
		},
		size: 20,
		align: 1
	},
	clap_plugin_configurable_audio_ports: {
		readWith:(addr, dataView) => ({
			can_apply_configuration: api.method(api.bool,api.pointer(api.clap_plugin),api.pointer(api.clap_audio_port_configuration_request),api.uint32).readWith(addr, dataView),
			apply_configuration: api.method(api.bool,api.pointer(api.clap_plugin),api.pointer(api.clap_audio_port_configuration_request),api.uint32).readWith(addr + 4, dataView)
		}),
		writeWith(addr, value, dataView) {
			can_apply_configuration: api.method(api.bool,api.pointer(api.clap_plugin),api.pointer(api.clap_audio_port_configuration_request),api.uint32).writeWith(addr, dataView)
			apply_configuration: api.method(api.bool,api.pointer(api.clap_plugin),api.pointer(api.clap_audio_port_configuration_request),api.uint32).writeWith(addr + 4, dataView)
		},
		size: 8,
		align: 1
	},
	clap_context_menu_target: {
		readWith:(addr, dataView) => ({
			kind: api.uint32.readWith(addr, dataView),
			id: api.uint32.readWith(addr + 4, dataView)
		}),
		writeWith(addr, value, dataView) {
			kind: api.uint32.writeWith(addr, dataView)
			id: api.uint32.writeWith(addr + 4, dataView)
		},
		size: 8,
		align: 1
	},
	clap_context_menu_entry: {
		readWith:(addr, dataView) => ({
			label: api.pointer(api.int8).readWith(addr, dataView),
			is_enabled: api.bool.readWith(addr + 4, dataView),
			action_id: api.uint32.readWith(addr + 8, dataView)
		}),
		writeWith(addr, value, dataView) {
			label: api.pointer(api.int8).writeWith(addr, dataView)
			is_enabled: api.bool.writeWith(addr + 4, dataView)
			action_id: api.uint32.writeWith(addr + 8, dataView)
		},
		size: 12,
		align: 1
	},
	clap_context_menu_check_entry: {
		readWith:(addr, dataView) => ({
			label: api.pointer(api.int8).readWith(addr, dataView),
			is_enabled: api.bool.readWith(addr + 4, dataView),
			is_checked: api.bool.readWith(addr + 5, dataView),
			action_id: api.uint32.readWith(addr + 8, dataView)
		}),
		writeWith(addr, value, dataView) {
			label: api.pointer(api.int8).writeWith(addr, dataView)
			is_enabled: api.bool.writeWith(addr + 4, dataView)
			is_checked: api.bool.writeWith(addr + 5, dataView)
			action_id: api.uint32.writeWith(addr + 8, dataView)
		},
		size: 12,
		align: 1
	},
	clap_context_menu_item_title: {
		readWith:(addr, dataView) => ({
			title: api.pointer(api.int8).readWith(addr, dataView),
			is_enabled: api.bool.readWith(addr + 4, dataView)
		}),
		writeWith(addr, value, dataView) {
			title: api.pointer(api.int8).writeWith(addr, dataView)
			is_enabled: api.bool.writeWith(addr + 4, dataView)
		},
		size: 5,
		align: 1
	},
	clap_context_menu_submenu: {
		readWith:(addr, dataView) => ({
			label: api.pointer(api.int8).readWith(addr, dataView),
			is_enabled: api.bool.readWith(addr + 4, dataView)
		}),
		writeWith(addr, value, dataView) {
			label: api.pointer(api.int8).writeWith(addr, dataView)
			is_enabled: api.bool.writeWith(addr + 4, dataView)
		},
		size: 5,
		align: 1
	},
	clap_context_menu_builder: {
		readWith:(addr, dataView) => ({
			ctx: api.pointer(null).readWith(addr, dataView),
			add_item: api.method(api.bool,api.pointer(api.clap_context_menu_builder),api.uint32,api.pointer(null)).readWith(addr + 4, dataView),
			supports: api.method(api.bool,api.pointer(api.clap_context_menu_builder),api.uint32).readWith(addr + 8, dataView)
		}),
		writeWith(addr, value, dataView) {
			ctx: api.pointer(null).writeWith(addr, dataView)
			add_item: api.method(api.bool,api.pointer(api.clap_context_menu_builder),api.uint32,api.pointer(null)).writeWith(addr + 4, dataView)
			supports: api.method(api.bool,api.pointer(api.clap_context_menu_builder),api.uint32).writeWith(addr + 8, dataView)
		},
		size: 12,
		align: 1
	},
	clap_plugin_context_menu: {
		readWith:(addr, dataView) => ({
			populate: api.method(api.bool,api.pointer(api.clap_plugin),api.pointer(api.clap_context_menu_target),api.pointer(api.clap_context_menu_builder)).readWith(addr, dataView),
			perform: api.method(api.bool,api.pointer(api.clap_plugin),api.pointer(api.clap_context_menu_target),api.uint32).readWith(addr + 4, dataView)
		}),
		writeWith(addr, value, dataView) {
			populate: api.method(api.bool,api.pointer(api.clap_plugin),api.pointer(api.clap_context_menu_target),api.pointer(api.clap_context_menu_builder)).writeWith(addr, dataView)
			perform: api.method(api.bool,api.pointer(api.clap_plugin),api.pointer(api.clap_context_menu_target),api.uint32).writeWith(addr + 4, dataView)
		},
		size: 8,
		align: 1
	},
	clap_host_context_menu: {
		readWith:(addr, dataView) => ({
			populate: api.method(api.bool,api.pointer(api.clap_host),api.pointer(api.clap_context_menu_target),api.pointer(api.clap_context_menu_builder)).readWith(addr, dataView),
			perform: api.method(api.bool,api.pointer(api.clap_host),api.pointer(api.clap_context_menu_target),api.uint32).readWith(addr + 4, dataView),
			can_popup: api.method(api.bool,api.pointer(api.clap_host)).readWith(addr + 8, dataView),
			popup: api.method(api.bool,api.pointer(api.clap_host),api.pointer(api.clap_context_menu_target),api.int32,api.int32,api.int32).readWith(addr + 12, dataView)
		}),
		writeWith(addr, value, dataView) {
			populate: api.method(api.bool,api.pointer(api.clap_host),api.pointer(api.clap_context_menu_target),api.pointer(api.clap_context_menu_builder)).writeWith(addr, dataView)
			perform: api.method(api.bool,api.pointer(api.clap_host),api.pointer(api.clap_context_menu_target),api.uint32).writeWith(addr + 4, dataView)
			can_popup: api.method(api.bool,api.pointer(api.clap_host)).writeWith(addr + 8, dataView)
			popup: api.method(api.bool,api.pointer(api.clap_host),api.pointer(api.clap_context_menu_target),api.int32,api.int32,api.int32).writeWith(addr + 12, dataView)
		},
		size: 16,
		align: 1
	},
	clap_host_event_registry: {
		readWith:(addr, dataView) => ({
			query: api.method(api.bool,api.pointer(api.clap_host),api.pointer(api.int8),api.pointer(api.uint16)).readWith(addr, dataView)
		}),
		writeWith(addr, value, dataView) {
			query: api.method(api.bool,api.pointer(api.clap_host),api.pointer(api.int8),api.pointer(api.uint16)).writeWith(addr, dataView)
		},
		size: 4,
		align: 1
	},
	clap_window: {
		readWith:(addr, dataView) => ({
			api: api.pointer(api.int8).readWith(addr, dataView),
			ptr: api.pointer(null).readWith(addr + 4, dataView)
		}),
		writeWith(addr, value, dataView) {
			api: api.pointer(api.int8).writeWith(addr, dataView)
			ptr: api.pointer(null).writeWith(addr + 4, dataView)
		},
		size: 8,
		align: 1
	},
	clap_gui_resize_hints: {
		readWith:(addr, dataView) => ({
			can_resize_horizontally: api.bool.readWith(addr, dataView),
			can_resize_vertically: api.bool.readWith(addr + 1, dataView),
			preserve_aspect_ratio: api.bool.readWith(addr + 2, dataView),
			aspect_ratio_width: api.uint32.readWith(addr + 4, dataView),
			aspect_ratio_height: api.uint32.readWith(addr + 8, dataView)
		}),
		writeWith(addr, value, dataView) {
			can_resize_horizontally: api.bool.writeWith(addr, dataView)
			can_resize_vertically: api.bool.writeWith(addr + 1, dataView)
			preserve_aspect_ratio: api.bool.writeWith(addr + 2, dataView)
			aspect_ratio_width: api.uint32.writeWith(addr + 4, dataView)
			aspect_ratio_height: api.uint32.writeWith(addr + 8, dataView)
		},
		size: 12,
		align: 1
	},
	clap_plugin_gui: {
		readWith:(addr, dataView) => ({
			is_api_supported: api.method(api.bool,api.pointer(api.clap_plugin),api.pointer(api.int8),api.bool).readWith(addr, dataView),
			get_preferred_api: api.method(api.bool,api.pointer(api.clap_plugin),api.pointer(api.pointer(api.int8)),api.pointer(api.bool)).readWith(addr + 4, dataView),
			create: api.method(api.bool,api.pointer(api.clap_plugin),api.pointer(api.int8),api.bool).readWith(addr + 8, dataView),
			destroy: api.method(null,api.pointer(api.clap_plugin)).readWith(addr + 12, dataView),
			set_scale: api.method(api.bool,api.pointer(api.clap_plugin),api.double).readWith(addr + 16, dataView),
			get_size: api.method(api.bool,api.pointer(api.clap_plugin),api.pointer(api.uint32),api.pointer(api.uint32)).readWith(addr + 20, dataView),
			can_resize: api.method(api.bool,api.pointer(api.clap_plugin)).readWith(addr + 24, dataView),
			get_resize_hints: api.method(api.bool,api.pointer(api.clap_plugin),api.pointer(api.clap_gui_resize_hints)).readWith(addr + 28, dataView),
			adjust_size: api.method(api.bool,api.pointer(api.clap_plugin),api.pointer(api.uint32),api.pointer(api.uint32)).readWith(addr + 32, dataView),
			set_size: api.method(api.bool,api.pointer(api.clap_plugin),api.uint32,api.uint32).readWith(addr + 36, dataView),
			set_parent: api.method(api.bool,api.pointer(api.clap_plugin),api.pointer(api.clap_window)).readWith(addr + 40, dataView),
			set_transient: api.method(api.bool,api.pointer(api.clap_plugin),api.pointer(api.clap_window)).readWith(addr + 44, dataView),
			suggest_title: api.method(null,api.pointer(api.clap_plugin),api.pointer(api.int8)).readWith(addr + 48, dataView),
			show: api.method(api.bool,api.pointer(api.clap_plugin)).readWith(addr + 52, dataView),
			hide: api.method(api.bool,api.pointer(api.clap_plugin)).readWith(addr + 56, dataView)
		}),
		writeWith(addr, value, dataView) {
			is_api_supported: api.method(api.bool,api.pointer(api.clap_plugin),api.pointer(api.int8),api.bool).writeWith(addr, dataView)
			get_preferred_api: api.method(api.bool,api.pointer(api.clap_plugin),api.pointer(api.pointer(api.int8)),api.pointer(api.bool)).writeWith(addr + 4, dataView)
			create: api.method(api.bool,api.pointer(api.clap_plugin),api.pointer(api.int8),api.bool).writeWith(addr + 8, dataView)
			destroy: api.method(null,api.pointer(api.clap_plugin)).writeWith(addr + 12, dataView)
			set_scale: api.method(api.bool,api.pointer(api.clap_plugin),api.double).writeWith(addr + 16, dataView)
			get_size: api.method(api.bool,api.pointer(api.clap_plugin),api.pointer(api.uint32),api.pointer(api.uint32)).writeWith(addr + 20, dataView)
			can_resize: api.method(api.bool,api.pointer(api.clap_plugin)).writeWith(addr + 24, dataView)
			get_resize_hints: api.method(api.bool,api.pointer(api.clap_plugin),api.pointer(api.clap_gui_resize_hints)).writeWith(addr + 28, dataView)
			adjust_size: api.method(api.bool,api.pointer(api.clap_plugin),api.pointer(api.uint32),api.pointer(api.uint32)).writeWith(addr + 32, dataView)
			set_size: api.method(api.bool,api.pointer(api.clap_plugin),api.uint32,api.uint32).writeWith(addr + 36, dataView)
			set_parent: api.method(api.bool,api.pointer(api.clap_plugin),api.pointer(api.clap_window)).writeWith(addr + 40, dataView)
			set_transient: api.method(api.bool,api.pointer(api.clap_plugin),api.pointer(api.clap_window)).writeWith(addr + 44, dataView)
			suggest_title: api.method(null,api.pointer(api.clap_plugin),api.pointer(api.int8)).writeWith(addr + 48, dataView)
			show: api.method(api.bool,api.pointer(api.clap_plugin)).writeWith(addr + 52, dataView)
			hide: api.method(api.bool,api.pointer(api.clap_plugin)).writeWith(addr + 56, dataView)
		},
		size: 60,
		align: 1
	},
	clap_host_gui: {
		readWith:(addr, dataView) => ({
			resize_hints_changed: api.method(null,api.pointer(api.clap_host)).readWith(addr, dataView),
			request_resize: api.method(api.bool,api.pointer(api.clap_host),api.uint32,api.uint32).readWith(addr + 4, dataView),
			request_show: api.method(api.bool,api.pointer(api.clap_host)).readWith(addr + 8, dataView),
			request_hide: api.method(api.bool,api.pointer(api.clap_host)).readWith(addr + 12, dataView),
			closed: api.method(null,api.pointer(api.clap_host),api.bool).readWith(addr + 16, dataView)
		}),
		writeWith(addr, value, dataView) {
			resize_hints_changed: api.method(null,api.pointer(api.clap_host)).writeWith(addr, dataView)
			request_resize: api.method(api.bool,api.pointer(api.clap_host),api.uint32,api.uint32).writeWith(addr + 4, dataView)
			request_show: api.method(api.bool,api.pointer(api.clap_host)).writeWith(addr + 8, dataView)
			request_hide: api.method(api.bool,api.pointer(api.clap_host)).writeWith(addr + 12, dataView)
			closed: api.method(null,api.pointer(api.clap_host),api.bool).writeWith(addr + 16, dataView)
		},
		size: 20,
		align: 1
	},
	clap_plugin_latency: {
		readWith:(addr, dataView) => ({
			get: api.method(api.uint32,api.pointer(api.clap_plugin)).readWith(addr, dataView)
		}),
		writeWith(addr, value, dataView) {
			get: api.method(api.uint32,api.pointer(api.clap_plugin)).writeWith(addr, dataView)
		},
		size: 4,
		align: 1
	},
	clap_host_latency: {
		readWith:(addr, dataView) => ({
			changed: api.method(null,api.pointer(api.clap_host)).readWith(addr, dataView)
		}),
		writeWith(addr, value, dataView) {
			changed: api.method(null,api.pointer(api.clap_host)).writeWith(addr, dataView)
		},
		size: 4,
		align: 1
	},
	clap_host_log: {
		readWith:(addr, dataView) => ({
			log: api.method(null,api.pointer(api.clap_host),api.int32,api.pointer(api.int8)).readWith(addr, dataView)
		}),
		writeWith(addr, value, dataView) {
			log: api.method(null,api.pointer(api.clap_host),api.int32,api.pointer(api.int8)).writeWith(addr, dataView)
		},
		size: 4,
		align: 1
	},
	clap_note_name: {
		readWith:(addr, dataView) => ({
			name: api.array(api.int8, 256).readWith(addr, dataView),
			port: api.int16.readWith(addr + 256, dataView),
			key: api.int16.readWith(addr + 258, dataView),
			channel: api.int16.readWith(addr + 260, dataView)
		}),
		writeWith(addr, value, dataView) {
			name: api.array(api.int8, 256).writeWith(addr, dataView)
			port: api.int16.writeWith(addr + 256, dataView)
			key: api.int16.writeWith(addr + 258, dataView)
			channel: api.int16.writeWith(addr + 260, dataView)
		},
		size: 262,
		align: 1
	},
	clap_plugin_note_name: {
		readWith:(addr, dataView) => ({
			count: api.method(api.uint32,api.pointer(api.clap_plugin)).readWith(addr, dataView),
			get: api.method(api.bool,api.pointer(api.clap_plugin),api.uint32,api.pointer(api.clap_note_name)).readWith(addr + 4, dataView)
		}),
		writeWith(addr, value, dataView) {
			count: api.method(api.uint32,api.pointer(api.clap_plugin)).writeWith(addr, dataView)
			get: api.method(api.bool,api.pointer(api.clap_plugin),api.uint32,api.pointer(api.clap_note_name)).writeWith(addr + 4, dataView)
		},
		size: 8,
		align: 1
	},
	clap_host_note_name: {
		readWith:(addr, dataView) => ({
			changed: api.method(null,api.pointer(api.clap_host)).readWith(addr, dataView)
		}),
		writeWith(addr, value, dataView) {
			changed: api.method(null,api.pointer(api.clap_host)).writeWith(addr, dataView)
		},
		size: 4,
		align: 1
	},
	clap_note_port_info: {
		readWith:(addr, dataView) => ({
			id: api.uint32.readWith(addr, dataView),
			supported_dialects: api.uint32.readWith(addr + 4, dataView),
			preferred_dialect: api.uint32.readWith(addr + 8, dataView),
			name: api.array(api.int8, 256).readWith(addr + 12, dataView)
		}),
		writeWith(addr, value, dataView) {
			id: api.uint32.writeWith(addr, dataView)
			supported_dialects: api.uint32.writeWith(addr + 4, dataView)
			preferred_dialect: api.uint32.writeWith(addr + 8, dataView)
			name: api.array(api.int8, 256).writeWith(addr + 12, dataView)
		},
		size: 268,
		align: 1
	},
	clap_plugin_note_ports: {
		readWith:(addr, dataView) => ({
			count: api.method(api.uint32,api.pointer(api.clap_plugin),api.bool).readWith(addr, dataView),
			get: api.method(api.bool,api.pointer(api.clap_plugin),api.uint32,api.bool,api.pointer(api.clap_note_port_info)).readWith(addr + 4, dataView)
		}),
		writeWith(addr, value, dataView) {
			count: api.method(api.uint32,api.pointer(api.clap_plugin),api.bool).writeWith(addr, dataView)
			get: api.method(api.bool,api.pointer(api.clap_plugin),api.uint32,api.bool,api.pointer(api.clap_note_port_info)).writeWith(addr + 4, dataView)
		},
		size: 8,
		align: 1
	},
	clap_host_note_ports: {
		readWith:(addr, dataView) => ({
			supported_dialects: api.method(api.uint32,api.pointer(api.clap_host)).readWith(addr, dataView),
			rescan: api.method(null,api.pointer(api.clap_host),api.uint32).readWith(addr + 4, dataView)
		}),
		writeWith(addr, value, dataView) {
			supported_dialects: api.method(api.uint32,api.pointer(api.clap_host)).writeWith(addr, dataView)
			rescan: api.method(null,api.pointer(api.clap_host),api.uint32).writeWith(addr + 4, dataView)
		},
		size: 8,
		align: 1
	},
	clap_param_info: {
		readWith:(addr, dataView) => ({
			id: api.uint32.readWith(addr, dataView),
			flags: api.uint32.readWith(addr + 4, dataView),
			cookie: api.pointer(null).readWith(addr + 8, dataView),
			name: api.array(api.int8, 256).readWith(addr + 12, dataView),
			module: api.array(api.int8, 1024).readWith(addr + 268, dataView),
			min_value: api.double.readWith(addr + 1296, dataView),
			max_value: api.double.readWith(addr + 1304, dataView),
			default_value: api.double.readWith(addr + 1312, dataView)
		}),
		writeWith(addr, value, dataView) {
			id: api.uint32.writeWith(addr, dataView)
			flags: api.uint32.writeWith(addr + 4, dataView)
			cookie: api.pointer(null).writeWith(addr + 8, dataView)
			name: api.array(api.int8, 256).writeWith(addr + 12, dataView)
			module: api.array(api.int8, 1024).writeWith(addr + 268, dataView)
			min_value: api.double.writeWith(addr + 1296, dataView)
			max_value: api.double.writeWith(addr + 1304, dataView)
			default_value: api.double.writeWith(addr + 1312, dataView)
		},
		size: 1320,
		align: 1
	},
	clap_plugin_params: {
		readWith:(addr, dataView) => ({
			count: api.method(api.uint32,api.pointer(api.clap_plugin)).readWith(addr, dataView),
			get_info: api.method(api.bool,api.pointer(api.clap_plugin),api.uint32,api.pointer(api.clap_param_info)).readWith(addr + 4, dataView),
			get_value: api.method(api.bool,api.pointer(api.clap_plugin),api.uint32,api.pointer(api.double)).readWith(addr + 8, dataView),
			value_to_text: api.method(api.bool,api.pointer(api.clap_plugin),api.uint32,api.double,api.pointer(api.int8),api.uint32).readWith(addr + 12, dataView),
			text_to_value: api.method(api.bool,api.pointer(api.clap_plugin),api.uint32,api.pointer(api.int8),api.pointer(api.double)).readWith(addr + 16, dataView),
			flush: api.method(null,api.pointer(api.clap_plugin),api.pointer(api.clap_input_events),api.pointer(api.clap_output_events)).readWith(addr + 20, dataView)
		}),
		writeWith(addr, value, dataView) {
			count: api.method(api.uint32,api.pointer(api.clap_plugin)).writeWith(addr, dataView)
			get_info: api.method(api.bool,api.pointer(api.clap_plugin),api.uint32,api.pointer(api.clap_param_info)).writeWith(addr + 4, dataView)
			get_value: api.method(api.bool,api.pointer(api.clap_plugin),api.uint32,api.pointer(api.double)).writeWith(addr + 8, dataView)
			value_to_text: api.method(api.bool,api.pointer(api.clap_plugin),api.uint32,api.double,api.pointer(api.int8),api.uint32).writeWith(addr + 12, dataView)
			text_to_value: api.method(api.bool,api.pointer(api.clap_plugin),api.uint32,api.pointer(api.int8),api.pointer(api.double)).writeWith(addr + 16, dataView)
			flush: api.method(null,api.pointer(api.clap_plugin),api.pointer(api.clap_input_events),api.pointer(api.clap_output_events)).writeWith(addr + 20, dataView)
		},
		size: 24,
		align: 1
	},
	clap_host_params: {
		readWith:(addr, dataView) => ({
			rescan: api.method(null,api.pointer(api.clap_host),api.uint32).readWith(addr, dataView),
			clear: api.method(null,api.pointer(api.clap_host),api.uint32,api.uint32).readWith(addr + 4, dataView),
			request_flush: api.method(null,api.pointer(api.clap_host)).readWith(addr + 8, dataView)
		}),
		writeWith(addr, value, dataView) {
			rescan: api.method(null,api.pointer(api.clap_host),api.uint32).writeWith(addr, dataView)
			clear: api.method(null,api.pointer(api.clap_host),api.uint32,api.uint32).writeWith(addr + 4, dataView)
			request_flush: api.method(null,api.pointer(api.clap_host)).writeWith(addr + 8, dataView)
		},
		size: 12,
		align: 1
	},
	clap_color: {
		readWith:(addr, dataView) => ({
			alpha: api.uint8.readWith(addr, dataView),
			red: api.uint8.readWith(addr + 1, dataView),
			green: api.uint8.readWith(addr + 2, dataView),
			blue: api.uint8.readWith(addr + 3, dataView)
		}),
		writeWith(addr, value, dataView) {
			alpha: api.uint8.writeWith(addr, dataView)
			red: api.uint8.writeWith(addr + 1, dataView)
			green: api.uint8.writeWith(addr + 2, dataView)
			blue: api.uint8.writeWith(addr + 3, dataView)
		},
		size: 4,
		align: 1
	},
	clap_plugin_param_indication: {
		readWith:(addr, dataView) => ({
			set_mapping: api.method(null,api.pointer(api.clap_plugin),api.uint32,api.bool,api.pointer(api.clap_color),api.pointer(api.int8),api.pointer(api.int8)).readWith(addr, dataView),
			set_automation: api.method(null,api.pointer(api.clap_plugin),api.uint32,api.uint32,api.pointer(api.clap_color)).readWith(addr + 4, dataView)
		}),
		writeWith(addr, value, dataView) {
			set_mapping: api.method(null,api.pointer(api.clap_plugin),api.uint32,api.bool,api.pointer(api.clap_color),api.pointer(api.int8),api.pointer(api.int8)).writeWith(addr, dataView)
			set_automation: api.method(null,api.pointer(api.clap_plugin),api.uint32,api.uint32,api.pointer(api.clap_color)).writeWith(addr + 4, dataView)
		},
		size: 8,
		align: 1
	},
	clap_plugin_posix_fd_support: {
		readWith:(addr, dataView) => ({
			on_fd: api.method(null,api.pointer(api.clap_plugin),api.int32,api.uint32).readWith(addr, dataView)
		}),
		writeWith(addr, value, dataView) {
			on_fd: api.method(null,api.pointer(api.clap_plugin),api.int32,api.uint32).writeWith(addr, dataView)
		},
		size: 4,
		align: 1
	},
	clap_host_posix_fd_support: {
		readWith:(addr, dataView) => ({
			register_fd: api.method(api.bool,api.pointer(api.clap_host),api.int32,api.uint32).readWith(addr, dataView),
			modify_fd: api.method(api.bool,api.pointer(api.clap_host),api.int32,api.uint32).readWith(addr + 4, dataView),
			unregister_fd: api.method(api.bool,api.pointer(api.clap_host),api.int32).readWith(addr + 8, dataView)
		}),
		writeWith(addr, value, dataView) {
			register_fd: api.method(api.bool,api.pointer(api.clap_host),api.int32,api.uint32).writeWith(addr, dataView)
			modify_fd: api.method(api.bool,api.pointer(api.clap_host),api.int32,api.uint32).writeWith(addr + 4, dataView)
			unregister_fd: api.method(api.bool,api.pointer(api.clap_host),api.int32).writeWith(addr + 8, dataView)
		},
		size: 12,
		align: 1
	},
	clap_plugin_preset_load: {
		readWith:(addr, dataView) => ({
			from_location: api.method(api.bool,api.pointer(api.clap_plugin),api.uint32,api.pointer(api.int8),api.pointer(api.int8)).readWith(addr, dataView)
		}),
		writeWith(addr, value, dataView) {
			from_location: api.method(api.bool,api.pointer(api.clap_plugin),api.uint32,api.pointer(api.int8),api.pointer(api.int8)).writeWith(addr, dataView)
		},
		size: 4,
		align: 1
	},
	clap_host_preset_load: {
		readWith:(addr, dataView) => ({
			on_error: api.method(null,api.pointer(api.clap_host),api.uint32,api.pointer(api.int8),api.pointer(api.int8),api.int32,api.pointer(api.int8)).readWith(addr, dataView),
			loaded: api.method(null,api.pointer(api.clap_host),api.uint32,api.pointer(api.int8),api.pointer(api.int8)).readWith(addr + 4, dataView)
		}),
		writeWith(addr, value, dataView) {
			on_error: api.method(null,api.pointer(api.clap_host),api.uint32,api.pointer(api.int8),api.pointer(api.int8),api.int32,api.pointer(api.int8)).writeWith(addr, dataView)
			loaded: api.method(null,api.pointer(api.clap_host),api.uint32,api.pointer(api.int8),api.pointer(api.int8)).writeWith(addr + 4, dataView)
		},
		size: 8,
		align: 1
	},
	clap_remote_controls_page: {
		readWith:(addr, dataView) => ({
			section_name: api.array(api.int8, 256).readWith(addr, dataView),
			page_id: api.uint32.readWith(addr + 256, dataView),
			page_name: api.array(api.int8, 256).readWith(addr + 260, dataView),
			param_ids: api.array(api.uint32, 8).readWith(addr + 516, dataView),
			is_for_preset: api.bool.readWith(addr + 548, dataView)
		}),
		writeWith(addr, value, dataView) {
			section_name: api.array(api.int8, 256).writeWith(addr, dataView)
			page_id: api.uint32.writeWith(addr + 256, dataView)
			page_name: api.array(api.int8, 256).writeWith(addr + 260, dataView)
			param_ids: api.array(api.uint32, 8).writeWith(addr + 516, dataView)
			is_for_preset: api.bool.writeWith(addr + 548, dataView)
		},
		size: 549,
		align: 1
	},
	clap_plugin_remote_controls: {
		readWith:(addr, dataView) => ({
			count: api.method(api.uint32,api.pointer(api.clap_plugin)).readWith(addr, dataView),
			get: api.method(api.bool,api.pointer(api.clap_plugin),api.uint32,api.pointer(api.clap_remote_controls_page)).readWith(addr + 4, dataView)
		}),
		writeWith(addr, value, dataView) {
			count: api.method(api.uint32,api.pointer(api.clap_plugin)).writeWith(addr, dataView)
			get: api.method(api.bool,api.pointer(api.clap_plugin),api.uint32,api.pointer(api.clap_remote_controls_page)).writeWith(addr + 4, dataView)
		},
		size: 8,
		align: 1
	},
	clap_host_remote_controls: {
		readWith:(addr, dataView) => ({
			changed: api.method(null,api.pointer(api.clap_host)).readWith(addr, dataView),
			suggest_page: api.method(null,api.pointer(api.clap_host),api.uint32).readWith(addr + 4, dataView)
		}),
		writeWith(addr, value, dataView) {
			changed: api.method(null,api.pointer(api.clap_host)).writeWith(addr, dataView)
			suggest_page: api.method(null,api.pointer(api.clap_host),api.uint32).writeWith(addr + 4, dataView)
		},
		size: 8,
		align: 1
	},
	clap_plugin_render: {
		readWith:(addr, dataView) => ({
			has_hard_realtime_requirement: api.method(api.bool,api.pointer(api.clap_plugin)).readWith(addr, dataView),
			set: api.method(api.bool,api.pointer(api.clap_plugin),api.int32).readWith(addr + 4, dataView)
		}),
		writeWith(addr, value, dataView) {
			has_hard_realtime_requirement: api.method(api.bool,api.pointer(api.clap_plugin)).writeWith(addr, dataView)
			set: api.method(api.bool,api.pointer(api.clap_plugin),api.int32).writeWith(addr + 4, dataView)
		},
		size: 8,
		align: 1
	},
	clap_istream: {
		readWith:(addr, dataView) => ({
			ctx: api.pointer(null).readWith(addr, dataView),
			read: api.method(api.int64,api.pointer(api.clap_istream),api.pointer(null),api.uint64).readWith(addr + 4, dataView)
		}),
		writeWith(addr, value, dataView) {
			ctx: api.pointer(null).writeWith(addr, dataView)
			read: api.method(api.int64,api.pointer(api.clap_istream),api.pointer(null),api.uint64).writeWith(addr + 4, dataView)
		},
		size: 8,
		align: 1
	},
	clap_ostream: {
		readWith:(addr, dataView) => ({
			ctx: api.pointer(null).readWith(addr, dataView),
			write: api.method(api.int64,api.pointer(api.clap_ostream),api.pointer(null),api.uint64).readWith(addr + 4, dataView)
		}),
		writeWith(addr, value, dataView) {
			ctx: api.pointer(null).writeWith(addr, dataView)
			write: api.method(api.int64,api.pointer(api.clap_ostream),api.pointer(null),api.uint64).writeWith(addr + 4, dataView)
		},
		size: 8,
		align: 1
	},
	clap_plugin_state_context: {
		readWith:(addr, dataView) => ({
			save: api.method(api.bool,api.pointer(api.clap_plugin),api.pointer(api.clap_ostream),api.uint32).readWith(addr, dataView),
			load: api.method(api.bool,api.pointer(api.clap_plugin),api.pointer(api.clap_istream),api.uint32).readWith(addr + 4, dataView)
		}),
		writeWith(addr, value, dataView) {
			save: api.method(api.bool,api.pointer(api.clap_plugin),api.pointer(api.clap_ostream),api.uint32).writeWith(addr, dataView)
			load: api.method(api.bool,api.pointer(api.clap_plugin),api.pointer(api.clap_istream),api.uint32).writeWith(addr + 4, dataView)
		},
		size: 8,
		align: 1
	},
	clap_plugin_state: {
		readWith:(addr, dataView) => ({
			save: api.method(api.bool,api.pointer(api.clap_plugin),api.pointer(api.clap_ostream)).readWith(addr, dataView),
			load: api.method(api.bool,api.pointer(api.clap_plugin),api.pointer(api.clap_istream)).readWith(addr + 4, dataView)
		}),
		writeWith(addr, value, dataView) {
			save: api.method(api.bool,api.pointer(api.clap_plugin),api.pointer(api.clap_ostream)).writeWith(addr, dataView)
			load: api.method(api.bool,api.pointer(api.clap_plugin),api.pointer(api.clap_istream)).writeWith(addr + 4, dataView)
		},
		size: 8,
		align: 1
	},
	clap_host_state: {
		readWith:(addr, dataView) => ({
			mark_dirty: api.method(null,api.pointer(api.clap_host)).readWith(addr, dataView)
		}),
		writeWith(addr, value, dataView) {
			mark_dirty: api.method(null,api.pointer(api.clap_host)).writeWith(addr, dataView)
		},
		size: 4,
		align: 1
	},
	clap_plugin_surround: {
		readWith:(addr, dataView) => ({
			is_channel_mask_supported: api.method(api.bool,api.pointer(api.clap_plugin),api.uint64).readWith(addr, dataView),
			get_channel_map: api.method(api.uint32,api.pointer(api.clap_plugin),api.bool,api.uint32,api.pointer(api.uint8),api.uint32).readWith(addr + 4, dataView)
		}),
		writeWith(addr, value, dataView) {
			is_channel_mask_supported: api.method(api.bool,api.pointer(api.clap_plugin),api.uint64).writeWith(addr, dataView)
			get_channel_map: api.method(api.uint32,api.pointer(api.clap_plugin),api.bool,api.uint32,api.pointer(api.uint8),api.uint32).writeWith(addr + 4, dataView)
		},
		size: 8,
		align: 1
	},
	clap_host_surround: {
		readWith:(addr, dataView) => ({
			changed: api.method(null,api.pointer(api.clap_host)).readWith(addr, dataView)
		}),
		writeWith(addr, value, dataView) {
			changed: api.method(null,api.pointer(api.clap_host)).writeWith(addr, dataView)
		},
		size: 4,
		align: 1
	},
	clap_plugin_tail: {
		readWith:(addr, dataView) => ({
			get: api.method(api.uint32,api.pointer(api.clap_plugin)).readWith(addr, dataView)
		}),
		writeWith(addr, value, dataView) {
			get: api.method(api.uint32,api.pointer(api.clap_plugin)).writeWith(addr, dataView)
		},
		size: 4,
		align: 1
	},
	clap_host_tail: {
		readWith:(addr, dataView) => ({
			changed: api.method(null,api.pointer(api.clap_host)).readWith(addr, dataView)
		}),
		writeWith(addr, value, dataView) {
			changed: api.method(null,api.pointer(api.clap_host)).writeWith(addr, dataView)
		},
		size: 4,
		align: 1
	},
	clap_host_thread_check: {
		readWith:(addr, dataView) => ({
			is_main_thread: api.method(api.bool,api.pointer(api.clap_host)).readWith(addr, dataView),
			is_audio_thread: api.method(api.bool,api.pointer(api.clap_host)).readWith(addr + 4, dataView)
		}),
		writeWith(addr, value, dataView) {
			is_main_thread: api.method(api.bool,api.pointer(api.clap_host)).writeWith(addr, dataView)
			is_audio_thread: api.method(api.bool,api.pointer(api.clap_host)).writeWith(addr + 4, dataView)
		},
		size: 8,
		align: 1
	},
	clap_plugin_thread_pool: {
		readWith:(addr, dataView) => ({
			exec: api.method(null,api.pointer(api.clap_plugin),api.uint32).readWith(addr, dataView)
		}),
		writeWith(addr, value, dataView) {
			exec: api.method(null,api.pointer(api.clap_plugin),api.uint32).writeWith(addr, dataView)
		},
		size: 4,
		align: 1
	},
	clap_host_thread_pool: {
		readWith:(addr, dataView) => ({
			request_exec: api.method(api.bool,api.pointer(api.clap_host),api.uint32).readWith(addr, dataView)
		}),
		writeWith(addr, value, dataView) {
			request_exec: api.method(api.bool,api.pointer(api.clap_host),api.uint32).writeWith(addr, dataView)
		},
		size: 4,
		align: 1
	},
	clap_plugin_timer_support: {
		readWith:(addr, dataView) => ({
			on_timer: api.method(null,api.pointer(api.clap_plugin),api.uint32).readWith(addr, dataView)
		}),
		writeWith(addr, value, dataView) {
			on_timer: api.method(null,api.pointer(api.clap_plugin),api.uint32).writeWith(addr, dataView)
		},
		size: 4,
		align: 1
	},
	clap_host_timer_support: {
		readWith:(addr, dataView) => ({
			register_timer: api.method(api.bool,api.pointer(api.clap_host),api.uint32,api.pointer(api.uint32)).readWith(addr, dataView),
			unregister_timer: api.method(api.bool,api.pointer(api.clap_host),api.uint32).readWith(addr + 4, dataView)
		}),
		writeWith(addr, value, dataView) {
			register_timer: api.method(api.bool,api.pointer(api.clap_host),api.uint32,api.pointer(api.uint32)).writeWith(addr, dataView)
			unregister_timer: api.method(api.bool,api.pointer(api.clap_host),api.uint32).writeWith(addr + 4, dataView)
		},
		size: 8,
		align: 1
	},
	clap_track_info: {
		readWith:(addr, dataView) => ({
			flags: api.uint64.readWith(addr, dataView),
			name: api.array(api.int8, 256).readWith(addr + 8, dataView),
			color: api.clap_color.readWith(addr + 264, dataView),
			audio_channel_count: api.int32.readWith(addr + 268, dataView),
			audio_port_type: api.pointer(api.int8).readWith(addr + 272, dataView)
		}),
		writeWith(addr, value, dataView) {
			flags: api.uint64.writeWith(addr, dataView)
			name: api.array(api.int8, 256).writeWith(addr + 8, dataView)
			color: api.clap_color.writeWith(addr + 264, dataView)
			audio_channel_count: api.int32.writeWith(addr + 268, dataView)
			audio_port_type: api.pointer(api.int8).writeWith(addr + 272, dataView)
		},
		size: 276,
		align: 1
	},
	clap_plugin_track_info: {
		readWith:(addr, dataView) => ({
			changed: api.method(null,api.pointer(api.clap_plugin)).readWith(addr, dataView)
		}),
		writeWith(addr, value, dataView) {
			changed: api.method(null,api.pointer(api.clap_plugin)).writeWith(addr, dataView)
		},
		size: 4,
		align: 1
	},
	clap_host_track_info: {
		readWith:(addr, dataView) => ({
			get: api.method(api.bool,api.pointer(api.clap_host),api.pointer(api.clap_track_info)).readWith(addr, dataView)
		}),
		writeWith(addr, value, dataView) {
			get: api.method(api.bool,api.pointer(api.clap_host),api.pointer(api.clap_track_info)).writeWith(addr, dataView)
		},
		size: 4,
		align: 1
	},
	clap_voice_info: {
		readWith:(addr, dataView) => ({
			voice_count: api.uint32.readWith(addr, dataView),
			voice_capacity: api.uint32.readWith(addr + 4, dataView),
			flags: api.uint64.readWith(addr + 8, dataView)
		}),
		writeWith(addr, value, dataView) {
			voice_count: api.uint32.writeWith(addr, dataView)
			voice_capacity: api.uint32.writeWith(addr + 4, dataView)
			flags: api.uint64.writeWith(addr + 8, dataView)
		},
		size: 16,
		align: 1
	},
	clap_plugin_voice_info: {
		readWith:(addr, dataView) => ({
			get: api.method(api.bool,api.pointer(api.clap_plugin),api.pointer(api.clap_voice_info)).readWith(addr, dataView)
		}),
		writeWith(addr, value, dataView) {
			get: api.method(api.bool,api.pointer(api.clap_plugin),api.pointer(api.clap_voice_info)).writeWith(addr, dataView)
		},
		size: 4,
		align: 1
	},
	clap_host_voice_info: {
		readWith:(addr, dataView) => ({
			changed: api.method(null,api.pointer(api.clap_host)).readWith(addr, dataView)
		}),
		writeWith(addr, value, dataView) {
			changed: api.method(null,api.pointer(api.clap_host)).writeWith(addr, dataView)
		},
		size: 4,
		align: 1
	},
	clap_plugin_invalidation_source: {
		readWith:(addr, dataView) => ({
			directory: api.pointer(api.int8).readWith(addr, dataView),
			filename_glob: api.pointer(api.int8).readWith(addr + 4, dataView),
			recursive_scan: api.bool.readWith(addr + 8, dataView)
		}),
		writeWith(addr, value, dataView) {
			directory: api.pointer(api.int8).writeWith(addr, dataView)
			filename_glob: api.pointer(api.int8).writeWith(addr + 4, dataView)
			recursive_scan: api.bool.writeWith(addr + 8, dataView)
		},
		size: 9,
		align: 1
	},
	clap_plugin_invalidation_factory: {
		readWith:(addr, dataView) => ({
			count: api.method(api.uint32,api.pointer(api.clap_plugin_invalidation_factory)).readWith(addr, dataView),
			get: api.method(api.pointer(api.clap_plugin_invalidation_source),api.pointer(api.clap_plugin_invalidation_factory),api.uint32).readWith(addr + 4, dataView),
			refresh: api.method(api.bool,api.pointer(api.clap_plugin_invalidation_factory)).readWith(addr + 8, dataView)
		}),
		writeWith(addr, value, dataView) {
			count: api.method(api.uint32,api.pointer(api.clap_plugin_invalidation_factory)).writeWith(addr, dataView)
			get: api.method(api.pointer(api.clap_plugin_invalidation_source),api.pointer(api.clap_plugin_invalidation_factory),api.uint32).writeWith(addr + 4, dataView)
			refresh: api.method(api.bool,api.pointer(api.clap_plugin_invalidation_factory)).writeWith(addr + 8, dataView)
		},
		size: 12,
		align: 1
	},
	clap_plugin_state_converter_descriptor: {
		readWith:(addr, dataView) => ({
			clap_version: api.clap_version.readWith(addr, dataView),
			src_plugin_id: api.clap_universal_plugin_id.readWith(addr + 12, dataView),
			dst_plugin_id: api.clap_universal_plugin_id.readWith(addr + 20, dataView),
			id: api.pointer(api.int8).readWith(addr + 28, dataView),
			name: api.pointer(api.int8).readWith(addr + 32, dataView),
			vendor: api.pointer(api.int8).readWith(addr + 36, dataView),
			version: api.pointer(api.int8).readWith(addr + 40, dataView),
			description: api.pointer(api.int8).readWith(addr + 44, dataView)
		}),
		writeWith(addr, value, dataView) {
			clap_version: api.clap_version.writeWith(addr, dataView)
			src_plugin_id: api.clap_universal_plugin_id.writeWith(addr + 12, dataView)
			dst_plugin_id: api.clap_universal_plugin_id.writeWith(addr + 20, dataView)
			id: api.pointer(api.int8).writeWith(addr + 28, dataView)
			name: api.pointer(api.int8).writeWith(addr + 32, dataView)
			vendor: api.pointer(api.int8).writeWith(addr + 36, dataView)
			version: api.pointer(api.int8).writeWith(addr + 40, dataView)
			description: api.pointer(api.int8).writeWith(addr + 44, dataView)
		},
		size: 48,
		align: 1
	},
	clap_plugin_state_converter: {
		readWith:(addr, dataView) => ({
			desc: api.pointer(api.clap_plugin_state_converter_descriptor).readWith(addr, dataView),
			converter_data: api.pointer(null).readWith(addr + 4, dataView),
			destroy: api.method(null,api.pointer(api.clap_plugin_state_converter)).readWith(addr + 8, dataView),
			convert_state: api.method(api.bool,api.pointer(api.clap_plugin_state_converter),api.pointer(api.clap_istream),api.pointer(api.clap_ostream),api.pointer(api.int8),api.uint32).readWith(addr + 12, dataView),
			convert_normalized_value: api.method(api.bool,api.pointer(api.clap_plugin_state_converter),api.uint32,api.double,api.pointer(api.uint32),api.pointer(api.double)).readWith(addr + 16, dataView),
			convert_plain_value: api.method(api.bool,api.pointer(api.clap_plugin_state_converter),api.uint32,api.double,api.pointer(api.uint32),api.pointer(api.double)).readWith(addr + 20, dataView)
		}),
		writeWith(addr, value, dataView) {
			desc: api.pointer(api.clap_plugin_state_converter_descriptor).writeWith(addr, dataView)
			converter_data: api.pointer(null).writeWith(addr + 4, dataView)
			destroy: api.method(null,api.pointer(api.clap_plugin_state_converter)).writeWith(addr + 8, dataView)
			convert_state: api.method(api.bool,api.pointer(api.clap_plugin_state_converter),api.pointer(api.clap_istream),api.pointer(api.clap_ostream),api.pointer(api.int8),api.uint32).writeWith(addr + 12, dataView)
			convert_normalized_value: api.method(api.bool,api.pointer(api.clap_plugin_state_converter),api.uint32,api.double,api.pointer(api.uint32),api.pointer(api.double)).writeWith(addr + 16, dataView)
			convert_plain_value: api.method(api.bool,api.pointer(api.clap_plugin_state_converter),api.uint32,api.double,api.pointer(api.uint32),api.pointer(api.double)).writeWith(addr + 20, dataView)
		},
		size: 24,
		align: 1
	},
	clap_plugin_state_converter_factory: {
		readWith:(addr, dataView) => ({
			count: api.method(api.uint32,api.pointer(api.clap_plugin_state_converter_factory)).readWith(addr, dataView),
			get_descriptor: api.method(api.pointer(api.clap_plugin_state_converter_descriptor),api.pointer(api.clap_plugin_state_converter_factory),api.uint32).readWith(addr + 4, dataView),
			create: api.method(api.pointer(api.clap_plugin_state_converter),api.pointer(api.clap_plugin_state_converter_factory),api.pointer(api.int8)).readWith(addr + 8, dataView)
		}),
		writeWith(addr, value, dataView) {
			count: api.method(api.uint32,api.pointer(api.clap_plugin_state_converter_factory)).writeWith(addr, dataView)
			get_descriptor: api.method(api.pointer(api.clap_plugin_state_converter_descriptor),api.pointer(api.clap_plugin_state_converter_factory),api.uint32).writeWith(addr + 4, dataView)
			create: api.method(api.pointer(api.clap_plugin_state_converter),api.pointer(api.clap_plugin_state_converter_factory),api.pointer(api.int8)).writeWith(addr + 8, dataView)
		},
		size: 12,
		align: 1
	},
	clap_plugin_extensible_audio_ports: {
		readWith:(addr, dataView) => ({
			add_port: api.method(api.bool,api.pointer(api.clap_plugin),api.bool,api.uint32,api.pointer(api.int8),api.pointer(null)).readWith(addr, dataView),
			remove_port: api.method(api.bool,api.pointer(api.clap_plugin),api.bool,api.uint32).readWith(addr + 4, dataView)
		}),
		writeWith(addr, value, dataView) {
			add_port: api.method(api.bool,api.pointer(api.clap_plugin),api.bool,api.uint32,api.pointer(api.int8),api.pointer(null)).writeWith(addr, dataView)
			remove_port: api.method(api.bool,api.pointer(api.clap_plugin),api.bool,api.uint32).writeWith(addr + 4, dataView)
		},
		size: 8,
		align: 1
	},
	clap_plugin_gain_adjustment_metering: {
		readWith:(addr, dataView) => ({
			get: api.method(api.double,api.pointer(api.clap_plugin)).readWith(addr, dataView)
		}),
		writeWith(addr, value, dataView) {
			get: api.method(api.double,api.pointer(api.clap_plugin)).writeWith(addr, dataView)
		},
		size: 4,
		align: 1
	},
	clap_mini_curve_display_curve_hints: {
		readWith:(addr, dataView) => ({
			x_min: api.double.readWith(addr, dataView),
			x_max: api.double.readWith(addr + 8, dataView),
			y_min: api.double.readWith(addr + 16, dataView),
			y_max: api.double.readWith(addr + 24, dataView)
		}),
		writeWith(addr, value, dataView) {
			x_min: api.double.writeWith(addr, dataView)
			x_max: api.double.writeWith(addr + 8, dataView)
			y_min: api.double.writeWith(addr + 16, dataView)
			y_max: api.double.writeWith(addr + 24, dataView)
		},
		size: 32,
		align: 1
	},
	clap_mini_curve_display_curve_data: {
		readWith:(addr, dataView) => ({
			curve_kind: api.int32.readWith(addr, dataView),
			values: api.pointer(api.uint16).readWith(addr + 4, dataView),
			values_count: api.uint32.readWith(addr + 8, dataView)
		}),
		writeWith(addr, value, dataView) {
			curve_kind: api.int32.writeWith(addr, dataView)
			values: api.pointer(api.uint16).writeWith(addr + 4, dataView)
			values_count: api.uint32.writeWith(addr + 8, dataView)
		},
		size: 12,
		align: 1
	},
	clap_plugin_mini_curve_display: {
		readWith:(addr, dataView) => ({
			get_curve_count: api.method(api.uint32,api.pointer(api.clap_plugin)).readWith(addr, dataView),
			render: api.method(api.uint32,api.pointer(api.clap_plugin),api.pointer(api.clap_mini_curve_display_curve_data),api.uint32).readWith(addr + 4, dataView),
			set_observed: api.method(null,api.pointer(api.clap_plugin),api.bool).readWith(addr + 8, dataView),
			get_axis_name: api.method(api.bool,api.pointer(api.clap_plugin),api.uint32,api.pointer(api.int8),api.pointer(api.int8),api.uint32).readWith(addr + 12, dataView)
		}),
		writeWith(addr, value, dataView) {
			get_curve_count: api.method(api.uint32,api.pointer(api.clap_plugin)).writeWith(addr, dataView)
			render: api.method(api.uint32,api.pointer(api.clap_plugin),api.pointer(api.clap_mini_curve_display_curve_data),api.uint32).writeWith(addr + 4, dataView)
			set_observed: api.method(null,api.pointer(api.clap_plugin),api.bool).writeWith(addr + 8, dataView)
			get_axis_name: api.method(api.bool,api.pointer(api.clap_plugin),api.uint32,api.pointer(api.int8),api.pointer(api.int8),api.uint32).writeWith(addr + 12, dataView)
		},
		size: 16,
		align: 1
	},
	clap_host_mini_curve_display: {
		readWith:(addr, dataView) => ({
			get_hints: api.method(api.bool,api.pointer(api.clap_host),api.uint32,api.pointer(api.clap_mini_curve_display_curve_hints)).readWith(addr, dataView),
			set_dynamic: api.method(null,api.pointer(api.clap_host),api.bool).readWith(addr + 4, dataView),
			changed: api.method(null,api.pointer(api.clap_host),api.uint32).readWith(addr + 8, dataView)
		}),
		writeWith(addr, value, dataView) {
			get_hints: api.method(api.bool,api.pointer(api.clap_host),api.uint32,api.pointer(api.clap_mini_curve_display_curve_hints)).writeWith(addr, dataView)
			set_dynamic: api.method(null,api.pointer(api.clap_host),api.bool).writeWith(addr + 4, dataView)
			changed: api.method(null,api.pointer(api.clap_host),api.uint32).writeWith(addr + 8, dataView)
		},
		size: 12,
		align: 1
	},
	clap_project_location_element: {
		readWith:(addr, dataView) => ({
			flags: api.uint64.readWith(addr, dataView),
			kind: api.uint32.readWith(addr + 8, dataView),
			track_kind: api.uint32.readWith(addr + 12, dataView),
			index: api.uint32.readWith(addr + 16, dataView),
			id: api.array(api.int8, 1024).readWith(addr + 20, dataView),
			name: api.array(api.int8, 256).readWith(addr + 1044, dataView),
			color: api.clap_color.readWith(addr + 1300, dataView)
		}),
		writeWith(addr, value, dataView) {
			flags: api.uint64.writeWith(addr, dataView)
			kind: api.uint32.writeWith(addr + 8, dataView)
			track_kind: api.uint32.writeWith(addr + 12, dataView)
			index: api.uint32.writeWith(addr + 16, dataView)
			id: api.array(api.int8, 1024).writeWith(addr + 20, dataView)
			name: api.array(api.int8, 256).writeWith(addr + 1044, dataView)
			color: api.clap_color.writeWith(addr + 1300, dataView)
		},
		size: 1304,
		align: 1
	},
	clap_plugin_project_location: {
		readWith:(addr, dataView) => ({
			set: api.method(null,api.pointer(api.clap_plugin),api.pointer(api.clap_project_location_element),api.uint32).readWith(addr, dataView)
		}),
		writeWith(addr, value, dataView) {
			set: api.method(null,api.pointer(api.clap_plugin),api.pointer(api.clap_project_location_element),api.uint32).writeWith(addr, dataView)
		},
		size: 4,
		align: 1
	},
	clap_plugin_resource_directory: {
		readWith:(addr, dataView) => ({
			set_directory: api.method(null,api.pointer(api.clap_plugin),api.pointer(api.int8),api.bool).readWith(addr, dataView),
			collect: api.method(null,api.pointer(api.clap_plugin),api.bool).readWith(addr + 4, dataView),
			get_files_count: api.method(api.uint32,api.pointer(api.clap_plugin)).readWith(addr + 8, dataView),
			get_file_path: api.method(api.int32,api.pointer(api.clap_plugin),api.uint32,api.pointer(api.int8),api.uint32).readWith(addr + 12, dataView)
		}),
		writeWith(addr, value, dataView) {
			set_directory: api.method(null,api.pointer(api.clap_plugin),api.pointer(api.int8),api.bool).writeWith(addr, dataView)
			collect: api.method(null,api.pointer(api.clap_plugin),api.bool).writeWith(addr + 4, dataView)
			get_files_count: api.method(api.uint32,api.pointer(api.clap_plugin)).writeWith(addr + 8, dataView)
			get_file_path: api.method(api.int32,api.pointer(api.clap_plugin),api.uint32,api.pointer(api.int8),api.uint32).writeWith(addr + 12, dataView)
		},
		size: 16,
		align: 1
	},
	clap_host_resource_directory: {
		readWith:(addr, dataView) => ({
			request_directory: api.method(api.bool,api.pointer(api.clap_host),api.bool).readWith(addr, dataView),
			release_directory: api.method(null,api.pointer(api.clap_host),api.bool).readWith(addr + 4, dataView)
		}),
		writeWith(addr, value, dataView) {
			request_directory: api.method(api.bool,api.pointer(api.clap_host),api.bool).writeWith(addr, dataView)
			release_directory: api.method(null,api.pointer(api.clap_host),api.bool).writeWith(addr + 4, dataView)
		},
		size: 8,
		align: 1
	},
	clap_host_scratch_memory: {
		readWith:(addr, dataView) => ({
			reserve: api.method(api.bool,api.pointer(api.clap_host),api.uint32,api.uint32).readWith(addr, dataView),
			access: api.method(api.pointer(null),api.pointer(api.clap_host)).readWith(addr + 4, dataView)
		}),
		writeWith(addr, value, dataView) {
			reserve: api.method(api.bool,api.pointer(api.clap_host),api.uint32,api.uint32).writeWith(addr, dataView)
			access: api.method(api.pointer(null),api.pointer(api.clap_host)).writeWith(addr + 4, dataView)
		},
		size: 8,
		align: 1
	},
	clap_host_transport_control: {
		readWith:(addr, dataView) => ({
			request_start: api.method(null,api.pointer(api.clap_host)).readWith(addr, dataView),
			request_stop: api.method(null,api.pointer(api.clap_host)).readWith(addr + 4, dataView),
			request_continue: api.method(null,api.pointer(api.clap_host)).readWith(addr + 8, dataView),
			request_pause: api.method(null,api.pointer(api.clap_host)).readWith(addr + 12, dataView),
			request_toggle_play: api.method(null,api.pointer(api.clap_host)).readWith(addr + 16, dataView),
			request_jump: api.method(null,api.pointer(api.clap_host),api.int64).readWith(addr + 20, dataView),
			request_loop_region: api.method(null,api.pointer(api.clap_host),api.int64,api.int64).readWith(addr + 24, dataView),
			request_toggle_loop: api.method(null,api.pointer(api.clap_host)).readWith(addr + 28, dataView),
			request_enable_loop: api.method(null,api.pointer(api.clap_host),api.bool).readWith(addr + 32, dataView),
			request_record: api.method(null,api.pointer(api.clap_host),api.bool).readWith(addr + 36, dataView),
			request_toggle_record: api.method(null,api.pointer(api.clap_host)).readWith(addr + 40, dataView)
		}),
		writeWith(addr, value, dataView) {
			request_start: api.method(null,api.pointer(api.clap_host)).writeWith(addr, dataView)
			request_stop: api.method(null,api.pointer(api.clap_host)).writeWith(addr + 4, dataView)
			request_continue: api.method(null,api.pointer(api.clap_host)).writeWith(addr + 8, dataView)
			request_pause: api.method(null,api.pointer(api.clap_host)).writeWith(addr + 12, dataView)
			request_toggle_play: api.method(null,api.pointer(api.clap_host)).writeWith(addr + 16, dataView)
			request_jump: api.method(null,api.pointer(api.clap_host),api.int64).writeWith(addr + 20, dataView)
			request_loop_region: api.method(null,api.pointer(api.clap_host),api.int64,api.int64).writeWith(addr + 24, dataView)
			request_toggle_loop: api.method(null,api.pointer(api.clap_host)).writeWith(addr + 28, dataView)
			request_enable_loop: api.method(null,api.pointer(api.clap_host),api.bool).writeWith(addr + 32, dataView)
			request_record: api.method(null,api.pointer(api.clap_host),api.bool).writeWith(addr + 36, dataView)
			request_toggle_record: api.method(null,api.pointer(api.clap_host)).writeWith(addr + 40, dataView)
		},
		size: 44,
		align: 1
	},
	clap_event_trigger: {
		readWith:(addr, dataView) => ({
			header: api.clap_event_header.readWith(addr, dataView),
			trigger_id: api.uint32.readWith(addr + 16, dataView),
			cookie: api.pointer(null).readWith(addr + 20, dataView),
			note_id: api.int32.readWith(addr + 24, dataView),
			port_index: api.int16.readWith(addr + 28, dataView),
			channel: api.int16.readWith(addr + 30, dataView),
			key: api.int16.readWith(addr + 32, dataView)
		}),
		writeWith(addr, value, dataView) {
			header: api.clap_event_header.writeWith(addr, dataView)
			trigger_id: api.uint32.writeWith(addr + 16, dataView)
			cookie: api.pointer(null).writeWith(addr + 20, dataView)
			note_id: api.int32.writeWith(addr + 24, dataView)
			port_index: api.int16.writeWith(addr + 28, dataView)
			channel: api.int16.writeWith(addr + 30, dataView)
			key: api.int16.writeWith(addr + 32, dataView)
		},
		size: 34,
		align: 1
	},
	clap_trigger_info: {
		readWith:(addr, dataView) => ({
			id: api.uint32.readWith(addr, dataView),
			flags: api.uint32.readWith(addr + 4, dataView),
			cookie: api.pointer(null).readWith(addr + 8, dataView),
			name: api.array(api.int8, 256).readWith(addr + 12, dataView),
			module: api.array(api.int8, 1024).readWith(addr + 268, dataView)
		}),
		writeWith(addr, value, dataView) {
			id: api.uint32.writeWith(addr, dataView)
			flags: api.uint32.writeWith(addr + 4, dataView)
			cookie: api.pointer(null).writeWith(addr + 8, dataView)
			name: api.array(api.int8, 256).writeWith(addr + 12, dataView)
			module: api.array(api.int8, 1024).writeWith(addr + 268, dataView)
		},
		size: 1292,
		align: 1
	},
	clap_plugin_triggers: {
		readWith:(addr, dataView) => ({
			count: api.method(api.uint32,api.pointer(api.clap_plugin)).readWith(addr, dataView),
			get_info: api.method(api.bool,api.pointer(api.clap_plugin),api.uint32,api.pointer(api.clap_trigger_info)).readWith(addr + 4, dataView)
		}),
		writeWith(addr, value, dataView) {
			count: api.method(api.uint32,api.pointer(api.clap_plugin)).writeWith(addr, dataView)
			get_info: api.method(api.bool,api.pointer(api.clap_plugin),api.uint32,api.pointer(api.clap_trigger_info)).writeWith(addr + 4, dataView)
		},
		size: 8,
		align: 1
	},
	clap_host_triggers: {
		readWith:(addr, dataView) => ({
			rescan: api.method(null,api.pointer(api.clap_host),api.uint32).readWith(addr, dataView),
			clear: api.method(null,api.pointer(api.clap_host),api.uint32,api.uint32).readWith(addr + 4, dataView)
		}),
		writeWith(addr, value, dataView) {
			rescan: api.method(null,api.pointer(api.clap_host),api.uint32).writeWith(addr, dataView)
			clear: api.method(null,api.pointer(api.clap_host),api.uint32,api.uint32).writeWith(addr + 4, dataView)
		},
		size: 8,
		align: 1
	},
	clap_event_tuning: {
		readWith:(addr, dataView) => ({
			header: api.clap_event_header.readWith(addr, dataView),
			port_index: api.int16.readWith(addr + 16, dataView),
			channel: api.int16.readWith(addr + 18, dataView),
			tunning_id: api.uint32.readWith(addr + 20, dataView)
		}),
		writeWith(addr, value, dataView) {
			header: api.clap_event_header.writeWith(addr, dataView)
			port_index: api.int16.writeWith(addr + 16, dataView)
			channel: api.int16.writeWith(addr + 18, dataView)
			tunning_id: api.uint32.writeWith(addr + 20, dataView)
		},
		size: 24,
		align: 1
	},
	clap_tuning_info: {
		readWith:(addr, dataView) => ({
			tuning_id: api.uint32.readWith(addr, dataView),
			name: api.array(api.int8, 256).readWith(addr + 4, dataView),
			is_dynamic: api.bool.readWith(addr + 260, dataView)
		}),
		writeWith(addr, value, dataView) {
			tuning_id: api.uint32.writeWith(addr, dataView)
			name: api.array(api.int8, 256).writeWith(addr + 4, dataView)
			is_dynamic: api.bool.writeWith(addr + 260, dataView)
		},
		size: 261,
		align: 1
	},
	clap_plugin_tuning: {
		readWith:(addr, dataView) => ({
			changed: api.method(null,api.pointer(api.clap_plugin)).readWith(addr, dataView)
		}),
		writeWith(addr, value, dataView) {
			changed: api.method(null,api.pointer(api.clap_plugin)).writeWith(addr, dataView)
		},
		size: 4,
		align: 1
	},
	clap_host_tuning: {
		readWith:(addr, dataView) => ({
			get_relative: api.method(api.double,api.pointer(api.clap_host),api.uint32,api.int32,api.int32,api.uint32).readWith(addr, dataView),
			should_play: api.method(api.bool,api.pointer(api.clap_host),api.uint32,api.int32,api.int32).readWith(addr + 4, dataView),
			get_tuning_count: api.method(api.uint32,api.pointer(api.clap_host)).readWith(addr + 8, dataView),
			get_info: api.method(api.bool,api.pointer(api.clap_host),api.uint32,api.pointer(api.clap_tuning_info)).readWith(addr + 12, dataView)
		}),
		writeWith(addr, value, dataView) {
			get_relative: api.method(api.double,api.pointer(api.clap_host),api.uint32,api.int32,api.int32,api.uint32).writeWith(addr, dataView)
			should_play: api.method(api.bool,api.pointer(api.clap_host),api.uint32,api.int32,api.int32).writeWith(addr + 4, dataView)
			get_tuning_count: api.method(api.uint32,api.pointer(api.clap_host)).writeWith(addr + 8, dataView)
			get_info: api.method(api.bool,api.pointer(api.clap_host),api.uint32,api.pointer(api.clap_tuning_info)).writeWith(addr + 12, dataView)
		},
		size: 16,
		align: 1
	},
	clap_undo_delta_properties: {
		readWith:(addr, dataView) => ({
			has_delta: api.bool.readWith(addr, dataView),
			are_deltas_persistent: api.bool.readWith(addr + 1, dataView),
			format_version: api.uint32.readWith(addr + 4, dataView)
		}),
		writeWith(addr, value, dataView) {
			has_delta: api.bool.writeWith(addr, dataView)
			are_deltas_persistent: api.bool.writeWith(addr + 1, dataView)
			format_version: api.uint32.writeWith(addr + 4, dataView)
		},
		size: 8,
		align: 1
	},
	clap_plugin_undo_delta: {
		readWith:(addr, dataView) => ({
			get_delta_properties: api.method(null,api.pointer(api.clap_plugin),api.pointer(api.clap_undo_delta_properties)).readWith(addr, dataView),
			can_use_delta_format_version: api.method(api.bool,api.pointer(api.clap_plugin),api.uint32).readWith(addr + 4, dataView),
			undo: api.method(api.bool,api.pointer(api.clap_plugin),api.uint32,api.pointer(null),api.uint32).readWith(addr + 8, dataView),
			redo: api.method(api.bool,api.pointer(api.clap_plugin),api.uint32,api.pointer(null),api.uint32).readWith(addr + 12, dataView)
		}),
		writeWith(addr, value, dataView) {
			get_delta_properties: api.method(null,api.pointer(api.clap_plugin),api.pointer(api.clap_undo_delta_properties)).writeWith(addr, dataView)
			can_use_delta_format_version: api.method(api.bool,api.pointer(api.clap_plugin),api.uint32).writeWith(addr + 4, dataView)
			undo: api.method(api.bool,api.pointer(api.clap_plugin),api.uint32,api.pointer(null),api.uint32).writeWith(addr + 8, dataView)
			redo: api.method(api.bool,api.pointer(api.clap_plugin),api.uint32,api.pointer(null),api.uint32).writeWith(addr + 12, dataView)
		},
		size: 16,
		align: 1
	},
	clap_plugin_undo_context: {
		readWith:(addr, dataView) => ({
			set_can_undo: api.method(null,api.pointer(api.clap_plugin),api.bool).readWith(addr, dataView),
			set_can_redo: api.method(null,api.pointer(api.clap_plugin),api.bool).readWith(addr + 4, dataView),
			set_undo_name: api.method(null,api.pointer(api.clap_plugin),api.pointer(api.int8)).readWith(addr + 8, dataView),
			set_redo_name: api.method(null,api.pointer(api.clap_plugin),api.pointer(api.int8)).readWith(addr + 12, dataView)
		}),
		writeWith(addr, value, dataView) {
			set_can_undo: api.method(null,api.pointer(api.clap_plugin),api.bool).writeWith(addr, dataView)
			set_can_redo: api.method(null,api.pointer(api.clap_plugin),api.bool).writeWith(addr + 4, dataView)
			set_undo_name: api.method(null,api.pointer(api.clap_plugin),api.pointer(api.int8)).writeWith(addr + 8, dataView)
			set_redo_name: api.method(null,api.pointer(api.clap_plugin),api.pointer(api.int8)).writeWith(addr + 12, dataView)
		},
		size: 16,
		align: 1
	},
	clap_host_undo: {
		readWith:(addr, dataView) => ({
			begin_change: api.method(null,api.pointer(api.clap_host)).readWith(addr, dataView),
			cancel_change: api.method(null,api.pointer(api.clap_host)).readWith(addr + 4, dataView),
			change_made: api.method(null,api.pointer(api.clap_host),api.pointer(api.int8),api.pointer(null),api.uint32,api.bool).readWith(addr + 8, dataView),
			request_undo: api.method(null,api.pointer(api.clap_host)).readWith(addr + 12, dataView),
			request_redo: api.method(null,api.pointer(api.clap_host)).readWith(addr + 16, dataView),
			set_wants_context_updates: api.method(null,api.pointer(api.clap_host),api.bool).readWith(addr + 20, dataView)
		}),
		writeWith(addr, value, dataView) {
			begin_change: api.method(null,api.pointer(api.clap_host)).writeWith(addr, dataView)
			cancel_change: api.method(null,api.pointer(api.clap_host)).writeWith(addr + 4, dataView)
			change_made: api.method(null,api.pointer(api.clap_host),api.pointer(api.int8),api.pointer(null),api.uint32,api.bool).writeWith(addr + 8, dataView)
			request_undo: api.method(null,api.pointer(api.clap_host)).writeWith(addr + 12, dataView)
			request_redo: api.method(null,api.pointer(api.clap_host)).writeWith(addr + 16, dataView)
			set_wants_context_updates: api.method(null,api.pointer(api.clap_host),api.bool).writeWith(addr + 20, dataView)
		},
		size: 24,
		align: 1
	},
	clap_plugin_webview: {
		readWith:(addr, dataView) => ({
			get_uri: api.method(api.int32,api.pointer(api.clap_plugin),api.pointer(api.int8),api.uint32).readWith(addr, dataView),
			get_resource: api.method(api.bool,api.pointer(api.clap_plugin),api.pointer(api.int8),api.pointer(api.int8),api.uint32,api.pointer(api.clap_ostream)).readWith(addr + 4, dataView),
			receive: api.method(api.bool,api.pointer(api.clap_plugin),api.pointer(null),api.uint32).readWith(addr + 8, dataView)
		}),
		writeWith(addr, value, dataView) {
			get_uri: api.method(api.int32,api.pointer(api.clap_plugin),api.pointer(api.int8),api.uint32).writeWith(addr, dataView)
			get_resource: api.method(api.bool,api.pointer(api.clap_plugin),api.pointer(api.int8),api.pointer(api.int8),api.uint32,api.pointer(api.clap_ostream)).writeWith(addr + 4, dataView)
			receive: api.method(api.bool,api.pointer(api.clap_plugin),api.pointer(null),api.uint32).writeWith(addr + 8, dataView)
		},
		size: 12,
		align: 1
	},
	clap_host_webview: {
		readWith:(addr, dataView) => ({
			send: api.method(api.bool,api.pointer(api.clap_host),api.pointer(null),api.uint32).readWith(addr, dataView)
		}),
		writeWith(addr, value, dataView) {
			send: api.method(api.bool,api.pointer(api.clap_host),api.pointer(null),api.uint32).writeWith(addr, dataView)
		},
		size: 4,
		align: 1
	},
};
for (let name in api) {
	if (typeof api[name].readWith === 'function') {
		api[name].read = read;
		api[name].write = write;
	}
}
return api;};export default WCLAP32;