cmake: cmake-build
	@echo "Generating CMake project"
	cmake --build cmake-build --target wclap-host --config Release

cmake-build: CMakeLists.txt
	cmake . -B cmake-build -DCMAKE_TOOLCHAIN_FILE=$(WASI_SDK)/share/cmake/wasi-sdk-pthread.cmake  -DCMAKE_BUILD_TYPE=Release

wasm32-shared:
	clang/bin/clang++ -O3 -target wasm32 --no-standard-libraries \
		-fno-rtti -fno-exceptions -fvisibility=hidden -fno-builtin -fno-threadsafe-statics \
		-Wl,--no-entry -Wl,--import-memory -Wl,-strip-all -Wl,-gc-sections \
		-Wl,--export-all \
		-Dsize_t="unsigned long" -Duint32_t="unsigned long"\
		wasi.cpp -o ../wasi/wasm32.wasm
