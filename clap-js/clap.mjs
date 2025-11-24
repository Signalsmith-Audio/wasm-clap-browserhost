import WCLAP32 from "./wclap32.mjs"
import expandTarGz from "./targz.mjs"
import createWasi from "./wasi.mjs"

function	 fnv1aHex(string) {
	let fnv1a32 = 0x811c9dc5;
	for (let i = 0; i < string.length; ++i) {
		let byte = string.charCodeAt(i);
		fnv1a32 = ((fnv1a32^byte)*0x1000193)|0;
	}
	return [24, 16, 8, 0].map(s => ((fnv1a32>>s)&0xFF).toString(16).padStart(2, "0")).join("");
}

class ClapModuleRunning {
	#module;
	#instance;
	#memory;

	arena;
	api;
	clap_entry;
	constructor(module, instance, memory) {
		this.#module = module;
		this.#instance = instance;
		this.#memory = memory;
		
		let functionTable = null;
		for (let key in instance.exports) {
			let v = instance.exports[key];
			if (v instanceof WebAssembly.Table) {
				// Check the final entry, since 0 is often `null` to represent null-pointer
				if (v.length == 0 || typeof v.get(v.length - 1) != 'function') continue;
				if (functionTable) throw Error("multiple function tables");
				functionTable = v;
			}
		}
		if (!functionTable) throw Error("no function table found");
		if (!instance.exports.malloc) throw Error("WCLAP must export `malloc()` (or something like it)");
		if (!instance.exports.clap_entry) throw Error("WCLAP must export `clap_entry` pointer");
		let entryPtr = instance.exports.clap_entry.value;

		this.arena = new MemoryArena(memory, instance.exports.malloc);
		this.api = WCLAP32(memory, functionTable, this.arena);
		this.clap_entry = this.api.clap_plugin_entry.read(entryPtr);
	}

	bytes(length, align) {
		return this.arena.bytes(length, align);
	}
	byteArray(length, align) {
		return this.arena.byteArray(length, align);
	}
	bytesFor(type) {
		if (typeof type === 'string') type = type.api[type];
		return this.arena.bytes(type.size, type.align);
	}
	
	writeString(str) {
		return this.arena.writeString(str);
	}
	write(type, value) {
		if (typeof type === 'string') type = type.api[type];
		let ptr = this.bytesFor(type);
		type.write(ptr, value);
		return ptr;
	}
	readString(ptr, maxLength) {
		if (typeof ptr.pointer == 'number') ptr = ptr.pointer;
		if (!ptr) return null;
		let bytes = new Uint8Array(this.#memory.buffer);

		if (!maxLength) maxLength = 8192;
		let length = 0;
		while (length < maxLength && bytes[ptr + length]) ++length;
		return new TextDecoder('utf-8').decode(bytes.subarray(ptr, ptr + length));
	}
}

class ClapModuleConfig {
	initialised = false;
	module;
	memory;
	files;
	pluginPath;
	wasi;
	
	constructor(moduleObj) {
		Object.assign(this, moduleObj);
	}

	// Starts the instance, and optionally initialises it (both WASI and CLAP) if it hasn't been done yet
	async start() {
		let imports = {};
		// Create any memory imports
		WebAssembly.Module.imports(this.module).forEach(entry => {
			if (entry.kind == 'memory') {
				if (!imports[entry.module]) imports[entry.module] = Object.create(null);
				if (imports[entry.module][entry.name]) return;

				if (!this.memory) {
					this.memory = new WebAssembly.Memory({initial: 8, maximum: 32768, shared: true});
				}
				imports[entry.module][entry.name] = this.memory;
			}
		});
		let wasiRunning = this.wasi.createInstance(imports);

		let instance = await WebAssembly.instantiate(this.module, imports);
		if (!this.memory) this.memory = instance.exports.memory;
		if (!this.memory) throw Error("WASM module doesn't import or export memory");

		let running = new ClapModuleRunning(this, instance, this.memory);

		if (!this.initialised) {
			await wasiRunning.start(this.memory, instance.exports.malloc);
			
			// Call the CLAP module's WASI entry point
			instance.exports._initialize?.();
			if (instance.exports._start) {
				console.error("WCLAP should be a WASI 'reactor' (not a 'command') but it has `_start()`");
				instance.exports._start?.(); // robustness principle
			}

			// Let the WASI implementation set itself up as well
			// This goes down here because it calls `malloc()` which might need setup
			await wasiRunning.reserveMemory();

			// TODO: copy files in (and we can then discard them since they're in the memory now)

			// CLAP init
			if (!running.clap_entry.init(this.pluginPath)) {
				throw Error("clap_entry.init() failed");
			}

			if (this.memory.buffer instanceof SharedArrayBuffer && globalThis.crossOriginIsolated) {
				this.initialised = true;
			} else {
				// We can't share this memory - don't mark it as initialised
				this.memory = null;
			}
		} else {
			await wasiRunning.run(this.memory, instance.exports.malloc);
		}
		return running;
	}
	
	static async fetch(url) {
		let vfsPath = "/plugin/" + fnv1aHex(url); // Deliberately make plugin path unpredictable (but consistent for each module)

		let response = await fetch(url);
		if (response.headers.get("Content-Type") == "application/wasm") {
			return new ClapModuleConfig({
				module: await WebAssembly.compileStreaming(response),
				pluginPath: vfsPath,
				files: {
					[vfsPath + "/module.wasm"]: new ArrayBuffer(0)
				},
				wasi: await createWasi()
			});
		}

		// If it's not WASM, assume it's a `.tar.gz`
		let files = await expandTarGz(response);
		let newFiles = {};
		for (let path in files) {
			newFiles[vfsPath + "/" + path] = files[path];
		}
		let wasmPath = vfsPath + "/module.wasm";
		if (!newFiles[wasmPath]) {
			// Find first `module.wasm` in the bundle
			for (let path in newFiles) {
				if (/\/module.wasm$/.test(key)) {
					wasmPath = path;
					break;
				}
			}
		}
		if (!newFiles[wasmPath]) {
			throw Error("No `module.wasm` found in WCLAP bundle");
		}

		let modulePromise = WebAssembly.compile(newFiles[wasmPath]);
		let wasiPromise = createWasi();
		newFiles[wasmPath] = new ArrayBuffer(0);
		return new ClapModuleConfig({
			module: await modulePromise,
			pluginPath: wasmPath.replace(/\/module.wasm$/, ''),
			files: newFiles,
			wasi: await wasiPromise
		});
	}
};

// needs `{url: ...}`) or `{module: ...}`
export default async function createClap(options) {
	if (options.module) {
		if (options.module instanceof WebAssembly.Module) {
			return new ClapModuleConfig({
				module: options.module,
				files: {},
				pluginPath: "/plugin/" + fnv1aHex(options.url),
				wasi: await createWasi()
			});
		} else {
			// Assume it was serialised from ClapModuleConfig in another agent
			options.module.wasi = await createWasi(options.module.wasi);
			return new ClapModuleConfig(options.module);
		}
	}
	return ClapModuleConfig.fetch(options.url);
};

class MemoryArena {
	size = 16384; // size in bytes
	#index = 0;
	#pointer;

	#memory;
	#malloc;
	constructor(memory, malloc) {
		this.#memory = memory;
		this.#malloc = malloc;
		
		this.#pointer = malloc(this.size);
		if (!this.#pointer) throw Error("malloc() return 0, but we really need it");
	}
	clear() {
		this.#index = 0;
	}
	
	scoped(fn) {
		let restoreIndex = this.#index;
		let result = fn();
		this.#index = restoreIndex;
		return result;
	}
	
	bytes(length, align) {
		if (!align) align = 1;
		while ((this.#pointer + this.#index)%align) ++this.#index;
		if (this.#index + length > this.size) {
			throw Error("Ran out of space in memory arena: TODO allocate more");
		}
		let startPtr = this.#pointer + this.#index;
		this.#index += length;
		return startPtr;
	}
	byteArray(length, align) {
		let ptr = this.bytes(length, align);
		return new Uint8Array(this.#memory.buffer, ptr, length);
	}

	writeString(str) {
		if (typeof TextEncoder == 'function') {
			let utf8Bytes = new TextEncoder('utf-8').encode(str);
			let array = this.byteArray(utf8Bytes.length + 1);
			array.set(utf8Bytes);
			array[utf8Bytes.length] = 0; // null terminator
			return array.byteOffset;
		} else {
			let array = this.byteArray(str.length + 1);
			for (let i = 0; i < str.length; ++i) {
				// Clamp to printable ASCII
				array[i] = Math.max(32, Math.min(126, str.charCodeAt(i)));
			}
			array[array.length - 1] = 0;
			return array.byteOffset;
		}
	}
};
