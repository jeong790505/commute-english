// 앱 화면은 오프라인에서도 열리도록 캐시 (AI 대화 자체는 인터넷 필요)
const CACHE = "drive-english-v7";
const ASSETS = ["./", "index.html", "style.css", "app.js", "prompt.js", "scenarios.js", "gemini.js",
  "manifest.webmanifest", "icon-180.png", "icon-192.png", "icon-512.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});
// 네트워크 우선 + 브라우저 HTTP 캐시 무시(GitHub Pages는 10분 캐시) → 배포하면 바로 반영, 오프라인이면 캐시
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;
  e.respondWith(
    fetch(e.request.url, { cache: "no-cache" }).then((res) => {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(e.request, copy));
      return res;
    }).catch(() => caches.match(e.request).then((r) => r || caches.match("index.html")))
  );
});
