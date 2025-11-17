function wasi_snapshot_preview1(args=[], env={}, fileResolver, memory=null) {
	for (let key in env) {
		if (typeof env[key] !== 'string') env[key] += "";
	}
	
	if (!fileResolver) fileResolver = () => null;
	
	let fileHandles = {};
	function groupNewlines(fn) {
		let pending = "";
		return {
			offset: 0,
			length: 0,
			write(arr) {
				for (let i = 0; i < arr.length; ++i) {
					let c = String.fromCharCode(arr[i]);
					if (c == '\n') {
						fn(pending);
						pending = "";
					} else {
						pending += c;
					}
				}
			}
		};
	}
	fileHandles[1] = groupNewlines(console.log.bind(console)); // stdout
	fileHandles[2] = groupNewlines(console.error.bind(console)); // stderr

	let wasi = {
		// This seems to be the convention
		set instance(instance) {
			if (instance.exports.memory) {
				memory = instance.exports.memory;
			}
		},
		environ_sizes_get(pCount, pSize) {
			let count = 0, size = 0;
			for (let key in env) {
				++count;
				size += env[key].length + 1;
			}
			let view = new DataView(memory.buffer);
			view.setUint32(pCount, count, true);
			view.setUint32(pSize, size, true);
			return 0;
		},
		environ_get(pArray, pBuffer) {
			let view = new DataView(memory.buffer);
			let arr8 = new Uint8Array(memory.buffer);
			
			let count = 0, size = 0;
			for (let key in env) {
				let value = env[key];
				// Set the pointer
				view.setUint32(pArray + count*4, pBuffer + size, true);
				// Copy the string
				for (let i = 0; i < value.length; ++i) {
					arr8[pBuffer + size + i] = value.charCodeAt[i];
				}
				arr8[pBuffer + size + value.length] = 0; // null-terminated string

				++count;
				size += value.length + 1;
			}
			return 0;
		},
		fd_seek(fd, offset, relativeTo) {
			let file = fileHandles[fd];
			if (!file) return 9; // bad file handle
			
			// POSIX lseek constants
			if (relativeTo == 1) { // SEEK_CUR
				file.offset += offset;
			} else if (relativeTo == 2) { // SEEK_END
				file.offset = file.length - offset;
			} else { // SEEK_SET
				file.offset = offset;
			}
			return file.offset;
		},
		fd_write(fd, pVectors, nVectors, pWritten) {
			let file = fileHandles[fd];
			if (!file) return 9; // bad file handle
			
			let view = new DataView(memory.buffer);
			let arr8 = new Uint8Array(memory.buffer);
			// Everything goes to the console
			let written = 0;
			for (let n = 0; n < nVectors; ++n) {
				let pData = view.getUint32(pVectors + n*8, true);
				let length = view.getUint32(pVectors + n*8 + 4, true);
				file.write(arr8.subarray(pData, pData + length));
				written += length;
			}
			view.setUint32(pWritten, written, true);
			return 0;
		},
		fd_read(fd, pVectors, nVectors, pWritten) {
			console.log("fd_read()");
			let file = fileHandles[fd];
			if (!file) file = {
				read() {
				}
			};

			let view = new DataView(memory.buffer);
			let arr8 = new Uint8Array(memory.buffer);
			// Everything goes to the console
			let written = 0;
			for (let n = 0; n < nVectors; ++n) {
				let pData = view.getUint32(pVectors + n*8, true);
				let length = view.getUint32(pVectors + n*8 + 4, true);
				file.read(arr8.subarray(pData, pData + length));
				written += length;
			}
			view.setUint32(pWritten, written, true);
			return 0;
		},
		random_get(ptr, nBytes) { // TODO: a more secure generator
			let arr8 = new Uint8Array(memory);
			for (let i = 0; i < nBytes; ++i) {
				arr8[ptr + i] = Math.floor(Math.random()*256);
			}
		}
	};

	// List adapted from https://github.com/nodejs/uvwasi?tab=readme-ov-file#system-calls
	'args_get,args_sizes_get,clock_res_get,clock_time_get,environ_get,environ_sizes_get,fd_advise,fd_allocate,fd_close,fd_datasync,fd_fdstat_get,fd_fdstat_set_flags,fd_fdstat_set_rights,fd_filestat_get,fd_filestat_set_size,fd_filestat_set_times,fd_pread,fd_prestat_get,fd_prestat_dir_name,fd_pwrite,fd_read,fd_readdir,fd_renumber,fd_seek,fd_sync,fd_tell,fd_write,path_create_directory,path_filestat_get,path_filestat_set_times,path_link,path_open,path_readlink,path_remove_directory,path_rename,path_symlink,path_unlink_file,poll_oneoff,proc_exit,proc_raise,random_get,sched_yield,sock_recv,sock_send,sock_shutdown'.split(',').forEach(key => {
		if (!wasi[key]) {
			wasi[key] = (...args) => {
				console.error(`Missing WASI: ${key}(${args.join(', ')})`);
				debugger;
				throw Error('WASI: ' + key + '(' + args.join(', ') + ')');
				return 0;
			};
		}
	});
	return wasi;
};

export default wasi_snapshot_preview1;
