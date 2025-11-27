cmake_minimum_required(VERSION 3.28)

add_library(wclap-js STATIC
	${CMAKE_CURRENT_LIST_DIR}/wclap-js-instance.cpp
)
target_compile_options(wclap-js PUBLIC "-fno-exceptions")
target_link_options(wclap-js PUBLIC
	"-Wl,--export=_wclapInstanceGetNextIndex"
	"-Wl,--export=_wclapInstanceCreate"
	"-Wl,--export=_wclapInstanceSetPath"
)
target_include_directories(wclap-js PUBLIC ${CMAKE_CURRENT_LIST_DIR})

# Add `wclap-cpp` as a dependency
add_subdirectory(modules/wclap-cpp)
target_link_libraries(wclap-js PUBLIC wclap-cpp)
