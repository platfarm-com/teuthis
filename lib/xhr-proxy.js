/*! Teuthis XHR proxy/cache

This Source Code Form is subject to the terms of the Mozilla Public
License, v. 2.0. If a copy of the MPL was not distributed with this
file, You can obtain one at http://mozilla.org/MPL/2.0/.
*/
'use strict';

// At the moment, responseText / responseXML facading are not supported

var _ = require('lodash/core');
_.isNil = require('lodash/isNil');
var RequestCache = require('./request-cache');

// Save a reference to the native XMLHttpRequest
var nativeXMLHttpRequest = XMLHttpRequest;

var options = {
  debugMethods: false,
  debugCache: false,
  debugEvents: false,
  debugErrorEvents: true,
  debugCachePuts: false,
  debugCacheHits: false,
  debugCacheMiss: false,
  debugCacheBoot: false,
};

// Global function to determine if a request should be cached or not
var cacheSelector = function() { return false; }

var onerrorhook = function(e, isOnSend, xhr, realXhr, alternativeResponse) { }
var onloadhook = function(isOnSend, xhr, realXhr) { }
var onmisshook = function(xhr, realXhr, res) { return false; }
var cachekeymangler = function(urlkey) { return urlkey; }

var requestCache = null;

function XMLHttpRequestProxy() {
  // console.log('[Teuthis] XMLHttpRequestProxy constructor');

  var xhr = new nativeXMLHttpRequest();

  if (_.isNil(requestCache)) {
    requestCache = new RequestCache({instanceName: 'Teuthis'});
  }

  var store = requestCache;

  var method_ = null;
  var url_ = null;
  var requestHeaders_ = null;
  var shouldAddToCache_ = false;

  var self = this;

  // Facade the status, statusText and response properties to spec XMLHttpRequest
  this.status = 0;  // This is the status if error due to browser offline, etc.
  this.statusText = "";
  this.responseText = "";
  this.responseHeaders = undefined;
  // Facade the onload, onreadystatechange to spec XMLHttpRequest
  this.onreadystatechange = null;
  this.onload = null;

  Object.defineProperty(self, 'proxymethod', { get: function() {return method_;} });
  Object.defineProperty(self, 'proxyurl', { get: function() {return url_;} });
  Object.defineProperty(self, 'response', { get: function() {
    if (self.responseHeaders['content-type'] && self.responseHeaders['content-type'].includes("json")) {
      return JSON.parse(self.responseText);
    }
    return self.responseText;
  } });

  function shouldCache(method, url) {
    if (_.isFunction(cacheSelector)) { return cacheSelector.call(self, method, url); }
    return false;
  }

  // monkey-patch onreadystatechange to copy the status from the original.
  // then call the users onreadystatechange
  // This does happen each time an instance is constructed, perhaps this is redundant
  xhr.onreadystatechange = function onreadystatechange () {
    self.status = xhr.status;
    self.statusText  = xhr.statusText;
    self.readyState  = xhr.readyState;
    if (_.isFunction(self.onreadystatechange)) { return self.onreadystatechange(); }
  };

  // monkey-patch onload to save the value into cache, if we had a miss in send()
  // Call the users on-load once the value is saved into the cache, or immediately if not caching
  xhr.onload = function onload () {
    if (options.debugEvents) console.log('[Teuthis] proxy-xhr-onload ' + xhr.status + ' ' + xhr.statusText);
    self.status = xhr.status;
    self.statusText = xhr.statusText;
    self.responseText = xhr.responseText;
    self.responseHeaders = xhr.getAllResponseHeaders();
    if (self.responseHeaders) {
      self.responseHeaders = self.responseHeaders.trim().split('\r\n').reduce((acc, current) => {
        const [x,v] = current.split(': ');
        return Object.assign(acc, { [x.toLowerCase()] : v });
      }, {});
    }
    else {
      self.responseHeaders = {};
    }
    if (xhr.status >= 200 && xhr.status < 300 && xhr.responseText) {
      if (shouldAddToCache_ === true) {
        var mangled = cachekeymangler(url_);
        if (options.debugEvents) console.log('[Teuthis] proxy-xhr-onload do-put ' + method_ + ' ' + mangled);
        // console.log('proxy-cache-type ' + xhr.responseType); // + ', ' + xhr.responseText.substring(0,64));
        // if (xhr.responseType === 'arraybuffer')
        // Assuming the response is string or arraybuffer then clone it first, otherwise things seem to not work properly
        var savedResponseText = xhr.responseText.slice(0);
        var cachedResponse = { v: savedResponseText, ts: Date.now() };

        store.put(method_, mangled, cachedResponse, function() {
          if (_.isFunction(onloadhook)) { onloadhook(shouldAddToCache_, self, xhr); }
          if (_.isFunction(self.onload)) { self.onload(); }
        });
        shouldAddToCache_ = false;
        return;
      }
    }
    if (_.isFunction(onloadhook)) { onloadhook(shouldAddToCache_, self, xhr); } // Allow proxy success to be hooked as well
    if (_.isFunction(self.onload)) { self.onload(); } // Call original
  };

  xhr.onerror = function onerror (event) {
    // Note when using a file: URL in an Android webview, if the file is missing we get an error but status code is 0
    // and event.error is not defined
    if (options.debugErrorEvents) console.log('[Teuthis] proxy-xhr-onerror event=' + event.type + ' ' + method_ + ' ' + url_);
    if (options.debugErrorEvents) console.log('[Teuthis] proxy-xhr-onerror error.name=' + (event.error && event.error.name) + ' error.message=' + (event.error && event.error.message));
    if (_.isFunction(onerrorhook)) {
      var alternativeResponse = {};
      if (onerrorhook(event, shouldAddToCache_, self, xhr, alternativeResponse)) {
        // If user returns true then dont call onerror, instead call onload with fake data, such as a crossed tile PNG

        self.status = +200;
        self.statusText = '200 OK';
        if (_.isFunction(self.onreadystatechange)) { self.onreadystatechange(); }

        if (alternativeResponse.responseText) {
          self.responseText = alternativeResponse.responseText;
        }
        self.readyState = 4; // Done
        if (_.isFunction(onloadhook)) { onloadhook('on-error', self, xhr); }
        if (_.isFunction(self.onload)) { self.onload(); }

        return;
      }
    }
    if (_.isFunction(self.onerror)) { self.onerror(event); }
  }

  // Facade XMLHttpRequest.open() with a version that saves the arguments for later use, then calls the original
  this.open = function() {
    if (options.debugMethods) console.log('[Teuthis] proxy-xhr-open ' + arguments[0] + ' ' + arguments[1]);
    method_ = arguments[0];
    url_ = arguments[1];
    shouldAddToCache_ = false;
    xhr.open.apply(xhr, arguments);
  };

  this.setRequestHeader = function(name, value) {
    if (!this.requestHeaders_) {
        this.requestHeaders_ = {};
    }
    // collect headers
    this.requestHeaders_[name] = value;
    xhr.setRequestHeader.apply(xhr, arguments);
  };

  // Facade XMLHttpRequest.send() with a version that queries our offline cache,
  // calls the original if the response is not found in the cache, then adds the response to the cache,
  // or calls to onload() with the cached response if found
  this.send = function() {
    const sendArguments = arguments;
    if (options.debugMethods) console.log('[Teuthis] proxy-xhr-send ' + method_ + ' ' + url_);
    if (shouldCache(method_, url_)) {
      var mangled = cachekeymangler(url_);
      if (options.debugCache) console.log('[Teuthis] proxy-try-cache ' + method_ + ' ' + mangled);
      store.match(method_, mangled, handleHit, handleMiss);

      function handleHit(key, cachedValue) {
        if (!cachedValue.v || !cachedValue.ts) {
          // something is badly wrong... we need to treat as a miss
          console.warn('invalid cache data');
          // This is a hack copy/paste - we really need to refactor this code
          if (options.debugCache) console.log('[Teuthis] proxy-try-cache miss ' + method_ + ' ' + mangled);
          // miss - not in our cache. So try and fetch from the real Internet
          //console.log('onMiss called'); console.log(arguments);
          if (_.isFunction(onmisshook)) {
            var res = {url: url_, status: +200, statusText: '200 OK', responseText: undefined, readyState: 4};
            var patch = onmisshook(self, xhr, res);
            if (patch) {
              // Miss hook returns undefined, or otherwise, a replacement response,
              // and it should fix self status, statusText, response, and readyState
              self.status = res.status;
              self.statusText = res.statusText;
              if (_.isFunction(self.onreadystatechange)) { self.onreadystatechange(); }
              self.responseText = res.responseText;
              self.readyState = res.readyState;
              if (_.isFunction(onloadhook)) { onloadhook('on-match', self, xhr); }
              if (_.isFunction(self.onload)) { self.onload(); }
              return;
            }
          }
          shouldAddToCache_ = true;
          xhr.send.apply(xhr, sendArguments);
          return;
        }

        if (options.debugCache) console.log('[Teuthis] proxy-try-cache hit ' + method_ + ' ' + mangled);
        // hit
        self.status = +200;
        self.statusText = '200 OK';
        if (_.isFunction(self.onreadystatechange)) { self.onreadystatechange(); }
        self.responseText = cachedValue.v;
        self.readyState = 4; // Done
        if (_.isFunction(onloadhook)) { onloadhook('on-match', self, xhr); }
        if (_.isFunction(self.onload)) { self.onload(); }

        // Now, how do we update the LRU time?
        var o = {v: cachedValue.v, ts: Date.now()};
        store.put(method_, mangled, o, function() {  });
      }

      function handleMiss(key) {
        if (options.debugCache) console.log('[Teuthis] proxy-try-cache miss ' + method_ + ' ' + mangled);
        // miss - not in our cache. So try and fetch from the real Internet
        //console.log('onMiss called'); console.log(arguments);
        if (_.isFunction(onmisshook)) {
          var res = {url: url_, status: +200, statusText: '200 OK', responseText: undefined, readyState: 4};
          var patch = onmisshook(self, xhr, res);
          if (patch) {
            // Miss hook returns undefined, or otherwise, a replacement response,
            // and it should fix self status, statusText, response, and readyState
            self.status = res.status;
            self.statusText = res.statusText;
            if (_.isFunction(self.onreadystatechange)) { self.onreadystatechange(); }
            self.responseText = res.responseText;
            self.readyState = res.readyState;
            if (_.isFunction(onloadhook)) { onloadhook('on-match', self, xhr); }
            if (_.isFunction(self.onload)) { self.onload(); }
            return;
          }
        }
        
        shouldAddToCache_ = true;
        xhr.send.apply(xhr, sendArguments);
      }
    } else {
      xhr.send.apply(xhr, sendArguments);
    }
  };

  // facade all other XMLHttpRequest getters, except 'status' and 'response'
  ["responseURL", "responseXML", "upload"].forEach(function(item) {
    Object.defineProperty(self, item, {
      get: function() {return xhr[item];},
    });
  });

  // facade all other XMLHttpRequest properties getters and setters'
  ["ontimeout", "timeout", "responseType", "withCredentials", "onprogress", "onloadstart", "onloadend", "onabort"].forEach(function(item) {
    Object.defineProperty(self, item, {
      get: function() {return xhr[item];},
      set: function(val) {xhr[item] = val;},
    });
  });

  // facade all pure XMLHttpRequest methods and EVentTarget ancestor methods
  ["addEventListener", "removeEventListener", "dispatchEvent",
   "abort", "getAllResponseHeaders", "getResponseHeader", "overrideMimeType"].forEach(function(item) {
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

XMLHttpRequestProxy.setErrorHook = function (onerrorhook_) {
  onerrorhook = onerrorhook_;
}

XMLHttpRequestProxy.setLoadHook = function (onloadhook_) {
  onloadhook = onloadhook_;
}

XMLHttpRequestProxy.setMissHook = function (onmisshook_) {
  onmisshook = onmisshook_;
}

XMLHttpRequestProxy.setCacheKeyMangler = function (cachekeymangler_) {
  cachekeymangler = cachekeymangler_;
}

// Get the underlying RequestCache store so the user can monitor usage statistics, etc.
XMLHttpRequestProxy.getStore = function () { return requestCache; }

// Set the underlying RequestCache store to a custom instance.
XMLHttpRequestProxy.setStore = function (store) { requestCache = store; }

// Create an instance of the request cache, shared among all XHR.
// If not called, and setStore not called, then happens on first XHR
XMLHttpRequestProxy.init = function(options_) {
  options = Object.assign({}, options, options_);
  console.log('Teuthis: Options=' + JSON.stringify(options));

  if (_.isNil(requestCache)) {
    var cacheOptions = {instanceName: 'Teuthis'};
    // FIXME: there must be a Object or _ method to do this mapping
    if (_.has(options_, 'debugCachePuts')) { cacheOptions.debugCachePuts = options_.debugCachePuts; }
    if (_.has(options_, 'debugCacheHits')) { cacheOptions.debugCacheHits = options_.debugCacheHits; }
    if (_.has(options_, 'debugCacheMiss')) { cacheOptions.debugCacheMiss = options_.debugCacheMiss; }
    if (_.has(options_, 'debugCacheBoot')) { cacheOptions.debugCacheBoot = options_.debugCacheBoot; }

    requestCache = new RequestCache(cacheOptions);
  } else {
    requestCache.setDebugOptions(options_);
  }
  return requestCache;
}

// For each value present in options_, update debugging options
XMLHttpRequestProxy.setOptions = function(options_) {
// TODO: at some point I should update all this code to ES2015, given it is being babelled anyway
  _.each(options, function (v, k) {
    if (_.has(options_, k)) {
      options[k] = options_[k];
    }
  });
  requestCache.setDebugOptions(options_);
}

module.exports = XMLHttpRequestProxy;
