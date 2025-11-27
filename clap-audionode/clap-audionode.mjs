import {createHost, createWclap} from "../wclap-js/wclap.mjs";
import CBOR from "./cbor.mjs";

export default class ClapAudioNode {
	#m_moduleAddedToAudioContext = Symbol();

	#m_hostConfigPromise;
	#m_pluginConfigPromise;
	
	static #m_routingId = Symbol();
	static #m_hostConfig = {
		url: new URL("./host.wasm", import.meta.url).href,
	};
	#m_hostImports = {};

	constructor(options) {
		if (typeof options === 'string') {
			options = {url: new URL(options, document.baseURI).href};
		}
		// This particular host gets instantiated once per plugin, but that doesn't need to be true in general
		this.#m_hostConfigPromise = createHost(ClapAudioNode.#m_hostConfig);
		this.#m_pluginConfigPromise = createWclap(options);
	}
	
	async plugins() {
		let hostConfig = await this.#m_hostConfigPromise;
		let pluginConfig = await this.#m_pluginConfigPromise;
		
		// Decodes the (host-specific) `CborReturn *`
		let decodeCbor = ptr => {
			if (!ptr) return null;
			let buffer = host.memory.buffer;
			let dataView = new DataView(buffer);
			let cborPtr = dataView.getUint32(ptr, true);
			let cborLength = dataView.getUint32(ptr + 4, true);

			// Have to copy because the TextDecoder doesn't like shared buffers
			let bytes = new Uint8Array(buffer).slice(cborPtr, cborPtr + cborLength);
			return CBOR.decode(bytes);
		};
		let host = await hostConfig.instance({/*custom imports would go here*/});
		let api = host.instance.exports;
		
		// generic
		let instanceId = await host.pluginInstance(pluginConfig, this.#m_hostImports);

		// Specific to this host
		let wclap = api.makeHosted(instanceId);
		if (!wclap) throw Error("Failed to load WCLAP");

		let info = decodeCbor(api.getInfo(wclap));
		console.log(info);

		api.removeHosted(wclap);
		return info.plugins;
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
		
		if (!audioContext[this.#m_moduleAddedToAudioContext]) {
			let moduleUrl = new URL('./clap-audioworkletprocessor.mjs', import.meta.url);
			await audioContext.audioWorklet.addModule(moduleUrl);
		}
		audioContext[this.#m_moduleAddedToAudioContext] = true;

//		let effectNode = new AudioWorkletNode(audioContext, 'audioworkletprocessor-clap', nodeOptions);
//
//		let responseMap = Object.create(null);
//		let idCounter = 0;
//		function addRemoteMethod(name) {
//			effectNode[name] = (...args) => {
//				let requestId = idCounter++;
//
//				effectNode.port.postMessage([requestId, name, args]);
//
//				return new Promise((pass, fail) => {
//					responseMap[requestId] = {m_pass: pass, m_fail: fail};
//				});
//			};
//		}
//
//		effectNode.getFile = async path => {
//			let files = (await this.#m_modulePromise).files;
//			return files[path.replace(/[?#].*/, '')];
//		};
//
//		// Hacky event-handling: add a named function to this map
//		effectNode.events = Object.create(null);
//
//		return new Promise(resolve => {
//			function spawnWorker(data) {
//				if (data?.[0] == "worker") {
//					let moduleUrl = data[1], options = data[2], threadId = data[3], threadArg = data[4];
//					options.module = moduleObj;
//					let worker = new Worker(moduleUrl, {type: 'module', name: 'thread-' + threadId});
//					worker.postMessage([options, threadId, threadArg]);
//					return true;
//				}
//				return false;
//			}
//
//			effectNode.port.onmessage = e => {
//				if (spawnWorker(e.data)) return;
//				let {routingId, desc, methods, webview} = e.data;
//				effectNode[ClapAudioNode.#m_routingId] = routingId;
//				effectNode.descriptor = desc;
//				methods.forEach(addRemoteMethod);
//				// For [dis]connectEvents, replace the other node with its ID
//				effectNode.connectEvents = (prevMethod => otherNode => {
//					if (otherNode[ClapAudioNode.#m_routingId] != null) {
//						return prevMethod(otherNode[ClapAudioNode.#m_routingId]);
//					}
//				})(effectNode.connectEvents);
//				effectNode.disconnectEvents = (prevMethod => nodeOrNull => {
//					return prevMethod(nodeOrNull?.[ClapAudioNode.#m_routingId]);
//				})(effectNode.disconnectEvents);
//
//				let prevGetResource = effectNode.getResource;
//				effectNode.getResource = async path => {
//					let obj = await prevGetResource(path);
//					// Can't construct Blob in the AudioWorklet, so we translate it here
//					return new Blob([obj.bytes], {type: obj.type});
//				};
//
//				let iframe = null;
//
//				effectNode.port.onmessage = e => {
//					if (spawnWorker(e.data)) return;
//					let data = e.data;
//					if (data instanceof ArrayBuffer) {
//						// it's a message from the plugin
//						if (iframe) iframe.contentWindow.postMessage(data, '*');
//						return;
//					}
//					if (typeof data[0] === 'string') {
//						// it's an event - call a handler if there is one
//						let handler = effectNode.events[data[0]];
//						if (handler) {
//							handler(data[1]);
//						} else {
//							console.error("unhandled event:", ...data);
//						}
//						return;
//					}
//					let response = responseMap[data[0]];
//					if (data[1]) {
//						response.m_fail(data[1]);
//					} else {
//						response.m_pass(data[2]);
//					}
//				};
//
//				if (webview) {
//					let messageHandler = e => {
//						if (e.source === iframe?.contentWindow) {
//							let data = e.data;
//							if (!(data instanceof ArrayBuffer)) throw Error("messages must be ArrayBuffers");
//							effectNode.port.postMessage(data);
//						}
//					};
//					let visibilityHandler;
//					effectNode.openInterface = (uiOptions) => {
//						iframe = document.createElement('iframe');
//						window.addEventListener('message', messageHandler);
//						window.addEventListener('visibilitychange', visibilityHandler = () => {
//							effectNode.webviewOpen(true, !document.hidden);
//						});
//						let src = webview;
//						if (/^file:/.test(src) && uiOptions?.filePrefix) {
//							src = uiOptions.filePrefix + webview.replace(/^file:\/*/, '/');
//						} else if (src[0] == "/" && uiOptions?.resourcePrefix) {
//							src = uiOptions.resourcePrefix + webview;
//						}
//						iframe.src = new URL(src, this.url);
//						effectNode.webviewOpen(true, !document.hidden);
//						return iframe;
//					};
//					effectNode.closeInterface = () => {
//						effectNode.webviewOpen(false);
//						if (iframe) {
//							window.removeEventListener('message', messageHandler);
//							window.removeEventListener('visibilitychange', visibilityHandler);
//						}
//						iframe = null;
//					}
//				}
//
//				let prevConnect = effectNode.connect;
//				effectNode.connect = function() {
//					effectNode.resume();
//					prevConnect.apply(this, arguments);
//				};
//
//				resolve(effectNode);
//			};
//		});
	}
}
