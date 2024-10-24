let moduleAdded = Symbol();

export default async function createClapNode(audioContext, options) {
	let url = new URL(options.processorOptions?.url, location.href);
	if (!audioContext[moduleAdded]) {
		await audioContext.audioWorklet.addModule('./audioworkletprocessor-clap.mjs');
	}
	audioContext[moduleAdded] = true;

	let effectNode = new AudioWorkletNode(audioContext, 'audioworkletprocessor-clap', options);
	
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
				effectNode.openInterface = () => {
					iframe = document.createElement('iframe');
					window.addEventListener('message', messageHandler);
					iframe.src = new URL(web.startPage, url);
					effectNode.webOpen(true);
					return iframe;
				};
				effectNode.closeInterface = () => {
					effectNode.webOpen(false);
					if (iframe) window.removeEventListener('message', messageHandler);
					iframe = null;
				}
			}

			resolve(effectNode);
		};
	});
}
