/** Returns a low-level interface to a CLAP WebAssembly instance.

A section of memory is allocated up-front for host use.  If we overflow this, we fail and the instance is not recoverable.

The following properties are provided:
	* `.clap_entry`: the entry point
	* `.save(type, value)`: permanently writes a value to the host memory, returning a pointer to it
	
Everything else is a type, provided as a function: `(pointer, ?bind) => ` dereferenced/parsed value.  All pointers are untyped, so you need to dereference them using the correct type.  The `bind` argument is only used for `struct`s, where any functions are bound as methods (passing the `struct` pointer as the first argument).

Numeric types (and pointers) are mapped to JS numbers, `const char *` to JS strings, structs to JS objects, functions to callable JS functions.

For dynamically-sized arrays, CLAP points to an array of pointers, terminated by a null pointer.  We create these types using `pointerArray()`, but really it's only ever used with pointers or strings (which is a pointer in C, but we interpret differently).

Internally, each type has methods:
	* `m_read(address, bind)`: same as the main type function
	* `m_writeArg(value)`: write any supporting data to scratch memory, returns a value which a WebAssembly function can accept
	* `m_write(value)`: write the value to scratch memory (after any supporting data)
*/
export default function clapInterface(instance, hostMemorySize=1024*1024, logFn=null) {
	let fullTypeKey = Symbol();
	let memory = instance.exports.memory;
	let functionTable = null;
	if (!functionTable) {
		for (let key in instance.exports) {
			if (instance.exports[key] instanceof WebAssembly.Table) {
				if (functionTable) throw Error("multiple function tables");
				functionTable = instance.exports[key];
			}
		}
	}
	if (!functionTable) throw Error("no function table found");
	
	function importFunctions(wasmFunctions) {
		let keys = Object.keys(wasmFunctions);
		let fnOffset = functionTable.grow(keys.length);
		let fnPointers = Object.create(null);
		keys.forEach((key, i) => {
			functionTable.set(fnOffset + i, wasmFunctions[key]);
			fnPointers[key] = fnOffset + i
		});
		return fnPointers;
	}

	// Reserve some memory for host use
	let hostMemory = instance.exports.malloc(hostMemorySize);
	let scratchMemory = hostMemory; // the end of any saved values
	let scratchPointer, view;
	let funcCallDepth = 0;
	function resetView() {
		view = new DataView(memory.buffer);
	}
	function resetScratch() {
		scratchPointer = scratchMemory;
	}
	function overflowCheck() {
		if (scratchPointer > hostMemory + hostMemorySize) {
			throw Error(`Host memory exceeded (${scratchPointer - hostMemory}/${hostMemorySize})`);
		}
	}
	resetScratch();
	resetView();
	// Permanently save a value to memory, returning the pointer
	function writePersistent(type, value) {
		if (funcCallDepth) throw Error("writePersistent() from within plugin call");
		resetScratch();
		while (scratchPointer%type.m_alignment) ++scratchPointer;

		type.m_write(value); // writes to the start of the scratch area
		overflowCheck();
		scratchMemory = scratchPointer; // move the scratch boundary
		return scratchPointer - type.m_bytes;
	}
	// Temporarily write a value - it will still be valid after a *single* native call
	function writeTemporary(type, value) {
		while (scratchPointer%type.m_alignment) ++scratchPointer;

		type.m_write(value); // writes to the start of the scratch area
		overflowCheck();
		return scratchPointer - type.m_bytes;
	}
	function reserveTemporary(bytes, alignment) {
		alignment = alignment || 1;
		while (scratchPointer%alignment) ++scratchPointer;
		let pointer = scratchPointer;
		scratchPointer += bytes;
		return pointer;
	}
	
	// Fixed types
	function numberType(bytes, getter, setter, TypedArray) {
		return {
			m_canBeArg: true,
			m_TypedArray: TypedArray,
			m_alignment: bytes,
			m_bytes: bytes,
			m_read(address) {
				if (address%bytes) throw Error("alignment");
				return view[getter](address, true);
			},
			m_write(value) {
				if (scratchPointer%bytes) throw Error("alignment");
				view[setter](scratchPointer, value, true);
				scratchPointer += bytes;
			},
			m_writeArg(value) {
				return value;
			}
		}
	};
	const u8 = numberType(1, 'getUint8', 'setUint8', Uint8Array);
	const i8 = numberType(1, 'getInt8', 'setInt8', Int8Array);
	const u16 = numberType(2, 'getUint16', 'setUint16', Uint16Array);
	const i16 = numberType(2, 'getInt16', 'setInt16', Int16Array);
	const u32 = numberType(4, 'getUint32', 'setUint32', Uint32Array);
	const i32 = numberType(4, 'getInt32', 'setInt32', Int32Array);
	const u64 = numberType(8, 'getBigUint64', 'setBigUint64', BigUint64Array);
	const i64 = numberType(8, 'getBigInt64', 'setBigInt64', BigInt64Array);
	const f32 = numberType(4, 'getFloat32', 'setFloat32', Float32Array);
	const f64 = numberType(8, 'getFloat64', 'setFloat64', Float64Array);
	// wasm32
	const size = u32;
	const pointer = {
		m_canBeArg: true,
		m_TypedArray: Uint32Array,
		m_alignment: 4,
		m_bytes: 4,
		m_read(address) {
			if (address%4) throw Error("alignment");
			return view.getUint32(address, true);
		},
		m_write(value) {
			if (scratchPointer%4) throw Error("alignment");
			if (ArrayBuffer.isView(value)) value = value.byteOffset;
			view.setUint32(scratchPointer, value, true);
			scratchPointer += 4;
		},
		m_writeArg(value) {
			if (ArrayBuffer.isView(value)) value = value.byteOffset;
			return value;
		}
	};
	
	function fixedChars(bytes, isString) {
		return {
			m_alignment: 1,
			m_bytes: bytes,
			m_read(address) {
				if (isString) {
					return string.m_readArg(address);
				}
				let array = new Uint8Array(bytes);
				for (let i = 0; i < bytes; ++i) {
					array[i] = view.getUint8(address + i);
				}
				array.toString = () => {
					let result = "";
					for (let i = 0; i < bytes; ++i) {
						let c = array[i];
						if (!c) break;
						result += String.fromCharCode(c);
					}
					return result;
				};
				return array;
			},
			m_write(value) {
				if (typeof value === 'string') {
					for (let i = 0; i < bytes && i < value.length; ++i) {
						view.setUint8(scratchPointer + i, value.charCodeAt(i));
					}
					// Fill the rest with 0
					for (let i = value.length; i < bytes; ++i) view.setUint8(scratchPointer + i, 0);
				} else if (value && typeof value === 'object') {
					for (let i = 0; i < bytes; ++i) {
						view.setUint8(scratchPointer + i, value[i]);
					}
				} else {
					value = value || 0;
					for (let i = 0; i < bytes; ++i) {
						view.setUint8(scratchPointer + i);
					}
				}
				scratchPointer += bytes;
			},
			m_writeArg(value) {
				return value;
			}
		};
	}
	
	const string = {
		m_canBeArg: true,
		m_alignment: pointer.m_alignment,
		m_bytes: pointer.m_bytes,
		m_readArg(cPointer) {
			let result = "";
			while (1) {
				let code = view.getUint8(cPointer);
				if (code == 0) break;
				result += String.fromCharCode(code);
				++cPointer;
			}
			return result;
		},
		m_read(address) {
			return string.m_readArg(pointer.m_read(address));
		},
		m_write(value) {
			value = string.m_writeArg(value);
			pointer.m_write(value);
		},
		m_writeArg(value) {
			if (typeof value !== 'string') return value;

			let startPtr = scratchPointer;
			for (let i = 0; i < value.length; ++i) {
				view.setUint8(scratchPointer, value.charCodeAt(i)); // TODO: proper UTF-8 encoding
				++scratchPointer;
			}
			view.setUint8(scratchPointer, 0); // null terminator
			++scratchPointer;
			return startPtr;
		}
	};
	// An array of pointers (or things the same size as pointers)
	function pointerArray(itemType) {
		itemType = itemType || pointer;
		let type = {
			m_alignment: pointer.m_alignment,
			m_bytes: pointer.m_bytes,
			m_readArg(itemPointer, bind) {
				let result = [];
				while (1) {
					let itemAsPointer = pointer.m_read(itemPointer);
					if (itemAsPointer == 0) break; // null pointer
					result.push(itemType.m_read(itemPointer, bind)); // we don't necessarily parse it as a pointer though
					itemPointer += pointer.m_bytes;
				}
				return result;
			},
			m_read(address, bind) {
				return type.m_readArg(pointer.m_read(address), bind);
			},
			m_write(obj) {
				throw Error("Can arrays be arguments?");
			},
			m_writeArg(obj) {
				throw Error("Can arrays be arguments?");
			}
		};
		return type;
	};
	function struct(...members) {
		let alignment = 1;
		let bytes = 0;
		members = members.map(entry => {
			for (let key in entry) {
				let type = privateType(entry[key]);
				// pad to alignment
				while (bytes%type.m_alignment) ++bytes;
				let offset = bytes;
				bytes += type.m_bytes;
				alignment = Math.max(alignment, type.m_alignment);
				return {
					m_key: key,
					m_offset: offset,
					m_type: type
				};
			}
		});
		let type = {
			m_alignment: alignment,
			m_bytes: bytes,
			m_readArg() {
				throw Error("can't readArg() a struct - it would have to be an object, but we don't get those from WASM");
			},
			m_read(address, bind) {
				let bindValue = (typeof bind === 'boolean') ? address : bind;
				let obj = {};
				members.forEach(entry => {
					let type = entry.m_type;
					let value = type.m_read(address + entry.m_offset);
					if (bind && typeof value === 'function') {
						value = value.bind(null, bindValue);
					}
					obj[entry.m_key] = value;
				});
				return obj;
			},
			m_write(obj) {
				// write any supporting data
				obj = type.m_writeArg(obj);
				// write the actual struct
				while (scratchPointer%alignment) ++scratchPointer;
				let address = scratchPointer;
				members.forEach((entry, i) => {
					scratchPointer = address + entry.m_offset;
					let type = entry.m_type, key = entry.m_key;
					type.m_write(obj[key]);
				});
			},
			m_writeArg(obj) {
				let newObj = {};
				members.forEach(entry => {
					let type = entry.m_type, key = entry.m_key;
					newObj[key] = type.m_writeArg(obj[key]);
				});
				return newObj;
			},
		};
		return publicType(type);
	}
	// A function signature (arguments only), used like: sig(fnAddr, 5, ptr, "foo")
	// The value is a callable function, which uses scratch memory for arguments if needed
	function func(...argTypes) {
		argTypes = argTypes.map(privateType);
		argTypes.forEach(type => {
			if (!type.m_canBeArg) throw Error("func() should only take numbers/strings/pointers");
		});
		let type = {
			m_bytes: pointer.m_bytes,
			m_alignment: pointer.m_alignment,
			m_readArg(fnPointer) {
				let wasmFn = functionTable.get(fnPointer);
				if (!wasmFn) return null; // functions can be null
				return (...args) => {
					++funcCallDepth;
					args = args.map((value, i) => {
						return argTypes[i].m_writeArg(value);
					});
					overflowCheck();
					let result = wasmFn(...args);
					resetView(); // any WASM call might've grown the memory
					if (--funcCallDepth == 0) resetScratch(); // we don't erase the data, but we reset it before the next function
					return result;
				};
			},
			m_read(address) {
				return type.m_readArg(pointer.m_read(address));
			},
			m_write(value) {
				if (typeof value === 'undefined') throw Error("missing function value - use null if deliberate");
				// If we're writing (e.g. to the host struct), it must be a function pointer
				return pointer.m_write(value);
			},
			m_writeArg(value) {
				return value;
			}
		};
		return publicType(type);
	}
	
	// Initial types
	let clap_version = struct(
		{major: u32},
		{minor: u32},
		{patch: u32}
	);
	let clap_plugin_entry = struct(
		{clap_version: clap_version},
		{init: func(string)},
		{deinit: func()},
		{get_factory: func(string)}
	);

	// We expose a dereference method, but with the full type attached
	let api = {
		sizeof(type) {
			return privateType(type).m_bytes;
		},
		// returns the DataView to the memory, invalidated after any native method call
		dataView() {
			return view;
		},
		// returns the ArrayBuffer, invalidated after any native method call
		asTyped(TypedArray, start, length) {
			if (TypedArray[fullTypeKey]) { // actually one of our numerical types
				TypedArray = TypedArray[fullTypeKey].m_TypedArray;
			}
			let bpe = TypedArray.BYTES_PER_ELEMENT;
			if (!bpe) throw Error("not a TypedArray (or numeric type)");
			if (start%bpe) throw Error("start not aligned");
			return new TypedArray(memory.buffer, start, length);
		},

		log: logFn || console.log.bind(console),
		save(type, value) {
			return writePersistent(privateType(type), value);
		},
		// Writes a value to the scratch space, returning the pointer.  This can be used by the next native function call, and then remains valid until the next native function call OR call to temp()/tempBytes()
		temp(type, value) {
			return writeTemporary(privateType(type), value);
		},
		tempBytes: reserveTemporary,
		tempTyped(TypedArray, length) {
			if (TypedArray[fullTypeKey]) { // actually one of our numerical types
				TypedArray = TypedArray[fullTypeKey].m_TypedArray;
			}
			let bpe = TypedArray.BYTES_PER_ELEMENT;
			let ptr = reserveTemporary(length*bpe, bpe);
			return api.asTyped(TypedArray, ptr, length);
		},
		
		// Interprets a value (not a pointer!) as passed to an imported function
		fromArg(type, value) {
			return type[fullTypeKey].m_readArg(value);
		},
		// imports functions from another WASM module, returns their indices
		// Takes a map {name: [wasmFn], ...}, returns {name: fnIndex}
		importFunctions: importFunctions,

		// For defining new types
		makeStruct: struct,
		makeFunc: func,
	};

	function publicType(type) {
		if (type[fullTypeKey]) return type; // already the public version
		let read = type.m_read;
		read[fullTypeKey] = type;
		return read;
	}
	function privateType(type) {
		if (typeof type === 'string') {
			if (!(type in api)) throw Error("unknown type: " + type);
			type = api[type];
		}
		return type[fullTypeKey] || type;
	}
	function addType(name, type) {
		return api[name] = publicType(type);
	}
	function addTypes(obj, extra) {
		for (let key in obj) addType(key, obj[key]);
		if (extra) Object.assign(api, extra);
	}

	addTypes({
		// numeric types
		i8: i8,
		u8: u8,
		i16: i16,
		u16: u16,
		i32: i32,
		u32: u32,
		i64: i64,
		u64: u64,
		f32: f32,
		f64, f64,
		size: size,
		pointer: pointer,
		string: string,

		// We already defined these above
		clap_version: clap_version,
		clap_plugin_entry: clap_plugin_entry,
	});
	// fixedpoint.h
	let clap_beattime = i64;
	let clap_sectime = i64;
	addTypes({
		clap_beattime: clap_beattime,
		clap_sectime: clap_sectime
	}, {
		CLAP_BEATTIME_FACTOR: 2147483648,
		CLAP_SECTIME_FACTOR: 2147483648,
	});
	// id.h
	let clap_id = u32;
	addTypes({
		clap_id: clap_id
	}, {
		CLAP_INVALID_ID: 0xFFFFFFFF
	});
	// events.h
	let clap_event_header = struct(
		{size: u32},
		{time: u32},
		{space_id: u16},
		{type: u16},
		{flags: u32}
	);
	let clap_note_expression = i32;
	addTypes({
		clap_event_header: clap_event_header,
		clap_event_note: struct(
			{header: clap_event_header},
			{note_id: i32},
			{port_index: i16},
			{channel: i16},
			{key: i16},
			{velocity: f64}
		),
		clap_event_note_expression: struct(
			{header: clap_event_header},
			{expression_id: clap_note_expression},
			{note_id: i32},
			{port_index: i16},
			{channel: i16},
			{key: i16},
			{value: f64}
		),
		clap_event_param_value: struct(
			{header: clap_event_header},
			{param_id: clap_id},
			{cookie: pointer},
			{note_id: i32},
			{port_index: i16},
			{channel: i16},
			{key: i16},
			{value: f64}
		),
		clap_event_param_mod: struct(
			{header: clap_event_header},
			{param_id: clap_id},
			{cookie: pointer},
			{note_id: i32},
			{port_index: i16},
			{channel: i16},
			{key: i16},
			{value: f64}
		),
		clap_event_param_gesture: struct(
			{header: clap_event_header},
			{param_id: clap_id},
		),
		clap_event_transport: struct(
			{header: clap_event_header},
			{flags: u32},
			{song_pos_beats: clap_beattime},
			{song_pos_seconds: clap_sectime},
			{tempo: f64},
			{tempo_inc: f64},
			{loop_start_beats: clap_beattime},
			{loop_end_beats: clap_beattime},
			{loop_start_seconds: clap_sectime},
			{loop_end_seconds: clap_sectime},
			{bar_start: clap_beattime},
			{bar_number: i32},
			{tsig_num: u16},
			{tsig_denom: u16},
		),
		clap_event_midi: struct(
			{header: clap_event_header},
			{port_index: u16},
			{data: fixedChars(3)}
		),
		clap_event_midi_sysex: struct(
			{header: clap_event_header},
			{port_index: u16},
			{buffer: pointer},
			{size: u32}
		),
		clap_event_midi2: struct(
			{header: clap_event_header},
			{port_index: u16},
			{data: fixedChars(4)}
		),
		clap_input_events: struct(
			{ctx: pointer},
			{size: func(pointer)},
			{'get': func(pointer, u32)}
		),
		clap_output_events: struct(
			{ctx: pointer},
			{try_push: func(pointer, pointer)}
		)
	}, {
		CLAP_CORE_EVENT_SPACE_ID: 0,

		CLAP_EVENT_IS_LIVE: 1,
		CLAP_EVENT_DONT_RECORD: 1<<1,

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

		CLAP_TRANSPORT_HAS_TEMPO: 1<< 0,
		CLAP_TRANSPORT_HAS_BEATS_TIMELINE: 1<<1,
		CLAP_TRANSPORT_HAS_SECONDS_TIMELINE: 1<<2,
		CLAP_TRANSPORT_HAS_TIME_SIGNATURE: 1<<3,
		CLAP_TRANSPORT_IS_PLAYING: 1<<4,
		CLAP_TRANSPORT_IS_RECORDING: 1<<5,
		CLAP_TRANSPORT_IS_LOOP_ACTIVE: 1<<6,
		CLAP_TRANSPORT_IS_WITHIN_PRE_ROLL: 1<<7,
	});
	// audio-buffer.h
	addTypes({
		clap_audio_buffer: struct(
			{data32: pointer},
			{data64: pointer},
			{channel_count: u32},
			{latency: u32},
			{constant_mask: u64}
		)
	});
	// process.h
	addTypes({
		clap_process_status: i32,
		clap_process: struct(
			{steady_time: i64},
			{frames_count: u32},
			{transport: pointer},
			{audio_inputs: pointer},
			{audio_outputs: pointer},
			{audio_inputs_count: u32},
			{audio_outputs_count: u32},
			{in_events: pointer},
			{out_events: pointer}
		)
	}, {
		CLAP_PROCESS_ERROR: 0,
		CLAP_PROCESS_CONTINUE: 1,
		CLAP_PROCESS_CONTINUE_IF_NOT_QUIET: 2,
		CLAP_PROCESS_TAIL: 3,
		CLAP_PROCESS_SLEEP: 4,
	});
	// plugin-features.h just has string constants which I don't think we need
	// plugin.h
	addTypes({
		clap_plugin_descriptor: struct(
			{clap_version: clap_version},
			{id: string},
			{name: string},
			{vendor: string},
			{url: string},
			{manual_url: string},
			{support_url: string},
			{version: string},
			{description: string},
			{features: pointerArray(string)}
		),
		clap_plugin: struct(
			{desc: pointer},
			{plugin_data: pointer},
			{init: func(pointer)},
			{destroy: func(pointer)},
			{activate: func(pointer, f64, u32, u32)},
			{deactivate: func(pointer)},
			{start_processing: func(pointer)},
			{stop_processing: func(pointer)},
			{reset: func(pointer)},
			{process: func(pointer, pointer)},
			{get_extension: func(pointer, string)},
			{on_main_thread: func(pointer)}
		)
	});
	// host.h
	addTypes({
		clap_host: struct(
			{clap_version: clap_version},
			{host_data: pointer},
			{name: string},
			{vendor: string},
			{url: string},
			{version: string},
			{get_extension: func(pointer, string)},
			{request_restart: func(pointer)},
			{request_process: func(pointer)},
			{request_callback: func(pointer)},
		)
	})
	// universal-plugin-id.h
	addTypes({
		clap_universal_plugin_id: struct(
			{abi: string},
			{id: string}
		)
	});

	// factory/plugin-factory.h
	addTypes({
		clap_plugin_factory: struct(
			{get_plugin_count: func(pointer)},
			{get_plugin_descriptor: func(pointer, u32)},
			{create_plugin: func(pointer, pointer, string)}
		),
	}, {
		CLAP_PLUGIN_FACTORY_ID: "clap.plugin-factory"
	});

	// color.h
	addTypes({
		clap_color: struct(
			{alpha: u8},
			{red: u8},
			{green: u8},
			{blue: u8}
		),
	});

	// stream.h
	addTypes({
		clap_istream: struct(
			{ctd: pointer},
			{read: func(pointer, pointer, u64)}
		),
		clap_ostream: struct(
			{ctd: pointer},
			{write: func(pointer, pointer, u64)}
		),
	});

	// string-sizes.h
	api.CLAP_NAME_SIZE = 256;
	api.CLAP_PATH_SIZE = 1024;
	// For convenience
	addTypes({
		clap_name: fixedChars(api.CLAP_NAME_SIZE, true),
		clap_path: fixedChars(api.CLAP_PATH_SIZE, true)
	});

	// timestamp.h
	addTypes({
		clap_timestamp: u64,
	}, {
		CLAP_TIMESTAMP_UNKNOWN: 0
	});
	
	return api;
}
