export default function hostImports() {
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
