import instantiate from "./instantiate.mjs";
import clapInterface from"./clap-interface.mjs";

import HostedPlugin from "./hosted-plugin.mjs";
import "./ext/log.mjs";
import "./ext/state.mjs";
import "./ext/params.mjs";
import "./ext/audio-ports.mjs";
import "./ext/webview.mjs";

async function clapHostBinding(moduleInstance, api, factory) {
	let hostModule = await HostedPlugin.methodProxyModule();

	// A map from host memory addresses to HostedPlugin instances
	let hostPointerMap = {};
	// A map of (probably!) unbound hosts
	let hostPool = {};

	let hostMethodImports = {};
	WebAssembly.Module.imports(hostModule).forEach(v => {
		if (v.kind === 'function' && v.module === 'proxy') {
			let key = v.name;
			hostMethodImports[key] = (hostPointer, ...args) => {
				api.memoryMaybeChanged(); // we've been called _from_ native code - it might've resized before this point
				let entry = hostPointerMap[hostPointer];
				if (!entry) throw Error("WASM->JS callback with unfamiliar pointer");
				return entry.m_methods[key].call(entry.m_this, ...args);
			};
		}
	});
	
	let instance = await WebAssembly.instantiate(hostModule, {
		proxy: hostMethodImports
	});
	// get the function IDs from adding the proxied methods to the plugin's Table
	let hostFunctions = api.importFunctions(instance.exports);
	// add any extension types, and store any one-off (reusable by all instances) extension structs
	let staticExtensionPointers = HostedPlugin.setupExtensions(api, hostFunctions);
	
	let hostBinding = {
		m_staticExtensionPointers: staticExtensionPointers,
		m_methods: hostFunctions,
		m_register(hostPointer, methods, thisArg) {
			hostPointerMap[hostPointer] = {m_methods:methods, m_this: thisArg};
		},
		m_addToPool(key, host) {
			hostPool[key] = host;
		},
		m_removeFromPool(key) {
			delete hostPool[key];
		},
		m_getBound(pluginId) {
			let bindable, shouldBind = (pluginId !== null);
			if (shouldBind) {
				for (let key in hostPool) {
					let b = hostPool[key];
					delete hostPool[key];
					if (!b.plugin) {
						bindable = b;
						break;
					}
				}
			}
			if (!bindable) bindable = new HostedPlugin(api, hostBinding, factory);
			if (shouldBind) bindable.bind(pluginId);
			return bindable;
		}
	};
	return hostBinding;
}

async function clapModule(options) {
	let url = options.url;
	let instance = await instantiate(options);

	if (!('clap_entry' in instance.exports)) throw Error('no clap_entry found');
	if (typeof instance.exports.malloc !=='function') throw Error('no malloc() found');
	
	let hostMemorySize = options.hostMemorySize || 1024*1024;
	let api = clapInterface(instance, hostMemorySize, options.log);

	let entryPtr = instance.exports.clap_entry;
	let entry = api.clap_plugin_entry(entryPtr);
	if (!entry.init(url)) {
		throw Error("clap_entry.init() failed");
	}
	
	let factoryPtr = entry.get_factory("clap.plugin-factory");
	if (!factoryPtr) throw Error("no clap.plugin-factory");
	let factory = api.clap_plugin_factory(factoryPtr, true /*bind functions as methods*/);

	let hostBindingPromise = clapHostBinding(instance, api, factory);
	let pluginCount = factory.get_plugin_count();
	let plugins = [];
	for (let i = 0; i < pluginCount; ++i) {
		let descriptorPtr = factory.get_plugin_descriptor(i);
		let descriptor = api.clap_plugin_descriptor(descriptorPtr);
		plugins.push(descriptor);
	}
	
	return {
		url: url,
		version: entry.clap_version,
		plugins: plugins,
		async create(pluginId) {
			return (await hostBindingPromise).m_getBound(pluginId);
		}
	};
}

clapModule.addExtension = HostedPlugin.addExtension.bind(HostedPlugin);

export {clapModule as default};
