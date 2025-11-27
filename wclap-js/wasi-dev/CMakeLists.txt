cmake_minimum_required(VERSION 3.28)

set(CMAKE_CXX_STANDARD 17)

project(wasi-browser-cpp VERSION 1.0.0)
set(CMAKE_RUNTIME_OUTPUT_DIRECTORY "${CMAKE_CURRENT_LIST_DIR}/../")
set(CMAKE_EXECUTABLE_SUFFIX .wasm)

add_executable(wasi
	${CMAKE_CURRENT_LIST_DIR}/wasi.cpp
)
target_link_options(wasi PUBLIC "-mexec-model=reactor" "-Wl,--max-memory=4294967296" "-Wl,--export-all")
