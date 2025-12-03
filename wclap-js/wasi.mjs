/* Loads a C++ WASI implementation.

Each Wasi object (obtained with `createWasi()`) can only be used to provide imports for a single other module.  Once it's been created, it needs to be bound to that module's memory using `bindToOtherMemory()`.

However, you can use the same WASI context for multiple other instances, by creating copies with `copyForRebinding()` (on the same thread), or `initObj()` when passing to a Worker/Worklet (which then gets passed to `createWasi()`.

If the browser is not cross-origin isolated, `initObj()` will pass the WebAssembly module across (to avoid re-fetching) but the WASI contexts will not be shared.
*/

function fillWasiFromInstance(instance, wasiImports) {
	// Collect WASI methods by matching `{group}__{method}` exports
	for (let name in instance.exports) {
		if (/^wasi32_/.test(name) && typeof instance.exports[name] == 'function') {
			let parts = name.split('__');
			if (parts.length == 2) {
				// Forward to the instance
				let groupName = parts[0].replace(/^wasi32_/, 'wasi_');
				let group = wasiImports[groupName];
				if (!group) group = wasiImports[groupName] = {};
				group[parts[1]] = instance.exports[name];
			}
		}
	}
}

// Similar to above, but with an extra layer of indirection so we can do it before it's instantiated
function fillWasiFromModuleExports(module, wasiImports) {
	let instance = {exports:{}};
	
	// Collect WASI methods by matching `{group}__{method}`
	WebAssembly.Module.exports(module).forEach(item => {
		let name = item.name;
		if (/^wasi32_/.test(name) && item.kind == 'function') {
			let parts = name.split('__');
			if (parts.length == 2) {
				instance.exports[name] = (...args) => {
					console.error(`WASI: ${name} called before instance ready`, args);
					return -1; // usually an error code
				};

				// Forward to the instance
				let groupName = parts[0].replace(/^wasi32_/, 'wasi_');
				let group = wasiImports[groupName];
				if (!group) group = wasiImports[groupName] = {};
				group[parts[1]] = (...args) => instance.exports[name](...args);
			}
		}
	});
	return function setWasiInstance(v) {
		instance = v;
	};
}

class Wasi {
	// This config is a plain object with {module, ?memory}
	// The memory is only populated if it's sharable across threads *and* has already been initialised
	#config;
	#memory;
	#otherModuleMemory;
	
	importObj = {};

	constructor(config, singleThreadMemory) {

		this.#config = config;
		this.#memory = config.memory || singleThreadMemory;

		let needsInit = false;
		if (!this.#memory) {
			needsInit = true;
			this.#memory = new WebAssembly.Memory({initial: 8, maximum: 32768, shared: true});
			if (globalThis.crossOriginIsolated) config.memory = this.#memory;
		}
		
		// String as SHA256 pseudo-random source when we don't have `crypto`
		// We don't really care about performance here
		let seedString = config.seedString + Math.random();
		let shaCounter = 0;
		
		let wasiImplImports = {
			wasi: {
				'thread-spawn': threadArg => {throw Error("WASI can't spawn threads")}
			},
			env: {
				memory: this.#memory,
				memcpyToOther32: (otherP, wasiP, size) => {
					let otherA = new Uint8Array(this.#otherModuleMemory.buffer).subarray(otherP, otherP + size);
					let wasiA = new Uint8Array(this.#memory.buffer).subarray(wasiP, wasiP + size);
					otherA.set(wasiA);
				},
				memcpyFromOther32: (wasiP, otherP, size) => {
					let wasiA = new Uint8Array(this.#memory.buffer).subarray(wasiP, wasiP + size);
					let otherA = new Uint8Array(this.#otherModuleMemory.buffer).subarray(otherP, otherP + size);
					wasiA.set(otherA);
				},
				procExit() {
					debugger;
					throw new Error("Fatal error - but fully stopping is not supported");
				},
				consoleLog: (wasiP, size) => {
					let bytes = new Uint8Array(this.#memory.buffer).subarray(wasiP, wasiP + size);
					let string = "";
					for (let i = 0; i < size; ++i) string += String.fromCharCode(bytes[i]);
					console.log(string);
				},
				consoleError: (wasiP, size) => {
					let bytes = new Uint8Array(this.#memory.buffer).subarray(wasiP, wasiP + size);
					let string = "";
					for (let i = 0; i < size; ++i) string += String.fromCharCode(bytes[i]);
					console.error(string);
				},
				getRandom64() {
					if (typeof crypto == 'object') {
						return crypto.getRandomBytes(new BigUint64Array(1))[0];
					}
					let v64 = 0n;
					sha256(++shaCounter + seedString).forEach(v32 => {
						v64 = v64*256n + BigInt(v32&0xFF);
					});
					return v64;
				}
			}
		};
		// Yes, we recursively pass its own WASI implementation back in, indirectly
		let setWasiInstance = fillWasiFromModuleExports(config.module, wasiImplImports);

		this.ready = (async _ => {
			let instance = await WebAssembly.instantiate(this.#config.module, wasiImplImports);
			if (needsInit) instance.exports._initialize();
			setWasiInstance(instance);
			fillWasiFromInstance(instance, this.importObj);
			return this;
		})();
	}
	
	initObj() {
		let result = Object.assign({}, this.#config);
		return result;
	}
	
	bindToOtherMemory(memory) {
		this.#otherModuleMemory = memory;
	}

	// Makes another instance, using the same memory (even if it's on the same thread)
	async copyForRebinding() {
		return new Wasi(this.#config, this.#memory).ready;
	}
}

// SHA256 used for pseudo-random values if `crypto` isn't available
// Used because I had it lying around, and it minifies well
function sha256(ascii) {
	function rightRotate(value, amount) {
		return (value>>>amount) | (value<<(32 - amount));
	};
	
	var mathPow = Math.pow;
	var maxWord = mathPow(2, 32);
	var lengthProperty = 'length';
	var i, j; // Used as a counter across the whole file
	var result = '';

	var words = [];
	var asciiBitLength = ascii[lengthProperty]*8;
	
	// Initial hash value: first 32 bits of the fractional parts of the square roots of the first 8 primes
	// (we actually calculate the first 64, but extra values are just ignored)
	var hash = sha256.h = sha256.h || [];
	// Round constants: first 32 bits of the fractional parts of the cube roots of the first 64 primes
	var k = sha256.k = sha256.k || [];
	var primeCounter = k[lengthProperty];

	var isComposite = {};
	for (var candidate = 2; primeCounter < 64; candidate++) {
		if (!isComposite[candidate]) {
			for (i = 0; i < 313; i += candidate) {
				isComposite[i] = candidate;
			}
			hash[primeCounter] = (mathPow(candidate, .5)*maxWord)|0;
			k[primeCounter++] = (mathPow(candidate, 1/3)*maxWord)|0;
		}
	}
	
	ascii += '\x80'; // Append '1' bit (plus zero padding)
	while (ascii[lengthProperty]%64 - 56) ascii += '\x00'; // More zero padding
	for (i = 0; i < ascii[lengthProperty]; i++) {
		j = ascii.charCodeAt(i);
		if (j>>8) return; // ASCII check: only accept characters in range 0-255
		words[i>>2] |= j << ((3 - i)%4)*8;
	}
	words[words[lengthProperty]] = ((asciiBitLength/maxWord)|0);
	words[words[lengthProperty]] = (asciiBitLength)
	
	// process each chunk
	for (j = 0; j < words[lengthProperty];) {
		var w = words.slice(j, j += 16); // The message is expanded into 64 words as part of the iteration
		var oldHash = hash;
		// This is now the "working hash", often labelled as variables a...g
		// (we have to truncate as well, otherwise extra entries at the end accumulate
		hash = hash.slice(0, 8);
		
		for (i = 0; i < 64; i++) {
			var i2 = i + j;
			// Expand the message into 64 words
			// Used below if 
			var w15 = w[i - 15], w2 = w[i - 2];

			// Iterate
			var a = hash[0], e = hash[4];
			var temp1 = hash[7]
				+ (rightRotate(e, 6) ^ rightRotate(e, 11) ^ rightRotate(e, 25)) // S1
				+ ((e&hash[5])^((~e)&hash[6])) // ch
				+ k[i]
				// Expand the message schedule if needed
				+ (w[i] = (i < 16) ? w[i] : (
						w[i - 16]
						+ (rightRotate(w15, 7) ^ rightRotate(w15, 18) ^ (w15>>>3)) // s0
						+ w[i - 7]
						+ (rightRotate(w2, 17) ^ rightRotate(w2, 19) ^ (w2>>>10)) // s1
					)|0
				);
			// This is only used once, so *could* be moved below, but it only saves 4 bytes and makes things unreadble
			var temp2 = (rightRotate(a, 2) ^ rightRotate(a, 13) ^ rightRotate(a, 22)) // S0
				+ ((a&hash[1])^(a&hash[2])^(hash[1]&hash[2])); // maj
			
			hash = [(temp1 + temp2)|0].concat(hash); // We don't bother trimming off the extra ones, they're harmless as long as we're truncating when we do the slice()
			hash[4] = (hash[4] + temp1)|0;
		}
		
		for (i = 0; i < 8; i++) {
			hash[i] = (hash[i] + oldHash[i])|0;
		}
	}
	return hash.slice(0, 8);
};


let wasiModulePromise;

export async function getWasi(initObj) {
	if (initObj?.module) return initObj;

	if (!wasiModulePromise) {
		let wasmUrl = new URL("./wasi.wasm", import.meta.url).href;
		wasiModulePromise = WebAssembly.compileStreaming(fetch(wasmUrl));
	}
	// Contexts which have `fetch()` almost certainly have `crypto`, but use a fallback anyway
	let seed = "seed" + Math.random();
	if (typeof crypto === 'object') {
		seed = Array.from(crypto.getRandomValues(new BigUint64Array(4))).join(',');
	}
	return {module: await wasiModulePromise, seedString: seed};
}

export async function startWasi(initObj) {
	if (!initObj.module) initObj = getWasi(initObj);
	return new Wasi(initObj).ready;
}
