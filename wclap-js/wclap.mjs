import {getWasi, startWasi} from "./wasi.mjs";
import getWclap from "./wclap-plugin.mjs";
import generateForwardingWasm from "./generate-forwarding-wasm.mjs"

/* This exports `createHost()`, which should work for any Wasm32 host using the `wclap-js-instance` version of `Instance`.*/
export {getHost, startHost, getWclap};

class WclapHost {
	#config;
	#wasi;
	#wclapMap = Object.create(null);
	#functionTable;
	
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
			if (!entry) throw Error("tried to address Instance which isn't in #wclapMap");
			return entry;
		};
		// When `WebAssembly.Function` is widely supported, we can avoid this workaround: https://github.com/WebAssembly/js-types/blob/main/proposals/js-types/Overview.md#addition-of-webassemblyfunction
		let makeHostFunctionsNative = hostFnEntries => {
			let fnSigs = {};
			let imports = {proxy:{}};
			for (let key in hostFnEntries) {
				let entry = hostFnEntries[key];
				fnSigs[key] = entry.sig;
				let hostFn = this.#functionTable.get(entry.hostIndex);
				imports.proxy[key] = hostFn.bind(null, entry.context);
			}
			let wasm = generateForwardingWasm(fnSigs);
			// Synchronous compile & instantiate
			let forwardingModule = new WebAssembly.Module(wasm);
			let forwardingInstance = new WebAssembly.Instance(forwardingModule, imports);
			return forwardingInstance.exports;
		};
		
		hostImports._wclapInstance = {
			release: instancePtr => {
				delete this.#wclapMap[instancePtr];
			},
			// wclap32
			registerHost32: (instancePtr, context, fnIndex, funcSig, funcSigLength) => {
				let entry = getEntry(instancePtr);
				if (entry.hadInit) throw Error("Can't register host functions after .init()");

				let wasmFnIndex = entry.functionTable.length;
				entry.functionTable.grow(1);
				let sig = '';
				let sigBytes = new Uint8Array(this.memory.buffer).subarray(funcSig, funcSig + funcSigLength);
				sigBytes.forEach(b => {
					sig += String.fromCharCode(b);
				});
				entry.hostFunctions['hostFn' + fnIndex] = {
					instanceIndex: wasmFnIndex,
					hostIndex: fnIndex,
					context: context,
					sig: sig
				}
				return wasmFnIndex;
			},
			init32: instancePtr => {
				let entry = getEntry(instancePtr);
				if (entry.hadInit) throw Error("WCLAP initialised twice");
				entry.hadInit = true;
				
				let nativeHostFns = makeHostFunctionsNative(entry.hostFunctions);
				for (let key in entry.hostFunctions) {
					let fnEntry = entry.hostFunctions[key];
					entry.functionTable.set(fnEntry.instanceIndex, nativeHostFns[key]);
				}
				delete entry.hostFunctions;

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
				if (result == null) {
					dataView.setUint8(resultPtr, 0);
					dataView.setUint32(resultPtr + 8, 0, true);
				} else if (typeof result == 'boolean') {
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
			// wclap64
			init64: instancePtr => {throw Error("64-bit WCLAP not supported (yet)")}
		};
		
		let wasiPromise = startWasi(config.wasi);

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
			if (!hostImports.wasi) hostImports.wasi = {};
			hostImports.wasi['thread-spawn'] = threadArg => {
				return this.hostThreadSpawn(threadArg);
			};

			this.instance = await WebAssembly.instantiate(this.#config.module, hostImports);
			this.memory = importMemory || this.instance.exports.memory;
			
			for (let key in this.instance.exports) {
				let e = this.instance.exports[key];
				if (e instanceof WebAssembly.Table && typeof e.get(e.length - 1) == 'function') {
					this.#functionTable = e;
				}
			}

			this.#wasi.bindToOtherMemory(this.memory);
			if (needsInit) this.instance.exports._initialize();

			return this;
		})();
	}
	
	initObj() {
		return Object.assign({}, this.#config);
	}
	
	/// Returns an instance pointer (`Instance *`) for the C++ host.
	async startWclap(initObj) {
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
			pluginWasi = await this.#wasi.copyForRebinding();
			Object.assign(wclapImports, pluginWasi.importObj);
		}
		// wasi-threads
		if (!wclapImports.wasi) wclapImports.wasi = {};
		wclapImports.wasi['thread-spawn'] = threadArg => {
			return this.pluginThreadSpawn(initObj, threadArg);
		};

		let pluginInstance = await WebAssembly.instantiate(initObj.module, wclapImports);
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
			instance: pluginInstance,
			memory: importMemory || pluginInstance.exports.memory,
			functionTable: functionTable,
			hostFunctions: {}
		};
		if (pluginWasi) pluginWasi.bindToOtherMemory(entry.memory);

		let instancePtr = initObj.instancePtr;
		if (needsInit) {
			let is64 = pluginInstance.exports.clap_entry instanceof BigInt;
if (is64) throw Error("wasm64 WCLAP isn't supported yet");
			instancePtr = this.instance.exports._wclapInstanceCreate(is64);
			// Set the path
			let pathBytes = new TextEncoder('utf-8').encode(initObj.pluginPath);
			let pathPtr = this.instance.exports._wclapInstanceSetPath(initObj.instancePtr, pathBytes.length);
			new Uint8Array(this.memory.buffer).set(pathBytes, pathPtr);
		}
		this.#wclapMap[instancePtr] = entry;
		if (initObj.memory) initObj.instancePtr = instancePtr; // only save if we're also saving the memory

		return instancePtr;
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
	if (typeof initObj == 'string') initObj = {url: initObj};
	if (initObj.module) return initObj;

	if (!initObj.module) {
		initObj.url = new URL(initObj.url, document.baseURI).href;
		initObj.module = await WebAssembly.compileStreaming(fetch(initObj.url));
	}
	if (!initObj.wasi) initObj.wasi = await getWasi();
	return initObj;
}

// Worklets don't have TextEncoder/TextDecoder - this polyfill isn't the most performant, but we shouldn't be doing it often in an AudioProcessorWorklet anyway
if (!globalThis.TextEncoder) {
	let TextCodec = globalThis.TextEncoder = globalThis.TextDecoder = function(){};
	TextCodec.prototype.encode = str => {
		let binaryString = unescape(encodeURIComponent(str));
		let result = new Uint8Array(binaryString.length);
		for (let i = 0; i < binaryString.length; ++i) {
			result[i] = binaryString.charCodeAt(i);
		}
		return result;
	};
	TextCodec.prototype.decode = array => {
		if (!ArrayBuffer.isView(array)) {
			throw Error('Can only use ArrayBuffer or view with TextDecoder');
		}
		array = new Uint8Array(array.buffer, array.byteOffset, array.byteLength);
		let binaryString = "";
		for (let i = 0; i < array.length; ++i) {
			binaryString += String.fromCharCode(array[i]);
		}
		return decodeURIComponent(escape(binaryString));
	};
}
