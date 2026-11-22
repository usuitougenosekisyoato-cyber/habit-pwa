// sw.js のキャッシュ一覧(APP_FILES)に書き漏れ・書き間違いがないか確かめる
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('..', import.meta.url));
const sw = readFileSync(path.join(root, 'sw.js'), 'utf8');

function appFiles() {
  const m = /const APP_FILES = \[([\s\S]*?)\];/.exec(sw);
  assert.ok(m, 'sw.js に APP_FILES が見つかりません');
  return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
}

test('VERSION が書かれている', () => {
  assert.match(sw, /const VERSION = 'v\d+';/);
});

test('キャッシュ一覧のファイルはすべて実在する', () => {
  for (const url of appFiles()) {
    const rel = url === './' ? 'index.html' : url.replace(/^\.\//, '');
    assert.ok(existsSync(path.join(root, rel)), `${url} がありません`);
  }
});

test('画面に必要なファイルは、すべてキャッシュ一覧に入っている', () => {
  const listed = new Set(appFiles().map((u) => u.replace(/^\.\//, '')));
  const needed = [
    ...readdirSync(root).filter((f) => /\.(html|css|js|webmanifest)$/.test(f) && f !== 'sw.js'),
    ...readdirSync(path.join(root, 'icons')).map((f) => `icons/${f}`),
  ];
  for (const f of needed) assert.ok(listed.has(f), `${f} が sw.js の APP_FILES にありません`);
});
