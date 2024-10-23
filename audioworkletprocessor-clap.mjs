import clapModule from "./clap-host/clap-module.mjs";

class AudioWorkletProcessorClap extends AudioWorkletProcessor {
	inputChannelCounts = [];
	outputChannelCounts = [];
	clapPlugin;
	maxFramesCount = 1024;

	constructor(options) {
		super();

		let inputChannelCounts = [], outputChannelCounts = [];
		let channelCount = options.outputChannelCount || 2;
		for (let i = 0; i < options.numberOfInputs; ++i) {
			inputChannelCounts.push(channelCount);
		}
		for (let i = 0; i < options.numberOfOutputs; ++i) {
			outputChannelCounts.push(channelCount);
		}
		this.inputChannelCounts = inputChannelCounts;
		this.outputChannelCounts = outputChannelCounts;

		let clapOptions = options.processorOptions;
		if (!clapOptions) throw Error("no processorOptions");
		clapModule(options?.processorOptions).then(async module => {
			let pluginId = clapOptions.pluginId;
			if (!pluginId) {
				let pluginIndex = clapOptions.pluginIndex || 0;
				pluginId = module.plugins[pluginIndex].id;
			}
			
			let clapPlugin = await module.create(pluginId);
			this.clapPlugin = clapPlugin;
			this.clapActivate();
			
			// initial message lists plugin descriptor and remote methods
			this.port.postMessage({
				desc: clapPlugin.api.clap_plugin_descriptor(clapPlugin.plugin.desc),
				methods: Object.keys(this.remoteMethods)
			});
		});
		
		// subsequent messages are proxied method calls
		this.port.onmessage = async event => {
			let [requestId, method, args] = event.data;

			try {
				let result = await this.remoteMethods[method].call(this, ...args);
				this.port.postMessage([requestId, null, result]);
			} catch (e) {
				this.port.postMessage([requestId, e]);
			}
		};
	}
	
	remoteMethods = {
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
			plugin.eventsIn.list = [eventPtr];
			// Single-threaded, so no reason not to immediately flush
			params.flush(plugin.eventsIn.pointer, plugin.eventsOut.pointer);
			plugin.eventsIn.list = [];
			
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
			if (!params) throw Error("clap.params not supported");

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
		}
	};

	clapActivate() {
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
	
	previousInputChannels = 0;
	process(inputs, outputs, parameters) {
		if (!this.clapPlugin) return; // outputs are pre-filled with silence
		let {api, plugin} = this.clapPlugin;

		let input = inputs[0], output = outputs[0];
		let blockLength = (outputs[0] || inputs[0])[0].length;
		
		// Sometimes if the input is stopped, it gives us 0 input channels, so we have to make up our own
		if (!input.length) {
			// use some host space to make a fake buffer without allocating
			let fakeInput = api.tempTyped(Float32Array, blockLength);
			fakeInput.fill(0);
			for (let i = 0; i < this.previousInputChannels; ++i) {
				input.push(fakeInput);
			}
		}
		this.previousInputChannels = input.length;
		
		// Use host memory for audio buffers
		let inputBufferPointers = api.tempTyped(api.pointer, input.length);
		let inputBufferBlock = api.tempTyped(Float32Array, blockLength*input.length);
		input.forEach((channel, index) => {
			let bufferPtr = inputBufferBlock.byteOffset + blockLength*index*4;
			inputBufferPointers[index] = bufferPtr;

			let array = inputBufferBlock.subarray(blockLength*index, blockLength*(index + 1));
			array.set(channel);
		});

		let outputBufferPointers = api.tempTyped(api.pointer, output.length);
		let outputBufferBlock = api.tempTyped(Float32Array, blockLength*output.length);
		outputBufferBlock.fill(0.2); // not terrible, but deliberately not correct (for debugging)
		output.forEach((channel, index) => {
			let bufferPtr = outputBufferBlock.byteOffset + blockLength*index*4;
			outputBufferPointers[index] = bufferPtr;
			outputBufferBlock[index*blockLength] = 0.1; // bzzzzz
		});

		let audioInputPtr = api.temp(api.clap_audio_buffer, {
			data32: inputBufferPointers,
			data64: 0,
			channel_count: input.length,
			latency: 0,
			constant_mask: 0n // BigInt
		});
		let audioOutputPtr = api.temp(api.clap_audio_buffer, {
			data32: outputBufferPointers,
			data64: 0,
			channel_count: output.length,
			latency: 0,
			constant_mask: 0n // BigInt
		});
		
		// Write the audio buffers to the temporary scratch space
		let processPtr = api.temp(api.clap_process, {
			steady_time: -1n,
			frames_count: blockLength,
			transport: 0, //null
			audio_inputs: audioInputPtr,
			audio_outputs: audioOutputPtr,
			audio_inputs_count: 1,
			audio_outputs_count: 1,
			in_events: this.clapPlugin.eventsIn.pointer,
			out_events: this.clapPlugin.eventsOut.pointer
		});
		
		plugin.process(processPtr);
		
		// Read audio buffers out again
		output.forEach((channel, index) => {
			let array = outputBufferBlock.subarray(blockLength*index, blockLength*(index + 1));
			channel.set(array);
		});

		return true;
	}
}

registerProcessor('audioworkletprocessor-clap', AudioWorkletProcessorClap);
