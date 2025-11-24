import WCLAP32 from "./wclap32.mjs"
import expandTarGz from "./targz.mjs"
import addWasi from "./wasi.mjs"

function	 fnv1aHex(string) {
	let fnv1a32 = 0x811c9dc5;
	for (let i = 0; i < string.length; ++i) {
		let byte = string.charCodeAt(i);
		fnv1a32 = ((fnv1a32^byte)*0x1000193)|0;
	}
	return [24, 16, 8, 0].map(s => ((fnv1a32>>s)&0xFF).toString(16).padStart(2, "0")).join("");
}

async function fetchModule(url) {
	let vfsPath = "/plugin/" + fnv1aHex(url); // Deliberately make plugin path unpredictable (but consistent)

	let response = await fetch(url);
	if (response.headers.get("Content-Type") != "application/wasm") {
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
		let module = await WebAssembly.compile(newFiles[wasmPath]);
		newFiles[wasmPath] = new ArrayBuffer(0);
		return {
			module: module,
			path: wasmPath.replace(/\/module.wasm$/, ''),
			files: newFiles
		};
	}
	return {
		module: await WebAssembly.compileStreaming(response),
		path: vfsPath,
		files: {
			[vfsPath + "/module.wasm"]: new ArrayBuffer(0)
		}
	};
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
};

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
	bytesFor(type) {
		if (typeof type === 'string') type = type.api[type];
		return this.arena.bytes(type.size, type.align);
	}
	byteArray(length, align) {
		let ptr = this.bytes(length, align);
		return new Uint8Array(this.#memory.buffer, ptr, length);
	}
	
	write(type, value) {
		if (typeof type === 'string') type = type.api[type];
		let ptr = this.bytesFor(type);
		type.write(ptr, value);
		return ptr;
	}
	writeString(str) {
		let utf8Bytes = new TextEncoder('utf-8').encode(str);
		let array = this.byteArray(utf8Bytes.length + 1);
		array.set(utf8Bytes);
		array[utf8Bytes.length] = 0; // null terminator
		return array.byteOffset;
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

class ClapModuleReady {
	module;
	files;
	pluginPath;
	
	constructor(module, files, pluginPath) {
		this.module = module;
		this.files = files;
		this.pluginPath = pluginPath;
	}
	
	async start() {
		let imports = {};
		// Create any memory imports
		let memory;
		WebAssembly.Module.imports(this.module).forEach(entry => {
			if (entry.kind == 'memory') {
				if (!imports[entry.module]) imports[entry.module] = Object.create(null);
				if (imports[entry.module][entry.name]) return;

				memory = new WebAssembly.Memory({initial: 8, maximum: 32768, shared: true});
				imports[entry.module][entry.name] = memory;
			}
		});
		let wasiPending = addWasi(imports);

		let instance = await WebAssembly.instantiate(this.module, imports);
		if (!memory) memory = instance.exports.memory;
		if (!memory) throw Error("WASM module doesn't import or export memory");
		await wasiPending(memory);
		
		let running = new ClapModuleRunning(this, instance, memory);
		let stringPtr = running.writeString(this.pluginPath);
		if (!running.clap_entry.init(stringPtr)) {
			throw Error("clap_entry.init() failed");
		}
		return running;
	}
};

// needs URL (string or `{url: ...}`), module optional
export default async function (options) {
	if (typeof options === 'string') options = {url: options};
	let url = new URL(options.url, location.href).href;

	if (options.module && options.module instanceof WebAssembly.Module) {
		return new ClapModuleReady(options.module, {}, "/plugin/" + fnv1aHex(url));
	}
	let obj = await fetchModule(url);
	return new ClapModuleReady(obj.module, obj.files, obj.path);
};
