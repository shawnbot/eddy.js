# eddy.js
Eddy.js is a JavaScript library for loading and working with data from
[Eddy](http://eddy.stamen.com/), the realtime Twitter analytics system
developed by [Stamen](http://stamen.com) for use with live events. In most
cases, you will only need to use the `loader`:

```
var loader = eddy.loader({
    "baseURL": "url/to/eddy/publisher/",
    "lastURI": "uri/to/history-last.jsonp"
});

loader.on("load", function(data) {
    console.log("loaded data:", data);
});

loader.start();
```

## Unpacking data
Eddy has evolved over its lifetime, and the data that it produces may vary
slightly from event to event. To accommodate both legacy and future
serializations, eddy.js provides several "unpacking" functions that can be used
to format data into consistent forms. These functions modify the data object in
place, and can be called at any point inside a `"load"` callback, e.g.:

```
loader.on("load", function(data) {
    // unpack "filters" data
    eddy.unpack.filters(data);

    console.log("Lady Gaga:", data.filtersByName["Lady Gaga"]);
});
```
