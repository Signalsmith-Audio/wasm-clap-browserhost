export default function generateForwardingModuleWasm(methodSignatures) {
	let typeCodes = {
		b: 0x7F, // bool (32-bit in wasm32)
		p: 0x7F, // pointer
		s: 0x7F, // size
		i: 0x7F, // i32
		I: 0x7E, // i64
		f: 0x7D, // f32
		F: 0x7C // f64
	};
	function encodeUint(arr, v) {
		while (v >= 0x80) {
			arr.push(0x80 | (v&0x7F));
			v >>= 7;
		}
		arr.push(v);
		return arr;
	}
	function encodeName(arr, str) {
		encodeUint(arr, str.length);
		for (let i = 0; i < str.length; ++i) {
			arr.push(str.charCodeAt(i)%0x7F);
		}
	}
	let typeCount = 0;
	let typeWasm = [], importWasm = [], exportWasm = [];
	let typeMap = {};
	let methodNames = Object.keys(methodSignatures);
	methodNames.forEach((key, fIndex) => {
		let sig = methodSignatures[key]; // code using the four basic types
		let typeIndex;
		if (sig in typeMap) {
			// reuse existing type
			typeIndex = methodSignatures[key] = typeMap[sig];
		} else {
			// Add an entry to the type section
			typeIndex = typeMap[sig] = typeCount++;
			typeWasm.push(0x60); // function type
			encodeUint(typeWasm, sig.length - 1); // argument count
			for (let i = 1; i < sig.length; ++i) {
				typeWasm.push(typeCodes[sig[i]]);
			}
			if (sig[0] == 'v') {
				typeWasm.push(0); // no result (void)
			} else {
				typeWasm.push(0x01);
				typeWasm.push(typeCodes[sig[0]]);
			}
		}
		encodeName(importWasm, "proxy");
		encodeName(importWasm, key);
		importWasm.push(0x00); // function import
		encodeUint(importWasm, typeIndex); // type index
		
		encodeName(exportWasm, key);
		exportWasm.push(0x00); // function export
		encodeUint(exportWasm, fIndex);
	});

	// Each section starts with the number of entries
	typeWasm = encodeUint([], typeCount).concat(typeWasm);
	let methodCount = encodeUint([], methodNames.length);
	importWasm = methodCount.concat(importWasm);
	exportWasm = methodCount.concat(exportWasm);

	return new Uint8Array([
		0x00, 0x61, 0x73, 0x6D, // magic: \0asm
		0x01, 0x00, 0x00, 0x00, // v1
		
		0x01, // type section
		encodeUint([], typeWasm.length),
		typeWasm,
		
		0x02, // import section
		encodeUint([], importWasm.length),
		importWasm,
		
		0x07, // export section
		encodeUint([], exportWasm.length),
		exportWasm
	].flat());
};
