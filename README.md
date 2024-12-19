# Browser-based Web-CLAP host

This is a _very_ WIP proof-of-concept host for WCLAP ([Web CLAP](https://github.com/free-audio/web-clap)) plugins.  Although this host is browser-based, a similar approach could be used for non-web contexts.

## Design

There are three layers:

### CLAP host

The source for this is in `clap-host/`, with the main entry point being `clapModule()` from `clap-module.mjs`.  This takes the [WebAssembly Module](https://developer.mozilla.org/en-US/docs/WebAssembly/JavaScript_interface/Module) for a CLAP plugin, and lets you query/create plugin instances.

Rather than wrap the CLAP API in any way, `clap-interface.mjs` makes it easy to define and read/write C structs in the WebAssembly memory, call functions (from function pointers), proxy your own JS functions as function pointers, and add CLAP extensions.  The core CLAP types/extensions are already defined.

### AudioWorkletNode / AudioWorkletProcessor

This fetches/compiles a `.wasm`, and uses the Module to construct an AudioWorkletProcessor.  This processor uses the CLAP host helpers (above) to configure/activate the plugin and process audio blocks.

The AudioWorkletNode has proxy methods added to it, which asynchronously scan/update parameters and save/load state, by posting messages across to the processor.  It also receives events from the processor (such as "state marked dirty").

They also use the WIP `clap.web/1` draft extension, which (if supported) opens a web-page and passes arbitrary messages between the web-page and the plugin, allowing plugins to present a web-based UI.  Since this host is running in the browser, this web-view is loaded in an `<iframe>`.

### Service Worker

WCLAP bundles might contain multiple resources, in which case they should be served as `.tar.gz` archives.  The main page registers a Service Worker which can fetch these bundles, extract them, and serve them as if they were individual resources.
