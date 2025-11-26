cmake_minimum_required(VERSION 3.28)

set(CMAKE_CXX_STANDARD 17)

project(wclap-cpp-browser VERSION 1.0.0)
set(CMAKE_RUNTIME_OUTPUT_DIRECTORY "${CMAKE_CURRENT_LIST_DIR}/../")
set(CMAKE_EXECUTABLE_SUFFIX .wasm)

add_executable(host
	${CMAKE_CURRENT_LIST_DIR}/host.cpp
	${CMAKE_CURRENT_LIST_DIR}/wclap-instance-js.cpp
)
target_compile_options(host PUBLIC "-fno-exceptions")
target_link_options(host PUBLIC "-mexec-model=reactor" "-Wl,--max-memory=4294967296" "-Wl,--export-all")

add_subdirectory(modules/wclap-cpp)
target_link_libraries(host PUBLIC wclap-cpp)
add_subdirectory(modules/cbor-walker)
target_link_libraries(host PUBLIC cbor-walker)

add_executable(wasi
	${CMAKE_CURRENT_LIST_DIR}/wasi.cpp
)
target_link_options(wasi PUBLIC "-mexec-model=reactor" "-Wl,--max-memory=4294967296" "-Wl,--export-all")
