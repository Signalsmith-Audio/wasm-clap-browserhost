# `wasi.wasm` build

This builds the `wasi.wasm`, a (placeholder for now) WASI implementation.

Assuming `WASI_SDK` points to a [wasi-sdk](https://github.com/WebAssembly/wasi-sdk) release, you generate the CMake build by pointing at the toolchain:

```sh
cmake . -B cmake-build -DCMAKE_TOOLCHAIN_FILE=$(WASI_SDK)/share/cmake/wasi-sdk-pthread.cmake  -DCMAKE_BUILD_TYPE=Release
```

And then build it with:

```sh
cmake --build cmake-build --target wasi --config Release
```

This will output `../wasi.wasm`.
