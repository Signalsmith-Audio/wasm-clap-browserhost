#include <cstdint>
#include <utility>
#include <type_traits>
#include <vector>

__attribute__((import_module("env"), import_name("memcpyToOther32")))
extern void memcpyToOther32(uint32_t destP32, const void *src, uint32_t count);
__attribute__((import_module("env"), import_name("memcpyFromOther32")))
extern void memcpyFromOther32(void *dest, uint32_t srcP32, uint32_t count);
__attribute__((import_module("env"), import_name("procExit")))
extern void jsProcExit(uint32_t code);
__attribute__((import_module("env"), import_name("consoleLog")))
extern void consoleLog(const char *chars, size_t length);
__attribute__((import_module("env"), import_name("consoleError")))
extern void consoleError(const char *chars, size_t length);

template<class T>
struct P32 {
	uint32_t remotePointer;
	
	P32(uint32_t remotePointer=0) : remotePointer(remotePointer) {}
	
	std::remove_cv_t<T> get(size_t index=0) const {
		std::remove_cv_t<T> result;
		memcpyFromOther32(&result, remotePointer + uint32_t(index*sizeof(T)), uint32_t(sizeof(T)));
		return result;
	}
	template<class T2>
	void set(const T2 &&convert, size_t index=0) const {
		T value = convert;
		memcpyToOther32(remotePointer + uint32_t(index*sizeof(T)), &value, uint32_t(sizeof(T)));
	}
	
	P32 operator+(int32_t delta) {
		return {remotePointer + delta*sizeof(T)};
	}
	P32 operator+=(int32_t delta) {
		remotePointer += delta*sizeof(T);
	}
};

using result_t = uint16_t;

struct fdstat {
	uint8_t filetype;
	uint16_t flags;
	uint64_t rightsBase;
	uint64_t rightsInheriting;
};

struct filestat {
	uint64_t device;
	uint64_t inode;
	uint8_t filetype;
	uint64_t linkCount;
	uint64_t size;
	// accessed, modified, created
	uint64_t aTime;
	uint64_t mTime;
	uint64_t cTime;
};

struct prestat {
	uint8_t type;
	struct {
		uint32_t nameLength;
	} directory;
};

struct iovec32 {
	P32<void> buffer;
	uint32_t length;
};

struct subscription32 {
	uint64_t userData;
	uint8_t eventType;
	union {
		struct {
			uint32_t clockId;
			uint64_t timestamp;
			uint64_t precision;
			uint16_t subClockFlags;
		} clock;
		struct {
			uint32_t fd;
		} fileReadWrite;
	};
};

struct event32 {
	uint64_t userData;
	result_t error;
	uint8_t eventType;
	struct {
		uint64_t numBytes;
		uint16_t flags;
	} fileReadWrite;
};

template<class Fn>
void forEachIoVec(P32<const iovec32> ioBufferList, uint32_t ioBufferCount, Fn &&fn) {
	std::vector<char> buffer;
	for (uint32_t i = 0; i < ioBufferCount; ++i) {
		auto vec = (ioBufferList + i).get();
		buffer.resize(vec.length);
		memcpyFromOther32(buffer.data(), vec.buffer.remotePointer, vec.length);
		fn(buffer.data(), buffer.size());
	}
}

std::vector<char> stdoutLine, stderrLine;

extern "C" {
	result_t wasi32_snapshot_preview1__args_sizes_get(P32<size_t> count, P32<size_t> bufferSize) {
		count.set(0);
		bufferSize.set(0);
		return 0;
	}
	result_t wasi32_snapshot_preview1__args_get(P32<P32<const char>> args, P32<char> buffer) {
		return 0;
	}
	result_t wasi32_snapshot_preview1__clock_res_get(uint32_t clock_id, P32<uint64_t> resolution) {
		return ENOTCAPABLE;
	}
	result_t wasi32_snapshot_preview1__clock_time_get(uint32_t clock_id, uint64_t withResolution, P32<uint64_t> time) {
		return ENOTCAPABLE;
	}
	result_t wasi32_snapshot_preview1__environ_sizes_get(P32<size_t> items, P32<size_t> totalSize) {
		items.set(0);
		totalSize.set(0);
		return 0;
	}
	result_t wasi32_snapshot_preview1__environ_get(P32<P32<const char>> env, P32<char> buffer) {
		return 0;
	}
	result_t wasi32_snapshot_preview1__fd_advise(uint32_t fd, int64_t offset, int64_t len, uint8_t advice) {
		return ENOTCAPABLE;
	}
	result_t wasi32_snapshot_preview1__fd_allocate(uint32_t fd, int64_t offset, int64_t len) {
		return ENOTCAPABLE;
	}
	result_t wasi32_snapshot_preview1__fd_close(uint32_t fd) {
		return ENOTCAPABLE;
	}
	result_t wasi32_snapshot_preview1__fd_datasync(uint32_t fd) {
		return ENOTCAPABLE;
	}
	result_t wasi32_snapshot_preview1__fd_fdstat_get(uint32_t fd, P32<fdstat> stat) {
		return ENOTCAPABLE;
	}
	result_t wasi32_snapshot_preview1__fd_fdstat_set_flags(uint32_t fd, uint16_t flags) {
		return ENOTCAPABLE;
	}
	result_t wasi32_snapshot_preview1__fd_fdstat_set_rights(uint32_t fd, uint64_t rightsBase, uint64_t rightsInheriting) {
		return ENOTCAPABLE;
	}
	result_t wasi32_snapshot_preview1__fd_filestat_get(uint32_t fd, P32<filestat> stat) {
		return ENOTCAPABLE;
	}
	result_t wasi32_snapshot_preview1__fd_filestat_set_size(uint32_t fd, uint64_t size) {
		return ENOTCAPABLE;
	}
	result_t wasi32_snapshot_preview1__fd_filestat_set_times(uint32_t fd, uint64_t aTime, uint64_t mTime, uint16_t flags) {
		return ENOTCAPABLE;
	}
	result_t wasi32_snapshot_preview1__fd_pread(uint32_t fd, P32<const iovec32> ioBufferList, uint32_t ioBufferCount, uint64_t offset, P32<uint32_t> bytesRead) {
		return ENOTCAPABLE;
	}
	result_t wasi32_snapshot_preview1__fd_prestat_get(uint32_t fd, P32<prestat> stat) {
		return ENOTCAPABLE;
	}
	result_t wasi32_snapshot_preview1__fd_prestat_dir_name(uint32_t fd, P32<char> path, uint32_t pathLength) {
		return ENOTCAPABLE;
	}
	result_t wasi32_snapshot_preview1__fd_pwrite(uint32_t fd, P32<const iovec32> ioBufferList, uint32_t ioBufferCount, uint64_t offset, P32<uint32_t> bytesWritten) {
		return ENOTCAPABLE;
	}
	result_t wasi32_snapshot_preview1__fd_read(uint32_t fd, P32<const iovec32> ioBufferList, uint32_t ioBufferCount, P32<uint32_t> bytesRead) {
		return ENOTCAPABLE;
	}
	result_t wasi32_snapshot_preview1__fd_readdir(uint32_t fd, P32<void> buffer, uint32_t bufferSize, uint64_t cookie, P32<uint32_t> bytesUsed) {
		return ENOTCAPABLE;
	}
	result_t wasi32_snapshot_preview1__fd_renumber(uint32_t fdFrom, uint32_t fdTo) {
		return ENOTCAPABLE;
	}
	result_t wasi32_snapshot_preview1__fd_seek(uint32_t fd, int64_t delta, uint8_t whence, P32<uint64_t> newOffset) {
		return ENOTCAPABLE;
	}
	result_t wasi32_snapshot_preview1__fd_sync(uint32_t fd) {
		return ENOTCAPABLE;
	}
	result_t wasi32_snapshot_preview1__fd_tell(uint32_t fd, P32<uint64_t> offset) {
		return ENOTCAPABLE;
	}
	result_t wasi32_snapshot_preview1__fd_write(uint32_t fd, P32<const iovec32> ioBufferList, uint32_t ioBufferCount, P32<uint32_t> bytesWritten) {
		if (fd == 1) {
			size_t total = 0;
			forEachIoVec(ioBufferList, ioBufferCount, [&](const char *bytes, size_t length){
				for (size_t i = 0; i < length; ++i) {
					if (bytes[i] == '\n') {
						consoleLog(stdoutLine.data(), stdoutLine.size());
						stdoutLine.resize(0);
					} else {
						stdoutLine.push_back(bytes[i]);
					}
				}
				total += length;
			});
			bytesWritten.set(uint32_t(total));
			return 0;
		} else if (fd == 2) {
			size_t total = 0;
			forEachIoVec(ioBufferList, ioBufferCount, [&](const char *bytes, size_t length){
				for (size_t i = 0; i < length; ++i) {
					if (bytes[i] == '\n') {
						consoleError(stderrLine.data(), stderrLine.size());
						stderrLine.resize(0);
					} else {
						stderrLine.push_back(bytes[i]);
					}
				}
				total += length;
			});
			bytesWritten.set(uint32_t(total));
			return 0;
		}
		return ENOTCAPABLE;
	}
	result_t wasi32_snapshot_preview1__path_create_directory(uint32_t fd, P32<const char> path, uint32_t pathLength) {
		return ENOTCAPABLE;
	}
	result_t wasi32_snapshot_preview1__path_filestat_get(uint32_t fd, uint32_t lookupFlags, P32<const char> path, uint32_t pathLength, P32<filestat> stat) {
		return ENOTCAPABLE;
	}
	result_t wasi32_snapshot_preview1__path_filestat_set_times(uint32_t fd, uint32_t lookupFlags, P32<const char> path, uint32_t pathLength, uint64_t aTime, uint64_t mTime, uint16_t flags) {
		return ENOTCAPABLE;
	}
	result_t wasi32_snapshot_preview1__path_link(uint32_t oldFd, uint32_t oldLookupFlags, P32<const char> oldPath, uint32_t oldPathLength, uint32_t newFd, P32<const char> newPath, uint32_t newPathLength) {
		return ENOTCAPABLE;
	}
	result_t wasi32_snapshot_preview1__path_open(uint32_t dirFd, uint32_t dirLookupFlags, P32<const char> path, uint32_t pathLength, uint16_t openFlags, uint64_t rightsBase, uint64_t rightsInheriting, uint16_t fsFlags, P32<uint32_t> newPath) {
		return ENOTCAPABLE;
	}
	result_t wasi32_snapshot_preview1__path_readlink(uint32_t dirFd, P32<const char> path, uint32_t pathLength, P32<char> buffer, uint32_t bufferLength, P32<uint32_t> bytesUsed) {
		return ENOTCAPABLE;
	}
	result_t wasi32_snapshot_preview1__path_remove_directory(uint32_t dirFd, P32<const char> path, uint32_t pathLength) {
		return ENOTCAPABLE;
	}
	result_t wasi32_snapshot_preview1__path_rename(uint32_t oldFd, P32<const char> oldPath, uint32_t oldPathLength, uint32_t newFd, P32<const char> newPath, uint32_t newPathLength) {
		return ENOTCAPABLE;
	}
	result_t wasi32_snapshot_preview1__path_symlink(P32<const char> oldPath, uint32_t oldPathLength, uint32_t newFd, P32<const char> newPath, uint32_t newPathLength) {
		return ENOTCAPABLE;
	}
	result_t wasi32_snapshot_preview1__path_unlink_file(uint32_t fd, P32<const char> path, uint32_t pathLength) {
		return ENOTCAPABLE;
	}
	result_t wasi32_snapshot_preview1__poll_oneoff(P32<subscription32> subs, P32<event32> out, uint32_t subCount, P32<uint32_t> eventCount) {
		return ENOTCAPABLE;
	}
	void wasi32_snapshot_preview1__proc_exit(uint32_t code) {
		jsProcExit(code);
	}
	result_t wasi32_snapshot_preview1__proc_raise(uint8_t signalType) {
		return ENOTCAPABLE;
	}
	result_t wasi32_snapshot_preview1__random_get(P32<void> buffer, uint32_t length) {
		return ENOTCAPABLE;
	}
	result_t wasi32_snapshot_preview1__sched_yield() {
		return ENOTCAPABLE;
	}
	result_t wasi32_snapshot_preview1__sock_accept(uint32_t sd, uint16_t flags, uint32_t fd) {
		return ENOTCAPABLE;
	}
	result_t wasi32_snapshot_preview1__sock_recv(uint32_t sd, P32<const iovec32> riList, uint32_t riCount, uint16_t riFlags, P32<uint32_t> roDataLength, P32<uint16_t> roFlags) {
		return ENOTCAPABLE;
	}
	result_t wasi32_snapshot_preview1__sock_send(uint32_t sd, P32<const iovec32> dataList, uint32_t dataCount, uint16_t flags, P32<uint32_t> sentDataLength) {
		return ENOTCAPABLE;
	}
	result_t wasi32_snapshot_preview1__sock_shutdown(uint32_t sd, uint8_t how) {
		return ENOTCAPABLE;
	}
}
