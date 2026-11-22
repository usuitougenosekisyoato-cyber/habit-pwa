// sw.js — Service Worker(アプリ本体をキャッシュして、オフラインでも開けるようにする)
//
// ★ アプリのファイル(HTML / CSS / JS / アイコンなど)を変えたら、必ず VERSION を上げてください。
//   VERSION が変わる = sw.js の中身が変わるので、ブラウザが新しい版として取り込みます。
//
// 新しい版への切り替わり方(くわしくは README.md):
//   1. 開いたとき、画面はいまの版のキャッシュから出す(オフラインでもすぐ開ける)
//   2. 裏でブラウザが sw.js を取りに行き、変わっていれば新しい版を install
//   3. 新しい版は全ファイルを新しいキャッシュに取り込み、待機する(画面は古い版のまま)
//   4. 画面に「新しい版があります[更新する]」が出る
//   5. 押すと新しい版が有効になり、古い版のキャッシュを削除
//   6. ページが再読み込みされて新しい版の画面になる
//   ※ 押さなくても、アプリを全部閉じて開き直せば新しい版に切り替わる
//
// 保存データ(localStorage)はこのキャッシュとは別の場所なので、更新しても消えません。

const VERSION = 'v1';
const CACHE_PREFIX = 'habit-tracker-';
const CACHE_NAME = `${CACHE_PREFIX}${VERSION}`;

const APP_FILES = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './habits.js',
  './storage.js',
  './manifest.webmanifest',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      // cache: 'reload' … ブラウザの通常キャッシュを通さず、サーバーから最新を取り直す
      await cache.addAll(APP_FILES.map((url) => new Request(url, { cache: 'reload' })));
    })(),
  );
  // ここでは skipWaiting しない(使っている途中で画面が入れ替わらないよう、利用者の操作を待つ)
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names
          .filter((name) => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME)
          .map((name) => caches.delete(name)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      const hit = await cache.match(request, { ignoreSearch: true });
      if (hit) return hit;
      try {
        return await fetch(request);
      } catch (err) {
        if (request.mode === 'navigate') {
          const shell = await cache.match('./index.html');
          if (shell) return shell;
        }
        throw err;
      }
    })(),
  );
});
