import generateForwardingModuleWasm from "./generate-forwarding-wasm.mjs";

export default class HostedPlugin {
	static #m_wasmMethods = {
		get_extension: 'ppp',
		request_restart: 'vp',
		request_process: 'vp',
		request_callback: 'vp',
		input_events_size: 'ip',
		input_events_get: 'ppi',
		output_events_try_push: 'ipp'
	};
	static #m_modulePromise;
	static methodProxyModule() {
		// Cache the promise, but we can remove it later if we add more methods etc.
		if (!HostedPlugin.#m_modulePromise) {
			let wasmCode = generateForwardingModuleWasm(HostedPlugin.#m_wasmMethods);
			HostedPlugin.#m_modulePromise = WebAssembly.compile(wasmCode);
		}
		return HostedPlugin.#m_modulePromise;
	};

	static #m_extensions = {};
	static addExtension(key, extension) {
		HostedPlugin.#m_modulePromise = null;
		Object.assign(HostedPlugin.#m_wasmMethods, extension.wasm);
		for (let m in extension.wasm) {
			if (typeof extension.js?.[m] !== 'function') throw Error("no JS for " + m);
		}
		HostedPlugin.#m_extensions[key] = extension;
	}
	static setupExtensions(api, methods) {
		let staticExtensionPointers = Object.create(null);
		for (let key in HostedPlugin.#m_extensions) {
			let extension = HostedPlugin.#m_extensions[key];
			if (extension.addTypes) {
				let maybePointer = extension.addTypes(api, methods);
				if (maybePointer) {
					staticExtensionPointers[key] = maybePointer;
				}
			}
		}
		return staticExtensionPointers;
	}

	#m_factory;
	#m_hostBinding;

	// low-level interface
	api;
	// function struct, as returned from api
	plugin = null;
	// plugin extension structs (if the plugin supports them)
	ext = {};

	// our extension pointers
	hostExt = {};
	
	// WASM pointers to our various structs
	hostPointers = {};
	// WASM function pointers for the host methods
	hostMethods = {};
	// JS implementations - replace these to customise behaviour
	hostJs = {
		get_extension(cStr) {
			let str = this.api.fromArg(this.api.string, cStr);
			return this.hostExt[str] || 0;
		},
		request_restart() {throw Error("not implemented");},
		request_process() {throw Error("not implemented");},
		request_callback() {throw Error("not implemented");},
		input_events_size() {return 0;},
		input_events_get(i) {throw Error("not implemented");},
		output_events_try_push(eventPtr) {return false;}
	};

	constructor(api, hostBinding, factory) {
		let methods = Object.assign(this.hostMethods, hostBinding.m_methods);
		Object.freeze(methods);

		this.api = api;
		this.#m_factory = factory;
		this.#m_hostBinding = hostBinding;

		Object.assign(this.hostExt, hostBinding.m_staticExtensionPointers);
		for (let key in HostedPlugin.#m_extensions) {
			let extension = HostedPlugin.#m_extensions[key];
			if (extension.writeHost) {
				this.hostExt[key] = extension.writeHost(api, methods);
			}
		}

		// Registers the methods to place in the host structs
		let jsMethods = this.hostJs;
		for (let key in HostedPlugin.#m_extensions) {
			let extension = HostedPlugin.#m_extensions[key];
			Object.assign(jsMethods, extension.js);
		}
		
		let hostPointers = Object.assign(this.hostPointers, {
			host: api.save(api.clap_host, {
				clap_version: {major: 1, minor: 2, patch: 2},
				host_data: 0,
				name: 'WASM-CLAP host',
				vendor: 'Signalsmith Audio',
				url: '',
				version: '0.0.1',
				get_extension: methods.get_extension,
				request_restart: methods.request_restart,
				request_process: methods.request_process,
				request_callback: methods.request_callback
			}),
			input_events: api.save(api.clap_input_events, {
				ctx: 0,
				size: methods.input_events_size,
				'get': methods.input_events_get
			}),
			output_events: api.save(api.clap_output_events, {
				ctx: 0,
				try_push: methods.output_events_try_push
			})
		});
		
		Object.freeze(hostPointers);
		for (let key in hostPointers) {
			hostBinding.m_register(hostPointers[key], jsMethods, this);
		}
	}

	bind(pluginId) {
		this.#m_hostBinding.m_removeFromPool(this.hostPointers.host);
		
		if (this.plugin) throw Error("bind(): already bound");
	
		let pluginPtr = this.#m_factory.create_plugin(this.hostPointers.host, pluginId);
		if (!pluginPtr) throw Error("failed to create plugin");
		this.plugin = this.api.clap_plugin(pluginPtr, true);
		if (!this.plugin.init()) {
			this.plugin.destroy();
			throw Error("plugin.init() failed");
		}

		for (let key in HostedPlugin.#m_extensions) {
			let extension = HostedPlugin.#m_extensions[key];
			if (extension.readPlugin) {
				let pluginExtPtr = this.plugin.get_extension(key);
				if (pluginExtPtr) {
					this.ext[key] = extension.readPlugin(this.api, pluginExtPtr, pluginPtr);
				}
			}
		}
	}

	unbind() {
		this.#m_hostBinding.m_addToPool(this.hostPointers.host);
		
		if (!this.plugin) throw Error("unbind(): not bound");
		this.plugin.destroy();
		this.plugin = null;
		this.ext = {};
	}
}
