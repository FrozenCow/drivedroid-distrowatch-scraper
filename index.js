function transform(promisedFs, liftedFunc, name) {
    promisedFs[name + 'Async'] = liftedFunc;
    return promisedFs;
};

var when = require('when');
var whenNode = require('when/node');
var fs = whenNode.liftAll(require('fs'),transform);
var http = require('http');
var most = require('most');
var request = whenNode.liftAll(require('./request'),transform);
var URL = require('url');
var validation = require('./validation.js');

// Globals
function identity(x) {
    return x;
}

function isTrueish(x) {
    return !!x;
}

function first(arr) {
    return arr[0];
}

function second(arr) {
    return arr[1];
}

function map(f,arr) {
    return arr.map(f);
}

function arrayToObject(arr) {
    var obj = {};
    for(var i=0;i<arr.length;i++) {
        obj[arr[i][0]] = arr[i][1];
    }
    return obj;
}

function objectToArray(obj) {
    var arr = [];
    for(var k in obj) {
        arr.push([k,obj[k]]);
    }
    return arr;
}

function extend(/*...*/) {
    var r = {};
    for(var i=0;i<arguments.length;i++) {
        for(var k in arguments[i]) {
            r[k] = arguments[i][k];
        }
    }
    return r;
}

function objectFilter(f,obj) {
    return arrayToObject(objectToArray(obj).filter(function(pair) {
        return f(pair[1]);
    }));
}

RegExp.escape = function(str) {
  return str.replace(/[\-\[\]\/\{\}\(\)\*\+\?\.\\\^\$\|]/g, "\\$&");
};

// Extend most
most.fromCheerio = function(items) {
    return most.from(items.toArray$());
};

most.Stream.prototype.compact = function() {
    return this.filter(isTrueish);
};

most.Stream.prototype.compactMap = function(f) {
    return this.map(f).compact();
};

// Extend Cheerio
var CheerioStatic = require('cheerio/lib/static');
CheerioStatic.resolveUrl = function(relativeUrl) {
    return URL.resolve(this.response.url,relativeUrl);
};

var Cheerio = require('cheerio');
Cheerio.prototype.toArray$ = function() {
    return this.toArray().map(Cheerio);
};

function printValue(value) {
    console.log('%j %j', typeof value, value);
}

function typeOf(value) {
    switch(typeof value) {
        case 'string':
        case 'number':
        case 'undefined':
            return typeof value;
        case 'object':
            if (value === null) {
                return 'null';
            } else if (value.constructor) {
                if (value.constructor.name) {
                    return value.constructor.name;
                } else {
                    return value.constructor;
                }
            } else {
                return typeof value;
            }
        case 'function':
            return 'function';
        default:
            return 'unknown'+(typeof value);
    }
}

most.from(['http://distrowatch.com/'])
    .map(function(url) {
        return request.domAsync(url);
    })
    .await()
    // News items
    .flatMap(function($) {
        return most.fromCheerio($('.News1 table.News'))
            .map(function(newsItem) {
                var headline = newsItem.find('.NewsHeadline a[href]');
                var logo = newsItem.find('.NewsLogo');
                return {
                    id: logo.find('a[href]').attr('href'),
                    title: headline.text(),
                    content: newsItem.find('.NewsText'),
                    logo: $.resolveUrl(logo.find('img').attr('src')),
                    logoTitle: logo.find('img').attr('title'),
                    logoHref: $.resolveUrl(logo.find('a[href]').attr('href')),
                    date: newsItem.find('.NewsDate').text()
                };
            });
    })
    // Release news items
    .compactMap(function(newsItem) {
        var match = /^(Distribution|BSD|Development) Release: (.*)$/.exec(newsItem.title);
        if (!match) { return null; }
        return extend(newsItem,{
            release: match[1].toLowerCase(),
            title: match[2]
        });
    })
    // Home Page
    .map(function(releaseNewsItem) {
        return most.from(['http://distrowatch.com/table.php?distribution='+releaseNewsItem.id])
            .map(function(url) { return request.domAsync(url); })
            .await()
            .flatMap(function($) { return most.fromCheerio($('table.Info tr')); })
            .filter(function(row) { return row.find('th.Info').text() === 'Home Page'; })
            .map(function(row) { return row.find('td.Info a').attr('href'); })
            .head()
            .then(function(homepageUrl) {
                return extend(releaseNewsItem,{
                    homepage: homepageUrl
                });
            });
    })
    .await()
    // Version
    .compactMap(function(releaseNewsItem) {
        /* title: {name} {version} "{extras}" */
        /* logoTitle: {name} */
        var pattern = new RegExp('^' + RegExp.escape(releaseNewsItem.logoTitle) + ' ([^"]+)');
        var match = pattern.exec(releaseNewsItem.title);
        if (!match) { return null; }
        return extend(releaseNewsItem,{
            title: releaseNewsItem.logoTitle,
            version: match[1].trim()
        });
    })
    // Download url
    .flatMap(function(releaseNewsItem) {
        return most.fromCheerio(releaseNewsItem.content.find('a'))
            .map(function(a) { return a.attr('href'); })
            .filter(function(url) { return /^(http|https):.*\.(iso|img)$/i.test(url); })
            .map(function(url) {
                return extend(releaseNewsItem,{
                    downloadUrl: url
                });
            });
    })
    // Download size
    .map(function(releaseNewsItem) {
        return when(request.contentlengthAsync(releaseNewsItem.downloadUrl),function(contentLength) {
            return extend(releaseNewsItem,{
                downloadSize: contentLength
            });
        });
    })
    .await()
    // Architecture
    .map(function(releaseNewsItem) {
        var architectures = [
            'x86_64',
            'amd64',
            'ia64',
            'i386',
            'i486',
            'i586',
            'i686',
            'x86',
            'x64',
            'arm',
            'hybrid',
            '64bit',
            '32bit'
        ];
        var pattern = new RegExp('[^a-zA-Z0-9]('+architectures.map(RegExp.escape).join('|')+')[^a-zA-Z0-9]');
        var match = pattern.exec(releaseNewsItem.downloadUrl);
        return extend(releaseNewsItem,{
            architecture: match && match[1]
        });
    })
    // Create distribution entries
    .map(function(releaseNewsItem) {
        return {
            id: releaseNewsItem.id,
            name: releaseNewsItem.title,
            imageUrl: releaseNewsItem.logo,
            url: releaseNewsItem.homepage,
            releases: [objectFilter(isTrueish,{
                version: releaseNewsItem.version,
                url: releaseNewsItem.downloadUrl,
                size: releaseNewsItem.downloadSize,
                arch: releaseNewsItem.architecture
            })]
        };
    })
    // Merge the existing JSON file with the retrieved distribution entries
    .reduce(mergeDistribution,
        arrayToObject(JSON.parse(fs.readFileSync('distrowatch.json')).map(function(distro) { return [distro.id,distro]; }))
    )
    .then(objectToArray)
    .then(map.bind(null,second))
    // Validate the distributions
    .then(function(distributions) {
        var errors = validation.validateDistributions(distributions);
        if (errors.length > 0) {
            throw new validation.ValidationError(errors);
        }
        return distributions;
    })
    // Write the distributions as a JSON file to disk
    .then(JSON.stringify)
    .then(fs.writeFileAsync.bind(null,"distrowatch.json"));

function mergeDistribution(distributions,newDistribution) {
    var id = newDistribution.id;
    var oldDistribution = distributions[id];
    if (!oldDistribution) {
        distributions[id] = newDistribution;
    } else {
        // We found a distribution (newDistribution) that was already in the distribution-list.
        // We will use the new distribution (which could contain a new name, new logo, new url, etc), but
        // copy over the releases from the old distribution.
        // 
        // We have to make sure that the new releases have priority over the old ones.
        // We use the URLs to determine conflicting releases and make sure the only the
        // non-conflicting old releases are added to the new distribution.
        var mergedDistribution = extend(oldDistribution,newDistribution,{
            releases: newDistribution.releases.concat(
                oldDistribution.releases.filter(function(oldRelease) {
                    return !newDistribution.releases.some(function(newRelease) {
                        return oldRelease.url === newRelease.url;
                    });
                })
            )
        });
        distributions[id] = mergedDistribution;
    }
    return distributions;
}

