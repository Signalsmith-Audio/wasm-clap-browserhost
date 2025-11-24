let fs = require('fs');

let wclap = require('./wclap32.json');
let pointerInt = 'uint32';
let pointerBytes = wclap.pointerBytes;

let js = `const WCLAP32 = (mem, functionTable, scratchArena) => {
function read(addr) {
	return this.readWith(addr, new DataView(mem.buffer));
}
function write(addr, value) {
	return this.writeWith(addr, value, new DataView(mem.buffer));
}

let api = {
	// Typed pointer
	pointer: type => ({
		fromUntyped: pointer => ({
			pointer: pointer,
			valueOf() {
				return this.pointer;
			},
			getAs(otherType, index) {
				if (typeof otherType == 'string') otherType = api[otherType];
				let itemPointer = this.pointer + (index || 0)*otherType.size;
				return otherType.read(itemPointer);
			},
			get(index) {
				let itemPointer = this.pointer + (index || 0)*type.size;
				return type.read(itemPointer);
			},
			set(value, index) {
				let itemPointer = this.pointer + (index || 0)*type.size;
				return type.write(itemPointer, value);
			}
		}),
		read: read,
		readWith(addr, dataView) {
			return this.fromUntyped(api.${pointerInt}.readWith(addr, dataView));
		},
		write: write,
		writeWith(addr, ptr, dataView) {
			if (ptr == null) ptr = 0;
			if (typeof ptr.pointer == 'number') ptr = ptr.pointer;
			if (typeof ptr != 'number') throw Error("invalid pointer value");
			api.${pointerInt}.writeWith(addr, ptr, dataView);
		},
		size: ${pointerBytes},
		align: ${pointerBytes}
	}),
	// Fixed-length arrays
	array: (type, length) => ({
		read: read,
		readWith(addr, dataView) {
			let result = [];
			for (let i = 0; i < length; ++i) {
				result.push(type.readWith(addr + i*type.size, dataView));
			}
			return result;
		},
		write: write,
		writeWith(addr, list, dataView) {
			for (let i = 0; i < length; ++i) {
				type.writeWith(addr + i*type.size, list[i], dataView);
			}
		},
		size: type.size*length,
		align: type.align
	}),
	// Functions
	method: (retType, ...argTypes) => ({
		read: read,
		readWith(addr, dataView) {
			let fnIndex = api.${pointerInt}.readWith(addr, dataView);
			let fn = functionTable.get(fnIndex);
			return (...args) => {
				let result = scratchArena.scoped(_ => {
					args = args.map(arg => {
						if (arg === null) arg = 0;
						if (typeof arg == 'boolean') return +arg;
						if (typeof arg?.pointer == 'number') return arg.pointer;
						if (typeof arg == 'number') return arg;
						if (typeof arg == 'string') return scratchArena.writeString(arg);
						console.error(typeof arg, arg);
						throw Error("all WASM arguments need to be number/bool/pointer");
					});
					return fn(...args);
				});
				if (retType?.fromUntyped) {
					return retType.fromUntyped(result);
				}
				return result;
			};
		},
		write: write,
		writeWith(addr, jsFn) {
			throw Error("writing methods not implemented");
		},
		size: ${pointerBytes},
		align: ${pointerBytes}
	}),
	// Numeric types
	float: {
		readWith: (addr, dataView) => dataView.getFloat32(addr, true),
		writeWith: (addr, value, dataView) => dataView.setFloat32(addr, value, true),
		size: 4,
		align: 4
	},
	double: {
		readWith: (addr, dataView) => dataView.getFloat64(addr, true),
		writeWith: (addr, value, dataView) => dataView.setFloat64(addr, value, true),
		size: 8,
		align: 8
	},
	int8: {
		readWith: (addr, dataView) => dataView.getInt8(addr),
		writeWith: (addr, value, dataView) => dataView.setInt8(addr, value),
		size: 1,
		align: 1
	},
	uint8: {
		readWith: (addr, dataView) => dataView.getUint8(addr),
		writeWith: (addr, value, dataView) => dataView.setUint8(addr, value),
		size: 1,
		align: 1
	},
	int16: {
		readWith: (addr, dataView) => dataView.getInt16(addr, true),
		writeWith: (addr, value, dataView) => dataView.setInt16(addr, value, true),
		size: 2,
		align: 2
	},
	uint16: {
		readWith: (addr, dataView) => dataView.getUint16(addr, true),
		writeWith: (addr, value, dataView) => dataView.setUint16(addr, value, true),
		size: 2,
		align: 2
	},
	int32: {
		readWith: (addr, dataView) => dataView.getInt32(addr, true),
		writeWith: (addr, value, dataView) => dataView.setInt32(addr, value, true),
		size: 4,
		align: 4
	},
	uint32: {
		readWith: (addr, dataView) => dataView.getUint32(addr, true),
		writeWith: (addr, value, dataView) => dataView.setUint32(addr, value, true),
		size: 4,
		align: 4
	},
	int64: {
		readWith: (addr, dataView) => dataView.getBigInt64(addr, true),
		writeWith: (addr, value, dataView) => dataView.setBigInt64(addr, value, true),
		size: 8,
		align: 8
	},
	uint64: {
		readWith: (addr, dataView) => dataView.getBigUint64(addr, true),
		writeWith: (addr, value, dataView) => dataView.setBigUint64(addr, value, true),
		size: 8,
		align: 8
	},
	// CLAP types
`;
for (let key in wclap.constants) {
	js += `\t${key}: ${JSON.stringify(wclap.constants[key])},\n`;
}
for (let key in wclap.strings) {
	js += `\t${key}: ${JSON.stringify(wclap.strings[key])},\n`;
}
for (let name in wclap.types) {
	let type = wclap.types[name];
	if (type.type != 'struct') continue;
	
	function codeType(field) {
		if (field.type == 'void') {
			return 'null';
		} else if (field.type == '*') {
			return `api.pointer(${codeType(field.to)})`;
		} else if (field.type == '[]') {
			return `api.array(${codeType(field.item)}, ${field.count})`;
		} else if (field.type == '()') {
			let args = [codeType(field.result), ...field.args.map(codeType)];
			return `api.method(${args.join(',')})`;
		}
		let fieldType = wclap.types[field.type];
		if (!fieldType) {
			return `/*Unknown field type: ${field.type}*/`;
		}
		return `api.${field.type}`;
	}
	function toRead(field) {
		let fieldAddr = field.offset ? `addr + ${field.offset}` : "addr";
		return `${field.name}: ${codeType(field)}.readWith(${fieldAddr}, dataView)`;
	};
	function toWrite(field) {
		let fieldAddr = field.offset ? `addr + ${field.offset}` : "addr";
		return `${field.name}: ${codeType(field)}.writeWith(${fieldAddr}, dataView)`;
	};
	
	// Pad sizes so they're aligned
	let size = type.size;
	while (size%type.align) ++size;
	
	js += `\t${name}: {
		readWith:(addr, dataView) => ({
			${type.fields.map(toRead).join(',\n\t\t\t')}
		}),
		writeWith(addr, value, dataView) {
			${type.fields.map(toWrite).join('\n\t\t\t')}
		},
		size: ${type.size},
		align: ${type.align}
	},\n`;
}
js += `};
for (let name in api) {
	if (typeof api[name].readWith === 'function') {
		api[name].read = read;
		api[name].write = write;
	}
}
return api;};`;

fs.writeFileSync("../wclap32.js", js);
fs.writeFileSync("../wclap32.mjs", js + "export default WCLAP32;");

