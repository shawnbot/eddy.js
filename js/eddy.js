// DummyConsole
if (!window.console) (function(b){function c(){}for(var d=["error","info","log","warn"],a;a=d.pop();)b[a]=b[a]||c})(window.console=window.console={});

if (typeof Eddy === "undefined") Eddy = {};

(function($) {

    // utility functions
    Eddy.Util = {
        // sum the provided numbers
        sum: function(numbers, map) {
            if (typeof map === "function") numbers = numbers.map(map);
            return numbers.reduce(function(a, b) { return a + b; }, 0);
        },
        // get the values in a dictionary
        values: function(dict) {
            var values = [];
            for (var key in dict) {
                values.push(dict[key]);
            }
            return values;
        }
    };

    // extend the child object with keys from one or more parent objects
    Eddy.extend = function(child, parent1, parent2, parentN) {
        var parents = Array.prototype.slice.call(arguments, 1),
            len = parents.length;
        for (var i = 0; i < len; i++) {
            var parent = parents[i];
            for (var key in parent) {
                child[key] = parent[key];
            }
        }
        return child;
    };

    /**
     * Event dispatch mixin. E.g.:
     * var Class = function() { ... };
     * Eddy.extend(Class.prototype, Eddy.Events, {
     *   ...
     * });
     */
    Eddy.Events = {
        id: 0,
        bind: function(event, callback, context) {
            if (!this._callbacks) {
                this._callbacks_id = ++Eddy.Events.id;
                this._callbacks = {};
            }
            if (!this._callbacks[event]) this._callbacks[event] = new $.Callbacks("unique stopOnFalse");
            if (context) {
                var bound = $.proxy(callback, context);
                callback["_bound" + this._callbacks_id] = bound;
                callback = bound;
            }
            this._callbacks[event].add(callback);
        },
        unbind: function(event, callback) {
            if (!this._callbacks || !this._callbacks[event]) return;
            this._callbacks[event].remove(callback["_bound" + this._callbacks_id] || callback);
        },
        trigger: function(event, data) {
            if (!this._callbacks || !this._callbacks[event]) return;
            return this._callbacks[event].fire(data);
        }
    };
    // aliases for jQuery 1.7-style bind interface
    Eddy.Events.on = Eddy.Events.bind;
    Eddy.Events.off = Eddy.Events.unbind;
    Eddy.Events.fire = Eddy.Events.trigger;

    /**
     * The Loader repeatedly loads JSON data from Eddy.
     */
    Eddy.Loader = function(options) {
        if (typeof options !== "object") {
            throw "Eddy.Loader() expects an options object; got " + (typeof options);
        }
        this.baseURL = options.baseURL;
        this.lastURI = options.lastURI;
        this.options = options;
    };

    Eddy.extend(Eddy.Loader.prototype, Eddy.Events, {
        baseURL: null,
        lastURI: null,
        loaded: 0,
        latency: 0,
        nextTimeout: null,
        retries: 0,
        maxRetries: 10,

        start: function(nextURI, resetLoaded) {
            console.log("[loader] start(", [nextURI, resetLoaded || false], ")");
            if (resetLoaded) loaded = 0;
            this.abortNext();
            return this.load(nextURI || this.lastURI);
        },

        stop: function(message) {
            this.abortNext();
            this.trigger("stop", {message: message});
        },

        getCallback: function(uri) {
            var parts = uri.split(".");
            return parts[0].replace(/[^\w]/g, "_");
        },

        abortNext: function() {
            if (this.nextTimeout) {
                clearTimeout(this.nextTimeout);
                return true;
            } else {
                return false;
            }
        },

        ajax: $.ajax,

        next: function(nextURI, wait) {
            var self = this;
            console.log("loader.next(", [nextURI, wait, this.latency], ")");
            this.next.uri = nextURI;
            this.next.wait = wait;
            if (wait > 0) {
                var timeout = wait * 1000;
                if (this.latency > timeout) {
                    console.warn("latency > timeout:",
                        (this.latency / 1000).toFixed(2) + "s vs.",
                        (timeout / 1000).toFixed(2) + "s",
                        "; ignoring!"
                    );
                } else {
                    timeout -= this.latency;
                }
                return setTimeout(function() {
                    self.load(nextURI);
                },  timeout);
            } else {
                // still defer it
                return setTimeout(function() {
                    self.load(nextURI);
                }, 1);
            }
        },

        load: function(uri) {
            this.abortNext();
            var self = this,
                url = this.baseURL + uri,
                time = Date.now();

            this.trigger("loading", {url: url});

            return this.ajax(url, {
                dataType: "jsonp",
                jsonpCallback: this.getCallback(uri),
                cache: true
            })
            .done(function(data) {
                var latency = self.latency = Date.now() - time;
                console.info("* load took:", (latency / 1000).toFixed(2), "seconds");
                self.retries = 0;
                self.trigger("load", data);
                // console.log("loader.load() [success]:", data);
                var next = data.next
                        ? data.next.href
                        : null,
                    wait = data.next
                        ? data.next.wait
                        : null;
                if (next) {
                    // self.stop("Stopping because it's broken");
                    self.nextTimeout = self.next(next, wait);
                } else {
                    self.stop("No next.href in response");
                }
            })
            .fail(function(req) {
                if (self.retries >= self.maxRetries) {
                    self.stop("Too many retries (" + self.retries + ")");
                    return;
                } else {
                    self.trigger("error", {message: req.statusText});
                    var wait = self.next.wait || 10;
                    console.warn("error loading; retrying in", wait, "seconds...");
                    self.nextTimeout = self.next(uri, wait); // FIXME: how long should we wait here?
                    self.retries++;
                }
            });
        }
    });


    /**
     * Eddy data munging utilities.
     */
    Eddy.Data = {

        prepareHistory: function(data) {
            if (!data.history) return false;

            var sumHistory = Eddy.Util.sum(data.history),
                currentCount = 0;
            if (data.currentUsage) {
                currentCount = data.currentUsage.count;
            } else {
                currentCount = sumHistory;
            }

            var start = currentCount - sumHistory;
            data.history = Eddy.Data.makeRunningHistory(data.history, start, data.time);
        },

        /**
         * Prepare filter data by attaching new properties, like "id", "count",
         * and "name", for data sources that don't provide them.
         */
        prepareFilters: function(data) {
            Eddy.Data.prepareUsages(data);
            Eddy.Data.prepareHistory(data);

            // get a dictionary of filters by name
            var filtersByName = {};
            data.filters.forEach(function(filter) {
                filtersByName[filter.name] = filter;
                if (!filter.usage) filter.usage = {};
            });

            if (data["filter usage"] instanceof Array) {
                data["filter usage"].forEach(function(usage) {
                    var label = usage.label;
                    for (var name in usage.counts) {
                        if (name in filtersByName) {
                            // console.log("filter usage", [name, filtersByName[name], usage.counts[name]]);
                            filtersByName[name].usage[label] = usage.counts[name];
                        } else {
                            console.warn("filter usage (no filter):", name, usage.counts[name]);
                        }
                    }
                });

                if (data.currentUsage) {
                    var label = data.currentUsage.label;
                    data.filters.forEach(function(filter) {
                        filter.count = filter.usage[label];
                    });
                }
            }

            data.filters.forEach(function(filter) {
                if (!filter.id) {
                    filter.id = filter.name.replace(/\W+/g, "_").toLowerCase();
                }

                // tweets per minute
                filter.tpm = filter.history[filter.history.length - 1];

                var sumHistory = Eddy.Util.sum(filter.history);
                if (!filter.total) {
                    filter.total = sumHistory;
                }
                var start = filter.total - sumHistory;
                if (start < 0) {
                    console.warn("negative running count start:", start,
                        "(count:", filter.total, "; sum history:", sumHistory, ")");
                    start = 0;
                }
                filter.counts = filter.history.slice();
                filter.history = Eddy.Data.makeRunningHistory(filter.history, start, data.time);
            });

        },

        /**
         * Prepare minute data
         */
        prepareMinutes: function(data) {
            Eddy.Data.prepareUsages(data);

            var filtersById = data.filters;
            data.minutes.forEach(function(minute) {
                minute.filters = minute.filters.map(function(idCount) {
                    return {
                        filter: filtersById[idCount[0]],
                        count: idCount[1]
                    };
                });
            });

            data.history = data.minutes.map(function(minute) {
                return minute.tweets.count;
            });

            Eddy.Data.prepareHistory(data);

            data.filters = Eddy.Util.values(filtersById)
                .sort(function(a, b) {
                    return a.name > b.name ? 1 : a.name === b.name ? 0 : -1;
                });
        },

        /**
         * Prepare minute data
         */
        prepareRetweets: function(data) {
            Eddy.Data.prepareUsages(data);
            Eddy.Data.prepareHistory(data);
        },

        prepareUsages: function(data) {
            var time = data.time,
                start = time.start || time.start_time,
                period = time.period,
                end = start + period * (data.history.length - 1);
            console.log("start:", start, "end:", end);

            function usageIsCurrent(usage) {
                return (usage.start <= start && usage.end >= start)
                    || (usage.end >= start && usage.end <= end);
            }

            if (data.usage) {
                var lastActive = null,
                    // sort them by time, so we can figure out which is the last
                    sortedByTime = data.usage.sort(function(a, b) {
                        var end = b.end - a.end,
                            start = b.start - a.start;
                        return end || start;
                    }),
                    // sort them by count to find the biggest
                    sortedByCount = data.usage.sort(function(a, b) {
                        return b.count - a.count;
                    });
                // console.log("usages by time:", sortedByTime.map(function(u) { return [u.label, u.start].join(": "); }));
                // console.log("usages by count:", sortedByCount.map(function(u) { return [u.label, u.count].join(": "); }));
                
                sortedByTime.forEach(function(usage) {
                    usage.active = usageIsCurrent(usage);
                    console.log("usage active?", usage.label, [usage.start, "<=", [start, end].join(":"), "<=", usage.end], usage.active);
                    if (usage.active) {
                        lastActive = usage;
                    }
                });

                data.currentUsage = lastActive;
                data.biggestUsage = sortedByCount[0];
            }
        },

        makeRunningHistory: function(counts, startCount, time) {
            var runningCount = startCount,
                time = time.start_time,
                step = time.period;
            return counts.map(function(count) {
                var countTime = time;
                time += step;
                runningCount += count;
                return {
                    count: count,
                    time: countTime,
                    running: runningCount
                };
            });
        }

    };

    // query string parse/format
    Eddy.Util.QueryString = {
        parse: function(str) {
            if (str.charAt(0) === "?") {
                str = str.substr(1);
            }
            if (str.length === 0 || str.indexOf("=") === -1) {
                return {};
            }
            var parts = str.split("&"),
                len = parts.length;
                params = {};
            for (var i = 0; i < len; i++) {
                var kv = parts[i].split("=");
                params[decodeURIComponent(kv[0])] = (kv.length === 2)
                    ? decodeURIComponent(kv[1])
                    : true;
            }
            return params;
        },
        format: function(params) {
            var parts = [],
                i = 0;
            for (var key in params) {
                if (i++ > 0) parts.push("&");
                var value = params[key];
                if (value !== null) {
                    parts.push(encodeURIComponent(key), "=", encodeURIComponent(value));
                }
            }
            return parts.join("");
        }
    };

})(jQuery);
