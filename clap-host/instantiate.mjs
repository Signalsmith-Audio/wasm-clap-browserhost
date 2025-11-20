import wasi from "./wasi/wasi.mjs";

export default async function instantiate(options, spawnThread, skipInit) {
	let url = options.url;
	if (!url) throw Error("missing `url` option");
	let instance = options.instance;
	if (!instance) {
		let module = options.module;
		if (!module) throw Error("missing `module` data");

		let imports = options.imports = options.imports || {};
		WebAssembly.Module.imports(module.module).forEach(entry => {
			if (entry.kind == 'memory') {
				if (!imports[entry.module]) imports[entry.module] = Object.create(null);
				if (imports[entry.module][entry.name]) return;

				let memory = new WebAssembly.Memory({initial: 8, maximum: 32768, shared: true});
				imports[entry.module][entry.name] = memory;
			}
		});
		// These imports *don't* get passed to new threads, but recreated instead
		imports = Object.assign({}, imports);
		if (!imports.wasi_snapshot_preview1) {
			imports.wasi_snapshot_preview1 = wasi.wasi_snapshot_preview1([], {}, null, imports.env?.memory);
		}
		if (!imports.wasi) {
			if (imports.env?.memory && spawnThread) {
				imports.wasi = wasi.wasi_threads((threadId, ptr) => spawnThread(options, threadId, ptr));
			} else {
				imports.wasi = wasi.wasi_threads(null);
			}
		}

		instance = await WebAssembly.instantiate(await module.module, imports);
		// this seems to be the convention
		imports.wasi_snapshot_preview1.instance = instance;
		
		// WASI entry points for standalone / dynamic
		if (!skipInit) {
			instance.exports._start?.();
			instance.exports._initialize?.();
		}

		return {instance, imports};
	}
}
