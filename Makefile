server:
	python3 -m http.server

bundle:
	npx rollup clap-host/clasm.mjs --file clasm.mjs --format es --sourcemap
	
	npx rollup clap-host/clasm.mjs --file clasm.js --format umd --output.name Clasm --no-esModule --strict --sourcemap


minify:
	npx uglify-js ./clasm.mjs -o ./clasm.min.mjs \
		--source-map "content=clasm.mjs.map,url=clasm.min.mjs.map" \
		--warn --compress passes=10 \
		--mangle --mangle-props "regex=/^(m_|#)/" \
		--output-opts ascii_only

	npx uglify-js ./clasm.js -o ./clasm.min.js \
		--source-map "content=clasm.js.map,url=clasm.min.js.map" \
		--warn --compress passes=10 \
		--mangle --mangle-props "regex=/^(m_|#)/" \
		--output-opts ascii_only
