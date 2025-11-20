function wasi_snapshot_preview1(args=[], env={}, fileResolver, memory=null) {
	for (let key in env) {
		if (typeof env[key] !== 'string') env[key] += "";
	}
	
	if (!fileResolver) fileResolver = () => null;
	// Values in octal
	//#define S_IFMT 0170000           /* type of file */
	//#define        S_IFIFO  0010000  /* named pipe (fifo) */
	//#define        S_IFCHR  0020000  /* character special */
	//#define        S_IFDIR  0040000  /* directory */
	//#define        S_IFBLK  0060000  /* block special */
	//#define        S_IFREG  0100000  /* regular */
	//#define        S_IFLNK  0120000  /* symbolic link */
	//#define        S_IFSOCK 0140000  /* socket */
	//#define        S_IFWHT  0160000  /* whiteout */
	//#define S_ISUID 0004000  /* set user id on execution */
	//#define S_ISGID 0002000  /* set group id on execution */
	//#define S_ISVTX 0001000  /* save swapped text even after use */
	//#define S_IRUSR 0000400  /* read permission, owner */
	//#define S_IWUSR 0000200  /* write permission, owner */
	//#define S_IXUSR 0000100  /* execute/search permission, owner */
	
	let fileHandles = {};
	function stdToConsole(fn) {
		let pending = ""; // collect until we have a newline
		return {
			offset: 0,
			length: 0,
			filetype: 2, // S_IFCHR: character device
			flags: 0,
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
	fileHandles[1] = stdToConsole(console.log.bind(console)); // stdout
	fileHandles[2] = stdToConsole(console.error.bind(console)); // stderr

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
		fd_advise(fd, offset, length, advice) {
			let file = fileHandles[fd];
			if (!file) return 9; // bad file handle
			return 0; // ignore
		},
		fd_fdstat_get(fd, ptr) {
			let file = fileHandles[fd];
			if (!file) return 9; // bad file handle
			let view = new DataView(memory.buffer);
			view.setUint8(ptr, file.filetype);
			view.setUint16(ptr + 2, file.flags);
			view.setBigUint64(ptr + 8, 0n, true);
			view.setBigUint64(ptr + 16, 0n, true);
			return 0; // no error
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

function wasi_threads(createThreadFn) {
	return {
		'thread-spawn': ptr => {
			if (!createThreadFn) {
				console.error("tried to spawn a thread, but not created with thread support");
				return -1;
			}
			if (!globalThis.crossOriginIsolated) {
				console.error("tried to spawn a thread, but environment isn't cross-origin isolated");
				//return -2;
			}
			
			// Hack for now - cross fingers and hope for no collisions
			let threadId = (1 + Math.random()*0x1FFFFFFE)|0;
			createThreadFn(threadId, ptr);
			return threadId;
		}
	};
}

let wasi = {
	wasi_snapshot_preview1: wasi_snapshot_preview1,
	wasi_threads: wasi_threads
};

export default wasi;
