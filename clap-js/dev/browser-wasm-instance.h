#include "wclap/instance.hpp"

// This interfaces with a different WebAssembly module in the browser

__attribute__((import_module("env"), import_name("_browserInstanceInit32")))
extern uint32_t _browserInstanceInit32(size_t browserIndex);
__attribute__((import_module("env"), import_name("_browserInstanceInit64")))
extern uint32_t _browserInstanceInit64(size_t browserIndex);

namespace browser_wasm {
	struct BrowserWasmInstance {
		const size_t browserIndex;
		const bool wasm64;
		
		BrowserWasmInstance(size_t index, bool wasm64) : browserIndex(index), wasm64(wasm64) {}
		
		bool is64() const {
			return wasm64;
		}
		
		wclap32::Pointer<wclap32::wclap_plugin_entry> init32() {
			return {_browserInstanceInit32(browserIndex)};
		}
		wclap64::Pointer<wclap64::wclap_plugin_entry> init64() {
			return {_browserInstanceInit64(browserIndex)};
		}

		int (*threadSpawn)(BrowserWasmInstance *instance, uint64_t startArg) = nullptr;

		// Thread-specific init - calls through to wasi_thread_start()
		void initThread(int threadId, void *startArg) {
			impl.initThread(threadId, startArg);
		}

	};
};

using Instance = wclap::Instance<browser_wasm::BrowserWasmInstance>;

extern "C" {
	Instance _browserInstanceCreate(size_t index) {
		return new Instance(index);
	}
}
