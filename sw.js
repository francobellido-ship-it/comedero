// Service worker de la app del dueño: permite instalarla (y empaquetarla como APK con PWABuilder)
const CACHE = 'comedero-v15';
const ARCHIVOS = ['./app.html', './index.html', './css/app.css', './js/firebase-config.js', './js/comedero.js', './js/nube.js', './js/dibujos.js', './js/app.js', './manifest.json', './manifest-demo.json', './demo.html', './js/sim.js', './js/vision.js', './js/presentacion.js', './js/cuenta.js', './icon-192.png', './icon-512.png'];
self.addEventListener('install', (e) => e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ARCHIVOS)).then(() => self.skipWaiting())));
self.addEventListener('activate', (e) => e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (url.origin !== location.origin || e.request.method !== 'GET') return; // Firebase, TensorFlow.js y MobileNet van directo
  // Primero la red, siempre revalidando (no-cache): así una versión nueva de la página nunca queda tapada por la vieja
  e.respondWith(fetch(e.request, { cache: 'no-cache' }).then((r) => { const copia = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, copia)); return r; }).catch(() => caches.match(e.request)));
});
