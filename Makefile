JS_COMPILER ?= uglifyjs
KITCHEN_SINK ?= eddy.min.js timeline/eddy.timeline.js examples/js/vendor/d3.v2.min.js examples/js/vendor/raphael.min.js

all: \
	eddy.min.js \
	eddy.kitchensink.js \
	eddy.kitchensink.min.js

eddy.kitchensink.js:
	cat $(KITCHEN_SINK) > $@

%.min.js: %.js
	$(JS_COMPILER) $< > $@

clean:
	rm -f eddy.min.js
	rm -f eddy.kitchensink*.js
