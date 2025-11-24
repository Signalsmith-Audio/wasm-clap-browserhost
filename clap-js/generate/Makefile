wasm32-shared:
	clang/bin/clang++ -O3 -target wasm32 --no-standard-libraries \
		-fno-rtti -fno-exceptions -fvisibility=hidden -fno-builtin -fno-threadsafe-statics \
		-Wl,--no-entry -Wl,--import-memory -Wl,-strip-all -Wl,-gc-sections \
		-Wl,--export-all \
		-Dsize_t="unsigned long" -Duint32_t="unsigned long"\
		wasi.cpp -o ../wasi/wasm32.wasm
