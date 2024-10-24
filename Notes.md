# CLAP WASM notes

Here are some notes for compiing a CLAP plugin to a self-contained `.wasm` file (no JS support needed);

## General

The WASM module needs to export:

* `memory`
* `clap_entry` - pointer to the entry object
* `malloc(size)` - allocates memory for the host to use
* a growable WebAssembly.Table (full of function references)

We need `malloc` because the host needs to provide pointers to structures and audio buffers.  Rather than structuring the WASM module as a shared library (which isn't currently standardised), the plugin module is self-contained but allows the host to inject itself.

### Finding the Table

Plugins should only export one function Table, and hosts may throw if there's more than one candidate.  LLVM calls this table `__indirect_function_table`, but hosts shouldn't assume that.

### Resizable Table/`memory`

The Table export needs to be growable, so that the host can import an arbitrary number of its own functions.

The `memory` export is *probably* resizable, since the plugin doesn't know how much memory the host will ask for with `malloc()`.  A host might(?) also constructing an arbitrary number of plugin instances.

### Emscripten flags

None of these requirements/behaviours are specific to Emscripten, but it's pretty common, so 'here are some useful flags for the Emscripten linker:

* `-sEXPORTED_FUNCTIONS=_clap_entry,_malloc`: not sure what the `_` is about here - they're not present in the actual exports
* `-sPURE_WASI`: no Emscripten-specific imports (`emscripten_notify_memory_growth`)
* `-sSTANDALONE_WASM`: otherwise Emscripten does various things (e.g. renaming exports) which assume a matching custom JS loader
* `--export-table`: exports the function Table
* `-sALLOW_TABLE_GROWTH`: the Table is growable
* `--no-entry`: don't expect a `main()`
* `-sINITIAL_MEMORY=512kb -sALLOW_MEMORY_GROWTH`: up to you and your specific plugin - it'll complain at build time if the initial memory is too small

## Threads

Each WebAssembly instance is single-threaded, and multi-threading is done by having multiple instances (perhaps of different modules!) using shared memory.  This means that (if you import shared `memory` instead of exporting it) you could have calls being made on separate UI/audio threads.

Many non-browser engines don't support shared memory anyway (and in a browser you need to [lock everything down](https://hacks.mozilla.org/2020/07/safely-reviving-shared-memory/) before you can pass memory around).  Even where supported, you can't spawn your own threads (for now) from inside the WebAssembly module.

However, threads are most commonly used for passing messages between the audio/UI components.  If a WASM build doesn't include the `clap.gui` extension, then the threads might not be necessary either.

### C++

With Emscripten at least, you can still have a `std::thread` but actually starting one throws an error.  Therefore, if you only start the `std::thread` when you actually need it (e.g. when the GUI is opened) that can avoid the problem.
