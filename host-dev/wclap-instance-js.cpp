#include "./wclap-instance-js.h"

Instance * _wclapInstanceCreate(size_t index, bool is64) {
	return new Instance(index, is64);
}

#include <vector>

char * _wclapInstanceSetPath(Instance *instance, size_t size) {
	auto *impl = (js_wasm::WclapInstance *)instance;
	impl->pathChars.assign(size + 1, 0);
	return impl->pathChars.data();
}

#include <atomic>

static std::atomic<uint32_t> indexCounter{0};
uint32_t _wclapInstanceGetNextIndex() {
	return indexCounter++;
}
