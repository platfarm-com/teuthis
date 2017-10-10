# Teuthis

Teuthis is an XHR transparent proxy cache.

Uses:
- retaining offline data in the presence of unreliable network connections, of artefacts such as static images or map tiles, for cases
  where a library does not reliably cache such data
- providing offline data where service workers cannot be used, for example an Android web view in a Cordova app
- auditing XHR in a browser application

Data is saved using `localforage`, which defaults to IndexedDB and falls back to other methods

# Usage example

1. Load teuthis:

```
  ...
  <script src="../teuthis.js"></script>
  ...
```

2. Shim XMLHttpRequest:

```
  ...
  <script>
    XMLHttpRequest = teuthis.Teuthis;
  </script>
  ...
```

The above should be included before loading frameworks such as cordova to ensure the native `XMLHttpRequest` is handled in all cases.

# Detailed Information

Package *teuthis* is a module intended to enable offline operation of and save bandwidth usage for web or hybrid mobile applications that employ simple XHR data retrieval, such as map tile caches and other applications. Teuthis was created because although this task can be met in the browser using a service worker, service workers are not supported in mobile we views and are thus unusable with cross platform frameworks such as Apache Cordova.

Teuthis will intercept specified XMLHttpRequest calls and retain in browser or webview local storage the response for those calls. When a subsequent call is made, if the exact URL is already in the cache, the response is returned from browser or webview local storage instead of making another network request.

It follows that only idempotent requests (requests where a query on the same URL will be expected to return the same results) should be cached, such as map tiles or static images. Teuthis further provides controls allowing the app to provide the user with a means of flushing the cache!

Teuthis works by monkey-patching the native `XMLHttpRequest` class. As such it generally needs to be instantiated early on in `index.html` before deep frameworks such as Ionic2 are bootstrapped, and particular before any code that uses `XMLHttpRequest`

# Constraints / Todo

* At present only simple use cases are supported. Specifically, XHR used with with `XMLHttpRequest` methods `open()`, `setRequestHeader()`, `send()` and property `onload` and property `request` - at present requestText and requestXML are not catered for
* At present only tested to work with string and ArrayBuffer responses
* Teuthis may break various test harnesses such as `sinon` which themselves mock an XHR server
* There needs to be a proper test harness using mocha or similar

# Developing

Run `npm install` then `npm run bundle` to create `teuthis.js`

# Name

Teuthis is ancient greek for squid and forms part of the scientific name of some species of squid. Squid is also the name of a famous open source web proxy cache.