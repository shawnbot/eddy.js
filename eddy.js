(function(exports) {

    var eddy = {
        "version": "2.2.1"
    };

    // utility functions
    eddy.util = {
        // sum the provided numbers
        sum: function(numbers, map) {
            if (typeof map === "function") numbers = numbers.map(map);
            return numbers.reduce(function(a, b) { return a + b; }, 0);
        },

        // get an array of object keys
        keys: function(obj) {
            var keys = [];
            for (var key in obj) {
                if (obj.hasOwnProperty(key) && typeof obj[key] !== "function") {
                    keys.push(key);
                }
            }
            return keys;
        },

        // coerce the value into a number, and return either the numeric value
        // or the ifNaN value
        numor: function(numish, ifNaN) {
            var num = +numish;
            return isNaN(num) ? ifNaN : num;
        },

        // merge keys from source objects (arguments[1:]) into the destination
        // object (arguments[0])
        merge: function(dest, source1, source2) {
            var sources = Array.prototype.slice.call(arguments, 1);
            sources.forEach(function(source) {
                if (typeof source == "object") {
                    var keys = eddy.util.keys(source);
                    keys.forEach(function(key) {
                        dest[key] = source[key];
                    });
                }
            });
            return dest;
        }
    };

    eddy.dispatch = function(obj) {
        var callbacks = {};

        obj.on = function(type, fn, context) {
            if (type in callbacks) {
                callbacks[type].push({
                    "fn": fn,
                    "context": context
                });
            } else {
                callbacks[type] = [{
                    "fn": fn,
                    "context": context
                }];
            }
            return obj;
        };

        obj.off = function(type, fn) {
            var cb = callbacks[type];
            if (cb && cb.length) {
                var len = cb.length;
                for (var i = 0; i < len; i++) {
                    if (cb[i].fn === fn) {
                        cb.splice(i, 1);
                        i--;
                    }
                }
            }
            return obj;
        };

        return obj.dispatch = function(e) {
            var type = (typeof e === "string")
                ? e
                : e.type;
            var cb = callbacks[type];
            if (cb && cb.length) {
                var len = cb.length,
                    args = Array.prototype.slice.call(arguments, 1);
                for (var i = 0; i < len; i++) {
                    var stat = cb[i].fn.apply(cb[i].context, args);
                    if (stat === false) return false;
                }
            }

            return true;
        };
    };

    /**
     * The Loader repeatedly loads JSON data from Eddy.
     */
    eddy.loader = function(options) {
        if (typeof options !== "object") {
            throw "eddy.loader() expects an options object; got " + (typeof options);
        }

        var baseURL = options.baseURL,
            lastURI = options.lastURI,
            nextTimeout = null,
            retries = 0,
            maxRetries = 10,
            latency = 0,
            next = {};

        var loader = {};
        // set up event dispatchers
        eddy.dispatch(loader);

        // URI -> JSON-P callback name
        // works in the same way as its Python equivalent
        loader.callback = function(uri) {
            var parts = uri.split(".");
            return parts[0].replace(/[^\w]/g, "_");
        };

        loader.request = function(uri, success, failure) {
            var url = baseURL + uri,
                callback = loader.callback(uri);
            return reqwest({
                "url":                  url,
                "type":                 "jsonp",
                "jsonpCallbackName":    callback,
                "success":              success,
                "error":                failure
            });
        };

        loader.start = function(nextURI) {
            // console.log("[loader] start(", nextURI, ")");
            abortNext();
            return loader.load(nextURI || lastURI);
        };

        loader.stop = function(message) {
            abortNext();
            loader.dispatch("stop", {message: message});
        };

        function abortNext() {
            if (nextTimeout) {
                clearTimeout(nextTimeout);
                return true;
            } else {
                return false;
            }
        }

        // load the next URI in the currently loaded data,
        // called internally
        function loadNext(nextURI, wait) {
            // console.log("loader.next(", [nextURI, wait, latency], ")");
            next.uri = nextURI;
            next.wait = wait;

            // TODO: be smarter about how often to just grab the lastURI,
            // avoiding time drift
            if (wait > 0) {
                var timeout = wait * 1000;
                if (latency > timeout) {
                    console.warn("latency > timeout:",
                        (latency / 1000).toFixed(2) + "s vs.",
                        (timeout / 1000).toFixed(2) + "s",
                        "; ignoring!"
                    );
                } else {
                    timeout -= latency;
                }
                return setTimeout(function() {
                    loader.load(nextURI);
                }, timeout);
            } else {
                // still defer it
                return setTimeout(function() {
                    loader.load(nextURI);
                }, 1);
            }
        }

        loader.load = function(uri) {
            // clear out the next timeout, just in case
            abortNext();

            var time = Date.now();

            loader.dispatch("loading", {uri: uri});

            return loader.request(uri,
                function(data) {
                    var latency = latency = Date.now() - time;
                    console.info("load took:", (latency / 1000).toFixed(2), "seconds", uri);
                    // TODO: instead of retry, use lastURI?
                    retries = 0;

                    // console.log("loader.load() [success]:", data);
                    var next = data.next ? data.next.href : null,
                        wait = data.next ? data.next.wait : null;
                    if (next) {
                        // loader.stop("Stopping because it's broken");
                        nextTimeout = loadNext(next, wait);
                    } else {
                        loader.stop("No next.href in response");
                    }

                    loader.dispatch("load", data);
                },
                function(req) {
                    if (retries >= maxRetries) {
                        loader.stop("Too many retries (" + retries + ")");
                    } else {
                        loader.dispatch("error", {message: req.statusText});

                        var wait = next.wait || 10;
                        console.warn("error loading; retrying in", wait, "seconds...");
                        nextTimeout = loadNext(uri, wait); // FIXME: how long should we wait here?
                        retries++;
                    }
                });
        };

        return loader;
    };


    /**
     * Eddy data munging utilities.
     */
    eddy.unpack = {};


    /*
     * if you want data.currentUsage, use
     * eddy.unpack.usages().
     */
    eddy.unpack.history = function(data) {
        if (!data.history) {
            console.warn("no history in data; not unpacking");
            return false;
        } else if (typeof data.history[0] === "object") {
            console.warn("data.history[0] is an object; not unpacking again");
            return false;
        }

        var sumHistory = eddy.util.sum(data.history),
            currentCount = 0;
        if (data.currentUsage) {
            currentCount = data.currentUsage.count;
        } else {
            currentCount = sumHistory;
        }

        var start = currentCount - sumHistory;
        data.history = eddy.unpack.runningTotal(data.history, start, data.time);
        return true;
    };

    /**
     * Prepare filter data by attaching new properties, like "id", "count",
     * and "name", for data sources that don't provide them.
     */
    eddy.unpack.filters = function(data) {
        eddy.unpack.usages(data);
        eddy.unpack.history(data);

        // bail if there are no filters
        if (!data.filters) {
            return false;
        }

        // get a dictionary of filters by name
        var filtersByName = {};
        data.filters.forEach(function(filter) {
            filtersByName[filter.name] = filter;
            if (!filter.usage) filter.usage = {};
        });

        data.filtersByName = filtersByName;

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

        // FIXME: bail if data.filters === undefined?
        data.filters.forEach(function(filter) {
            if (!filter.id) {
                filter.id = filter.name.replace(/\W+/g, "_").toLowerCase();
            }

            // tweets per minute
            filter.tpm = filter.history[filter.history.length - 1];

            var sumHistory = eddy.util.sum(filter.history);
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
            filter.history = eddy.unpack.runningTotal(filter.history, start, data.time);
        });

        var filtersById = {};
        data.filters.forEach(function(filter) {
            filtersById[filter.id] = filter;
        });

        data.filtersById = filtersById;

        return true;
    };

    /**
     * Prepare minute data
     */
    eddy.unpack.minutes = function(data) {
        eddy.unpack.usages(data);

        if (!data.filters || !data.minutes) {
            return false;
        }

        var filtersById = {};
        data.filters.forEach(function(filter) {
            filtersById[filter.id] = filter;
        });

        data.filtersById = filtersById;

        data.minutes.forEach(function(minute) {
            minute.filters = minute.filters.map(function(idCount) {
                return {
                    "filter": filtersById[idCount[0]],
                    "count": idCount[1]
                };
            });
        });

        data.history = data.minutes.map(function(minute) {
            return minute.tweets.count;
        });

        eddy.unpack.history(data);

        return true;
    };

    /**
     * Prepare retweet data
     */
    eddy.unpack.retweets = function(data) {
        eddy.unpack.usages(data);
        eddy.unpack.history(data);
    };

    eddy.unpack.usages = function(data) {
        if (!data.history || !data.usage) {
            return false;
        }

        var time = data.time,
            start = time.start || time.start_time,
            period = time.period,
            end = start + period * (data.history.length - 1);
        // console.log("start:", start, "end:", end);

        function usageIsCurrent(usage) {
            return (usage.start <= start && usage.end >= start)
                || (usage.end >= start && usage.end <= end);
        }

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
            // console.log("usage active?", usage.label, [usage.start, "<=", [start, end].join(":"), "<=", usage.end], usage.active);
            if (usage.active) {
                lastActive = usage;
            }
        });

        data.currentUsage = lastActive;
        data.biggestUsage = sortedByCount[0];

        return true;
    };

    eddy.unpack.runningTotal = function(counts, startCount, timeMeta) {
        var total = startCount,
            time = timeMeta.start_time,
            step = timeMeta.period;
        return counts.map(function(count) {
            var countTime = time;
            time += step;
            total += count;
            return {
                "count": count,
                "time": countTime,
                "total": total
            };
        });
    };

    // query string parse/format
    eddy.util.qs = {
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

    exports.eddy = eddy;

    // DummyConsole
    if (!window.console)(function(b){function c(){}for(var d=["error","info","log","warn"],a;a=d.pop();)b[a]=b[a]||c})(window.console=window.console={});

    /*!
      * Reqwest! A general purpose XHR connection manager
      * (c) Dustin Diaz 2011
      * https://github.com/ded/reqwest
      * license MIT
      */
    !function(a,b){typeof module!="undefined"?module.exports=b():typeof define=="function"&&define.amd?define(a,b):this[a]=b()}("reqwest",function(){function handleReadyState(a,b,c){return function(){a&&a[readyState]==4&&(twoHundo.test(a.status)?b(a):c(a))}}function setHeaders(a,b){var c=b.headers||{},d;c.Accept=c.Accept||defaultHeaders.accept[b.type]||defaultHeaders.accept["*"],!b.crossOrigin&&!c[requestedWith]&&(c[requestedWith]=defaultHeaders.requestedWith),c[contentType]||(c[contentType]=b.contentType||defaultHeaders.contentType);for(d in c)c.hasOwnProperty(d)&&a.setRequestHeader(d,c[d])}function generalCallback(a){lastValue=a}function urlappend(a,b){return a+(/\?/.test(a)?"&":"?")+b}function handleJsonp(a,b,c,d){var e=uniqid++,f=a.jsonpCallback||"callback",g=a.jsonpCallbackName||"reqwest_"+e,h=new RegExp("((^|\\?|&)"+f+")=([^&]+)"),i=d.match(h),j=doc.createElement("script"),k=0;i?i[3]==="?"?d=d.replace(h,"$1="+g):g=i[3]:d=urlappend(d,f+"="+g),win[g]=generalCallback,j.type="text/javascript",j.src=d,j.async=!0,typeof j.onreadystatechange!="undefined"&&(j.event="onclick",j.htmlFor=j.id="_reqwest_"+e),j.onload=j.onreadystatechange=function(){if(j[readyState]&&j[readyState]!=="complete"&&j[readyState]!=="loaded"||k)return!1;j.onload=j.onreadystatechange=null,j.onclick&&j.onclick(),a.success&&a.success(lastValue),lastValue=undefined,head.removeChild(j),k=1},head.appendChild(j)}function getRequest(a,b,c){var d=(a.method||"GET").toUpperCase(),e=typeof a=="string"?a:a.url,f=a.processData!==!1&&a.data&&typeof a.data!="string"?reqwest.toQueryString(a.data):a.data||null,g;return(a.type=="jsonp"||d=="GET")&&f&&(e=urlappend(e,f),f=null),a.type=="jsonp"?handleJsonp(a,b,c,e):(g=xhr(),g.open(d,e,!0),setHeaders(g,a),g.onreadystatechange=handleReadyState(g,b,c),a.before&&a.before(g),g.send(f),g)}function Reqwest(a,b){this.o=a,this.fn=b,init.apply(this,arguments)}function setType(a){var b=a.match(/\.(json|jsonp|html|xml)(\?|$)/);return b?b[1]:"js"}function init(o,fn){function complete(a){o.timeout&&clearTimeout(self.timeout),self.timeout=null,o.complete&&o.complete(a)}function success(resp){var r=resp.responseText;if(r)switch(type){case"json":try{resp=win.JSON?win.JSON.parse(r):eval("("+r+")")}catch(err){return error(resp,"Could not parse JSON in response",err)}break;case"js":resp=eval(r);break;case"html":resp=r}fn(resp),o.success&&o.success(resp),complete(resp)}function error(a,b,c){o.error&&o.error(a,b,c),complete(a)}this.url=typeof o=="string"?o:o.url,this.timeout=null;var type=o.type||setType(this.url),self=this;fn=fn||function(){},o.timeout&&(this.timeout=setTimeout(function(){self.abort()},o.timeout)),this.request=getRequest(o,success,error)}function reqwest(a,b){return new Reqwest(a,b)}function normalize(a){return a?a.replace(/\r?\n/g,"\r\n"):""}function serial(a,b){var c=a.name,d=a.tagName.toLowerCase(),e=function(a){a&&!a.disabled&&b(c,normalize(a.attributes.value&&a.attributes.value.specified?a.value:a.text))};if(a.disabled||!c)return;switch(d){case"input":if(!/reset|button|image|file/i.test(a.type)){var f=/checkbox/i.test(a.type),g=/radio/i.test(a.type),h=a.value;(!f&&!g||a.checked)&&b(c,normalize(f&&h===""?"on":h))}break;case"textarea":b(c,normalize(a.value));break;case"select":if(a.type.toLowerCase()==="select-one")e(a.selectedIndex>=0?a.options[a.selectedIndex]:null);else for(var i=0;a.length&&i<a.length;i++)a.options[i].selected&&e(a.options[i])}}function eachFormElement(){var a=this,b,c,d,e=function(b,c){for(var e=0;e<c.length;e++){var f=b[byTag](c[e]);for(d=0;d<f.length;d++)serial(f[d],a)}};for(c=0;c<arguments.length;c++)b=arguments[c],/input|select|textarea/i.test(b.tagName)&&serial(b,a),e(b,["input","select","textarea"])}function serializeQueryString(){return reqwest.toQueryString(reqwest.serializeArray.apply(null,arguments))}function serializeHash(){var a={};return eachFormElement.apply(function(b,c){b in a?(a[b]&&!isArray(a[b])&&(a[b]=[a[b]]),a[b].push(c)):a[b]=c},arguments),a}var win=window,doc=document,twoHundo=/^20\d$/,byTag="getElementsByTagName",readyState="readyState",contentType="Content-Type",requestedWith="X-Requested-With",head=doc[byTag]("head")[0],uniqid=0,lastValue,xmlHttpRequest="XMLHttpRequest",isArray=typeof Array.isArray=="function"?Array.isArray:function(a){return a instanceof Array},defaultHeaders={contentType:"application/x-www-form-urlencoded",accept:{"*":"text/javascript, text/html, application/xml, text/xml, */*",xml:"application/xml, text/xml",html:"text/html",text:"text/plain",json:"application/json, text/javascript",js:"application/javascript, text/javascript"},requestedWith:xmlHttpRequest},xhr=win[xmlHttpRequest]?function(){return new XMLHttpRequest}:function(){return new ActiveXObject("Microsoft.XMLHTTP")};return Reqwest.prototype={abort:function(){this.request.abort()},retry:function(){init.call(this,this.o,this.fn)}},reqwest.serializeArray=function(){var a=[];return eachFormElement.apply(function(b,c){a.push({name:b,value:c})},arguments),a},reqwest.serialize=function(){if(arguments.length===0)return"";var a,b,c=Array.prototype.slice.call(arguments,0);return a=c.pop(),a&&a.nodeType&&c.push(a)&&(a=null),a&&(a=a.type),a=="map"?b=serializeHash:a=="array"?b=reqwest.serializeArray:b=serializeQueryString,b.apply(null,c)},reqwest.toQueryString=function(a){var b="",c,d=encodeURIComponent,e=function(a,c){b+=d(a)+"="+d(c)+"&"};if(isArray(a))for(c=0;a&&c<a.length;c++)e(a[c].name,a[c].value);else for(var f in a){if(!Object.hasOwnProperty.call(a,f))continue;var g=a[f];if(isArray(g))for(c=0;c<g.length;c++)e(f,g[c]);else e(f,a[f])}return b.replace(/&$/,"").replace(/%20/g,"+")},reqwest.compat=function(a,b){return a&&(a.type&&(a.method=a.type)&&delete a.type,a.dataType&&(a.type=a.dataType),a.jsonpCallback&&(a.jsonpCallbackName=a.jsonpCallback)&&delete a.jsonpCallback,a.jsonp&&(a.jsonpCallback=a.jsonp)),new Reqwest(a,b)},reqwest})

})(this);
