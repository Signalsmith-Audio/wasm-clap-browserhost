/* Loads a C++ WASI implementation.

Each Wasi object (obtained with `createWasi()`) can only be used to provide imports for a single other module.  Once it's been created, it needs to be bound to that module's memory using `bindToOtherMemory()`.

However, you can use the same WASI context for multiple other instances, by creating copies with `copyForRebinding()` (on the same thread), or `initObj()` when passing to a Worker/Worklet (which then gets passed to `createWasi()`.

If the browser is not cross-origin isolated, `initObj()` will pass the WebAssembly module across (to avoid re-fetching) but the WASI contexts will not be shared.
*/

function fillWasiFromInstance(instance, wasiImports) {
	// Collect WASI methods by matching `{group}__{method}` exports
	for (let name in instance.exports) {
		if (/^wasi32_/.test(name) && typeof instance.exports[name] == 'function') {
			let parts = name.split('__');
			if (parts.length == 2) {
				// Forward to the instance
				let groupName = parts[0].replace(/^wasi32_/, 'wasi_');
				let group = wasiImports[groupName];
				if (!group) group = wasiImports[groupName] = {};
				group[parts[1]] = instance.exports[name];
			}
		}
	}
}

// Similar to above, but with an extra layer of indirection so we can do it before it's instantiated
function fillWasiFromModuleExports(module, wasiImports) {
	let instance = {exports:{}};
	
	// Collect WASI methods by matching `{group}__{method}`
	WebAssembly.Module.exports(module).forEach(item => {
		let name = item.name;
		if (/^wasi32_/.test(name) && item.kind == 'function') {
			let parts = name.split('__');
			if (parts.length == 2) {
				instance.exports[name] = (...args) => {
					console.error(`WASI: ${name} called before instance ready`, args);
					return -1; // usually an error code
				};

				// Forward to the instance
				let groupName = parts[0].replace(/^wasi32_/, 'wasi_');
				let group = wasiImports[groupName];
				if (!group) group = wasiImports[groupName] = {};
				group[parts[1]] = (...args) => instance.exports[name](...args);
			}
		}
	});
	return function setWasiInstance(v) {
		instance = v;
	};
}

function fromString(memory, ptr, length) {
	let buffer = new Uint8Array(memory.buffer, ptr, length);
	if (typeof TextDecoder === 'function') {
		return new TextDecoder('utf-8').decode(buffer);
	} else {
		let str = "";
		for (let i = 0; i < length; ++i) {
			str += String.fromCharCode(buffer[i]);
		}
		return str;
	}
}

class Wasi {
	// This config is a plain object with {module, ?memory}
	// The memory is only populated if it's sharable across threads *and* has already been initialised
	#config;
	#memory;
	#otherModuleMemory;
	
	importObj = {};

	constructor(config, singleThreadMemory) {

		this.#config = config;
		this.#memory = config.memory || singleThreadMemory;

		let needsInit = false;
		if (!this.#memory) {
			needsInit = true;
			this.#memory = new WebAssembly.Memory({initial: 8, maximum: 32768, shared: true});
			if (globalThis.crossOriginIsolated) config.memory = this.#memory;
		}

		let wasiImplImports = {
			env: {
				memory: this.#memory,
				memcpyToOther32: (otherP, wasiP, size) => {
					let otherA = new Uint8Array(this.#otherModuleMemory.buffer, otherP, otherP + size);
					let wasiA = new Uint8Array(this.#memory.buffer, wasiP, wasiP + size);
					otherA.set(wasiA);
				},
				memcpyFromOther32: (wasiP, otherP, size) => {
					let wasiA = new Uint8Array(this.#memory.buffer, wasiP, wasiP + size);
					let otherA = new Uint8Array(this.#otherModuleMemory.buffer, otherP, otherP + size);
					wasiA.set(otherA);
				},
				procExit() {
					debugger;
					throw new Error("Fatal error - but fully stopping is not supported");
				}
			}
		};
		// Yes, we recursively pass its own WASI implementation back in, indirectly
		let setWasiInstance = fillWasiFromModuleExports(config.module, wasiImplImports);

		this.ready = (async _ => {
			let instance = await WebAssembly.instantiate(this.#config.module, wasiImplImports);
			if (needsInit) instance.exports._initialize();
			setWasiInstance(instance);
			fillWasiFromInstance(instance, this.importObj);
			return this;
		})();
	}
	
	initObj() {
		return Object.assign({}, this.#config);
	}
	
	bindToOtherMemory(memory) {
		this.#otherModuleMemory = memory;
	}

	// Makes another instance, using the same memory (even if it's on the same thread)
	async copyForRebinding() {
		return new Wasi(this.#config, this.#memory).ready;
	}
}

let wasiModulePromise;

export async function getWasi(initObj) {
	if (initObj?.module) return initObj;

	if (!wasiModulePromise) {
		let wasmUrl = new URL("./wasi.wasm", import.meta.url).href;
		wasiModulePromise = WebAssembly.compileStreaming(fetch(wasmUrl));
	}
	return {module: await wasiModulePromise};
}

export async function startWasi(initObj) {
	if (!initObj.module) initObj = getWasi(initObj);
	return new Wasi(initObj).ready;
}
