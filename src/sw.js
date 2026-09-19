import { clientsClaim } from 'workbox-core'
import { cleanupOutdatedCaches, matchPrecache, precacheAndRoute } from 'workbox-precaching'
import { registerRoute } from 'workbox-routing'
import { NetworkFirst, NetworkOnly } from 'workbox-strategies'
import { CacheableResponsePlugin } from 'workbox-cacheable-response'

self.skipWaiting()
clientsClaim()

// Register BEFORE precaching. API reads, SSE and mutations must always use the
// network, including requests typed as navigations. Never store keys or libraries.
const isApi = ({ url }) => url.origin === self.location.origin &&
  (url.pathname === '/api' || url.pathname.startsWith('/api/'))
for (const method of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD']) {
  registerRoute(isApi, new NetworkOnly({ fetchOptions: { cache: 'no-store' } }), method)
}

cleanupOutdatedCaches()
precacheAndRoute(self.__WB_MANIFEST)

registerRoute(
  ({ request, url }) => request.mode === 'navigate' && url.origin === self.location.origin,
  new NetworkFirst({
    cacheName: 'arrview-navigation-v1',
    networkTimeoutSeconds: 5,
    plugins: [
      new CacheableResponsePlugin({ statuses: [200] }),
      {
        // A disconnected client sees the dedicated offline page, not a cached
        // dashboard which could be mistaken for current media/queue state.
        cachedResponseWillBeUsed: async () => matchPrecache('/offline.html'),
        fetchDidSucceed: async ({ response }) => {
          if (response.status >= 500) throw new Error('Server unavailable')
          return response
        },
        handlerDidError: async () => matchPrecache('/offline.html'),
      },
    ],
  }),
)
