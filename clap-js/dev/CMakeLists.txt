cmake_minimum_required(VERSION 3.28)

set(CMAKE_CXX_STANDARD 17)

project(wclap-cpp-browser VERSION 1.0.0)

add_executable(wclap-host
	${CMAKE_CURRENT_LIST_DIR}/host.cpp
)

add_subdirectory(wclap-cpp)
target_link_libraries(wclap-host PUBLIC wclap-cpp)

set(CMAKE_RUNTIME_OUTPUT_DIRECTORY "${CMAKE_CURRENT_LIST_DIR}/../")