import {runThread} from "./wclap-js/wclap.mjs";

export function hostImports() {
	// imports for our particular host go here
	return {
		env: {
			eventsOutTryPush: (pluginPtr, ptr, length) => {
				throw Error("eventsOutTryPush");
			},
			webviewSend: (pluginPtr, ptr, length) => {
				throw Error("webviewSend");
			},
			stateMarkDirty: (pluginPtr) => {
				throw Error("stateMarkDirty");
			},
			paramsRescan: (pluginPtr, flags) => {
				throw Error("paramsRescan");
			}
		}
	};
};

export function startThreadWorker(host, threadData) {
	let name = `WCLAP instance 0x${threadData.instancePtr.toString(16)} thread #${threadData.threadId}`;
	console.log(`Starting Worker for ${name}`);
	// Load this module as a Worker
	let worker = new Worker(import.meta.url, {type: 'module', name: name});
	worker.postMessage(host.getWorkerData(threadData));
	return worker;
}

if (globalThis.DedicatedWorkerGlobalScope) {
	addEventListener('message', e => {
		runThread(e.data, hostImports(), startThreadWorker);
		console.log("WCLAP thread finished");
		close();
	});
}
