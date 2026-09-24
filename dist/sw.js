// The Floor service worker — offline support for the installed app.
// Strategy:
//   • static assets (/assets/*, icons): cache-first, they are content-hashed
//   • navigation requests + everything else: network-first, cache fallback
const VERSION = 'thefloor-v2'
const SHELL = ['/', '/manifest.webmanifest', '/icons/icon-192.png', '/icons/icon-512.png']

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches
      .open(VERSION)
      .then(function (cache) {
        return cache.addAll(SHELL)
      })
      .then(function () {
        return self.skipWaiting()
      }),
  )
})

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches
      .keys()
      .then(function (keys) {
        return Promise.all(keys.filter(function (k) {
          return k !== VERSION
        }).map(function (k) {
          return caches.delete(k)
        }))
      })
      .then(function () {
        return self.clients.claim()
      }),
  )
})

function isStatic(url) {
  return url.pathname.indexOf('/assets/') === 0 || url.pathname.indexOf('/icons/') === 0
}

self.addEventListener('fetch', function (event) {
  const url = new URL(event.request.url)
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return

  if (isStatic(url)) {
    // Cache-first: hashed filenames never change meaning.
    event.respondWith(
      caches.match(event.request).then(function (hit) {
        return (
          hit ||
          fetch(event.request).then(function (res) {
            if (res.ok) {
              const copy = res.clone()
              caches.open(VERSION).then(function (c) {
                c.put(event.request, copy)
              })
            }
            return res
          })
        )
      }),
    )
    return
  }

  // Network-first with cache fallback (app shell + index.html).
  event.respondWith(
    fetch(event.request)
      .then(function (res) {
        if (res.ok) {
          const copy = res.clone()
          caches.open(VERSION).then(function (c) {
            c.put(event.request, copy)
          })
        }
        return res
      })
      .catch(function () {
        return caches.match(event.request).then(function (hit) {
          return hit || caches.match('/')
        })
      }),
  )
})
