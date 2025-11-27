/* This exports `createHost()`, which should work for any Wasm32 host using the `wclap-js-instance` version of `Instance`.*/
export {createHost};

import createWasi from "./wasi.mjs";

function fillWasiFromInstance(instance, wasiImports) {
	// Collect WASI methods by matching `{group}__{method}` exports
	for (let key in instance.exports) {
		if (/^wasi_/.test(name) && typeof instance.exports[key] == 'function') {
			let parts = name.split('__');
			if (parts.length == 2) {
				// Forward to the instance
				let group = wasiImports[parts[0]];
				if (!group) group = wasiImports[parts[0]] = {};
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
		console.log(item);
		let name = item.name;
		if (/^wasi_/.test(name) && item.kind == 'function') {
			let parts = name.split('__');
			if (parts.length == 2) {
				instance.exports[name] = (...args) => {
					console.error(`WASI: ${name} called before instance ready`, args);
					return -1; // usually an error code
				};

				// Forward to the instance
				let group = wasiImports[parts[0]];
				if (!group) group = wasiImports[parts[0]] = {};
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

class HostRunning {
	#config;
	#hostImports = {}
	#wclapMap = Object.create(null);
	
	ready;
	instance;
	memory;

	constructor(config, imports, skipInit) {
		// Methods which let the host manage the WCLAP in another module
		let getEntry = jsIndex => {
			let entry = this.#wclapMap[jsIndex];
			if (!entry) throw Error("tried to initialise instance not in the map");
			return entry;
		};
		imports._wclapInstance = {
			release: jsIndex => {
				delete this.#wclapMap[jsIndex];
			},
			init32: jsIndex => {
				let entry = getEntry(jsIndex);
				if (entry.hadInit) throw Error("WCLAP initialised twice");
				entry.hadInit = true;

				if (typeof entry.instance.exports._initialize === 'function') {
					entry.instance.exports._initialize();
				}

				return entry.instance.exports.clap_entry;
			},
			call32: (jsIndex, wasmFn, resultPtr, argsPtr, argsCount) => {
				let entry = getEntry(jsIndex);
				if (!entry.hadInit) throw Error("WCLAP function called before initialisation");

				let dataView = new DataView(this.memory.buffer);
				let args = [];
				for (let i = 0; i < argsCount; ++i) {
					let ptr = argsPtr + i*16;
					let type = dataView.getUint8(ptr);
					if (type == 0) {
						args.push(dataView.getUint32(ptr + 8, true));
					} else if (type == 1) {
						args.push(dataView.getBigUint64(ptr + 8, true));
					} else if (type == 2) {
						args.push(dataView.getFloat32(ptr + 8, true));
					} else if (type == 3) {
						args.push(dataView.getFloat64(ptr + 8, true));
					} else {
						throw Error("invalid argument type");
					}
				}

				let result = entry.functionTable.get(wasmFn)(...args);
				if (typeof result == 'boolean') {
					dataView.setUint8(resultPtr, 0);
					dataView.setUint32(resultPtr + 8, result, true);
				} else if (typeof result == 'number' && (result|0) == result) {
					dataView.setUint8(resultPtr, 0);
					dataView.setInt32(resultPtr + 8, result, true);
				} else if (typeof result == 'number') {
					dataView.setUint8(resultPtr, 3);
					dataView.setFloat64(resultPtr + 8, result, true);
				} else if (result instanceof BigInt && result >= 0n) {
					dataView.setUint8(resultPtr, 1);
					dataView.setBigUint64(resultPtr + 8, result, true);
				} else if (result instanceof BigInt && result < 0n) {
					dataView.setUint8(resultPtr, 1);
					dataView.setBigInt64(resultPtr + 8, result, true);
				} else {
					console.error("Unknown return type from WCLAP function:", result);
				}
			},
			malloc32: (jsIndex, size) => {
				let entry = getEntry(jsIndex);
				let ptr = entry.instance.exports.malloc(size);
				return ptr;
			},
			memcpyToOther32: (jsIndex, wclapP, hostP, size) => {
				let entry = getEntry(jsIndex);
				let wclapA = new Uint8Array(entry.memory.buffer).subarray(wclapP, wclapP + size);
				let hostA = new Uint8Array(this.memory.buffer).subarray(hostP, hostP + size);
				wclapA.set(hostA);
				return true;
			},
			memcpyFromOther32: (jsIndex, hostP, wclapP, size) => {
				let entry = getEntry(jsIndex);
				let hostA = new Uint8Array(this.memory.buffer).subarray(hostP, hostP + size);
				let wclapA = new Uint8Array(entry.memory.buffer).subarray(wclapP, wclapP + size);
				hostA.set(wclapA);
				return true;
			},
		};

		this.ready = (async _ => {
			this.#config = config;

			let hostMemory = null;
			WebAssembly.Module.imports(config.module).forEach(entry => {
				if (entry.kind == 'memory') {
					hostMemory = config.memory || new WebAssembly.Memory({initial: 8, maximum: 32768, shared: true});
					if (!imports[entry.module]) imports[entry.module] = {};
					imports[entry.module][entry.name] = hostMemory;
				}
			});

			let hostWasi = await config.wasiConfig.instance(skipInit);
			Object.assign(imports, hostWasi.importObj);
			if (!imports.wasi) imports.wasi = {};
			if (!imports.wasi['thread-spawn']) imports.wasi['thread-spawn'] = function(threadArg) {
				console.log("Host attempted to start a new thread, but we don't support that");
				return -1;
			};

			if (hostMemory) {
				if (!imports.env) imports.env = {};
				imports.env.memory = hostMemory;
				hostWasi.setOtherMemory(hostMemory);
			}

			this.instance = await WebAssembly.instantiate(this.#config.module, imports);
			if (!hostMemory) {
				hostMemory = this.instance.exports.memory
				hostWasi.setOtherMemory(hostMemory);
			}
			this.memory = hostMemory;

			if (!skipInit) this.instance.exports._initialize();

			return this;
		})();
	}
	
	/// Returns an "instance ID", which is actually an `Instance *` for the C++ host.
	async pluginInstance(wclapConfig, wclapImports, existingMapIndex) {
		if (!wclapImports) wclapImports = {};

		let pluginMemory = null;
		WebAssembly.Module.imports(wclapConfig.module).forEach(entry => {
			if (entry.kind == 'memory') {
				pluginMemory = wclapConfig.memory || new WebAssembly.Memory({initial: 8, maximum: 32768, shared: true});
				if (!wclapImports[entry.module]) wclapImports[entry.module] = {};
				wclapImports[entry.module][entry.name] = pluginMemory;
			}
		});

		let alreadyInitialised = (existingMapIndex != null);
		let pluginWasi = await this.#config.wasiConfig.instance(true); // the WASI instance is shared with the host
		Object.assign(wclapImports, pluginWasi.importObj);
		if (pluginMemory) pluginWasi.setOtherMemory(pluginMemory);

		let wclapInstance = await WebAssembly.instantiate(wclapConfig.module, wclapImports);
		if (!pluginMemory) {
			pluginMemory = wclapInstance.exports.memory;
			pluginWasi.setOtherMemory(pluginMemory);
		}
		let functionTable = null;
		for (let name in wclapInstance.exports) {
			if (wclapInstance.exports[name] instanceof WebAssembly.Table) {
				let table = wclapInstance.exports[name];
				if (table.length > 0 && typeof table.get(table.length - 1) === 'function') {
					if (functionTable) throw Error("WCLAP exported multiple function tables");
					functionTable = table;
				}
			}
		}
		if (!functionTable) throw Error("WCLAP didn't export a function table");

		if (alreadyInitialised) {
			this.#wclapMap[existingMapIndex] = {
				hadInit: false,
				config: wclapConfig,
				memory: pluginMemory,
				functionTable: functionTable,
				instance: wclapInstance
			};
		} else {
			// Put in the list
			let index = this.instance.exports._wclapInstanceGetNextIndex();
			this.#wclapMap[index] = {
				hadInit: false,
				config: wclapConfig,
				memory: pluginMemory,
				functionTable: functionTable,
				instance: wclapInstance,
			};
			// Defined in `wclap-instance-js.h`
			let instanceId = this.instance.exports._wclapInstanceCreate(index, false);
			// Set the path
			let pathBytes = new TextEncoder('utf-8').encode(wclapConfig.pluginPath);
			let pathPtr = this.instance.exports._wclapInstanceSetPath(instanceId, pathBytes.length);
			new Uint8Array(this.memory.buffer).set(pathBytes, pathPtr);

			return instanceId;
		}
	}
}

class HostConfig {
	memory;
	module;
	wasiConfig;
	
	constructor(initObj) {
		Object.assign(this, initObj);
		if (!this.memory && globalThis.crossOriginIsolated) {
			this.memory = new WebAssembly.Memory({initial: 8, maximum: 32768, shared: true});
		}
	}

	async instance(imports, skipInit) {
		if (!imports) imports = {};
		return new HostRunning(this, imports, skipInit).ready;
	}
}

async function createHost(options) {
	if (options?.module) return new HostConfig(options);

	options.url = new URL(options.url || "./wclap-host.wasm", document.baseURI).href;
	let modulePromise = WebAssembly.compileStreaming(fetch(options.url));
	let wasiPromise = createWasi(options.wasiConfig);
	options.module = await modulePromise;
	options.wasiConfig = await wasiPromise;
	return new HostConfig(options);
}
