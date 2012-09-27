JS_COMPILER ?= uglifyjs
KITCHEN_SINK ?= eddy.min.js lib/d3.v2.min.js lib/raphael.min.js

all: \
	eddy.min.js \
	goodies/eddy.timeline.min.js \
	eddy.kitchensink.js \
	eddy.kitchensink.min.js

eddy.kitchensink.js:
	cat $(KITCHEN_SINK) > $@

%.min.js: %.js
	$(JS_COMPILER) $< > $@

clean:
	rm -f eddy.kitchensink.js
	rm -f eddy*.min.js
	rm -f goodies/eddy*.min.js
