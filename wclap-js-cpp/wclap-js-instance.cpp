#include <iostream>
#define LOG_EXPR(expr) std::cout << #expr " = " << (expr) << std::endl;

#include "./wclap-js-instance.h"

Instance * _wclapInstanceCreate(bool is64) {
	return new Instance(is64);
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

static std::atomic<uint32_t> hostThreadCounter{0};
int32_t _wclapNextThreadId() {
	auto threadId = ++hostThreadCounter;
	if (threadId >= 0x20000000) {
		--hostThreadCounter;
		return -1; // 2^29 lifetime thread-count limit
	}
	return threadId;
}

#include <thread>
static void instanceThreadFn(Instance *instance, uint32_t threadId, uint64_t threadContext) {
	instance->runThread(threadId, threadContext);
}
int32_t _wclapStartInstanceThread(Instance *instance, uint64_t instanceThreadContext) {
	if (instance == nullptr) abort();
	auto instanceThreadId = instance->nextThreadId();
	std::thread instanceThread{instanceThreadFn, instance, instanceThreadId, instanceThreadContext};
	instanceThread.detach();
	return instanceThreadId;
}
