# Teuthis

Teuthis is an XHR transparent proxy cache.

Uses:
- retaining offline data in the presence of unreliable network connections, of artefacts such as static images or map tiles, for cases
  where a library does not reliably cache such data
- providing offline data where service workers cannot be used, for example an Android web view in a Cordova app
- auditing XHR in a browser application

Data is saved using `localforage`, which defaults to IndexedDB and falls back to other methods

## License

Teuthis is licensed under the MPL (see https://www.mozilla.org/en-US/MPL/2.0/FAQ/ and for a good summary of reasons why see https://christoph-conrads.name/why-i-chose-the-mozilla-public-license-2-0/).

Briefly paraphrased, you can use Teuthis in a commercial setting, and the MPL does not have the "viral" component of the GPL. However _modifications_ to files _that are part of Teuthis_ that you wish to _redistribute_ (by using in a web page or hybrid mobile app) must be made available, and also cannot be re-licensed.

The easiest way to make available is to submit a pull request :-)

I'm also happy to dual-license, so contact me to negotiate a commercial license if required.

# Usage example

1. Load teuthis:

```
  ...
  <script src="path/to/teuthis.js"></script>
  ...
```

2. Shim XMLHttpRequest:

```
  ...
  <script>
    // Replace all future XHR with Teuthis
    XMLHttpRequest = teuthis.Teuthis;

    // Set function used to decide what to cache or audit
    XMLHttpRequest.setCacheSelector(function (method, url) {
      // audit everything
      console.log('XHR Audit -- ' + url);

      // Only cache GET requests from specified URL
      if (method === 'GET' && url.startsWith('https://') && (url.includes('bnb.data.bl.uk'))) {
        return true;
      }
      return false;
    });

    // ...

    // Clear the cache with prejudice as follows:
    XMLHttpRequest.getStore().forceClear();

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
* RequestCache.onready wont fire as it cant be set until after when default created by Teuthis
* There should be a `.min.js` build
* Did I say it needed a unit test suite? Assistance gratefully received :-)

# Developing

Run `npm install` then `npm run bundle` to create `teuthis.js`

# Etymology

Teuthis is ancient greek for squid and forms part of the scientific name of some species of squid. Squid is also the name of a famous open source web proxy cache.