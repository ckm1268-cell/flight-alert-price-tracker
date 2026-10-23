/* Service worker. Bump SHELL_VERSION on every commit that touches a precached file (CI also cache-busts asset URLs). */
const SHELL_VERSION = 'v1';
const CACHE = 'flight-shell-' + SHELL_VERSION;
const SHELL = ['./', 'index.html', 'app.js', 'styles.css', 'shared/shared.js', 'config.js', 'manifest.webmanifest'];

self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

// Network-first / cache-fallback ONLY for the shell entry page. Other navigations (e.g. admin pages) go straight to network,
// so a transient fetch error can never silently render the cached dashboard in their place.
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return; // never cache Supabase / API calls
  const isEntry = req.mode === 'navigate' && (url.pathname.endsWith('/') || url.pathname.endsWith('/index.html'));
  if (isEntry) {
    e.respondWith(fetch(req).then((r) => { const copy = r.clone(); caches.open(CACHE).then((c) => c.put('index.html', copy)); return r; }).catch(() => caches.match('index.html')));
  } else if (SHELL.some((p) => url.pathname.endsWith(p.replace('./', '')) && p !== './')) {
    e.respondWith(fetch(req).catch(() => caches.match(req)));
  }
});
