// Service worker : garde l'appli disponible hors ligne.
// Incrémente VERSION à chaque mise à jour du code pour forcer le rafraîchissement.
const VERSION = "recomp-v1";
const SHELL = ["./", "index.html", "styles.css", "app.js", "config.js", "supabase.js",
  "manifest.webmanifest", "icons/icon-192.png", "icons/icon-512.png", "icons/apple-touch-icon.png"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  // Les appels à Supabase passent toujours par le réseau (l'appli gère le hors-ligne elle-même).
  if (url.hostname.endsWith("supabase.co") || url.hostname.endsWith("supabase.in")) return;
  const sameOrigin = url.origin === self.location.origin;
  const isFont = url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com";
  if (!sameOrigin && !isFont) return;
  // Réseau d'abord (pour avoir la dernière version), cache si hors ligne.
  e.respondWith(
    fetch(req).then(res => {
      if (res && (res.ok || res.type === "opaque")) {
        const copy = res.clone();
        caches.open(VERSION).then(c => c.put(req, copy));
      }
      return res;
    }).catch(() => caches.match(req).then(r => r || (req.mode === "navigate" ? caches.match("index.html") : undefined)))
  );
});
