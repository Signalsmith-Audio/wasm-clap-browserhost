import wasi_snapshot_preview1 from "./wasi/wasi_snapshot_preview1.mjs";

// Later, we can inspect the imports to see if needs WASI, expects a memory import etc.
export default async function instantiate(options) {
	let url = options.url;
	if (!url) throw Error("missing `url` option");
	let instance = options.instance;
	if (!instance) {
		let module = options.module;
		if (!module) {
			module = WebAssembly.compileStreaming(fetch(url));
		}

		let imports = options.imports || {};
		if (!imports.wasi_snapshot_preview1) {
			imports.wasi_snapshot_preview1 = wasi_snapshot_preview1();
		}

		instance = await WebAssembly.instantiate(await module, imports);
		// this seems to be the convention
		imports.wasi_snapshot_preview1.instance = instance;
		
		// WASI entry points for standalone / dynamic
		instance.exports._start?.();
		instance.exports._initialize?.();
	}
	return instance;
}
