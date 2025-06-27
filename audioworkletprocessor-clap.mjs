import clapModule from "./clap-host/clap-module.mjs";

clapModule.addExtension("clap.web/1", {
	wasm: {
		ext_web_is_open: 'ip',
		ext_web_send: 'ippi'
	},
	js: {
		ext_web_is_open() {
			// never open for now
			return false;
		},
		// This is the name on the host struct, so it means the plugin has sent us a message
		ext_web_send(voidPointer, length) {
			return false;
		}
	},
	addTypes(api, methods) {
		api.clap_plugin_web = api.makeStruct(
			{get_start: api.makeFunc(api.pointer, api.pointer, api.u32)},
			{receive: api.makeFunc(api.pointer, api.pointer, api.u32)}
		);
		api.clap_host_web = api.makeStruct(
			{is_open: api.makeFunc(api.pointer)},
			{send: api.makeFunc(api.pointer, api.pointer, api.u32)}
		);
		return api.save(api.clap_host_web, {
			is_open: methods.ext_web_is_open,
			send: methods.ext_web_send
		});
	},
	readPlugin(api, pointer, pluginPtr) {
		let web = api.clap_plugin_web(pointer, pluginPtr);
		let buffer = api.tempBytes(1024);
		if (!web.get_start(buffer, 1024)) return null;
		return {
			startPage: api.fromArg(api.string, buffer),
			send: message => {
				let messageArr = new Uint8Array(message);
				let buffer = this.api.tempTyped(Uint8Array, messageArr.length);
				buffer.set(messageArr);
				web.receive(buffer, buffer.length)
			}
		};
	}
});
clapModule.addExtension("clap.webview/1", {
	wasm: {
		ext_webview_is_open: 'ip',
		ext_webview_send: 'ippi'
	},
	js: {
		ext_webview_is_open() {
			// never open for now
			return false;
		},
		// This is the name on the host struct, so it means the plugin has sent us a message
		ext_webview_send(voidPointer, length) {
			return false;
		}
	},
	addTypes(api, methods) {
		api.clap_plugin_webview = api.makeStruct(
			{provide_starting_uri: api.makeFunc(api.pointer, api.pointer, api.u32)},
			{receive: api.makeFunc(api.pointer, api.pointer, api.u32)}
		);
		api.clap_host_webview = api.makeStruct(
			{is_open: api.makeFunc(api.pointer)},
			{send: api.makeFunc(api.pointer, api.pointer, api.u32)}
		);
		return api.save(api.clap_host_webview, {
			is_open: methods.ext_webview_is_open,
			send: methods.ext_webview_send
		});
	},
	readPlugin(api, pointer, pluginPtr) {
		let webview = api.clap_plugin_webview(pointer, pluginPtr);
		let buffer = api.tempBytes(1024);
		if (!webview.provide_starting_uri(buffer, 1024)) return null;
		return {
			startPage: api.fromArg(api.string, buffer),
			send: message => {
				let messageArr = new Uint8Array(message);
				let buffer = this.api.tempTyped(Uint8Array, messageArr.length);
				buffer.set(messageArr);
				webview.receive(buffer, buffer.length)
			}
		};
	}
});

class AudioWorkletProcessorClap extends AudioWorkletProcessor {
	inputChannelCounts = [];
	outputChannelCounts = [];
	clapPlugin;
	maxFramesCount = 1024;

	constructor(options) {
		super();

		let clapOptions = options.processorOptions;
		if (!clapOptions) throw Error("no processorOptions");
		clapModule(options?.processorOptions).then(async module => {
			let pluginId = clapOptions.pluginId;
			if (!pluginId) {
				let pluginIndex = clapOptions.pluginIndex || 0;
				pluginId = module.plugins[pluginIndex].id;
			}
			
			let clapPlugin = await module.create(pluginId);
			Object.assign(clapPlugin.hostJs, this.makeHostMethods());
			this.clapPlugin = clapPlugin;
			this.clapUpdateAudioPorts();
			this.clapActivate();
			
			// initial message lists plugin descriptor and remote methods
			let webview = this.clapPlugin.ext['clap.webview/1'] || this.clapPlugin.ext['clap.web/1'];
			this.port.postMessage({
				desc: clapPlugin.api.clap_plugin_descriptor(clapPlugin.plugin.desc),
				methods: Object.keys(this.remoteMethods),
				webview: webview && {startPage: webview.startPage},
				audioPorts: {'in': this.audioPortsIn, 'out': this.audioPortsOut}
			});
		});
		
		// subsequent messages are proxied method calls
		this.port.onmessage = async event => {
			if (this.fatalError) return;
			
			let data = event.data;
			if (data instanceof ArrayBuffer) {

			
				let webview = this.clapPlugin.ext['clap.webview/1'] || this.clapPlugin.ext['clap.web/1'];
				if (webview) webview.send(data);
				return;
			}
			let [requestId, method, args] = data;

			try {
				let result = await this.remoteMethods[method].call(this, ...args);
				this.port.postMessage([requestId, null, result]);
				this.mainThreadCallbackIfNeeded();
			} catch (e) {
				this.failWithError(e);
				this.port.postMessage([requestId, e]);
			}
		};
	}

	fatalError = null;
	failWithError(e) {
		this.fatalError = e;
	}
	
	webviewIsOpen = false;
	
	streamInput = {pointer: 0, length: 0};
	streamOutput = {
		buffer: new Uint8Array(16284),
		index: 0,
		result: new Uint8Array(0),
		clear() {
			this.index = 0;
			this.result = this.buffer.subarray(0, 0);
		}
	};
	
	wantsMainThreadCallback = false;
	mainThreadCallbackIfNeeded() {
		if (!this.wantsMainThreadCallback) return;
		this.wantsMainThreadCallback = false;
		try {
			this.clapPlugin.plugin.on_main_thread();
		} catch (e) {
			this.failWithError(e);
		}
	}
	
	pendingEvents = [];
	makeHostMethods() {
		return {
			input_events_size: () => this.pendingEvents.length,
			input_events_get: i => this.pendingEvents[i],
			output_events_try_push: ptr => false,

			request_restart() {throw Error("not implemented");},
			request_process() {throw Error("not implemented");},
			request_callback: () => {
				this.wantsMainThreadCallback = true;
			},

			istream_read: (voidPointer, length) => {
				length = Number(length);
				let streamInput = this.streamInput;
				if (!streamInput) throw Error("set .clapStreamInput={pointer:..., length: ...} before passing an istream");
				let bytes = Math.min(length, streamInput.length);
				if (bytes > 0) {
					let tmpBlock = this.clapPlugin.api.asTyped(Uint8Array, streamInput.pointer, bytes);
					let readBlock = this.clapPlugin.api.asTyped(Uint8Array, voidPointer, bytes);
					readBlock.set(tmpBlock);
					streamInput.pointer += bytes;
					streamInput.length -= bytes;
				}
				return BigInt(bytes);
			},
			ostream_write: (voidPointer, length) => {
				length = Number(length);
				let streamOutput = this.streamOutput;
				let bytes = Math.min(length, streamOutput.buffer.length - streamOutput.index);
				if (bytes > 0) {
					let writeBlock = this.clapPlugin.api.asTyped(Uint8Array, voidPointer, bytes);
					let bufferBlock = streamOutput.buffer.subarray(streamOutput.index, bytes);
					bufferBlock.set(writeBlock);
					streamOutput.index += bytes;
					streamOutput.result = streamOutput.buffer.subarray(0, streamOutput.index);
				}
				if (!bytes && length > 0) return -1n; // error (we ran out of space);
				return BigInt(bytes);
			},
			
			ext_params_rescan: flags => {
				this.port.postMessage(['params_rescan', flags]);
			},
			ext_params_clear(paramId, flags) {
				console.error("clap_host_params.clear() requested but not implemented");
			},
			ext_params_request_flush() {
				console.error("clap_host_params.request_flush() requested but not implemented");
			},

			ext_webview_is_open: () => this.webviewIsOpen,
			// plugin sent to us
			ext_webview_send: (ptr, length) => {
				if (!this.webIsOpen) return false;
				let message8 = this.clapPlugin.api.asTyped(Uint8Array, ptr, length);
				let message = message8.slice().buffer;
				this.port.postMessage(message, [message]); // copy the buffer, and transfer ownership of the copy
			},
			// Older draft version, for compatibility
			ext_web_is_open: () => this.webviewIsOpen,
			// plugin sent to us
			ext_web_send: (ptr, length) => {
				if (!this.webIsOpen) return false;
				let message8 = this.clapPlugin.api.asTyped(Uint8Array, ptr, length);
				let message = message8.slice().buffer;
				this.port.postMessage(message, [message]); // copy the buffer, and transfer ownership of the copy
			},

			ext_state_mark_dirty: () => {
				this.port.postMessage(['state_mark_dirty', null]);
			}
		};
	};
	
	remoteMethods = {
		saveState() {
			let plugin = this.clapPlugin;
			let state = plugin.ext['clap.state'];
			if (!state) throw Error("plugin doesn't support clap.state");
			this.streamOutput.clear();
			if (!state.save(plugin.hostPointers.ostream)) {
				throw Error("state.save() returned false");
			}
			let stateArray = this.streamOutput.result.slice(); // TODO: transfer ownership, to avoid allocation/GC from this
			return stateArray.buffer;
		},
		loadState(stateArray) {
			stateArray = new Uint8Array(ArrayBuffer.isView(stateArray) ? stateArray.buffer : stateArray);

			let plugin = this.clapPlugin;
			let state = plugin.ext['clap.state'];
			if (!state) throw Error("plugin doesn't support clap.state");
			
			let tmpArr = plugin.api.tempTyped(Uint8Array, stateArray.length);
			tmpArr.set(stateArray);
			this.streamInput = {pointer: tmpArr.byteOffset, length: stateArray.length};
			
			if (!state.load(plugin.hostPointers.istream)) {
				throw Error("state.load() returned false");
			}
			return true;
		},
		setParam(id, value) {
			let plugin = this.clapPlugin;
			let params = plugin.ext['clap.params'];
			if (!params) throw Error("clap.params not supported");
			
			let eventPtr = plugin.api.temp(plugin.api.clap_event_param_value, {
				header: {
					size: plugin.api.sizeof(plugin.api.clap_event_param_value),
					time: 0,
					space_id: 0, // CLAP_CORE_EVENT_SPACE_ID
					type: plugin.api.CLAP_EVENT_PARAM_VALUE,
					flags: 0
				},
				param_id: id,
				cookie: 0,
				note_id: -1,
				port_index: -1,
				channel: -1,
				key: -1,
				
				value: value
			});
			this.pendingEvents = [eventPtr];
			// Single-threaded, so no reason not to immediately flush
			params.flush(plugin.hostPointers.input_events, plugin.hostPointers.output_events);
			this.pendingEvents = [];
			
			return this.remoteMethods.getParam.call(this, id);
		},
		getParam(id) {
			let plugin = this.clapPlugin;
			let params = plugin.ext['clap.params'];
			if (!params) throw Error("clap.params not supported");
			
			let valuePtr = plugin.api.tempBytes(8, 8);
			params.get_value(id, valuePtr);
			let value = plugin.api.f64(valuePtr);
		
			let textBuffer = plugin.api.temp(plugin.api.clap_name, "?");
			let text = value + "";
			if (params.value_to_text(id, value, textBuffer, plugin.api.CLAP_NAME_SIZE)) {
				text = plugin.api.clap_name(textBuffer);
			}
			return {value: value, text: text};
		},
		getParams() {
			let plugin = this.clapPlugin;
			let params = plugin.ext['clap.params'];
			if (!params) {
				console.error("clap.params not supported");
				return [];
			}

			let paramInfo = [];
			for (let i = 0; i < params.count(); ++i) {
				let infoPtr = plugin.api.temp(plugin.api.clap_param_info, {});
				params.get_info(i, infoPtr);
				let info = plugin.api.clap_param_info(infoPtr);
				let flags = {
					stepped: !!(info.flags&1),
					periodic: !!(info.flags&2),
					hidden: !!(info.flags&4),
					readonly: !!(info.flags&8),
					bypass: !!(info.flags&16),
					automatable: (info.flags&32) ? {
						note: !!(info.flags&64),
						key: !!(info.flags&128),
						channel: !!(info.flags&256),
						port: !!(info.flags&512)
					} : false,
					modulatable: (info.flags&1024) ? {
						note: !!(info.flags&2048),
						key: !!(info.flags&4096),
						channel: !!(info.flags&8192),
						port: !!(info.flags&16384)
					} : false,
					requiresProcess: !!(info.flags&32768),
					isEnum: !!(info.flags&(65536))
				};
				info.flags = flags;
				info.value = this.remoteMethods.getParam.call(this, info.id);
				paramInfo.push(info);
			}
			return paramInfo;
		},
		webviewOpen(isOpen, isShowing) {
			console.log('isShowing should go through the clap.gui extension');
			return this.webIsOpen = isOpen;
		},
		performance() {
			return {js: this.#averageJsMs, wasm: this.#averageWasmMs};
		}
	};

	clapActivate() {
		if (this.fatalError) return;
		
		let {api, plugin} = this.clapPlugin;
		if (!plugin.activate(sampleRate, 1, this.maxFramesCount)) {
			console.error("plugin.activate() failed");
			this.clapPlugin.unbind(); // disconnects and cleans up
			this.clapPlugin = null;
		}
		if (!plugin.start_processing()) {
			plugin.deactivate();
			console.error("plugin.start_processing() failed");
			this.clapPlugin.unbind(); // disconnects and cleans up
			this.clapPlugin = null;
		}
	}
	
	clapUpdateAudioPorts() {
		if (this.fatalError) return;

		let {api, plugin} = this.clapPlugin;
		this.audioPortsIn = [];
		this.audioPortsOut = [];
		let audioPortsExt = this.clapPlugin.ext['clap.audio-ports'];
		if (audioPortsExt) {
			for (let isInput = 0; isInput < 2; ++isInput) {
				let list = (isInput ? this.audioPortsOut : this.audioPortsIn);
				let count = audioPortsExt.count(isInput);
				for (let i = 0; i < count; ++i) {
					let portPtr = api.temp(api.clap_audio_port_info, {});
					audioPortsExt.get(i, isInput, portPtr);
					let port = api.clap_audio_port_info(portPtr);
					list.push(port);
				}
			}
		}
	}
	
	#averageJsMs = 0;
	#averageWasmMs = 0;
	
	process(inputs, outputs, parameters) {
		if (this.fatalError) return false;
		let jsStartTime = Date.now();
		if (!this.clapPlugin) return true; // outputs are pre-filled with silence
		let {api, plugin} = this.clapPlugin;

		let blockLength = (outputs[0] || inputs[0])[0].length;

		/*
		if (inputs.length != this.audioPortsIn.length) {
			throw Error("input audio-port mismatch");
		}
		if (outputs.length != this.audioPortsOut.length) {
			throw Error("output audio-port mismatch");
		}
		*/

		let audioBuffersInput = this.audioPortsIn.map((audioPortIn, portIndex) => {
			let input = inputs[portIndex];
			
			// Sometimes if an input is stopped (or we're missing a port!), it gives us 0 input channels, so we have to make up our own
			if (!input?.length) {
				input = [];
				// use some host space to make a fake buffer without allocating
				let fakeInput = api.tempTyped(Float32Array, blockLength);
				fakeInput.fill(0);
				for (let i = 0; i < audioPortIn.channel_count; ++i) {
					input.push(fakeInput);
				}
			}
			
			// Use host memory for audio buffers
			let inputBufferPointers = api.tempTyped(api.pointer, audioPortIn.channel_count);
			let inputBufferBlock = api.tempTyped(Float32Array, blockLength*audioPortIn.channel_count);
			for (let index = 0; index < audioPortIn.channel_count; ++index) {
				let channel = input[index%input.length];
				let bufferPtr = inputBufferBlock.byteOffset + blockLength*index*4;
				inputBufferPointers[index] = bufferPtr;

				let array = inputBufferBlock.subarray(blockLength*index, blockLength*(index + 1));
				array.set(channel);
			}
			
			return {
				data32: inputBufferPointers,
				data64: 0,
				channel_count: audioPortIn.channel_count,
				latency: 0,
				constant_mask: 0n // BigInt
			};
		});

		let allOutputPointers = [];
		let audioBuffersOutput = this.audioPortsOut.map((audioPortOut, portIndex) => {
			let outputBufferPointers = api.tempTyped(api.pointer, audioPortOut.channel_count);
			let outputBufferBlock = api.tempTyped(Float32Array, blockLength*audioPortOut.channel_count);
			outputBufferBlock.fill(0.2); // not terrible, but deliberately not correct (for debugging)
			for (let index = 0; index < audioPortOut.channel_count; ++index) {
				let bufferPtr = outputBufferBlock.byteOffset + blockLength*index*4;
				outputBufferPointers[index] = bufferPtr;
				outputBufferBlock[index*blockLength] = 0.1; // bzzzzz
			}
			allOutputPointers.push(outputBufferPointers.slice(0));
			
			return {
				data32: outputBufferPointers,
				data64: 0,
				channel_count: audioPortOut.channel_count,
				latency: 0,
				constant_mask: 0n // BigInt
			};
		});

		// This writes them contiguously, so the first pointer can act as an array
		let audioInputPtrs = audioBuffersInput.map(b => api.temp(api.clap_audio_buffer, b));
		let audioOutputPtr = audioBuffersOutput.map(b => api.temp(api.clap_audio_buffer, b));
		
		// Write the audio buffers to the temporary scratch space
		let processPtr = api.temp(api.clap_process, {
			steady_time: -1n,
			frames_count: blockLength,
			transport: 0, //null
			audio_inputs: audioInputPtrs[0],
			audio_outputs: audioOutputPtr[0],
			audio_inputs_count: this.audioPortsIn.length,
			audio_outputs_count: this.audioPortsOut.length,
			in_events: this.clapPlugin.hostPointers.input_events,
			out_events: this.clapPlugin.hostPointers.output_events
		});
		
		let wasmStartTime, wasmEndTime;
		let status;
		try {
			wasmStartTime = Date.now();
			status = plugin.process(processPtr);
			this.mainThreadCallbackIfNeeded();
			wasmEndTime = Date.now();
		} catch (e) {
			this.failWithError(e);
			return false;
		}
		if (status == api.CLAP_PROCESS_ERROR) {
			console.error("CLAP_PROCESS_ERROR");
			return false;
		}
		
		// Read audio buffers out again
		outputs.forEach((output, portIndex) => {
			let audioPort = this.audioPortsOut[portIndex];
			if (!audioPort) return;
			let outputPointers = allOutputPointers[portIndex];
			output.forEach((channel, index) => {
				index = index%audioPort.channel_count;
				let array = api.asTyped(Float32Array, outputPointers[index], blockLength);
				channel.set(array);
			});
		});

		let jsEndTime = Date.now();
		this.#averageJsMs += (jsEndTime - jsStartTime - this.#averageJsMs)*0.01;
		this.#averageWasmMs += (wasmEndTime - wasmStartTime - this.#averageWasmMs)*0.01;

		if (status === api.CLAP_PROCESS_SLEEP) {
			return inputs.some(input => input.length); // continue only if there's more input
		}
		if (status === api.CLAP_PROCESS_TAIL) {
			console.log("CLAP_PROCESS_TAIL not supported")
			return inputs.some(input => input.length);
		}
		if (status === api.CLAP_PROCESS_CONTINUE_IF_NOT_QUIET) {
			let energy = 0;
			outputs.forEach(output => {
				output.forEach(channel => {
					channel.forEach(x => energy += x*x);
				});
			});
			return (energy >= 1e-6);
		}
		return true;
	}
}

registerProcessor('audioworkletprocessor-clap', AudioWorkletProcessorClap);
