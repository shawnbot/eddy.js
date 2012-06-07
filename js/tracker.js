// DummyConsole
if (!window.console) (function(b){function c(){}for(var d=["error","info","log","warn"],a;a=d.pop();)b[a]=b[a]||c})(window.console=window.console={});

if (typeof Tracker === "undefined") Tracker = {};

(function($) {

    /**
     * Event dispatch mixin. E.g.:
     * var Class = function() { ... };
     * $.extend(Class.prototype, Tracker.Events, {
     *   ...
     * });
     */
    Tracker.Events = {
        id: 0,
        bind: function(event, callback, context) {
            if (!this._callbacks) {
                this._callbacks_id = ++Tracker.Events.id;
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
    Tracker.Events.on = Tracker.Events.bind;
    Tracker.Events.off = Tracker.Events.unbind;
    Tracker.Events.fire = Tracker.Events.trigger;

    // utility functions
    Tracker.Util = {
        // sum the provided numbers
        sum: function(numbers) {
            return numbers.reduce(function(a, b) { return a + b; }, 0);
        },
        values: function(dict) {
            var values = [];
            for (var key in dict) {
                values.push(dict[key]);
            }
            return values;
        }
    };

    /**
     * Tracker.App is the controller.
     */
    Tracker.App = function(options) {
        this.initialize(options);
    };

    /**
     * Tracker.App constructor option defaults. Provided options are merged in with
     * these for each instance.
     */
    Tracker.App.DEFAULTS = {
        root:   "body",
        view:   "#view",
        index:  "#index",
        nav:    "#nav",
        loaders: {
            filters: {
                baseURL: "",
                lastURI: "history-last.jsonp"
            }
        }
    };

    $.extend(Tracker.App.prototype, Sammy.Application.prototype, Tracker.Events, {
        // the current view
        view: null,
        // dictionary of views by id
        viewsById: null,

        // loaders
        loaders: null,
        mainLoader: null,
        photoLoader: null,

        // attachment points
        $root: null,
        $view: null,
        $nav: null,

        /**
         * This is essentially the constructor.
         */
        initialize: function(options) {
            // stash a reference to this for inline functions
            var self = this;

            this.options = $.extend(Tracker.App.DEFAULTS, options);

            // set up loaders
            this.setupLoaders(this.options.loaders);

            this.bind("prepare:filters", Tracker.Eddy.prepareFilters);
            this.bind("prepare:minutes", Tracker.Eddy.prepareMinutes);
            this.bind("prepare:retweets", Tracker.Eddy.prepareRetweets);

            // initialize the views dictionary
            this.viewsById = {};

            // setup Sammy
            this.element_selector = this.options.root;
            Sammy.Application.call(this, this.setupRoutes);

            // set up jQuery references to important elements
            this.$root = this.$element(); // courtesy of Sammy
            // this.$element() is a scoped jQuery selection
            this.$index = this.$element(this.options.index);
            this.$view = this.$element(this.options.view);
            this.$nav = this.$element(this.options.nav);
        },

        /**
         * Set up loaders.
         */
        setupLoaders: function(loaders) {
            this.loaders = {};
            var self = this;
            for (var name in loaders) {
                var options = loaders[name],
                    loader = new Tracker.Loader(options);
                loader.name = name;
                loader.bind("load", $.proxy(function(data) {
                    var loader = this,
                        name = loader.name,
                        valid = self.validateData(data, name, options);
                    if (valid) {
                        console.info("preparing (" + name + "):", data);
                        self.trigger("prepare:" + name, data);
                        console.log("prepared data (" + name + "):", data);
                        self.applyData(data, name);
                        loader.data = data;
                    } else {
                        console.warn("validate:" + name, "failed; not applying", data);
                    }
                }, loader));
                this.loaders[name] = loader;
            }
        },

        /**
         * Set up default routes.
         */
        setupRoutes: function() {
            var self = this;

            // set up the index view
            this.get("#/", function() {
                console.log("[app] view index");
                self.showIndex();
            });

            // set up a parameterized view handler to switch between views
            this.get("#/:view", function() {
                console.log("[app] view:", this.params.view);
                if (this.params.view in self.viewsById) {
                    self.setViewById(this.params.view, this.params);
                } else {
                    this.redirect("#/");
                }
            });

            // update the nav whenever a route runs
            this.bind("run-route", function(e) {
                self.updateNav();
            });
        },

        /**
         * Run the app: call Sammy.Application.run(),
         * then start the loading!
         */
        run: function(path) {
            Sammy.Application.prototype.run.call(this, path);
            this.startLoaders();
        },

        // start all loaders
        startLoaders: function() {
            for (var name in this.loaders) {
                this.loaders[name].start();
            }
        },

        // stop all loaders
        stopLoaders: function() {
            for (var name in this.loaders) {
                this.loaders[name].stop();
            }
        },

        // "apply" data, which just triggers an "update:{name}" event
        applyData: function(data, name, dataOptions) {
            this.trigger("update:" + name, data);
        },

        /**
         * Re-apply already loaded data for all loaders, presumably for views
         * that weren't attached when they were originally loaded.
         */
        applyCurrentData: function() {
            for (var name in this.loaders) {
                var loader = this.loaders[name],
                    data = loader.data;
                if (data) {
                    this.applyData(data, name, loader.options);
                }
            }
        },

        /**
         * Validate loaded data. This gets called in the "load" handler for each
         * handler, and should return true if there's any data to be applied in
         * the loaded data object. The name of the loader can be used to figure
         * out what to look for. (E.g., in "filters" data, there should be an
         * array of filters in data.filters.);
         */
        validateData: function(data, name, dataOptions) {
            // if a validator was provided, use that
            if (dataOptions && typeof dataOptions.validate === "function") {
                return dataOptions.validate(data);
            }

            if (name === "filters") {
                return data.filters instanceof Array;
            } else {
                return data.history instanceof Array;
            }
        },

        /**
         * Update the navigation items with the "active" class if they have an
         * href that matches our location.
         */
        updateNav: function() {
            if (!this.$nav) return false;
            var current = "#" + this.getLocation().split("#").pop();
            this.$nav.children().each(function() {
                var item = $(this),
                    href = item.attr("href") || item.find("a").attr("href") || "";
                item.toggleClass("active", href == current || (href.length > 2 && current.indexOf(href) === 0));
            });
            return true;
        },

        /**
         * Register a view. This should be an Tracker.View instance with an id.
         */
        registerView: function(view) {
            if (!view.id) {
                throw "App.registerView() requires a view with an id";
            }
            this.viewsById[view.id] = view;
            if (typeof view.setupRoutes === "function") {
                view.setupRoutes(this);
            }
            return view;
        },

        /**
         * Unregister the view.
         * XXX This will not unregister location handlers initialized with
         * View.setupRoutes()!
         */
        unregisterView: function(view) {
            if (view.id in this.viewsById) {
                delete this.viewsById[view.id];
                // TODO tear down routes?
                if (this.view === view) {
                    this.setView(null);
                }
                return true;
            } else {
                return false;
            }
        },

        /**
         * Show the index, detaching the current view.
         */
        showIndex: function() {
            this.setView(null);
        },

        /**
         * Detach the existing view, attach the provided one, and apply
         * parameters as necessary. Views are only detached and attached if
         * different from the currently active one.
         */
        setView: function(view, params) {
            if (this.view !== view) {
                if (this.view) {
                    this.view.detach(this.$view, this);
                    this.$root
                        .removeClass("view-" + this.view.id)
                        .removeClass("has-view");
                }
                this.view = view;
                if (this.view) {
                    this.view.attach(this.$view, this);
                    this.$root
                        .addClass("view-" + this.view.id)
                        .addClass("has-view");
                    // apply current data to the existing view
                    this.applyCurrentData();
                }
            }
            if (this.view && params) {
                this.view.setParams(params);
            }
            return true;
        },

        /**
         * Set the current view by id. This just looks up the View instance in
         * viewsById and passes it to setView().
         */
        setViewById: function(id, params) {
            var view = this.viewsById[id];
            return this.setView(view, params);
        },

        getLocationWithParams: function(params, append) {
            var loc = "#" + this.getLocation().split("#").pop(),
                parts = loc.split("?"),
                path = parts[0],
                query = (parts.length > 1)
                    ? parts[1]
                    : "";
            if (append) {
                query = new QueryString(query);
                // console.log("current query:", query.params);
                query.update(params, append);
                // console.log("new query:", query.params);
            } else {
                query = new QueryString(params);
            }
            return path + query.toString();
        },

        setLocationParams: function(params, append) {
            var fullPath = this.getLocationWithParams(params, append);
            this.setLocation(fullPath);
        }

    });


    /**
     * Eddy data munging utilities.
     */
    Tracker.Eddy = {

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
        },

        prepareHistory: function(data) {
            if (!data.history) return false;

            var sumHistory = Tracker.Util.sum(data.history),
                currentCount = 0;
            if (data.currentUsage) {
                currentCount = data.currentUsage.count;
            } else {
                currentCount = sumHistory;
            }

            var start = currentCount - sumHistory;
            data.history = Tracker.Eddy.makeRunningHistory(data.history, start, data.time);
        },

        /**
         * Prepare filter data by attaching new properties, like "id", "count",
         * and "name", for data sources that don't provide them.
         */
        prepareFilters: function(data) {
            Tracker.Eddy.prepareUsages(data);
            Tracker.Eddy.prepareHistory(data);

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

                var sumHistory = Tracker.Util.sum(filter.history);
                if (!filter.count) {
                    filter.count = sumHistory;
                }
                var start = filter.count - sumHistory;
                if (start < 0) {
                    console.warn("negative running count start:", start,
                        "(count:", filter.count, "; sum history:", sumHistory, ")");
                    start = 0;
                }
                filter.history = Tracker.Eddy.makeRunningHistory(filter.history, start, data.time);
            });

        },

        /**
         * Prepare minute data
         */
        prepareMinutes: function(data) {
            Tracker.Eddy.prepareUsages(data);

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

            Tracker.Eddy.prepareHistory(data);

            data.filters = Tracker.Util.values(filtersById)
                .sort(function(a, b) {
                    return a.name > b.name ? 1 : a.name === b.name ? 0 : -1;
                });
        },

        /**
         * Prepare minute data
         */
        prepareRetweets: function(data) {
            Tracker.Eddy.prepareUsages(data);
            Tracker.Eddy.prepareHistory(data);
        }

    };

    /**
     * View represents a distinct view for the controller.
     */
    Tracker.View = function(id, options) {
        this.initialize(id, options);
    };

    /**
     * Convenience static method for extending Tracker.View, e.g.:
     *
     * var MyViewClass = Tracker.View.extend({
     *   attach: function($root, app) {
     *     ...
     *   }
     * });
     */
    Tracker.View.extend = function(prototype) {
        var ctor = function(id, options) {
            this.initialize(id, options);
        };
        $.extend(ctor.prototype, Tracker.View.prototype, prototype);
        return ctor;
    };

    $.extend(Tracker.View.prototype, Tracker.Events, {
        // jQuery element onto which the view is "attached"
        $root: null,
        // whether the view is attached to the DOM
        attached: false,
        // a reference to the app which attached this view
        app: null,

        /**
         * This is essentially the class constructor. which takes an id and
         * optional dictionary of options.
         */
        initialize: function(id, options) {
            this.id = id;
            this.options = options || {};
        },

        /**
         * Attach this view to the provided jQuery element and associate it with
         * the provided Tracker.App instance. If you do other stuff here, you
         * should call the super:
         *
         * var MyViewClass = Tracker.View.Extend({
         *   attach: function($root, app) {
         *     Tracker.View.prototype.attach.call(this, $root, app);
         *     app.bind("update:filters", this.update, this);
         *     // other stuff
         *   }
         * });
         */
        attach: function($root, app) {
            if (this.attached) {
                throw "View.attach() called on already attached view!";
            }
            this.$root = $root;
            this.attached = true;
            this.app = app;
        },

        /**
         * Detach this view from the provided jQuery element and associated
         * Tracker.App instance. If you do other stuff here, you
         * should call the super, preferably afterward, since it will unset
         * references to this.$root and this.app:
         *
         * var MyViewClass = Tracker.View.Extend({
         *   detach: function($root, app) {
         *     app.unbind("update:filters", this.update, this);
         *     Tracker.View.prototype.detach.call(this, $root, app);
         *   }
         * });
         */
        detach: function($root, app) {
            if (!this.attached) {
                throw "View.detach() called on detached view!";
            }
            this.$root = null;
            this.attached = false;
            this.app = null;
        },

        /**
         * Setup location.hash routes when registered. This gets called from
         * Tracker.App.registerView(), and is optional. For instance, if you
         * want to set up a route that passes an additional parameter to the
         * view, you can do this:
         *
         * setupRoutes: function(app) {
         *   this.setupSubRoute(app, ":filter");
         * }
         *
         * See Tracker.View.setupSubRoute() for more info.
         */
        setupRoutes: function(app) {
        },

        /**
         * This is a convenience method for establishing sub-path routes to this
         * view in the associated app. It adds a new route prefixed with the
         * view's id, the handler for which sets the app's view to this and
         * passes along any additional parameters parsed from the path, which
         * should result in a call to the view's setParams() method. E.g.:
         *
         * var FilterView = Tracker.View.extend({
         *   setupRoutes: function(app) {
         *     this.setupSubRoute(app, "filters/:filter");
         *   },
         *   setParams: function(params) {
         *     this.selectFilter(params.filter);
         *   },
         *   selectFilter: function(id) {
         *     // select the filter if provided, or deselect if null
         *   }
         * });
         */
        setupSubRoute: function(app, subpath, callback) {
            var self = this;
            app.get(["#", this.id, subpath].join("/"), function() {
                app.setView(self, this.params);
                if (callback) callback.call(self, this.params);
            });
        },

        /**
         * Set view parameters. This is called automatically from the registered
         * app whenever location.hash changes, and will contain only a "view"
         * key with this view's "id" as its value unless any additional routes
         * were explicitly set up in setupRoutes().
         */
        setParams: function(params) {
            console.log("[view] setParams():", JSON.stringify(params));
            this.params = params;
        },
    });

    /**
     * The Loader repeatedly loads JSON data from Tracker.
     */
    Tracker.Loader = function(options) {
        if (typeof options !== "object") {
            throw "Tracker.Loader() expects an options object; got " + (typeof options);
        }
        this.baseURL = options.baseURL;
        this.lastURI = options.lastURI;
    };

    $.extend(Tracker.Loader.prototype, Tracker.Events, {
        baseURL: null,
        lastURI: null,
        loaded: 0,
        latency: 0,
        nextTimeout: null,

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

            return $.ajax(url, {
                dataType: "jsonp",
                jsonpCallback: this.getCallback(uri),
                cache: true
            })
            .done(function(data) {
                var latency = self.latency = Date.now() - time;
                console.info("* load took:", (latency / 1000).toFixed(2), "seconds");
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
                self.trigger("error", {message: req.statusText});
                var wait = self.next.wait || 10;
                console.warn("error loading; retrying in", wait, "seconds...");
                self.nextTimeout = self.next(uri, wait); // FIXME: how long should we wait here?
            });
        }
    });

    var QueryString = Tracker.Util.QueryString = function(params) {
        this.params = {};
        if (typeof params === "string") {
            this.parse(params);
        } else if (typeof params === "object") {
            this.params = params;
        }
    };

    QueryString.prototype = {
        params: null,
        clear: function() {
            this.params = {};
        },
        parse: function(str) {
            var parsed = QueryString.parse(str);
            return this.update(parsed);
        },
        update: function(params, append) {
            var old = this.params || (this.params = {});
            if (!append) this.params = {};
            var changed = {};
            for (var key in params) {
                if (!key) continue; // skip empty keys
                var value = params[key];
                if (old[key] != value) {
                    changed[key] = value;
                }
                this.params[key] = value;
            }
            return changed;
        },
        toString: function() {
            var str = QueryString.format(this.params);
            return str.length ? "?" + str : "";
        }
    };

    QueryString.parse = function(str) {
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
    };

    QueryString.format = function(params) {
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
    };

})(jQuery);
