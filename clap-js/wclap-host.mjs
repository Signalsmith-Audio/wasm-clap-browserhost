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
	#wclapInstanceMethods = {};
	
	ready;
	instance;

	constructor(config, imports, skipInit) {
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
if (!imports.wasi);

			if (hostMemory) {
				if (!imports.env) imports.env = {};
				imports.env.memory = hostMemory;
				hostWasi.setOtherMemory(hostMemory);
			}

			this.instance = await WebAssembly.instantiate(this.#config.module, imports);
			if (!hostMemory) {
				hostWasi.setOtherMemory(this.instance.exports.memory);
			}
			if (!skipInit) this.instance.exports._initialize();
			// This lets the WASI implementation read/write pointers for the host's memory
			
			return this;
		})();
	}
	
	async pluginInstance(wclapConfig, wclapImports, existingMapIndex) {
		if (!wclapImports) wclapImports = {};
		wclapImports._wclapInstance = this.#wclapInstanceMethods;

		let pluginMemory = null;
		WebAssembly.Module.imports(wclapConfig.module).forEach(entry => {
			if (entry.kind == 'memory') {
				pluginMemory = wclapConfig.memory || new WebAssembly.Memory({initial: 8, maximum: 32768, shared: true});
				if (!wclapImports[entry.module]) wclapImports[entry.module] = {};
				wclapImports[entry.module][entry.name] = pluginMemory;
			}
		});

		let alreadyInitialised = (existingMapIndex != null);
		let pluginWasi = await config.wasiConfig.instance(alreadyInitialised);
		Object.assign(imports, pluginWasi.importObj);
		if (pluginMemory) pluginWasi.setOtherMemory(pluginMemory);

		let wclapInstance = await WebAssembly.instantiate(this.#config.module, wclapImports);
		if (!pluginMemory) {
			pluginMemory = wclapInstance.exports.memory;
			pluginWasi.setOtherMemory(pluginMemory);
		}
		if (alreadyInitialised) {
			this.#wclapMap[existingMapIndex] = {
				config: wclapConfig,
				memory: pluginMemory,
				instance: wclapInstance
			};
		} else {
			if (typeof wclapInstance.exports._initialize == 'function') wclapInstance.exports._initialize();

			// Put in the list
			let index = this.instance.exports._wclapInstanceGetNextIndex();
			this.#wclapMap[index] = {
				config: wclapConfig,
				memory: pluginMemory,
				instance: wclapInstance,
			};
			// Defined in `wclap-instance-js.h`
			let instanceId = this.instance.exports._wclapInstanceCreate(index, false);
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

export default async function createHost(options) {
	if (options?.module) return new HostConfig(options);

	options.url = new URL(options.url || "./wclap-host.wasm", document.baseURI).href;
	let modulePromise = WebAssembly.compileStreaming(fetch(options.url));
	let wasiPromise = createWasi(options.wasiConfig);
	options.module = await modulePromise;
	options.wasiConfig = await wasiPromise;
	return new HostConfig(options);
}
