(function(exports) {

    /*
     * These are the eddy.timeline option defaults. You can modify them in
     * eddy.timeline.defaults.
     *
     * eddy.timeline requires:
     * 1. d3 version 2.9.0+
     * 2. Raphael version 2.1.0+
     */
    var defaults = {
        // where to put the timeline in the DOM
        "parent": "#timeline",
        // whether and how to smooth values (see: d3.svg.area.interpolate)
        "smooth": "monotone",
        // whether to automatically increment the total toward the last minute
        // when the end of the timeline is selected
        "autoIncrement": false,
        // minimum values for history and filter y-axis scales
        // (if null or NaN, we use the value of the history count minimum)
        "historyMin": null,
        "filterMin": null,
        // whether to "nice" the y-axis scale (which usually creates some
        // padding at top and bottom)
        "nice": false
    };

    eddy.timeline = function(options) {
        // set up options by merging the defaults with the provided object
        options = eddy.util.merge({}, eddy.timeline.defaults, options);
        // console.log("eddy.timeline(" + JSON.stringify(options) + ")");

        // this should work whether you construct an instance with `new
        // eddy.timeline()` or just `eddy.timeline()`.
        var timeline = (this instanceof eddy.timeline)
            ? this
            : {};
        // set up event dispatching
        eddy.dispatch(timeline);

        // so you can modify these from the outside?
        timeline.options = options;

        // dimensions in pixels
        var dims = {x: 400, y: 80},
            // padding [top, right, bottom, left]
            padding = [0, 0, 0, 0],
            // x (time) and y (volume) scales
            xx = d3.scale.linear().clamp(true),
            yy = d3.scale.linear().clamp(true);

        // local variables
        var parent,
            paper,
            historyPath,
            filterPath,
            cursor,
            selectedTime,
            selectedFilter,
            previousData,
            currentData,
            updated = false,
            timeStep = 60;

        var dateFormat = d3.time.format("%I:%M%p");
        timeline.formatTime = function(time) {
            var date = new Date(time * 1000);
            return dateFormat(date)
                .toLowerCase()
                .replace(/^0+/g, "")
                .replace(":00", "");
        };

        timeline.formatCount = d3.format(",0");

        // attach the timeline to a parent node specified as a CSS selector
        timeline.attach = function(selector) {
            parent = d3.select(selector)
                .on("mousedown", onMouseDown);

            paper = new Raphael(parent.node());

            historyPath = paper.path()
                .data("ymin", options.historyMin)
                .attr(options.historyStyle || {
                    "fill": "#000",
                    "stroke": null
                });

            filterPath = paper.path()
                .data("ymin", options.filterMin)
                .attr(options.filterStyle || {
                    "fill": "#f0f",
                    "stroke": null
                });

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
                .text(" tweets");

            text.append("span")
                .attr("class", "since")
                .text(" from ")
                .append("span")
                    .attr("class", "since-time");

            text.append("span")
                .attr("class", "time-label")
                .text(" to ");
            text.append("span")
                .attr("class", "time");

            // expose as public
            timeline.historyPath = historyPath;
            timeline.filterPath = filterPath;
            timeline.cursor = cursor;

            resize();

            return timeline;
        };

        timeline.detach = function() {
            paper.remove();
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
        timeline.update = function(data, animate) {
            previousData = currentData;
            currentData = data;

            // public access
            timeline.currentData = currentData;

            var history = currentData.history;
            timeStep = currentData.time.period;

            // previous time scale
            var prevTime = xx.domain(),
                lastSelected = (selectedTime === prevTime[1]);

            var first = history[0],
                last = history[history.length - 1];
            xx.domain([first.time, last.time]);

            var counts = history.map(function(h) {
                return h.count;
            });

            counts.sort();
            var extent = d3.extent(counts);
            yy.domain(extent);

            if (options.nice) {
                yy.nice();
            }

            if (!updated) {
                var emptyHistory = getEmptyHistory();
                updatePath(historyPath, emptyHistory, false);
                updatePath(filterPath, emptyHistory, false);
            }

            updatePaths(animate);

            updated = true;

            if (!selectedTime || lastSelected) {
                timeline.selectTime(xx.domain()[1]);
            } else {
                updateSelectedTime();
            }
            return timeline;
        };

        // set the selected time
        timeline.selectTime = function(time, silent) {
            if (selectedTime !== time) {
                selectedTime = time;
                updateSelectedTime();

                var lastSelected = selectedTime === xx.domain()[1];
                if (!silent) {
                    timeline.dispatch("select", time, lastSelected);
                }

                if (lastSelected && options.autoIncrement) {
                    var history = currentData.history,
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

        timeline.selectFilter = function(filterId, animate) {
            selectedFilter = filterId;
            updateFilterPath(animate);
            return timeline;
        };

        var incrementInterval;
        timeline.startIncrementing = function(start, end, duration) {
            clearInterval(incrementInterval);

            if (end < start) {
                start = 0;
            }

            var count = start,
                span = end - start,
                tpms = span / duration,
                interval = 10,
                tpinterval = tpms * interval,
                counter = cursor.select(".total")
                    .text(timeline.formatCount(count));

            // console.log(span, "incrementing tweet count by", tpinterval, "every", interval, "ms");
            incrementInterval = setInterval(function() {
                count += tpinterval;
                counter.text(timeline.formatCount(~~count));
            }, interval);

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

        // time -> history index
        timeline.timetoindex = function(time) {
            var scale = xx.copy()
                .rangeRound([0, currentData.history.length - 1]);
            return scale(time);
        };

        // x -> history index
        timeline.xtoindex = function(x) {
            var scale = d3.scale.linear()
                .domain(xx.range())
                .rangeRound([0, currentData.history.length - 1]);
            return scale(x);
        };

        timeline.stepTime = function(secondOffset) {
            if (selectedTime) {
                var timeDomain = xx.domain(),
                    time = selectedTime + secondOffset;
                if (secondOffset < 0) {
                    time = Math.max(time, timeDomain[0]);
                } else {
                    time = Math.min(time, timeDomain[1]);
                }
                return timeline.selectTime(time);
            } else {
                return false;
            }
        };

        timeline.addKeyHandlers = function(dispatcher) {
            if (!dispatcher) dispatcher = window;
            dispatcher.addEventListener("keydown", onKeyUp);
            return timeline;
        };

        timeline.removeKeyHandlers = function(dispatcher) {
            if (!dispatcher) dispatcher = window;
            dispatcher.removeEventListener("keydown", onKeyUp);
            return timeline;
        };

        function resize() {
            var width = dims.x,
                height = dims.y,
                innerWidth = width - (padding[1] + padding[3]),
                innerHeight = height - (padding[0] + padding[2]);

            xx.range([padding[3], width - padding[1]]);
            yy.range([height - padding[2], padding[0]]);

            paper.setSize(width, height);

            updatePaths();

            updateCursorPosition();
        }

        function updatePaths(animate) {
            if (currentData) {
                updatePath(historyPath, currentData.history, animate);
                updateFilterPath(animate);
            } else {
                var emptyHistory = getEmptyHistory();
                updatePath(historyPath, emptyHistory, animate);
                updatePath(filterPath, emptyHistory, animate);
            }
        }

        function updateFilterPath(animate) {
            if (currentData && selectedFilter) {
                var filter = (typeof selectedFilter === "object")
                    ? selectedFilter
                    : ("filtersById" in currentData)
                        ? currentData.filtersById[selectedFilter]
                        : null;
                if (filter && filter.history) {
                    console.log("filter history:", filter.history.map(function(h) {
                        return h.count;
                    }));
                    updatePath(filterPath, filter.history, animate);
                } else {
                    console.warn("no such filter found:", selectedFilter);
                }
            } else {
                var emptyHistory = getEmptyHistory();
                updatePath(filterPath, emptyHistory, animate);
            }
        }

        function getEmptyHistory() {
            var timeDomain = xx.domain(),
                times = d3.range(timeDomain[0], timeDomain[1] + timeStep, timeStep);
            return times.map(function(time) {
                return {
                    "time": time,
                    "count": 0,
                    "total": 0
                };
            });
        }

        function updatePath(path, history, animate) {
            var height = yy.copy();

            // apply custom scale domains
            var ymin = path.data("ymin");
            if (!isNaN(ymin)) {
                height.domain([ymin, height.domain()[1]]);
            }

            var area = d3.svg.area()
                .x(function(h) { return xx(h.time); })
                .y0(yy.range()[0])
                .y1(function(h) { return height(h.count); });
            if (options.smooth) {
                area.interpolate(options.smooth);
            }
            var coords = area(history);
            if (animate) {
                var animation = {
                    "ms":       300,
                    "easing":   "linear",
                    "callback": null
                };
                if (typeof animate === "object") {
                    eddy.util.merge(animation, animate);
                }
                path.animate({"path": coords},
                    animation.ms, animation.easing, animation.callback);
            } else {
                path.attr("path", coords);
            }
        }

        function updateSelectedTime() {
            if (selectedTime && currentData) {
                updateCursorPosition();

                cursor.style("visibility", "visible")

                cursor.select(".time")
                    .text(timeline.formatTime(selectedTime));

                var index = timeline.timetoindex(selectedTime),
                    datum = currentData.history[index],
                    count = datum ? datum.count : 0,
                    total = datum ? datum.total : 0;

                cursor.select(".total")
                    .text(timeline.formatCount(total));

                cursor.select(".marker")
                    .style("top", ~~yy(count) + "px");

                if (datum.usage) {
                    cursor.select(".since")
                        .style("display", null)
                        .select(".since-time")
                            .text(timeline.formatTime(datum.usage.start));
                } else {
                    cursor.select(".since")
                        .style("display", "none");
                }

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
            timeline.selectTime(time);
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

        function onKeyUp(e) {
            var offset = 0;
            switch (e.keyCode) {
                case 37: // left
                    offset = -timeStep;
                    break;
                case 39: // right
                    offset = +timeStep;
                    break;
            }
            if (offset != 0) {
                var multiplier = e.shiftKey ? 10 : 1;
                timeline.stepTime(offset * multiplier);
            }
        }

        return timeline.attach(options.parent);
    };

    // export defaults for public modification
    eddy.timeline.defaults = defaults;

})(this);
