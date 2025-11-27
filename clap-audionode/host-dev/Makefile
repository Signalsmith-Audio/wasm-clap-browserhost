cmake: cmake-build
	cmake --build cmake-build --target host --config Release

cmake-build: CMakeLists.txt
	@echo "Generating CMake project"
	cmake . -B cmake-build -DCMAKE_TOOLCHAIN_FILE=$(WASI_SDK)/share/cmake/wasi-sdk-pthread.cmake  -DCMAKE_BUILD_TYPE=Release