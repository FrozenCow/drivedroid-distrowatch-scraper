var request = require('request');
var cheerio = require('cheerio');
var async = require('async');
var sugar = require('sugar');
var cookieJar = request.jar();
var URL = require('url');

var request = request.defaults({
	method: 'GET'
});

function requestDebug(options) {
	console.log(options);
	request.apply(this,arguments);
}

var requestQueues = {};
function getRequestQueue(host) {
	host = host.toLowerCase();
	var requestQueue = requestQueues[host];
	if (!requestQueue) {
		requestQueue = requestQueues[host] = async.queue(requestDebug,1);
	}
	return requestQueue;
}

function requestBase(options,cb) {
	if (typeof options === 'string') {
		options = { url: options };
	}
	var host = URL.parse(options.url).host;
	var q = getRequestQueue(host);
	q.push(options,handleResponse);
	function handleResponse(err,response,body) {
		if (err) {
			err.url = options.url;
			return cb(err);
		}
		if (response.statusCode === 302) { // Handle redirects after POST
			requestQueue.pushRequest({url:response.headers.location},handleResponse);
			return;
		}
		response.url = options.url;
		response.body = body;
		return cb(null,response);
	}
}

function requestText(options,cb) {
	requestBase(options,function(err,response) {
		if (err) { return cb(err); }
		return cb(null,response.body);
	});
}

function requestDom(options,cb) {
	requestBase(options,function(err,response) {
		if (err) { return cb(err); }
		var $ = cheerio.load(response.body);
		$.response = response;
		return cb(null,$);
	});
}

function requestXmlDom(options,cb) {
	requestBase(options,function(err,response) {
		if (err) { return cb(err); }
		var $ = cheerio.load(response.body,{xmlMode: true});
		$.response = response;
		return cb(null,$);
	});
}

function requestContentLength(options,cb) {
	if (typeof options === 'string') {
		options = { url: options };
	}
	var newOptions = { method: 'HEAD' };
	Object.merge(newOptions,options);
	requestBase(newOptions,function(err,response) {
		if (err) { return cb(err,null,response); }
		if (response.statusCode < 200 || response.statusCode >= 300) { return cb(null,null,response); }
		var contentLength = response.headers['content-length'];
		if (contentLength === undefined) {
			return cb(null,contentLength,response);
		}
		try {
			contentLength = parseInt(contentLength,10);
		} catch(e) {
			var err = new Error('Failed to parse Content-Length');
			err.response = response;
			return cb(err);
		}
		return cb(null,contentLength);
	});
}


// Cheerio helpers
cheerio.prototype.filter = function(f) {
	return cheerio(this.toArray().filter(function(e) {
		return f(cheerio(e));
	}));
};

cheerio.prototype.map = function(f) {
	return this.toArray().map(function(e) {
		return f(cheerio(e));
	});
};

cheerio.prototype.mapFilter = function(f) {
	return this.toArray().map(function(e) {
		return f(cheerio(e));
	}).filter(function(e) { return e; });
};

module.exports = requestBase;
module.exports.text = requestText;
module.exports.dom = requestDom;
module.exports.xmldom = requestXmlDom;
module.exports.contentlength = requestContentLength;
