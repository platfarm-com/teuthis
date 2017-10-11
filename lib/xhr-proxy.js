'use strict';

// At the moment, responseText / responseXML facading are not supported

var _ = require('lodash');
var RequestCache = require('./request-cache');

// Save a reference to the native XMLHttpRequest
var nativeXMLHttpRequest = XMLHttpRequest;

var options = {
  debugMethods: true,   // todo change to false in git
  debugCache: true,   // todo change to false in git
  debugEvents: true,   // todo change to false in git
};

// Global function to determine if a request should be cached or not
var cacheSelector = function() { return false; }

var requestCache = new RequestCache({instanceName: 'Teuthis'});

function XMLHttpRequestProxy() {
  console.log('[Teuthis] XMLHttpRequestProxy constructor');

  var xhr = new nativeXMLHttpRequest();
  var store = requestCache;

  var method_ = null;
  var url_ = null;
  var shouldAddToCache_ = false;

  var self = this;

  // Facade the status, statusText and response properties to spec XMLHttpRequest
  this.status = null;
  this.statusText = null;
  this.response = null;
  // Facade the onload, onreadystatechange to spec XMLHttpRequest
  this.onreadystatechange = null;
  this.onload = null;

  function shouldCache(method, url) {
    if (_.isFunction(cacheSelector)) { return cacheSelector.call(self, method, url); }
    return false;
  }

  // monkey-patch onreadystatechange to copy the status from the original.
  // then call the users onreadystatechange
  // This does happen each time an instance is constructed, perhaps this is redundant
  xhr.onreadystatechange = function onreadystatechange () {
    // console.log('CHECKING : ' + ( (xhr === this) ? 'good' : 'bad assumption'));
    self.status = xhr.status;
    self.statusText  = xhr.statusText;
    if (_.isFunction(self.onreadystatechange)) { return self.onreadystatechange(); }
  };

  // monkey-patch onload to save the value into cache, if we had a miss in send()
  // Call the users on-load once the value is saved into the cache, or immediately if not caching
  xhr.onload = function onload () {
    if (options.debugEvemts) console.log('[Teuthis] proxy-xhr-onload ' + method_ + ' ' + url_);
    self.status = xhr.status;
    self.statusText = xhr.statusText;
    self.response = xhr.response;
    if (xhr.status >= 200 && xhr.status < 300 && xhr.response) {
      if (shouldAddToCache_ === true) {
        // console.log('proxy-cache-type ' + xhr.responseType); // + ', ' + xhr.responseText.substring(0,64));
        // if (xhr.responseType === 'arraybuffer')
        // Assuming the response is string or arraybuffer then clone it first, otherwise things seem to not work properly
        var savedResponse = xhr.response.slice(0);
        store.put(method_, url_, savedResponse, function() {
          if (_.isFunction(self.onload)) { self.onload(); }
        });
        shouldAddToCache_ = false;
        return;
      }
    }
    if (_.isFunction(self.onload)) { self.onload(); }
  };

  // Facade XMLHttpRequest.open() with a version that saves the arguments for later use, then calls the original
  this.open = function() {
    if (options.debugMethods) console.log('[Teuthis] proxy-xhr-open ' + arguments[0] + ' ' + arguments[1]);
    method_ = arguments[0];
    url_ = arguments[1];
    shouldAddToCache_ = false;
    xhr.open.apply(xhr, arguments);
  };

  // Facade XMLHttpRequest.send() with a version that queries our offline cache,
  // calls the original if the response is not found in the cache, then adds the response to the cache,
  // or calls to onload() with the cached response if found
  this.send = function() {
    if (options.debugMethods) console.log('[Teuthis] proxy-xhr-send ' + method_ + ' ' + url_);
    if (shouldCache(method_, url_)) {
      if (options.debugCache) console.log('[Teuthis] proxy-try-cache ' + method_ + ' ' + url_);
      store.match(method_, url_, function(key, cachedValue) {
        // hit
        self.status = +200;
        self.statusText = '200 OK';
        if (_.isFunction(self.onreadystatechange)) { self.onreadystatechange(); }
        self.response = cachedValue;
        if (_.isFunction(self.onload)) { self.onload(); }
      }, function(key) {
        // miss
        shouldAddToCache_ = true;
        xhr.send.apply(xhr, arguments);
      });
    } else {
      xhr.send.apply(xhr, arguments);
    }
  };

  // facade all other XMLHttpRequest getters, except 'status'
  ["responseText", "readyState", "responseXML", "upload"].forEach(function(item) {
    Object.defineProperty(self, item, {
      get: function() {return xhr[item];},
    });
  });

  // facade all other XMLHttpRequest properties getters and setters'
  ["ontimeout, timeout", "responseType", "withCredentials", "onerror", "onprogress"].forEach(function(item) {
    Object.defineProperty(self, item, {
      get: function() {return xhr[item];},
      set: function(val) {xhr[item] = val;},
    });
  });

  // facade all pure XMLHttpRequest methods
  ["addEventListener", "abort", "getAllResponseHeaders", "getResponseHeader", "overrideMimeType", "setRequestHeader"].forEach(function(item) {
    Object.defineProperty(self, item, {
      value: function() {return xhr[item].apply(xhr, arguments);},
    });
  });
};

// Set a function that returns true if method + url shold be cached
// Example:
//    XMLHttpRequestProxy.setCacheSelector(function (method, url) {
//      if (method === 'GET' && url.startsWith('https://') ) {
//        return true;
//      }
//      return false;
//    });
XMLHttpRequestProxy.setCacheSelector = function (cacheSelector_) {
  cacheSelector = cacheSelector_;
}

XMLHttpRequestProxy.getStore() = function () { return requestCache; }

module.exports = XMLHttpRequestProxy;
