if (typeof eddy === "undefined") eddy = {};

eddy.archive = {};

eddy.archive.getShow = function(eventId) {
    var show = eddy.archive.shows[eventId];
    if (show && !show.baseURL) {
        show.baseURL = "http://p." + eventId + ".stamen.com/";
    }
    return show;
};

eddy.archive.shows = {
    "mtvvma12": {
        "baseURL":      "http://p.mtvvma12b.stamen.com/",
        "historyURI":   "history-tracker-last.jsonp",
        "photosURI":    "retweets-last.jsonp",
        "voteURL":      "http://p.mtvvma12b.stamen.com/",
        "voteURI":      "final-history-socialvote-last.jsonp",
    },
    "cmt2012": {
        "baseURL": "http://cmt-twittertracker.cmt.com/",
        "historyURI": "history-last.jsonp",
        "photosURI": "retweets-last.jsonp"
    },
    "mtvmovies2012": {
        "baseURL": "http://mtv-ma-2012.stamen.com/",
        "historyURI": "history-20120604/02/5926.jsonp",
        "voteURI": "vote-bestHero-final.jsonp",
        "photosURI": "retweets-20120604/03/5951.jsonp"
    },
    /*
    "logo2012": {
        "baseURL": "http://twittertracker.nnnext.com/",
        "lastURI": "history-last.jsonp"
    },
    */
    "spike2011": {
        "baseURL": "http://p.spike2011.stamen.com/",
        "historyURI": "history-last.jsonp"
    },
    "mtvema11": {
        "baseURL": "http://p.mtvema11.stamen.com/",
        "historyURI": "history-20111106/22/1523.jsonp",
        "photosURI": "retweets-20111106/22/1524.jsonp"
    },
    "mtvvma11": {
        "baseURL": "http://p.mtvvma11.stamen.com/",
        "historyURI": "history-20110829/06/0033.jsonp",
        "photosURI": "retweets-last.jsonp"
    }
};
