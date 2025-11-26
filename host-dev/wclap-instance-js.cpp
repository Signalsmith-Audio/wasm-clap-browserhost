#include "./wclap-instance-js.h"

Instance * _wclapInstanceCreate(size_t index, bool is64) {
	return new Instance(index, is64);
}

#include <atomic>

static std::atomic<uint32_t> indexCounter{0};
uint32_t _wclapInstanceGetNextIndex() {
	return indexCounter++;
}
