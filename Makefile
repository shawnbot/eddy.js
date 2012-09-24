JS_COMPILER ?= uglifyjs

all: eddy.min.js

%.min.js: %.js
	$(JS_COMPILER) $< > $@

clean:
	rm -f eddy.min.js
