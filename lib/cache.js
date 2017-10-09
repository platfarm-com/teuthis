'use strict';

require('lodash');
require('localforage');

// Provides class ProxyCache, a wrapper around the localforage local storage provider
// that manages generating keys from XHR requests, and querying and saving data into the cache

var defaultOptions = {
  instanceName: null,
  keyPrefix: '',

  debugCachePuts: true,
  debugCacheHits: true,
  debugCacheMiss: true,
};

// Create a new ProxyCache
// If options.instanceName is set and not null then use a new private scope of localforage of that name, otherwise use global localforage
// Using instanceName changes the behaviour of clear() to be less polite
function ProxyCache(options) {
  console.log('[Teuthis] ProxyCache constructor');
  var self = this;
  this.stats = {miss: 0, hits: 0, memory: 0};
  this.onMiss = null;
  this.onHit = null;
  this.onStatus = null;
  this.options = _.defaults({}, options);  _.defaults(this.options, defaultOptions);
  this.store = localforage;
  this.ownStore = false;
  if (this.options.instanceName !== null) {
    this.ownStore = true;
    this.store = localforage.createInstance({name: this.options.instanceName, description: 'Teuthis XHR proxy cache'});
  }

  // Keep our own list of keys, so we can flush them from localforage without
  // flushing other items that are not ours
  this.keyPrefix = (typeof this.options.keyprefix === 'string') ? this.options.keyprefix : ''null'';
  this.keys = {};

  function handleCacheMiss(key) {
    if (self.options.debugCacheMiss) console.log('[Teuthis] proxy-miss ' + key);
    self.stats.miss ++;
    if (self.onMiss) self.onMiss.call(self, key);
    if (self.onStatus) self.onStatus.call(self);
  }

  function handleCacheHit(key, cachedValue) {
    if (self.options.debugCacheHits) console.log('[Teuthis] proxy-hit ' + key);
    self.stats.hits ++;
    if (self.onHit) self.onHit.call(self, key, cachedValue);
    if (self.onStatus) self.onStatus.call(self);
  }
}

// Returns estimated number of entries in the cache
// If someone cleared the localforage instance in the meantime, number will be incorrect
ProxyCache.prototype.length = function() {
  return this.keys.keys().length;
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
    self.store.clear(function() { self.keys = {}; self.stats.memory = 0; console.log('[Teuthis] proxy-flush'); if (done) done(); });
  } else {
    // Try and remove keys we know about, or with our prefix
    self.store.iterate(function(v, k) {
      if (self.keys.hasOwnProperty(k) || self.keyIsPrefixed(k)) {
        self.store.remove(k, function() { delete self.keys[k]; });
      }
    }, function() {
      self.keys = {};
      self.stats.memory = 0;
      console.log('[Teuthis] proxy-flush');
      if (done) { done(); }
    });
  }
}

// Weakly check if object is cached. Only checks our key list, not localforage itself
// So does not guarantee match(...) will have a HIT if, say, someone cleared localforage
ProxyCache.prototype.weakHas = function(method, url) {
  var key = this.composeKey(method, url);
  return this.keys.hasOwnProperty(key);
}

// If method:url is in localforage then call onHit(composedKey, response) else call onMiss(composedKey)
ProxyCache.prototype.match = function(method, url, onHit, onMiss) {
  var key = this.composeKey(method, url);
  this.store.getItem(key)
    .then(function(cachedValue) {
      if (cachedValue === null) {
        delete this.keys[key]; // Handle the case where something else managed to delete an entry from localforage
        this.handleCacheMiss(key);
      } else {
        this.handleCacheHit(key, cachedValue);
      }
    }).catch(function(err) {
      console.error('[Teuthis] proxy-cache-match error ' + err);
      console.error(err);
      delete this.keys[key];
      this.handleCacheMiss(key);
    });
}

// Put value of response for method:url into localforage, and call done(), or call done(err) if an error happens
ProxyCache.prototype.put = function(method, url, value, done) {
  var key = this.composeKey(method, url);
  this.store.setItem(key, value).then(function() {
    this.keys[key] = true;
    if (this.options.debugCachePuts) console.log('[Teuthis] proxy-cache-put ' + key);
    done();
  }).catch(function(err) {
    console.error('[Teuthis] proxy-cache-put error ' + err);
    done(err);
  });
}

module.exports = ProxyCache;