/* This is an implementation for wclap-cpp's `Instance`, for the case when both the current code and all WCLAPs are running in `WebAssembly.Module`s

Anything using this can be instantiated by `wclap-host.mjs`.  This provides the imports below, which allow copying memory and calling functions from another `WebAssembly.Module`.

Currently only 32-bit WCLAPs are supported here, but 64-bit would be extremely similar.
*/
#include "wclap/instance.hpp"

// These are provided by `host.mjs`, and let us talk to another WebAssembly instance in the same JS context
__attribute__((import_module("_wclapInstance"), import_name("init32")))
extern uint32_t _wclapInstanceInit32(size_t jsIndex);
__attribute__((import_module("_wclapInstance"), import_name("malloc32")))
extern uint32_t _wclapInstanceMalloc32(size_t jsIndex, uint32_t size);
__attribute__((import_module("_wclapInstance"), import_name("initThread")))
extern void _wclapInstanceInitThread(size_t jsIndex, int threadId, uint64_t startArg);
__attribute__((import_module("_wclapInstance"), import_name("release")))
extern void _wclapInstanceRelease(size_t jsIndex);
__attribute__((import_module("_wclapInstance"), import_name("memcpyToOther32")))
extern bool _wclapInstanceMemcpyToOther32(size_t jsIndex, uint32_t destP32, const void *src, uint32_t count);
__attribute__((import_module("_wclapInstance"), import_name("memcpyFromOther32")))
extern bool _wclapInstanceMemcpyFromOther32(size_t jsIndex, void *dest, uint32_t srcP32, uint32_t count);
__attribute__((import_module("_wclapInstance"), import_name("call32")))
extern bool _wclapInstanceCall32(size_t jsIndex, uint32_t wasmFn, uint32_t resultPtr, uint32_t argsPtr, uint32_t argsCount);

namespace js_wasm {
	struct TaggedValue {
		uint8_t type; // i32, i64, f32, f64
		union {
			uint32_t i32;
			uint64_t i64;
			float f32;
			double f64;
		};
		
		TaggedValue() : type(0), i32(0) {}
		TaggedValue(bool v) : type(0), i32(v) {}
		TaggedValue(int8_t v) : type(0), i32(v) {}
		TaggedValue(uint8_t v) : type(0), i32(v) {}
		TaggedValue(int16_t v) : type(0), i32(v) {}
		TaggedValue(uint16_t v) : type(0), i32(v) {}
		TaggedValue(int32_t v) : type(0), i32(v) {}
		TaggedValue(uint32_t v) : type(0), i32(v) {}
		TaggedValue(int64_t v) : type(1), i64(v) {}
		TaggedValue(uint64_t v) : type(1), i64(v) {}
		TaggedValue(float v) : type(2), f32(v) {}
		TaggedValue(double v) : type(3), f64(v) {}
		
		template<class V>
		static TaggedValue from(V v) {
			return {v};
		}
		template<class V>
		static TaggedValue from(wclap32::Pointer<V> v) {
			return {v.wasmPointer};
		}
		template<class V>
		static TaggedValue from(wclap64::Pointer<V> v) {
			return {v.wasmPointer};
		}

		template<class V>
		void set(V &v) const {
			if (type == 0) {
				v = V(i32);
			} else if (type == 1) {
				v = V(i64);
			} else if (type == 2) {
				v = V(f32);
			} else if (type == 3) {
				v = V(f64);
			} else {
				v = V(0);
			}
		}
		template<class V>
		void set(wclap32::Pointer<V> &v) const {
			set(v.wasmPointer);
		}
	};
	
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
		
		wclap32::Pointer<const wclap32::wclap_plugin_entry> init32() {
			return {_wclapInstanceInit32(jsIndex)};
		}
		wclap64::Pointer<const wclap64::wclap_plugin_entry> init64() {
			return {0}; // not supported
		}

		wclap32::Pointer<void> malloc32(uint32_t size) {
			return {_wclapInstanceMalloc32(jsIndex, size)};
		}

		int (*threadSpawn)(WclapInstance *instance, uint64_t startArg) = nullptr;

		// Thread-specific init - calls through to wasi_thread_start()
		void initThread(int threadId, uint64_t startArg) {
			_wclapInstanceInitThread(jsIndex, threadId, startArg);
		}

		template<class V>
		std::remove_cv_t<V> get(wclap32::Pointer<V> ptr, size_t index) {
			std::remove_cv_t<V> value{};
			
			_wclapInstanceMemcpyFromOther32(jsIndex, &value, ptr.wasmPointer + uint32_t(sizeof(V)*index), uint32_t(sizeof(V)));
			return value;
		}
		template<class V>
		bool getArray(wclap32::Pointer<const V> ptr, V *value, size_t count) {
			return _wclapInstanceMemcpyFromOther32(jsIndex, value, ptr.wasmPointer, uint32_t(count*sizeof(V)));
		}
		template<class V>
		bool set(wclap32::Pointer<V> ptr, const V *value, size_t index) {
			return _wclapInstanceMemcpyToOther32(jsIndex, ptr.wasmPointer + uint32_t(sizeof(V)*index), value, uint32_t(sizeof(V)));
		}
		template<class V>
		bool setArray(wclap32::Pointer<V> ptr, const V *value, size_t count) {
			return _wclapInstanceMemcpyToOther32(jsIndex, ptr.wasmPointer, value, uint32_t(count*sizeof(V)));
		}

		template<class Return, class... Args>
		Return call(wclap32::Function<Return, Args...> fnPtr, Args... args) {
			TaggedValue taggedResult;
			TaggedValue taggedArgs[] = {TaggedValue::from(args)...};
			auto argsCount = sizeof(taggedArgs)/sizeof(TaggedValue);

			_wclapInstanceCall32(jsIndex, fnPtr.wasmPointer, (uint32_t)&taggedResult, (uint32_t)taggedArgs, uint32_t(argsCount));

			Return v;
			taggedResult.set(v);
			return v;
		}

		std::vector<char> pathChars;
		const char * path() const {
			return pathChars.data();
		}
	};
};

using Instance = wclap::Instance<js_wasm::WclapInstance>;

extern "C" {
	uint32_t _wclapInstanceGetNextIndex();
	Instance * _wclapInstanceCreate(size_t index, bool is64);
	char * _wclapInstanceSetPath(Instance *instance, size_t size);
}
