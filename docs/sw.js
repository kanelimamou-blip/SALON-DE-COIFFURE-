const CACHE = "salon-v12";
const SHELL = ["./", "index.html", "app.css", "app.js", "plus.js", "admin.js", "store.js", "config.js", "vendor/qrcode.js", "manifest.webmanifest", "icons/icon-192.png"];
self.addEventListener("install", (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL))); self.skipWaiting(); });
self.addEventListener("activate", (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k.startsWith("salon-") && k !== CACHE).map((k) => caches.delete(k))))); self.clients.claim(); });
// Réseau d'abord, cache si hors ligne : l'appli s'ouvre sans connexion (les polices et Firebase compris)
self.addEventListener("fetch", (e) => {
  const u = e.request.url;
  if (e.request.method !== "GET") return;
  const mine = u.startsWith(self.location.origin), lib = /fonts\.(googleapis|gstatic)\.com|gstatic\.com\/firebasejs/.test(u);
  if (!mine && !lib) return;
  e.respondWith(fetch(e.request).then((r) => { if (r.ok || r.type === "opaque") { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); } return r; }).catch(() => caches.match(e.request)));
});
self.addEventListener("notificationclick", (e) => { e.notification.close(); e.waitUntil(self.clients.matchAll({ type: "window" }).then((cs) => (cs[0] ? cs[0].focus() : self.clients.openWindow("./")))); });
