let moduleAdded = Symbol();

function addRemoteMethods(node) {
}

export default class ClapModule {
	url;
	#m_modulePromise;

	constructor(moduleOptions) {
		if (typeof moduleOptions === 'string') moduleOptions = {url: moduleOptions};
		
		let url = moduleOptions?.url;
		// If we specify a directory (ends in `/`) then use `module.wasm`
		if (/\.(wasm-clap|wclap(\.tar\.gz)?)$/.test(url)) url += '/'; // Assume .wasm-clap is a bundle directory
		if (/\/$/.test(url)) url += "module.wasm";
		this.url = new URL(url, location.href).href;

		this.#m_modulePromise = moduleOptions.module || WebAssembly.compileStreaming(fetch(this.url));
	}
	
	async createNode(audioContext, pluginId, nodeOptions) {
		if (!nodeOptions && typeof pluginId === 'object') {
			nodeOptions = pluginId;
			pluginId = null;
		}
		nodeOptions = nodeOptions || {
			numberOfInputs: 1,
			numberOfOutputs: 1,
			outputChannelCount: [2],
		};
		nodeOptions.processorOptions = {
			url: this.url,
			module: await this.#m_modulePromise,
			pluginId: pluginId
		};

		if (!audioContext[moduleAdded]) {
			await audioContext.audioWorklet.addModule('./audioworkletprocessor-clap.mjs');
		}
		audioContext[moduleAdded] = true;

		let effectNode = new AudioWorkletNode(audioContext, 'audioworkletprocessor-clap', nodeOptions);
		
		let responseMap = Object.create(null);
		let idCounter = 0;
		function addRemoteMethod(name) {
			effectNode[name] = (...args) => {
				let requestId = idCounter++;
				
				effectNode.port.postMessage([requestId, name, args]);
				
				return new Promise((pass, fail) => {
					responseMap[requestId] = {m_pass: pass, m_fail: fail};
				});
			};
		}
		
		// Hacky event-handling
		effectNode.events = {};
		
		return new Promise(resolve => {
			effectNode.port.onmessage = e => {
				let {desc, methods, web} = e.data;
				effectNode.descriptor = desc;
				methods.forEach(addRemoteMethod);

				let iframe = null;

				effectNode.port.onmessage = e => {
					let data = e.data;
					if (data instanceof ArrayBuffer) {
						// it's a message from the plugin
						if (iframe) iframe.contentWindow.postMessage(data);
						return;
					}
					if (typeof data[0] === 'string') {
						// it's an event - call a handler if there is one
						let handler = effectNode.events[data[0]];
						if (handler) {
							handler(data[1]);
						} else {
							console.error("unhandled event:", ...data);
						}
						return;
					}
					let response = responseMap[data[0]];
					if (data[1]) {
						response.m_fail(data[1]);
					} else {
						response.m_pass(data[2]);
					}
				};
				
				if (web) {
					let messageHandler = e => {
						if (e.source === iframe?.contentWindow) {
							let data = e.data;
							if (!(data instanceof ArrayBuffer)) throw Error("messages must be ArrayBuffers");
							effectNode.port.postMessage(data);
						}
					};
					let visibilityHandler;
					effectNode.openInterface = () => {
						iframe = document.createElement('iframe');
						window.addEventListener('message', messageHandler);
						window.addEventListener('visibilitychange', visibilityHandler = () => {
							effectNode.webOpen(true, !document.hidden);
						});
						iframe.src = new URL(web.startPage, this.url);
						effectNode.webOpen(true, !document.hidden);
						return iframe;
					};
					effectNode.closeInterface = () => {
						effectNode.webOpen(false);
						if (iframe) {
							window.removeEventListener('message', messageHandler);
							window.removeEventListener('visibilitychange', visibilityHandler);
						}
						iframe = null;
					}
				}

				resolve(effectNode);
			};
		});
	}
}
