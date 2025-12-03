import {getHost, startHost, getWclap} from "../wclap-js/wclap.mjs";
import hostImports from "./host-imports.mjs";
import CBOR from "./cbor.mjs";

// For debugging, we sometimes import this module into the main page, and makes that work
export default null;
if (!globalThis.AudioWorkletProcessor) globalThis.AudioWorkletProcessor = globalThis.registerProcessor = function(){}

if (!globalThis.clapRouting) {
	// Map from instance ID -> `{events: [...]}`
	globalThis.clapRouting = Object.create(null);
}

let now = (typeof performance === 'object') ? performance.now.bind(performance) : Date.now.bind(Date);
let cpuAveragePeriod = (typeof performance === 'object') ? 50 : 10000; // 150ms or 30s @ 44.1kHz
function setTimerSharedArrayBuffer(sharedArrayBuffer) {
	// We have a timer thread which is just spinning, putting performance.now() into shared memory
	let dv = new DataView(sharedArrayBuffer);
	now = _ => dv.getFloat32(0);
	cpuAveragePeriod = 50;
}

class ClapAudioWorkletProcessor extends AudioWorkletProcessor {
	inputChannelCounts = [];
	outputChannelCounts = [];
	maxFramesCount = 128;

	// Could be global
	host;
	
	// Could be shared amongst all plugins from the same module
	hostedWclapPtr; // The specific WCLAP model (created from an `Instance *` in C++)
	instanceMemory; // We read/write sample data directly, to avoid copying in/out of the host
	instanceAudioPointers; // pointers to read/write audio in the Instance memory
	instanceSingleThreaded = true;
	instancePluginMap = {};

	// specific to this module
	pluginPtr;
	
	running = false;
	routingId;
	static #cleanup = new FinalizationRegistry(routingId => {
		delete globalThis.clapRouting[routingId];
	});

	// Decode or fills the (host-specific) `CborReturn *`
	decodeCbor(ptr) {
		if (!ptr) return null;
		let buffer = this.host.hostMemory.buffer;
		let dataView = new DataView(buffer);
		let cborPtr = dataView.getUint32(ptr, true);
		let cborLength = dataView.getUint32(ptr + 4, true);

		// Have to copy because the TextDecoder doesn't like shared buffers
		let bytes = new Uint8Array(buffer).slice(cborPtr, cborPtr + cborLength);
		return CBOR.decode(bytes);
	};
	encodeCbor(value) {
		let bytes = new Uint8Array(CBOR.encode(value));
		return this.sendBytes(bytes, true);
	}
	sendBytes(bytes, returnCbor) {
		let ptr = this.hostApi.resizeCbor(bytes.length);
		let buffer = this.host.hostMemory.buffer;
		let dataView = new DataView(buffer);
		let bufferPtr = dataView.getUint32(ptr, true);
		let array = new Uint8Array(buffer).subarray(bufferPtr, bufferPtr + bytes.length);
		array.set(bytes);
		return returnCbor ? ptr : bufferPtr;
	}
	
	constructor(options) {
		super();
		this.port.onmessageerror = e => {
			console.error(e);
			debugger;
		};

		(async init => {
			// Create one Host for every AudioNode (for now) - could be global in future
			let imports = hostImports();
			Object.assign(imports.env, {
				webviewSend: (pluginPtr, ptr, length) => {
					let processor = this.instancePluginMap[pluginPtr];
					let bytes = new Uint8Array(this.instanceMemory.buffer, ptr, length).slice();
					processor.webviewSend(bytes);
				},
				eventsOutTryPush: (pluginPtr, ptr, length) => {
					let processor = this.instancePluginMap[pluginPtr];
					let bytes = new Uint8Array(this.instanceMemory.buffer, ptr, length).slice();
					processor.outputEvent(bytes);
				},
				stateMarkDirty: (pluginPtr) => {
					let processor = this.instancePluginMap[pluginPtr];
					processor.port.postMessage(['state_mark_dirty', null]);
				},
				paramsRescan: (pluginPtr, flags) => {
					let processor = this.instancePluginMap[pluginPtr];
					processor.port.postMessage(['params_rescan', flags]);
				}
			});
			this.host = await startHost(init.host, imports);
			let hostApi = this.hostApi = this.host.hostInstance.exports;
			
			// This particular WASM module
			let wclapInstance = await this.host.startWclap(init.wclap);
			this.hostedWclapPtr = hostApi.makeHosted(wclapInstance.ptr);
			this.instanceMemory = wclapInstance.memory;

			let pluginId = init.pluginId;
			if (!pluginId) {
				let pluginIndex = init.pluginIndex || 0;
				let moduleInfo = this.decodeCbor(hostApi.getInfo(this.hostedWclapPtr));
				pluginId = moduleInfo.plugins[pluginIndex].id;
			}

			// Manage the event-routing entry
			this.routingId = pluginId + "/" + Math.random().toString(16).substr(2);
			globalThis.clapRouting[this.routingId] = {
				events: []
			};
			ClapAudioWorkletProcessor.#cleanup.register(this, this.routingId);
			
			this.pluginPtr = hostApi.createPlugin(this.hostedWclapPtr, this.encodeCbor(pluginId));
			if (!this.pluginPtr) {
				throw this.fatalError = Error("Failed to create plugin: " + pluginId);
			}
			this.instancePluginMap[this.pluginPtr] = this; // this would be removed whenever we call `hostApi.destroyPlugin()` later
			this.instanceAudioPointers = this.decodeCbor(hostApi.pluginStart(this.pluginPtr, globalThis.sampleRate, 0, this.maxFramesCount));
			if (!this.instanceAudioPointers) {
				throw this.fatalError = Error("Failed to start plugin: " + pluginId);
			}
			this.running = true;

			// initial message lists plugin descriptor and remote methods
			let pluginInfo = this.decodeCbor(hostApi.pluginGetInfo(this.pluginPtr));
			this.port.postMessage(Object.assign(pluginInfo, {
				routingId: this.routingId,
				methods: Object.keys(this.remoteMethods),
			}));

			// subsequent messages are either proxied method calls, or ArrayBuffer messages from the webview
			this.port.onmessage = async event => {
				let data = event.data;
				if (data instanceof ArrayBuffer) {
					let bytes = new Uint8Array(data);
					hostApi.pluginMessage(this.pluginPtr, this.sendBytes(bytes), bytes.length);
					return;
				}
				let [requestId, method, args] = data;
				if (this.fatalError) return this.port.postMessage([requestId, this.fatalError]);
				if (requestId == 'timer-sharedArrayBuffer') {
					return setTimerSharedArrayBuffer(method);
				}

				try {
					let result = await this.remoteMethods[method].call(this, ...args);
					this.port.postMessage([requestId, null, result]);
					if (this.instanceSingleThreaded) this.mainThreadCallback();
				} catch (e) {
					this.failWithError(e);
					this.port.postMessage([requestId, e]);
				}
			};
		})(options.processorOptions);
	}

	fatalError = null;
	failWithError(e) {
		debugger;
		console.error(e);
		this.fatalError = e;
	}

	mainThreadCallback() {
		this.hostApi.pluginMainThread(this.pluginPtr);
	}
	
	// Hands input events to the plugin, and clears the list
	writePendingEvents() {
		let plugin = this.clapPlugin;
		globalThis.clapRouting[this.routingId].events.forEach(bytes => {
			this.hostApi.pluginAcceptEvent(this.pluginPtr, this.sendBytes(bytes));
		});
		globalThis.clapRouting[this.routingId].events = [];
	}
	
	eventTargets = {};
	outputEvent(eventBytes) {
		for (let key in this.eventTargets) {
			if (globalThis.clapRouting[key]) {
				globalThis.clapRouting[key].events.push(eventBytes);
			}
		}
	}

	webviewSend(messageBytes) {
		this.port.postMessage(messageBytes.buffer);
	}

	remoteMethods = {
		pause() {
			this.running = false;
		},
		resume() {
			this.running = true;
		},
		connectEvents(otherId) {
			this.eventTargets[otherId] = true;
		},
		disconnectEvents(otherId) {
			if (otherId == null) {
				this.eventTargets = {};
			}
		},
		saveState() {
			// TODO: transfer ownership, to avoid allocation/GC from this
			return this.decodeCbor(this.hostApi.pluginSaveState(this.pluginPtr));
		},
		loadState(stateArray) {
			let bytes = new Uint8Array(stateArray);
			return this.hostApi.pluginLoadState(this.pluginPtr, this.sendBytes(bytes), bytes.length);
		},
		setParam(paramId, value) {
			this.hostApi.pluginSetParam(this.pluginPtr, paramId, value);

			// If we're being called here (in the AudioWorklet), then it's single-threaded, so there's no reason not to immediately flush
			this.hostApi.pluginParamsFlush(this.pluginPtr);
			
			return this.remoteMethods.getParam.call(this, paramId);
		},
		getParam(paramId) {
			return this.decodeCbor(this.hostApi.pluginGetParam(this.pluginPtr, paramId));
		},
		getParams() {
			let params = this.decodeCbor(this.hostApi.pluginGetParams(this.pluginPtr));
			params.forEach(param => {
				param.value = this.remoteMethods.getParam.call(this, param.id);
			});
			return params;
		},
		performance() {
			return {js: this.#averageJsMs, wasm: this.#averageWasmMs, block: this.#averageBlockMs};
		},
		getResource(path) {
			let bytes = new Uint8Array(path.length);
			for (let i = 0; i < path.length; ++i) bytes[i] = path.charCodeAt(i);
			return this.decodeCbor(this.hostApi.pluginGetResource(this.pluginPtr, this.sendBytes(bytes), bytes.length));
		},
		webviewOpen(isOpen, isVisible) {
			// TODO: let the `clap.gui` extension know
		}
	};

	#averageJsMs = 0;
	#averageWasmMs = 0;
	#averageBlockMs = 0;
	
	process(inputs, outputs, parameters) {
		let jsStartTime = now();
		if (this.fatalError || !this.running) return false; // outputs are pre-filled with silence

		let blockLength = (outputs[0] || inputs[0])[0].length;
		
		this.writePendingEvents();
		
		// Copy audio input
		this.instanceAudioPointers.inputs.forEach((ptrs, inputPort) => {
			let jsInput = inputs[inputPort];
			ptrs.forEach((ptr, channelIndex) => {
				let instanceArray = new Float32Array(this.instanceMemory.buffer, ptr, blockLength);
				if (jsInput && jsInput.length > 0) {
					let jsChannel = jsInput[channelIndex%jsInput.length];
					instanceArray.set(jsChannel);
				} else {
					for (let i = 0; i < blockLength; ++i) instanceArray[i] = 0;
				}
			});
		});
		
		// Actual process call
		let wasmStartTime, wasmEndTime;
		let processStatus;
		try {
			wasmStartTime = now();
			processStatus = this.hostApi.pluginProcess(this.pluginPtr, blockLength);
			if (this.instanceSingleThreaded) this.mainThreadCallback();
			wasmEndTime = now();
		} catch (e) {
			this.failWithError(e);
			return false;
		}

		// Copy audio output
		outputs.forEach((output, outputPort) => {
			let input = inputs[outputPort];
			let ptrs = this.instanceAudioPointers.outputs[outputPort];
			if (ptrs && ptrs.length) {
				// We have an output - copy from that instead
				input = ptrs.map(ptr => {
					return new Float32Array(this.instanceMemory.buffer, ptr, blockLength);
				});
			}
			if (input.length) {
				output.forEach((jsChannel, channelIndex) => {
					let inputChannel = input[channelIndex%input.length];
					jsChannel.set(inputChannel);
				});
			}
		});

		let jsEndTime = now();

		let slew = 1/cpuAveragePeriod;
		this.#averageJsMs += (jsEndTime - jsStartTime - this.#averageJsMs)*slew;
		this.#averageWasmMs += (wasmEndTime - wasmStartTime - this.#averageWasmMs)*slew;
		this.#averageBlockMs += (blockLength*1000/sampleRate - this.#averageBlockMs)*slew;

		if (processStatus == 0/*CLAP_PROCESS_ERROR*/) {
			console.error("CLAP_PROCESS_ERROR");
			return false;
		} else if (processStatus === 2/*CLAP_PROCESS_CONTINUE_IF_NOT_QUIET*/) {
			let energy = 0;
			outputs.forEach(output => {
				output.forEach(channel => {
					channel.forEach(x => energy += x*x);
				});
			});
			return (energy >= 1e-6);
		} else if (processStatus === 3/*CLAP_PROCESS_TAIL*/) {
			console.log("CLAP_PROCESS_TAIL not supported")
			return inputs.some(input => input.length);
		} else if (processStatus === 4/*CLAP_PROCESS_SLEEP*/) {
			return inputs.some(input => input.length); // continue only if there's more input
		}
		return true;
	}
}

registerProcessor('audioworkletprocessor-clap', ClapAudioWorkletProcessor);
