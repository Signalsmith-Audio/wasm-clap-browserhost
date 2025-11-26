import expandTarGz from "./targz.mjs"

function fnv1aHex(string) {
	let fnv1a32 = 0x811c9dc5;
	for (let i = 0; i < string.length; ++i) {
		let byte = string.charCodeAt(i);
		fnv1a32 = ((fnv1a32^byte)*0x1000193)|0;
	}
	return [24, 16, 8, 0].map(s => ((fnv1a32>>s)&0xFF).toString(16).padStart(2, "0")).join("");
}

class WclapConfig {
	pluginPath;
	memory;
	module;
	files;

	constructor(obj) {
		Object.assign(this, obj);
		if (!this.memory) {
			// Assume that imported memory is shared, with maximum possible size
			// There's unfortunately no (sensible) way to get this info from JS
			WebAssembly.Module.imports(this.module).forEach(entry => {
				if (entry.kind == 'memory') {
					this.memory = new WebAssembly.Memory({initial: 8, maximum: 32768, shared: true});
				}
			});
		}
	}
};

export default async function createWclap(options) {
	if (typeof options === 'string') options = {url: options};
	if (!options.files) options.files = {};
	if (options.module) return new WclapConfig(options);

	if (options.pluginPath) options.pluginPath = "/plugin/" + fnv1aHex(url);
	let wasmPath = `${options.pluginPath}/module.wasm`;
	let response = await fetch(options.url);
	if (response.headers.get("Content-Type") == "application/wasm") {
		options.module = await WebAssembly.compileStreaming(response);
		options.files = {
			[wasmPath]: new ArrayBuffer(0)
		};
		return new WclapConfig(options);
	}

	// If it's not WASM, assume it's a `.tar.gz`
	let tarFiles = await expandTarGz(response);
	for (let path in tarFiles) {
		options.files[`${options.pluginPath}/${path}`] = tarFiles[path];
	}
	if (!options.files[wasmPath]) {
		// Find first `module.wasm` in the bundle (in case it's not top-level)
		for (let path in tarFiles) {
			if (/\/module.wasm$/.test(key)) {
				console.error(`WCLAP bundle has WASM at ${path} instead of /module.wasm`);
				wasmPath = `${options.pluginPath}/${path}`;
				break;
			}
		}
	}
	if (!options.files[wasmPath]) {
		throw Error("No `module.wasm` found in WCLAP bundle");
	}

	options.module = await WebAssembly.compile(options.files[wasmPath]);
	return new WclapConfig(options);
}
