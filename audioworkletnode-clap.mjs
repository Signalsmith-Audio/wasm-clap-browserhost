import clapModule from "./clap-js/clap.mjs";

export default class ClapModule {
	url;
	#m_modulePromise;
	#m_moduleAdded = Symbol();
	
	static #m_routingId = Symbol();

	constructor(moduleOptions) {
		this.#m_modulePromise = clapModule(moduleOptions);
	}
	
	async plugins() {
		let module = await this.#m_modulePromise;
		let instance = await module.start();
		let factoryPtr = instance.clap_entry.get_factory(instance.writeString(instance.api.CLAP_PLUGIN_FACTORY_ID));
		let factory = instance.api.clap_plugin_factory.read(factoryPtr);
		let count = factory.get_plugin_count(factoryPtr);
		let list = [];
		for (let i = 0; i < count; ++i) {
			let desc = factory.get_plugin_descriptor(factoryPtr, i).get();
			['description', 'id', 'manual_url', 'name', 'support_url', 'url', 'vendor', 'version'].forEach(key => {
				let ptr = desc[key].pointer;
				desc[key] = ptr ? instance.readString(ptr) : null;
			});
			// Null-terminated list of strings
			let featuresPtr = desc.features;
			let featureCount = 0;
			desc.features = [];
			while (featuresPtr.get(featureCount).pointer) {
				let stringPtr = featuresPtr.get(featureCount);
				desc.features.push(instance.readString(stringPtr));
				++featureCount;
			}
			
			list.push(desc);
		}
		console.log(JSON.stringify(list, null, '\t'));
		return list;
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

		effectNode.getFile = async path => {
			let files = (await this.#m_modulePromise).files;
			return files[path.replace(/[?#].*/, '')];
		};

		// Hacky event-handling: add a named function to this map
		effectNode.events = Object.create(null);
		
		return new Promise(resolve => {
			function spawnWorker(data) {
				if (data?.[0] == "worker") {
					let moduleUrl = data[1], options = data[2], threadId = data[3], threadArg = data[4];
					options.module = moduleObj;
					let worker = new Worker(moduleUrl, {type: 'module', name: 'thread-' + threadId});
					worker.postMessage([options, threadId, threadArg]);
					return true;
				}
				return false;
			}
		
			effectNode.port.onmessage = e => {
				if (spawnWorker(e.data)) return;
				let {routingId, desc, methods, webview} = e.data;
				effectNode[ClapModule.#m_routingId] = routingId;
				effectNode.descriptor = desc;
				methods.forEach(addRemoteMethod);
				// For [dis]connectEvents, replace the other node with its ID
				effectNode.connectEvents = (prevMethod => otherNode => {
					if (otherNode[ClapModule.#m_routingId] != null) {
						return prevMethod(otherNode[ClapModule.#m_routingId]);
					}
				})(effectNode.connectEvents);
				effectNode.disconnectEvents = (prevMethod => nodeOrNull => {
					return prevMethod(nodeOrNull?.[ClapModule.#m_routingId]);
				})(effectNode.disconnectEvents);
				
				let prevGetResource = effectNode.getResource;
				effectNode.getResource = async path => {
					let obj = await prevGetResource(path);
					// Can't construct Blob in the AudioWorklet, so we translate it here
					return new Blob([obj.bytes], {type: obj.type});
				};

				let iframe = null;

				effectNode.port.onmessage = e => {
					if (spawnWorker(e.data)) return;
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
