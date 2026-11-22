// storage.js — localStorage との読み書きだけを受け持つ(保存・読み込みの境目)
// 文字列への変換や中身の検査は habits.js の serialize / deserialize に任せています。
// storage を引数で差し替えられるので、Node.js のテストでも偽物の storage で試せます。

import { serialize, deserialize } from './habits.js';

export const STORAGE_KEY = 'habit-tracker:v1';

/** 保存データを読む。壊れていたときは ok: false と、元の文字列 raw を返す */
export function loadState(storage = globalThis.localStorage) {
  let raw;
  try {
    raw = storage.getItem(STORAGE_KEY);
  } catch {
    const empty = deserialize(null);
    return { ...empty, ok: false, raw: null, errors: ['この端末の保存領域が使えません'] };
  }
  return { ...deserialize(raw), raw };
}

export function saveState(state, storage = globalThis.localStorage) {
  storage.setItem(STORAGE_KEY, serialize(state));
}

/** 壊れていた保存データを、消さずに別のキーへ退避する */
export function rescueBrokenData(raw, stamp, storage = globalThis.localStorage) {
  const key = `${STORAGE_KEY}:broken:${stamp}`;
  storage.setItem(key, raw);
  return key;
}
