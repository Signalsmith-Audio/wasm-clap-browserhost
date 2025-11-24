__attribute__((import_module("env"), import_name("malloc")))
extern void * malloc(size_t size);

__attribute__((import_module("env"), import_name("log")))
extern void log_bytes(const char *ptr, size_t length);

__attribute__((import_module("env"), import_name("error")))
extern void error_bytes(const char *ptr, size_t length);

void * operator new(size_t count) {
	return malloc(count);
}

struct Wasi {
	
};

extern "C" {
	void * reserveMemory() {
		return new Wasi();
	}

	int wasi_snapshot_preview1__environ_sizes_get(Wasi *wasi, size_t *number, size_t *bufferSize) {
		log_bytes("environ_sizes_get", 17);
		error_bytes("environ_sizes_get", 17);
		// No environment variables
		*number = 0;
		*bufferSize = 0;
		return 0;
	}
	int wasi_snapshot_preview1__environ_get(Wasi *wasi, unsigned char **pointers, unsigned char *buffer) {
		return 0;
	}
}
