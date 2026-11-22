// habits.js — 習慣トラッカーの「画面に関係しない処理」をまとめたファイル
//
// ・DOM(画面)にも localStorage にも触れない、純粋な関数だけを置いています。
// ・引数で受け取ったデータは書き換えず、変更があるときは新しいデータを返します。
// ・日付はすべて端末のローカル日付の文字列 "YYYY-MM-DD" で扱います。
//   (日付の足し引きは UTC の暦計算で行うので、タイムゾーンや夏時間でずれません)

export const DATA_VERSION = 1;
export const BACKUP_APP = 'habit-tracker';
export const BACKUP_FORMAT = 1;
export const NAME_MAX_LENGTH = 30;

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

const pad2 = (n) => String(n).padStart(2, '0');

// ---------------------------------------------------------------------------
// 日付まわり
// ---------------------------------------------------------------------------

/** その月の日数(month は 1〜12) */
export function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** 年・月・日から "YYYY-MM-DD" を作る */
export function formatDate(year, month, day) {
  return `${String(year).padStart(4, '0')}-${pad2(month)}-${pad2(day)}`;
}

/** "YYYY-MM-DD" の形で、しかも実在する日付か(2/30 などは false) */
export function isValidDateString(value) {
  if (typeof value !== 'string') return false;
  const m = DATE_RE.exec(value);
  if (!m) return false;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (year < 1000 || month < 1 || month > 12 || day < 1) return false;
  return day <= daysInMonth(year, month);
}

function parseDate(value) {
  if (!isValidDateString(value)) {
    throw new RangeError(`日付の形が正しくありません: ${value}`);
  }
  const [y, m, d] = value.split('-').map(Number);
  return { year: y, month: m, day: d };
}

/** Date を端末のローカル日付 "YYYY-MM-DD" にする(toISOString は UTC なので使わない) */
export function toLocalDateString(date) {
  return formatDate(date.getFullYear(), date.getMonth() + 1, date.getDate());
}

/** Date を端末の時差つきの日時文字列にする(例: 2026-11-22T21:05:00+09:00) */
export function toLocalISOString(date) {
  const offset = -date.getTimezoneOffset();
  const sign = offset >= 0 ? '+' : '-';
  const abs = Math.abs(offset);
  const time = `${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`;
  return `${toLocalDateString(date)}T${time}${sign}${pad2(Math.floor(abs / 60))}:${pad2(abs % 60)}`;
}

/** "YYYY-MM-DD" に n 日足す(n は負でもよい) */
export function addDays(dateString, n) {
  const { year, month, day } = parseDate(dateString);
  const t = new Date(Date.UTC(year, month - 1, day + n));
  return formatDate(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

/** 曜日(0 = 日曜 〜 6 = 土曜) */
export function weekdayOf(dateString) {
  const { year, month, day } = parseDate(dateString);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

// ---------------------------------------------------------------------------
// データの形
//   state = { version: 1, habits: [habit, ...] }
//   habit = { id, name, createdAt: "YYYY-MM-DD", checks: ["YYYY-MM-DD", ...] }
// ---------------------------------------------------------------------------

export function createState() {
  return { version: DATA_VERSION, habits: [] };
}

function nameLength(name) {
  return [...name].length; // 絵文字なども1文字として数える
}

/**
 * 習慣を追加する
 * @returns {{ok: true, state, habit} | {ok: false, error: 'empty'|'too-long'|'duplicate'|'bad-id'}}
 */
export function addHabit(state, { name, id, today }) {
  const trimmed = typeof name === 'string' ? name.trim() : '';
  if (!trimmed) return { ok: false, error: 'empty' };
  if (nameLength(trimmed) > NAME_MAX_LENGTH) return { ok: false, error: 'too-long' };
  if (state.habits.some((h) => h.name === trimmed)) return { ok: false, error: 'duplicate' };
  if (typeof id !== 'string' || !id || state.habits.some((h) => h.id === id)) {
    return { ok: false, error: 'bad-id' };
  }
  parseDate(today);
  const habit = { id, name: trimmed, createdAt: today, checks: [] };
  return { ok: true, habit, state: { ...state, habits: [...state.habits, habit] } };
}

export function isChecked(habit, date) {
  return habit.checks.includes(date);
}

/** その日のチェックをオン/オフする(id が見つからなければそのまま返す) */
export function toggleCheck(state, habitId, date) {
  parseDate(date);
  let changed = false;
  const habits = state.habits.map((h) => {
    if (h.id !== habitId) return h;
    changed = true;
    const checks = h.checks.includes(date)
      ? h.checks.filter((d) => d !== date)
      : [...h.checks, date].sort();
    return { ...h, checks };
  });
  return changed ? { ...state, habits } : state;
}

/**
 * 連続日数(ストリーク)
 * 今日チェック済みなら今日から、まだなら昨日からさかのぼって数える。
 * (今日まだチェックしていなくても、昨日まで続いていれば途切れない)
 */
export function getStreak(habit, today) {
  const checked = new Set(habit.checks);
  let cursor = checked.has(today) ? today : addDays(today, -1);
  let count = 0;
  while (checked.has(cursor)) {
    count += 1;
    cursor = addDays(cursor, -1);
  }
  return count;
}

/**
 * ある月の記録(カレンダー表示用)
 * today を渡すと、今日・未来の日の印と「今日までの日数(elapsedDays)」も付く。
 */
export function getMonthRecord(habit, year, month, today) {
  const total = daysInMonth(year, month);
  const checked = new Set(habit ? habit.checks : []);
  const days = [];
  for (let d = 1; d <= total; d += 1) {
    const date = formatDate(year, month, d);
    days.push({
      date,
      day: d,
      checked: checked.has(date),
      isToday: date === today,
      isFuture: today ? date > today : false,
    });
  }
  return {
    year,
    month,
    daysInMonth: total,
    firstWeekday: weekdayOf(formatDate(year, month, 1)),
    days,
    checkedCount: days.filter((d) => d.checked).length,
    elapsedDays: days.filter((d) => !d.isFuture).length,
  };
}

export function summarizeState(state) {
  return {
    habitCount: state.habits.length,
    checkCount: state.habits.reduce((sum, h) => sum + h.checks.length, 0),
  };
}

// ---------------------------------------------------------------------------
// データの検査(保存データの読み込みとバックアップの読み込みで共通)
// ---------------------------------------------------------------------------

const MAX_ERRORS = 5;

function isPlainObject(v) {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** state として正しい形か調べ、正しければ整えた state を返す */
export function validateData(data) {
  const errors = [];
  if (!isPlainObject(data)) return { ok: false, errors: ['データの形が正しくありません'] };
  if (data.version !== DATA_VERSION) {
    return { ok: false, errors: [`対応していないデータの版です(version: ${JSON.stringify(data.version)})`] };
  }
  if (!Array.isArray(data.habits)) return { ok: false, errors: ['習慣の一覧(habits)がありません'] };

  const ids = new Set();
  const names = new Set();
  const habits = [];
  data.habits.forEach((h, i) => {
    const label = `${i + 1}件目の習慣`;
    if (!isPlainObject(h)) {
      errors.push(`${label}の形が正しくありません`);
      return;
    }
    if (typeof h.id !== 'string' || !h.id) errors.push(`${label}に id がありません`);
    else if (ids.has(h.id)) errors.push(`${label}の id「${h.id}」が重複しています`);
    else ids.add(h.id);

    const name = typeof h.name === 'string' ? h.name.trim() : '';
    if (!name) errors.push(`${label}に名前がありません`);
    else if (nameLength(name) > NAME_MAX_LENGTH) errors.push(`${label}の名前が長すぎます(${NAME_MAX_LENGTH}文字まで)`);
    else if (names.has(name)) errors.push(`${label}の名前「${name}」が重複しています`);
    else names.add(name);

    if (!isValidDateString(h.createdAt)) errors.push(`${label}の作成日が正しい日付ではありません`);

    if (!Array.isArray(h.checks)) {
      errors.push(`${label}にチェックの一覧(checks)がありません`);
    } else {
      const bad = h.checks.find((d) => !isValidDateString(d));
      if (bad !== undefined) errors.push(`${label}に正しくない日付があります: ${JSON.stringify(bad)}`);
    }
    if (errors.length === 0) {
      habits.push({
        id: h.id,
        name,
        createdAt: h.createdAt,
        checks: [...new Set(h.checks)].sort(),
      });
    }
  });

  if (errors.length > 0) {
    const shown = errors.slice(0, MAX_ERRORS);
    if (errors.length > MAX_ERRORS) shown.push(`ほか ${errors.length - MAX_ERRORS} 件`);
    return { ok: false, errors: shown };
  }
  return { ok: true, state: { version: DATA_VERSION, habits } };
}

// ---------------------------------------------------------------------------
// 保存・読み込みの境目(文字列との変換だけ。実際の localStorage は storage.js)
// ---------------------------------------------------------------------------

export function serialize(state) {
  return JSON.stringify(state);
}

/**
 * 保存されていた文字列から state を作る
 * ・何も保存されていなければ空の state(ok: true, empty: true)
 * ・壊れていれば空の state と ok: false(呼び出し側で元の文字列を退避する)
 */
export function deserialize(text) {
  if (text === null || text === undefined || text === '') {
    return { ok: true, empty: true, state: createState() };
  }
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return { ok: false, state: createState(), errors: ['保存データが JSON として読めません'] };
  }
  const result = validateData(data);
  if (!result.ok) return { ok: false, state: createState(), errors: result.errors };
  return { ok: true, empty: false, state: result.state };
}

// ---------------------------------------------------------------------------
// バックアップ(JSON の書き出し・読み込み)
// ---------------------------------------------------------------------------

export function createBackup(state, exportedAt) {
  return {
    app: BACKUP_APP,
    format: BACKUP_FORMAT,
    exportedAt,
    data: {
      version: DATA_VERSION,
      habits: state.habits.map((h) => ({ ...h, checks: [...h.checks] })),
    },
  };
}

export function backupToJSON(backup) {
  return `${JSON.stringify(backup, null, 2)}\n`;
}

export function backupFileName(today) {
  return `habit-tracker-backup-${today}.json`;
}

/**
 * このアプリで書き出したバックアップか確かめる
 * @returns {{ok: true, state, exportedAt, summary} | {ok: false, errors: string[]}}
 */
export function validateBackup(obj) {
  if (!isPlainObject(obj)) return { ok: false, errors: ['バックアップの形が正しくありません'] };
  if (obj.app !== BACKUP_APP) {
    return { ok: false, errors: ['このアプリで書き出したファイルではありません'] };
  }
  if (obj.format !== BACKUP_FORMAT) {
    return { ok: false, errors: [`対応していないバックアップの形式です(format: ${JSON.stringify(obj.format)})`] };
  }
  if (typeof obj.exportedAt !== 'string' || !obj.exportedAt) {
    return { ok: false, errors: ['書き出した日時(exportedAt)がありません'] };
  }
  const result = validateData(obj.data);
  if (!result.ok) return { ok: false, errors: result.errors };
  return {
    ok: true,
    state: result.state,
    exportedAt: obj.exportedAt,
    summary: summarizeState(result.state),
  };
}

/** ファイルの中身(文字列)からバックアップを読む */
export function parseBackup(text) {
  let obj;
  try {
    obj = JSON.parse(text);
  } catch {
    return { ok: false, errors: ['JSON として読み込めませんでした'] };
  }
  return validateBackup(obj);
}
