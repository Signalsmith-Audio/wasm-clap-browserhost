let moduleAdded = Symbol();

export default async function createClapNode(audioContext, options) {
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

	return new Promise(resolve => {
		effectNode.port.onmessage = e => {
			let {desc, methods} = e.data;
			effectNode.descriptor = desc;
			methods.forEach(addRemoteMethod);

			effectNode.port.onmessage = e => {
				let data = e.data;
				let response = responseMap[data[0]];
				if (data[1]) {
					response.m_fail(data[1]);
				} else {
					response.m_pass(data[2]);
				}
			};

			resolve(effectNode);
		};
	});
}
