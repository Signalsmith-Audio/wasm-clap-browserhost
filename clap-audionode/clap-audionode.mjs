import {getHost, startHost, getWclap} from "../wclap-js/wclap.mjs";
import {hostImports, startThreadWorker} from "./host-imports.mjs";
import CBOR from "./cbor.mjs";

export default class ClapAudioNode {
	#moduleAddedToAudioContext = Symbol();

	static #routingId = Symbol();
	static #timerSharedArrayBuffer;
	static #hostConfigPromise;
	#ready;
	
	constructor(wclapOptions) {
		if (typeof wclapOptions === 'string') wclapOptions = {url: wclapOptions};
		wclapOptions.url = new URL(wclapOptions.url, document.baseURI).href;

		// Load configs and start host/WCLAP
		if (!ClapAudioNode.#hostConfigPromise) {
			ClapAudioNode.#hostConfigPromise = getHost(new URL("./host.wasm", import.meta.url).href);
		}
		this.#ready = (async (hostConfigPromise, wclapConfigPromise) => {
			// We *could* have a common host across all WCLAP modules, but then we'd need to figure out when to de-register them
			let host = await startHost(await hostConfigPromise, hostImports(), startThreadWorker);
			let wclapConfig = await wclapConfigPromise;
			let wclap = await host.startWclap(wclapConfig);
			let api = host.hostInstance.exports;
			let hostedPtr = api.makeHosted(wclap.ptr); // this specific host's wrapper around an `Instance *`
			return {
				host: host,
				api: api,
				bytesPtr: api.createBytes(),
				wclap: wclap,
				hostedPtr: hostedPtr,
				files: wclapConfig.files // TODO: we use this for `.getFiles()` but actually that should use the WASI VFS which these are loaded into,
			};
		})(ClapAudioNode.#hostConfigPromise, getWclap(wclapOptions));
		
		// Optional timer thread to get more accurate CPU measurements
		if (globalThis.crossOriginIsolated && wclapOptions?.timerWorklet && !ClapAudioNode.#timerSharedArrayBuffer) {
			let workerJs = new Blob([`this.onmessage = e => {`,
				`console.log("CLAP AudioNode performance timer starting");`,
				`let dv = new DataView(e.data);`,
				`while (1) dv.setFloat32(0, performance.now());`,
			`};`], {type: 'application/javascript'});
			let worker = new Worker(URL.createObjectURL(workerJs), {name: "CLAP AudioNode performance timer"});
			let buffer = ClapAudioNode.#timerSharedArrayBuffer = new SharedArrayBuffer(8);
			new DataView(buffer).setFloat32(0, performance.now());
			worker.postMessage(buffer);
		}
	}
	
	async plugins() {
		let {host, api, hostedPtr, bytesPtr} = await this.#ready;

		let decodeCbor = _ => {
			let cborPtr = api.getBytesData(bytesPtr);
			let cborLength = api.getBytesLength(bytesPtr);

			// Have to copy because the TextDecoder doesn't like shared buffers
			let bytes = new Uint8Array(host.hostMemory.buffer).slice(cborPtr, cborPtr + cborLength);
			return CBOR.decode(bytes);
		};
		
		let info = decodeCbor(api.getInfo(hostedPtr, bytesPtr));
		console.log(info);
		
		return info.plugins;
	}
	
	async createNode(audioContext, pluginId, nodeOptions) {
		if (!nodeOptions && typeof pluginId === 'object') { // optional argument
			nodeOptions = pluginId;
			pluginId = null;
		}
		nodeOptions = nodeOptions || {
			numberOfInputs: 1,
			numberOfOutputs: 1,
			outputChannelCount: [2],
		};

		// Add the AudioWorkletProcessor module
		if (!audioContext[this.#moduleAddedToAudioContext]) {
			let moduleUrl = new URL('./clap-audioworkletprocessor.mjs', import.meta.url);
			await audioContext.audioWorklet.addModule(moduleUrl);
		}
		audioContext[this.#moduleAddedToAudioContext] = true;

		let {host, wclap, hostedPtr} = await this.#ready;
		nodeOptions.processorOptions = {
			// These provide enough information
			host: host.initObj(),
			wclap: wclap.initObj(),
			hostedPtr: wclap.shared ? hostedPtr : null,
			pluginId: pluginId
		};

		let effectNode = new AudioWorkletNode(audioContext, 'audioworkletprocessor-clap', nodeOptions);

		// Connect to timer worker, if running
		if (ClapAudioNode.#timerSharedArrayBuffer) {
			effectNode.port.postMessage(["timer-sharedArrayBuffer", ClapAudioNode.#timerSharedArrayBuffer]);
		}

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

		effectNode.getFile = async path => {
			let files = (await this.#ready).files;
			return files[path.replace(/[?#].*/, '')];
		};

		// Hacky event-handling: add a named function to this map
		effectNode.events = Object.create(null);
		
		function handleWorkerMessage(data) {
			if (data?.[0] == 'thread-worker') return startThreadWorker(host, data[1]);
			return false;
		}

		return new Promise(resolve => {
			effectNode.port.onmessage = e => {
				if (handleWorkerMessage(e.data)) return;
				let {routingId, desc, methods, webview} = e.data;
				effectNode[ClapAudioNode.#routingId] = routingId;
				effectNode.descriptor = desc;
				methods.forEach(addRemoteMethod);
				// For [dis]connectEvents, replace the other node with its ID
				effectNode.connectEvents = (prevMethod => otherNode => {
					if (otherNode[ClapAudioNode.#routingId] != null) {
						return prevMethod(otherNode[ClapAudioNode.#routingId]);
					}
				})(effectNode.connectEvents);
				effectNode.disconnectEvents = (prevMethod => nodeOrNull => {
					return prevMethod(nodeOrNull?.[ClapAudioNode.#routingId]);
				})(effectNode.disconnectEvents);

				let prevGetResource = effectNode.getResource;
				effectNode.getResource = async path => {
					let obj = await prevGetResource(path);
					// Can't construct Blob in the AudioWorklet, so we translate it here
					return new Blob([obj.bytes], {type: obj.type});
				};

				let iframe = null;

				effectNode.port.onmessage = e => {
					if (handleWorkerMessage(e.data)) return;
					let data = e.data;
					if (data instanceof ArrayBuffer) {
						// it's a message from the plugin to the UI
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
						iframe.src = new URL(src, document.baseURI);
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

				let prevConnect = effectNode.connect;
				effectNode.connect = function() {
					effectNode.resume();
					prevConnect.apply(this, arguments);
				};

				resolve(effectNode);
			};
		});
	}
}
