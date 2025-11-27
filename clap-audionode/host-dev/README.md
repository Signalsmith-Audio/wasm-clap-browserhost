# `host.wasm` build

This builds the `host.wasm`, a "native" host written in C++.

Assuming `WASI_SDK` points to a [wasi-sdk](https://github.com/WebAssembly/wasi-sdk) release, you generate the CMake build by pointing at the toolchain:

```sh
cmake . -B cmake-build -DCMAKE_TOOLCHAIN_FILE=$(WASI_SDK)/share/cmake/wasi-sdk-pthread.cmake  -DCMAKE_BUILD_TYPE=Release
```

And then build it with:

```sh
cmake --build cmake-build --target wclap-host --config Release
```

This will output `../host.wasm`.
