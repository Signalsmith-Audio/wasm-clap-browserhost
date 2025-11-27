# `wclap-js`: C++/JS library (& example host) for WCLAP

## C++ and JS library

The cleanest way to interact with WCLAPs in the browser is to write a C++ WASM host, which then exposes a simpler API to your custom JS.  This keeps all the CLAP-specific structures in the "native" world.

This repo provides `wclap-js-instance`, a C++ library (`.h`/`.cpp` pair) which for building your WCLAP host.  This is built on top of [`wclap-cpp`](host-dev/modules/wclap-cpp), and provides an `Instance` implementation which abstracts all the WCLAP interactions (e.g. calling WCLAP functions, reading/writing structures in its memory).

It also provides a JavaScript library (ES6 module: `wclap-js/wclap.mjs`) which can load hosts written using the above `wclap-js-instance` library, and manages the corresponding `WebAssembly`

![wclap-js architecture diagram](doc/wclap-js-outline.png)

It also provides a WASI helper (written in C++, with JS to load it).  Currently this doesn't actually implement anything, but it defines all the functions for `wasi_snapshot_preview1` (32-bit only).

## AudioWorklet wrapper

This also includes an example C++ host (in `host-dev/host.cpp`), and wrappers which load a single WCLAP as an `AudioNode` (backed by an `AudioWorkletProcessor`).

See `audioworkletnode-clap.mjs` and `audioworkletprocessor-clap.mjs`. 

## Example host

On top of that, it also includes an example host, which loads WCLAPs using the AudioWorklet wrappers, and connect it to a demo audio file and/or virtual keyboard.
