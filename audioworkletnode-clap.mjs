import clapModule from "./clap-host/clap-module.mjs";

function addRemoteMethods(node) {
}

export default class ClapModule {
	url;
	#m_modulePromise;
	#m_moduleAdded = Symbol();

	constructor(moduleOptions) {
		if (typeof moduleOptions === 'string') moduleOptions = {url: moduleOptions};
		
		let url = moduleOptions?.url;
		// If we specify a directory (ends in `/`) then use `module.wasm`
		if (/\/$/.test(url)) url += "module.wasm";
		this.url = new URL(url, location.href).href;

		this.#m_modulePromise = Promise.resolve(moduleOptions.module || clapModule.fetchModule(this.url));
	}
		
	async plugins(processorOptions) {
		let module = await clapModule({
			url: this.url,
			module: await this.#m_modulePromise
		});
		return module.plugins;
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
		let moduleObj = await this.#m_modulePromise;
		nodeOptions.processorOptions = {
			url: this.url,
			module: moduleObj,
			pluginId: pluginId
		};

		if (!audioContext[this.#m_moduleAdded]) {
			await audioContext.audioWorklet.addModule('./audioworkletprocessor-clap.mjs');
		}
		audioContext[this.#m_moduleAdded] = true;

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

		effectNode.getFile = async path => (await this.#m_modulePromise).files[path];

		// Hacky event-handling: add a named function to this map
		effectNode.events = Object.create(null);
		
		return new Promise(resolve => {
			effectNode.port.onmessage = e => {
				let {desc, methods, webview} = e.data;
				effectNode.descriptor = desc;
				methods.forEach(addRemoteMethod);
				
				let prevGetResource = effectNode.getResource;
				effectNode.getResource = async path => {
					let obj = await prevGetResource(path);
					// Can't construct Blob in the AudioWorklet, so we translate it here
					return new Blob([obj.bytes], {type: obj.type});
				};

				let iframe = null;

				effectNode.port.onmessage = e => {
					let data = e.data;
					if (data instanceof ArrayBuffer) {
						// it's a message from the plugin
						if (iframe) iframe.contentWindow.postMessage(data, '*');
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
				
				if (webview) {
					let messageHandler = e => {
						if (e.source === iframe?.contentWindow) {
							let data = e.data;
							if (!(data instanceof ArrayBuffer)) throw Error("messages must be ArrayBuffers");
							effectNode.port.postMessage(data);
						}
					};
					let visibilityHandler;
					effectNode.openInterface = (uiOptions) => {
						iframe = document.createElement('iframe');
						window.addEventListener('message', messageHandler);
						window.addEventListener('visibilitychange', visibilityHandler = () => {
							effectNode.webviewOpen(true, !document.hidden);
						});
						let src = webview;
						if (/^file:/.test(src) && uiOptions?.filePrefix) {
							src = uiOptions.filePrefix + webview.replace(/^file:\/*/, '/');
						} else if (src[0] == "/" && uiOptions?.resourcePrefix) {
							src = uiOptions.resourcePrefix + webview;
						}
						iframe.src = new URL(src, this.url);
						effectNode.webviewOpen(true, !document.hidden);
						return iframe;
					};
					effectNode.closeInterface = () => {
						effectNode.webviewOpen(false);
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
