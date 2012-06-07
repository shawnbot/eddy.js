(function($) {

var COMMIZE = d3.format(",0");


Tracker.View.Table = Tracker.View.extend({
    setupRoutes: function(app) {
        this.setupSubRoute(app, "filters/:filter", function(params) {
            msg.append("[buzz] select filter: ", params.filter);
        });
    },

    columns: ["name", "total", "tweets/minute"],

    attach: function($root, app) {
        Tracker.View.prototype.attach.call(this, $root, app);

        this.table = d3.select(this.$root[0])
            .append("table")
            .attr("id", "filters");

        this.table.append("thead")
            .append("tr")
                .selectAll("th")
                .data(this.columns).enter()
                .append("th")
                    .text(function(d) { return d; });

        this.tbody = this.table.append("tbody");

        this.app.bind("update:filters", this.updateFilters, this);
    },

    detach: function($root, app) {
        this.app.unbind("update:filters", this.updateFilters);

        this.table.remove();
        this.table = this.tbody = null;

        Tracker.View.prototype.detach.call(this, $root, app);
    },

    updateFilters: function(data) {
        console.log("updateFilters():", data);

        var filters = data.filters;

        var rows = this.tbody.selectAll("tr")
            .data(filters, function(d) { return d.id; });

        var entering = rows.enter()
            .append("tr")
            .attr("id", function(d) { return "row-" + d.id; });

        entering.append("th")
            .attr("scope", "row")
            .append("a")
                .classed("name", true)
                .text(function(d) { return d.name; })
                .attr("href", function(d) {
                    return "#/buzz/filters/" + d.id;
                });

        entering.append("td")
            .classed("total", true);

        entering.append("td")
            .classed("tpm", true);

        rows.exit().remove();

        this.tbody.selectAll("tr")
            .call(this.updateRows, this);

        // re-set params
        this.setParams(this.params);
    },

    updateRows: function(selection, self) {
        this.sort(function(a, b) {
            return d3.descending(a.count, b.count);
        });
        this.each(function(d, i) {
            console.log(i + 1, d.name, d.count);
        });
        this.select(".rank")
            .text(function(d, i) { return i + 1; });
        this.select(".total")
            .text(function(d) { return COMMIZE(d.count); });
        this.select(".tpm")
            .text(function(d) { return COMMIZE(d.tpm); });
    },

    setParams: function(params) {
        Tracker.View.prototype.setParams.call(this, params);
        this.selectFilter(this.params.filter);
    },

    selectFilter: function(id) {
        if (!this.tbody) return false;
        this.tbody.selectAll("tr")
            .classed("selected", function(filter) {
                return filter.id === id;
            });
    }
});

})(jQuery);
