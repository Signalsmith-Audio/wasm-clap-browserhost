import createWasi from "./wasi.mjs";
import getWclap from "./wclap-plugin.mjs";

/* This exports `createHost()`, which should work for any Wasm32 host using the `wclap-js-instance` version of `Instance`.*/
export {getHost, startHost, getWclap};

class WclapHost {
	#config;
	#wasi;
	#wclapMap = Object.create(null);
	
	ready;
	instance;
	memory;

	hostThreadSpawn(threadArg) {
		console.error("Host attempted to start a new thread, but we don't support that (yet)");
		return -1;
	}
	pluginThreadSpawn(wclapConfig, threadArg) {
		console.error("Plugin attempted to start a new thread, but we don't support that (yet)");
		return -1;
	}

	constructor(config, hostImports) {
		if (!hostImports) hostImports = {};
		// Methods which let the host manage the WCLAP in another module
		let getEntry = instancePtr => {
			let entry = this.#wclapMap[instancePtr];
			if (!entry) throw Error("tried to initialise instance not in the map");
			return entry;
		};
		hostImports._wclapInstance = {
			release: instancePtr => {
				delete this.#wclapMap[instancePtr];
			},
			// wclap32
			init32: instancePtr => {
				let entry = getEntry(instancePtr);
				if (entry.hadInit) throw Error("WCLAP initialised twice");
				entry.hadInit = true;

				if (typeof entry.instance.exports._initialize === 'function') {
					entry.instance.exports._initialize();
				}

				return entry.instance.exports.clap_entry;
			},
			malloc32: (instancePtr, size) => {
				let entry = getEntry(instancePtr);
				let ptr = entry.instance.exports.malloc(size);
				return ptr;
			},
			countUntil32: (instancePtr, startPtr, untilValuePtr, size, maxCount) => {
				let entry = getEntry(instancePtr);
				let untilArray = new Uint8Array(this.memory.buffer).subarray(untilValuePtr, untilValuePtr + size);
				let wclapA = new Uint8Array(entry.memory.buffer).subarray(startPtr);
				for (let i = 0; i < maxCount; ++i) {
					let offset = i*size;
					let difference = false;
					for (let b = 0; b < size; ++b) {
						if (wclapA[offset + b] != untilArray[b]) difference = true;
					}
					if (!difference) return i;
				}
				return maxCount;
			},
			call32: (instancePtr, wasmFn, resultPtr, argsPtr, argsCount) => {
				let entry = getEntry(instancePtr);
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
			memcpyToOther32: (instancePtr, wclapP, hostP, size) => {
				let entry = getEntry(instancePtr);
				let wclapA = new Uint8Array(entry.memory.buffer).subarray(wclapP, wclapP + size);
				let hostA = new Uint8Array(this.memory.buffer).subarray(hostP, hostP + size);
				wclapA.set(hostA);
				return true;
			},
			memcpyFromOther32: (instancePtr, hostP, wclapP, size) => {
				let entry = getEntry(instancePtr);
				let hostA = new Uint8Array(this.memory.buffer).subarray(hostP, hostP + size);
				let wclapA = new Uint8Array(entry.memory.buffer).subarray(wclapP, wclapP + size);
				hostA.set(wclapA);
				return true;
			},
		};
		
		let wasiPromise = createWasi(config.wasi);

		this.ready = (async _ => {
			this.#config = config;
			let importMemory = config.memory;
			let needsInit = !importMemory;

			WebAssembly.Module.imports(config.module).forEach(entry => {
				if (entry.kind == 'memory') {
					if (!importMemory) {
						importMemory = new WebAssembly.Memory({initial: 8, maximum: 32768, shared: true});
						if (globalThis.crossOriginIsolated) config.memory = importMemory;
					}
					
					if (!hostImports[entry.module]) hostImports[entry.module] = {};
					hostImports[entry.module][entry.name] = importMemory;
				}
			});
			
			// Add WASI imports
			this.#wasi = await wasiPromise;
			config.wasi = this.#wasi.initObj();
			Object.assign(hostImports, this.#wasi.importObj);

			// wasi-threads
			if (!hostImports.wasi) imports.wasi = {};
			hostImports.wasi['thread-spawn'] = threadArg => {
				return this.hostThreadSpawn(threadArg);
			};

			this.instance = await WebAssembly.instantiate(this.#config.module, hostImports);
			this.memory = importMemory || this.instance.exports.memory;

			this.#wasi.setOtherMemory(this.memory);
			if (needsInit) this.instance.exports._initialize();

			return this;
		})();
	}
	
	initObj() {
		return Object.assign({}, this.#config);
	}
	
	/// Returns an "instance ID", which is actually an `Instance *` for the C++ host.
	async loadWclap(initObj) {
		if (!initObj.module) initObj = getWclap(initObj);
		let wclapImports = {};

		let importMemory = initObj.memory;
		let needsInit = !importMemory;
		let needsWasi = false;
		WebAssembly.Module.imports(initObj.module).forEach(entry => {
			if (/^wasi/.test(entry.module)) needsWasi = true;
			if (entry.kind == 'memory') {
				if (!importMemory) {
					importMemory = new WebAssembly.Memory({initial: 8, maximum: 32768, shared: true});
					if (globalThis.crossOriginIsolated) initObj.memory = importMemory;
				}
				if (!wclapImports[entry.module]) wclapImports[entry.module] = {};
				wclapImports[entry.module][entry.name] = importMemory;
			}
		});

		if (needsInit && ('instancePtr' in initObj)) {
			throw Error("WCLAP's initObj has instancePtr, but no shared-memory import - this probably means you're trying to create a WCLAP thread, but the page isn't cross-origin isolated");
		}

		let pluginWasi = null;
		if (needsWasi) {
			pluginWasi = await this.#wasi.copyForReassignment();
			Object.assign(wclapImports, pluginWasi.importObj);
		}
		// wasi-threads
		if (!wclapImports.wasi) wclapImports.wasi = {};
		wclapImports.wasi['thread-spawn'] = threadArg => {
			return this.pluginThreadSpawn(initObj, threadArg);
		};
		if (pluginWasi) pluginWasi.setOtherMemory(pluginMemory);

		let pluginInstance = await WebAssembly.instantiate(wclapConfig.module, wclapImports);
		let functionTable = null;
		for (let name in pluginInstance.exports) {
			if (pluginInstance.exports[name] instanceof WebAssembly.Table) {
				let table = pluginInstance.exports[name];
				if (table.length > 0 && typeof table.get(table.length - 1) === 'function') {
					if (functionTable) throw Error("WCLAP exported multiple function tables");
					functionTable = table;
				}
			}
		}
		if (!functionTable) throw Error("WCLAP didn't export a function table");

		let entry = {
			initObj: initObj,
			instance: instance,
			memory: importMemory || pluginInstance.exports.memory,
			functionTable: functionTable,
		};
		if (pluginWasi) pluginWasi.setOtherMemory(entry.memory);

		if (needsInit) {
			let is64 = pluginInstance.exports.clap_entry instanceof BigInt;
if (is64) throw Error("wasm64 WCLAP isn't supported yet");
			initObj.instancePtr = this.instance.exports._wclapInstanceCreate(is64);
			// Set the path
			let pathBytes = new TextEncoder('utf-8').encode(wclapConfig.pluginPath);
			let pathPtr = this.instance.exports._wclapInstanceSetPath(initObj.instancePtr, pathBytes.length);
			new Uint8Array(this.memory.buffer).set(pathBytes, pathPtr);
		}
		this.#wclapMap[initObj.instancePtr] = entry;

		return initObj.instancePtr;
	}
	
	instanceMemory(instancePtr) {
		return this.#wclapMap[instancePtr].memory;
	}
}

async function startHost(initObj, hostImports) {
	initObj = Object.assign({}, initObj);
	return new WclapHost(initObj, hostImports).ready;
}

async function getHost(initObj) {
	if (typeof initObj == 'object' && initObj?.module) return initObj;

	if (typeof initObj == 'string') initObj = {url: initObj};
	let url = new URL(initObj.url, document.baseURI).href;
	return {
		url: url,
		module: await WebAssembly.compileStreaming(fetch(url))
	};
}
