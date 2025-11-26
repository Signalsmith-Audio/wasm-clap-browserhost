#include "wclap/instance.hpp"

// These are provided by `host.mjs`, and let us talk to another WebAssembly instance in the same JS context
__attribute__((import_module("_wclapInstance"), import_name("init32")))
extern uint32_t _wclapInstanceInit32(size_t jsIndex);
__attribute__((import_module("_wclapInstance"), import_name("init64")))
extern uint64_t _wclapInstanceInit64(size_t jsIndex);
__attribute__((import_module("_wclapInstance"), import_name("initThread")))
extern void _wclapInstanceInitThread(size_t jsIndex, int threadId, uint64_t startArg);
__attribute__((import_module("_wclapInstance"), import_name("release")))
extern void _wclapInstanceRelease(size_t jsIndex);

namespace js_wasm {
	struct WclapInstance {
		const size_t jsIndex;
		bool wasm64;
		
		WclapInstance(size_t index, bool wasm64) : jsIndex(index), wasm64(wasm64) {}
		WclapInstance(const WclapInstance &other) = delete;
		~WclapInstance() {
			_wclapInstanceRelease(jsIndex);
		}
		
		bool is64() const {
			return wasm64;
		}
		
		wclap32::Pointer<wclap32::wclap_plugin_entry> init32() {
			return {_wclapInstanceInit32(jsIndex)};
		}
		wclap64::Pointer<wclap64::wclap_plugin_entry> init64() {
			return {_wclapInstanceInit64(jsIndex)};
		}

		int (*threadSpawn)(WclapInstance *instance, uint64_t startArg) = nullptr;

		// Thread-specific init - calls through to wasi_thread_start()
		void initThread(int threadId, uint64_t startArg) {
			_wclapInstanceInitThread(jsIndex, threadId, startArg);
		}

	};
};

using Instance = wclap::Instance<js_wasm::WclapInstance>;

extern "C" {
	Instance * _wclapInstanceCreate(size_t index, bool is64);
	uint32_t _wclapInstanceGetNextIndex();
}
