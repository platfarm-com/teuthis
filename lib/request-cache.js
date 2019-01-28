/*! Teuthis XHR proxy/cache

This Source Code Form is subject to the terms of the Mozilla Public
License, v. 2.0. If a copy of the MPL was not distributed with this
file, You can obtain one at http://mozilla.org/MPL/2.0/.
*/
'use strict';

var _ = require('lodash/core');
_.isArrayBuffer = require('lodash/isArrayBuffer');
var localforage = require('localforage');

// Provides class RequestCache, a wrapper around the localforage local storage provider
// that manages generating keys from XHR requests, and querying and saving data into the cache

var defaultOptions = {
  instanceName: null,
  instanceDescription: 'Teuthis XHR proxy cache',
  keyPrefix: '',
  onStatus: null,
  onReady: null,
  debugCachePuts: false,
  debugCacheHits: false,
  debugCacheMiss: false,
  debugCacheBoot: false,
};

// Create a new RequestCache
// If options.instanceName is set and not null then use a new private scope of localforage of that name, otherwise use global localforage
// Using instanceName changes the behaviour of clear() to be less polite
function RequestCache(options) {
  console.log('[Teuthis] RequestCache constructor');
  var self = this;
  this.stats = {miss: 0, hits: 0, memory: 0};
  this.options = _.defaults({}, options);  _.defaults(this.options, defaultOptions);
  console.log('RequestCache: Options=' + JSON.stringify(this.options));
  this.store = localforage;
  this.ownStore = false;
  if (this.options.instanceName !== null) {
    this.ownStore = true;
    this.store = localforage.createInstance({name: this.options.instanceName, description: this.options.instanceDescription});
  }

  // Keep our own list of keys, so we can flush them from localforage without
  // flushing other items that are not ours
  this.keyPrefix = (typeof this.options.keyprefix === 'string') ? this.options.keyprefix : '';
  this.cacheKeys = {};

  // If we have a key prefix or are using own store, then propulate cacheKeys
  // This is problematic, we cant guarantee that when the constructor returns, we are ready!
  this.ready = false;
  this.store.iterate(function(v, k) {
    if (self.ownStore || self.keyIsPrefixed(k)) {
      self.cacheKeys[k] = true;
      var m = 0;
      if (typeof v === 'string') m = v.length;
      else if (_.isArrayBuffer(v)) m = v.byteLength;
      // else console.log(v);
      self.stats.memory += m;
      if (self.options.debugCacheBoot) console.log('[Teuthis] found key: ' + k + ', memory: ' + m + '/' + self.stats.memory + ', ' + typeof v);
    }
  }, function() {
    console.log('[Teuthis] found keys: ' + Object.getOwnPropertyNames(self.cacheKeys).length);
    console.log('[Teuthis] found memory: ' + self.stats.memory);
    self.ready = true;
    if (self.options.onReady) self.options.onReady();
  });
}

function handleCacheMiss(key, onMiss) {
  if (this.options.debugCacheMiss) console.log('[Teuthis] proxy-miss ' + key);
  this.stats.miss ++;
  if (_.isFunction(onMiss)) onMiss(key);
  if (_.isFunction(this.options.onStatus)) this.options.onStatus.call(this);
}

function handleCacheHit(key, cachedValue, onHit) {
  if (this.options.debugCacheHits) console.log('[Teuthis] proxy-hit ' + key);
  this.stats.hits ++;
  if (_.isFunction(onHit)) onHit(key, cachedValue);
  if (_.isFunction(this.options.onStatus)) this.options.onStatus.call(this);
}

// Returns estimated number of entries in the cache
// If someone cleared the localforage instance in the meantime, number will be incorrect
RequestCache.prototype.weakLength = function() {
  return Object.getOwnPropertyNames(this.cacheKeys).length;
}

RequestCache.prototype.composeKey = function(method, url) {
  return this.keyPrefix + method + '__' + url;
}

RequestCache.prototype.keyIsPrefixed = function(key) {
  if (this.keyPrefix && this.keyPrefix.length > 0) {
    return key.startsWith(this.keyPrefix);
  } else {
    return false;
  }
}

// Reset statistical information (other than memory usage)
RequestCache.prototype.clearStats = function() {
  this.stats.miss = 0;
  this.stats.hits = 0;
}

RequestCache.prototype.getStats = function() {
  return Object.assign({}, this.stats);
}

RequestCache.prototype.setDebugOptions = function(options) {
  if (_.has(options, 'debugCachePuts')) this.options.debugCachePuts = options.debugCachePuts;
  if (_.has(options, 'debugCacheHits')) this.options.debugCacheHits = options.debugCacheHits;
  if (_.has(options, 'debugCacheMiss')) this.options.debugCacheMiss = options.debugCacheMiss;
  if (_.has(options, 'debugCacheBoot')) this.options.debugCacheBoot = options.debugCacheBoot;
}

// Clear all our entries from the localforage instance
// Probably slower than localforage.clear() but guarantee to remove only our entries
RequestCache.prototype.flush = function(done) {
  var self = this;
  if (this.ownStore) {
    self.store.clear(function() { self.cacheKeys = {}; self.stats.memory = 0; console.log('[Teuthis] proxy-flush'); if (done) done(); });
  } else {
    // Try and remove keys we know about, or with our prefix
    self.store.iterate(function(v, k) {
      if (self.cacheKeys.hasOwnProperty(k) || self.keyIsPrefixed(k)) {
        self.store.remove(k, function() { delete self.cacheKeys[k]; });
      }
    }, function() {
      self.cacheKeys = {};
      self.stats.memory = 0;
      console.log('[Teuthis] proxy-flush');
      if (done) { done(); }
    });
  }
}

RequestCache.prototype.each = function(cb, done) {
  var self = this;
  self.store.iterate(function(v, k) {
    if (self.cacheKeys.hasOwnProperty(k) || self.keyIsPrefixed(k)) {
      cb(k, v);
    }
  }, done);
}

// Weakly check if object is cached. Only checks our key list, not localforage itself
// So does not guarantee match(...) will have a HIT if, say, someone cleared localforage
RequestCache.prototype.weakHas = function(method, url) {
  var key = this.composeKey(method, url);
  return this.cacheKeys.hasOwnProperty(key);
}

// If method:url is in localforage then call onHit(composedKey, response) else call onMiss(composedKey)
RequestCache.prototype.match = function(method, url, onHit, onMiss) {
  var key = this.composeKey(method, url);
  var self = this;
  this.store.getItem(key)
    .then(function(cachedValue) {
      try {
        if (cachedValue === null) {
          delete self.cacheKeys[key]; // Handle the case where something else managed to delete an entry from localforage
          handleCacheMiss.call(self, key, onMiss);
        } else {
          handleCacheHit.call(self, key, cachedValue, onHit);
        }
      } catch (err) {
        // callback was source of the error, not this.store.getItem
        console.error('[Teuthis] proxy-cache-match handler error ' + err);
        console.error(err);
        delete self.cacheKeys[key];
      }
    }).catch(function(err) {
      // care - this will catch errors in the handler, not just errors in the cache itself
      //      - if we are not careful by having try/catch above
      //      - i.e. we need to avoid a double call to handleCacheMiss
      // otherwise we see -
      //    Error: Uncaught (in promise): InvalidStateError: XMLHttpRequest state must be OPENED.
      //    Derived from xhr.send.apply(xhr, arguments); in send() inside the miss callback
      console.error('[Teuthis] proxy-cache-match error ' + err);
      console.error(err);
      delete self.cacheKeys[key];
      handleCacheMiss.call(self, key, onMiss);
    });
}

// Put value of response for method:url into localforage, and call done(), or call done(err) if an error happens
RequestCache.prototype.put = function(method, url, value, done) {
  var key = this.composeKey(method, url);
  if (this.options.debugCachePuts) console.log('[Teuthis] proxy-cache-put ' + key);
  var self = this;
  this.store.setItem(key, value).then(function() {
    self.cacheKeys[key] = true;
    if (typeof value === 'string') self.stats.memory += value.length;
    else if (_.isArrayBuffer(value)) self.stats.memory += value.byteLength;
    if (done) done();
  }).catch(function(err) {
    console.error('[Teuthis] proxy-cache-put error ' + err);
    if (done) done(err);
  });
}

RequestCache.prototype.forceClear = function() { this.store.clear(); }

module.exports = RequestCache;