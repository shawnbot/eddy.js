(function(exports) {

    /*
     * These are the eddy.timeline option defaults. You can modify them in
     * eddy.timeline.defaults.
     */
    var defaults = {
        // where to put the timeline in the DOM
        "parent": "#timeline",
        // whether and how to smooth values (see: d3.svg.area.interpolate)
        "smooth": "monotone",
        // whether to automatically increment the total toward the last minute
        // when the end of the timeline is selected
        "incrementLastCount": false,
        // whether to "nice" the y-axis scale (which usually creates some
        // padding at top and bottom)
        "nice": false,
    };

    eddy.timeline = function(options) {
        // set up options by merging the defaults with the provided object
        options = eddy.util.merge({}, eddy.timeline.defaults, options);

        // this should work whether you construct an instance with `new
        // eddy.timeline()` or just `eddy.timeline()`.
        var timeline = (this instanceof eddy.timeline)
            ? this
            : {};
        // set up event dispatching
        eddy.dispatch(timeline);

        // dimensions in pixels
        var dims = {x: 400, y: 80},
            // padding [top, right, bottom, left]
            padding = [0, 0, 0, 0],
            // x (time) and y (volume) scales
            xx = d3.scale.linear().clamp(true),
            yy = d3.scale.linear().clamp(true);

        // local variables
        var parent,
            root,
            mouseRect,
            blob,
            cursor,
            selectedTime,
            timeStep = 60;

        var dateFormat = d3.time.format("%I:%M%p");
        timeline.formatTime = function(time) {
            var date = new Date(time * 1000);
            return dateFormat(date)
                .toLowerCase()
                .replace(/^0+/g, "");
        };

        timeline.formatCount = d3.format(",0");

        // attach the timeline to a parent node specified as a CSS selector
        timeline.attach = function(selector) {
            parent = d3.select(selector)
                .on("mousedown", onMouseDown);

            root = parent.append("svg")
                .attr("class", "timeline");

            blob = root.append("path")
                .attr("class", "history")
                .datum([
                    {"time": 0, "count": 0},
                    {"time": 1, "count": 0}
                ]);

            mouseRect = root.append("rect")
                .attr("width", "100%")
                .attr("height", "100%")
                .attr("fill", "none")
                .attr("pointer-events", "all")
                .style("cursor", "ew-resize");

            cursor = parent.append("div")
                .attr("class", "cursor")
                .style("position", "absolute")
                .style("top", "0px")
                .style("height", "100%");

            // the cursor is positioned at the selected time and displays the
            // time and tweet total at that point
            cursor.append("div")
                .attr("class", "line")
                .style("visibility", "hidden");

            cursor.append("div")
                .attr("class", "marker");

            // cursor text bits
            var text = cursor.append("div")
                .attr("class", "text");

            text.append("span")
                .attr("class", "total");
            text.append("span")
                .attr("class", "total-label")
                .text(" tweets as of ");
            text.append("span")
                .attr("class", "time");

            // expose as public
            timeline.area = blob;
            timeline.cursor = cursor;

            resize();

            return timeline;
        };

        timeline.detach = function() {
            root.remove();
        };

        // set the size in pixels
        timeline.setSize = function(width, height) {
            dims = {x: width, y: height};
            resize();
            return timeline;
        };

        // set the size automatically, based on the current dimensions of the
        // parent element
        timeline.autoSize = function() {
            var width = parent.property("offsetWidth"),
                height = parent.property("offsetHeight");
            dims = {x: width, y: height};
            resize();
            return timeline;
        };

        // get or set padding
        timeline.padding = function(p) {
            if (arguments.length) {
                if (p instanceof Array) {
                    switch (p.length) {
                        case 1: padding = [p[0], p[0], p[0], p[0]]; break;
                        case 2: padding = [p[0], p[1], p[0], p[1]]; break;
                        case 3: padding = [p[0], p[1], p[2], p[1]]; break;
                        default:
                            padding = p;
                    }
                } else if (typeof p === "object") {
                    padding = [p.top, p.right, p.bottom, p.left];
                } else if (!isNaN(p)) {
                    padding = [p, p, p, p];
                }
                resize();
                return timeline;
            } else {
                return padding.slice();
            }
        };

        // update with new history data
        timeline.update = function(data) {
            var history = data.history;

            timeStep = data.time.period;

            // previous time scale
            var prevTime = xx.domain(),
                lastSelected = (selectedTime === prevTime[1]);

            var first = history[0],
                last = history[history.length - 1];
            xx.domain([first.time, last.time]);

            var counts = history.map(function(h) {
                return h.count;
            });

            if (options.fromZero) {
                yy.domain([0, d3.max(counts)]);
            } else {
                counts.sort();
                var extent = d3.extent(counts);
                yy.domain(extent);
                if (options.nice) {
                    yy.nice();
                }
            }

            blob.datum(history)
                .call(updateBlob);

            if (!selectedTime || lastSelected) {
                timeline.selectTime(xx.domain()[1]);
            }
            return timeline;
        };

        // set the selected time
        timeline.selectTime = function(time) {
            if (selectedTime !== time) {
                selectedTime = time;
                updateSelectedTime();

                var lastSelected = selectedTime === xx.domain()[1];
                timeline.dispatch("select", time, lastSelected);

                if (lastSelected && options.incrementLastCount) {
                    var history = blob.datum(),
                        lastIndex = history.length - 1,
                        endCount = history[lastIndex].total,
                        startCount = history[lastIndex - 1].total;
                    timeline.startIncrementing(startCount, endCount, timeStep * 1000);
                } else {
                    timeline.stopIncrementing();
                }
            } else {
                // console.warn("same time:", time);
            }
            return timeline;
        };

        var incrementInterval;
        timeline.startIncrementing = function(start, end, duration) {
            clearInterval(incrementInterval);

            var count = start,
                span = end - start,
                tpms = span / duration,
                interval = 10,
                tpinterval = tpms * interval,
                counter = cursor.select(".total")
                    .text(timeline.formatCount(count));

            if (tpinterval > 0) {
                // console.log(span, "incrementing tweet count by", tpinterval, "every", interval, "ms");
                incrementInterval = setInterval(function() {
                    count += tpinterval;
                    counter.text(timeline.formatCount(~~count));
                }, interval);
            } else {
                console.warn("negative increment span:", [start, end], "->", span, "; not incrementing");
            }
            return timeline;
        };

        timeline.stopIncrementing = function() {
            clearInterval(incrementInterval);
            return timeline;
        };

        // x -> time
        timeline.xtotime = function(x) {
            var time = xx.invert(x);
            return ~~(time / timeStep) * timeStep;
        };

        // time -> x
        timeline.timetox = function(time) {
            return xx(time);
        };

        timeline.timetoindex = function(time) {
            var scale = xx.copy()
                .rangeRound([0, blob.datum().length - 1]);
            return scale(time);
        };

        // x -> history index
        timeline.xtoindex = function(x) {
            var scale = d3.scale.linear()
                .domain(xx.range())
                .rangeRound([0, blob.datum().length - 1]);
            return scale(x);
        };

        function resize() {
            var width = dims.x,
                height = dims.y,
                innerWidth = width - (padding[1] + padding[3]),
                innerHeight = height - (padding[0] + padding[2]);

            xx.range([padding[3], width - padding[1]]);
            yy.range([height - padding[2], padding[0]]);

            root.attr("width", width)
                .attr("height", height);

            blob.call(updateBlob);

            updateCursorPosition();
        }

        function updateBlob() {
            var area = d3.svg.area()
                .x(function(h) { return xx(h.time); })
                .y0(yy.range()[0])
                .y1(function(h) { return yy(h.count); });
            if (options.smooth) {
                area.interpolate(options.smooth);
            }
            this.attr("d", area);
        }

        function updateSelectedTime() {
            if (selectedTime) {
                updateCursorPosition();

                cursor.style("visibility", "visible")

                cursor.select(".time")
                    .text(timeline.formatTime(selectedTime));

                var index = timeline.timetoindex(selectedTime),
                    datum = blob.datum()[index],
                    count = datum ? datum.count : 0,
                    total = datum ? datum.total || 0 : 0;

                cursor.select(".total")
                    .text(timeline.formatCount(total));

                cursor.select(".marker")
                    .style("top", ~~yy(count) + "px");

            } else {
                cursor.style("visibility", "hidden");
            }
        }

        function updateCursorPosition() {
            var x = timeline.timetox(selectedTime);
            cursor.style("left", Math.round(x) + "px");
        }

        function onClickX(x) {
            var time = timeline.xtotime(x);
            // console.log(x, "->", time);
            timeline.selectTime(time, true);
        }

        var mousedown = false;
        function onMouseDown() {
            var mouse = d3.mouse(this),
                x = mouse[0];
            onClickX(x);
            parent.on("mousemove", function() {
                mouse = d3.mouse(this);
                x = mouse[0];
                onClickX(x);
            });
            d3.select("body").on("mouseup", onMouseUp);
            mousedown = true;

            d3.event.preventDefault();
        }

        function onMouseUp() {
            parent.on("mousemove", null);
            d3.select("body").on("mouseup", null);
            mousedown = false;
        }

        return timeline.attach(options.parent);
    };

    eddy.timeline.defaults = defaults;

})(this);
