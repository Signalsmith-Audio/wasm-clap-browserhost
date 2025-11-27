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

class WasiRunning {
	#config;
	#otherModuleMemory;
	
	importObj = {};

	constructor(config, skipInit) {
		this.#config = config;
		let memory = config.memory;
		if (!memory) memory = new WebAssembly.Memory({initial: 8, maximum: 32768, shared: true});
		let wasiImplImports = {
			env: {
				memory: memory,
				memcpyToOther32: (otherP, wasiP, size) => {
					let otherA = new Uint8Array(this.#otherModuleMemory.buffer, otherP, otherP + size);
					let wasiA = new Uint8Array(memory.buffer, wasiP, wasiP + size);
					otherA.set(wasiA);
				},
				memcpyFromOther32: (wasiP, otherP, size) => {
					let wasiA = new Uint8Array(memory.buffer, wasiP, wasiP + size);
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
			if (!skipInit) instance.exports._initialize();
			setWasiInstance(instance);
			fillWasiFromInstance(instance, this.importObj);
			return this;
		})();
	}
	
	setOtherMemory(memory) {
		this.#otherModuleMemory = memory;
	}
	
}

class WasiConfig {
	memory;
	module;
	
	constructor(initObj) {
		Object.assign(this, initObj);
		if (!this.memory && globalThis.crossOriginIsolated) {
			this.memory = new WebAssembly.Memory({initial: 8, maximum: 32768, shared: true});
		}
	}

	async instance(skipInit) {
		return new WasiRunning(this, skipInit).ready;
	}
}

let wasiModulePromise;

export default async function createWasi(options) {
	if (options?.module) return new WasiConfig(options);
	if (!wasiModulePromise) {
		let wasmUrl = new URL("./wasi.wasm", import.meta.url).href;
		wasiModulePromise = WebAssembly.compileStreaming(fetch(wasmUrl));
	}
	return new WasiConfig({module: await wasiModulePromise});
}
