'use strict';

const _ = require('lodash');
const localforage = require('localforage');

// Provides class ProxyCache, a wrapper around the localforage local storage provider
// that manages generating keys from XHR requests, and querying and saving data into the cache

var defaultOptions = {
  instanceName: null,
  keyPrefix: '',
  onStatus: null,
  onReady: null,
  debugCachePuts: true, // todo change to false in git
  debugCacheHits: true, // todo change to false in git
  debugCacheMiss: true, // todo change to false in git
};

// Create a new ProxyCache
// If options.instanceName is set and not null then use a new private scope of localforage of that name, otherwise use global localforage
// Using instanceName changes the behaviour of clear() to be less polite
function ProxyCache(options) {
  console.log('[Teuthis] ProxyCache constructor');
  var self = this;
  this.stats = {miss: 0, hits: 0, memory: 0};
  this.options = _.defaults({}, options);  _.defaults(this.options, defaultOptions);
  this.store = localforage;
  this.ownStore = false;
  if (this.options.instanceName !== null) {
    this.ownStore = true;
    this.store = localforage.createInstance({name: this.options.instanceName, description: 'Teuthis XHR proxy cache'});
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
      if (typeof v === 'arraybuffer') m = v.length;
      self.stats.memory += m;
      console.log('[Teuthis] found key: ' + k + ', memory: ' + m);
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
  if (onMiss) onMiss(key);
  if (this.options.onStatus) this.options.onStatus.call(this);
}

function handleCacheHit(key, cachedValue, onHit) {
  if (this.options.debugCacheHits) console.log('[Teuthis] proxy-hit ' + key);
  this.stats.hits ++;
  if (onHit) onHit(key, cachedValue);
  if (this.options.onStatus) this.options.onStatus.call(this);
}

// Returns estimated number of entries in the cache
// If someone cleared the localforage instance in the meantime, number will be incorrect
ProxyCache.prototype.weakLength = function() {
  return Object.getOwnPropertyNames(this.cacheKeys).length;
}

ProxyCache.prototype.composeKey = function(method, url) {
  return this.keyPrefix + method + '__' + url;
}

ProxyCache.prototype.keyIsPrefixed = function(key) {
  if (this.keyPrefix && this.keyPrefix.length > 0) {
    return key.startsWith(this.keyPrefix);
  } else {
    return false;
  }
}

// Reset statistical information (other than memory usage)
ProxyCache.prototype.clearStats = function() {
  this.stats.miss = 0;
  this.stats.hits = 0;
}

ProxyCache.prototype.getStats = function() {
  return Object.assign({}, this.stats);
}

// Clear all our entries from the localforage instance
// Probably slower than localforage.clear() but guarantee to remove only our entries
ProxyCache.prototype.flush = function(done) {
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

ProxyCache.prototype.each = function(cb, done) {
  var self = this;
  self.store.iterate(function(v, k) {
    if (self.cacheKeys.hasOwnProperty(k) || self.keyIsPrefixed(k)) {
      cb(k, v);
    }
  }, done);
}

// Weakly check if object is cached. Only checks our key list, not localforage itself
// So does not guarantee match(...) will have a HIT if, say, someone cleared localforage
ProxyCache.prototype.weakHas = function(method, url) {
  var key = this.composeKey(method, url);
  return this.cacheKeys.hasOwnProperty(key);
}

// If method:url is in localforage then call onHit(composedKey, response) else call onMiss(composedKey)
ProxyCache.prototype.match = function(method, url, onHit, onMiss) {
  var key = this.composeKey(method, url);
  var self = this;
  this.store.getItem(key)
    .then(function(cachedValue) {
      if (cachedValue === null) {
        delete self.cacheKeys[key]; // Handle the case where something else managed to delete an entry from localforage
        handleCacheMiss.call(self, key, onMiss);
      } else {
        handleCacheHit.call(self, key, cachedValue, onHit);
      }
    }).catch(function(err) {
      console.error('[Teuthis] proxy-cache-match error ' + err);
      console.error(err);
      delete self.cacheKeys[key];
      handleCacheMiss.call(self, key, onMiss);
    });
}

// Put value of response for method:url into localforage, and call done(), or call done(err) if an error happens
ProxyCache.prototype.put = function(method, url, value, done) {
  var key = this.composeKey(method, url);
  if (this.options.debugCachePuts) console.log('[Teuthis] proxy-cache-put ' + key);
  var self = this;
  this.store.setItem(key, value).then(function() {
    self.cacheKeys[key] = true;
    if (typeof value === 'string') self.stats.memory += value.length;
    if (typeof value === 'arraybuffer') self.stats.memory += value.length;
    if (done) done();
  }).catch(function(err) {
    console.error('[Teuthis] proxy-cache-put error ' + err);
    if (done) done(err);
  });
}

ProxyCache.forceClear = function() { localforage.clear(); }

module.exports = ProxyCache;