import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  addDays,
  addHabit,
  backupFileName,
  backupToJSON,
  createBackup,
  createState,
  daysInMonth,
  deserialize,
  getMonthRecord,
  getStreak,
  isChecked,
  isValidDateString,
  parseBackup,
  serialize,
  summarizeState,
  toLocalDateString,
  toLocalISOString,
  toggleCheck,
  validateBackup,
  weekdayOf,
} from '../habits.js';
import { STORAGE_KEY, loadState, rescueBrokenData, saveState } from '../storage.js';

const readText = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');

/** 連続した日付のチェックを作る(start から count 日分) */
function run(start, count) {
  return Array.from({ length: count }, (_, i) => addDays(start, i));
}
const habitWith = (checks) => ({ id: 'h', name: 'テスト', createdAt: '2020-01-01', checks: [...checks].sort() });

// ---------------------------------------------------------------------------
describe('日付の扱い', () => {
  test('ローカル日付で YYYY-MM-DD にする(深夜0時台でも前日にならない)', () => {
    assert.equal(toLocalDateString(new Date(2026, 0, 1, 0, 30)), '2026-01-01');
    assert.equal(toLocalDateString(new Date(2026, 11, 31, 23, 59)), '2026-12-31');
    assert.equal(toLocalDateString(new Date(2026, 10, 5)), '2026-11-05');
  });

  test('時差つきの日時文字列はローカル日付と一致する', () => {
    const d = new Date(2026, 10, 22, 0, 5, 9);
    const s = toLocalISOString(d);
    assert.match(s, /^2026-11-22T00:05:09[+-]\d{2}:\d{2}$/);
    assert.equal(new Date(s).getTime(), d.getTime());
  });

  test('正しい日付だけを受け付ける', () => {
    assert.equal(isValidDateString('2026-11-22'), true);
    assert.equal(isValidDateString('2028-02-29'), true);
    assert.equal(isValidDateString('2027-02-29'), false);
    assert.equal(isValidDateString('2026-02-30'), false);
    assert.equal(isValidDateString('2026-13-01'), false);
    assert.equal(isValidDateString('2026-11-00'), false);
    assert.equal(isValidDateString('2026/11/22'), false);
    assert.equal(isValidDateString('2026-1-5'), false);
    assert.equal(isValidDateString(20261122), false);
    assert.equal(isValidDateString(null), false);
  });

  test('月の日数(うるう年を含む)', () => {
    assert.equal(daysInMonth(2026, 1), 31);
    assert.equal(daysInMonth(2026, 2), 28);
    assert.equal(daysInMonth(2028, 2), 29);
    assert.equal(daysInMonth(2100, 2), 28); // 100で割り切れる年はうるう年でない
    assert.equal(daysInMonth(2000, 2), 29); // 400で割り切れる年はうるう年
    assert.equal(daysInMonth(2026, 4), 30);
  });

  test('日付の足し引き: 月またぎ・年またぎ・うるう年', () => {
    assert.equal(addDays('2026-10-31', 1), '2026-11-01');
    assert.equal(addDays('2026-11-01', -1), '2026-10-31');
    assert.equal(addDays('2026-12-31', 1), '2027-01-01');
    assert.equal(addDays('2027-01-01', -1), '2026-12-31');
    assert.equal(addDays('2028-02-28', 1), '2028-02-29');
    assert.equal(addDays('2028-02-29', 1), '2028-03-01');
    assert.equal(addDays('2027-02-28', 1), '2027-03-01');
    assert.equal(addDays('2028-03-01', -1), '2028-02-29');
    assert.equal(addDays('2026-11-22', 0), '2026-11-22');
    assert.equal(addDays('2026-01-01', 365), '2027-01-01');
  });

  test('夏時間の切り替え日をまたいでもずれない', () => {
    // 米国・欧州の夏時間の切り替え日まわり(UTC の暦計算なので影響を受けない)
    assert.equal(addDays('2026-03-08', 1), '2026-03-09');
    assert.equal(addDays('2026-03-29', -1), '2026-03-28');
    assert.equal(addDays('2026-11-01', 1), '2026-11-02');
  });

  test('曜日', () => {
    assert.equal(weekdayOf('2026-11-22'), 0); // 日曜
    assert.equal(weekdayOf('2026-11-01'), 0);
    assert.equal(weekdayOf('2028-02-29'), 2); // 火曜
  });

  test('正しくない日付を渡すとエラーになる', () => {
    assert.throws(() => addDays('2026-02-30', 1), RangeError);
  });
});

// ---------------------------------------------------------------------------
describe('習慣の追加', () => {
  test('追加すると新しい state が返り、元の state は変わらない', () => {
    const s0 = createState();
    const r = addHabit(s0, { name: '  散歩  ', id: 'a', today: '2026-11-22' });
    assert.equal(r.ok, true);
    assert.deepEqual(r.habit, { id: 'a', name: '散歩', createdAt: '2026-11-22', checks: [] });
    assert.equal(r.state.habits.length, 1);
    assert.equal(s0.habits.length, 0);
  });

  test('空の名前・長すぎる名前・同じ名前・同じ id は追加しない', () => {
    let s = addHabit(createState(), { name: '散歩', id: 'a', today: '2026-11-22' }).state;
    assert.deepEqual(addHabit(s, { name: '   ', id: 'b', today: '2026-11-22' }), { ok: false, error: 'empty' });
    assert.deepEqual(addHabit(s, { name: 'あ'.repeat(31), id: 'b', today: '2026-11-22' }), { ok: false, error: 'too-long' });
    assert.deepEqual(addHabit(s, { name: '散歩', id: 'b', today: '2026-11-22' }), { ok: false, error: 'duplicate' });
    assert.deepEqual(addHabit(s, { name: '読書', id: 'a', today: '2026-11-22' }), { ok: false, error: 'bad-id' });
    assert.equal(addHabit(s, { name: 'あ'.repeat(30), id: 'c', today: '2026-11-22' }).ok, true);
  });

  test('絵文字は1文字として数える', () => {
    const r = addHabit(createState(), { name: '💧'.repeat(30), id: 'a', today: '2026-11-22' });
    assert.equal(r.ok, true);
  });
});

// ---------------------------------------------------------------------------
describe('毎日のチェック', () => {
  const base = addHabit(createState(), { name: '散歩', id: 'a', today: '2026-11-20' }).state;

  test('オン → オフ と切り替わり、元の state は変わらない', () => {
    const on = toggleCheck(base, 'a', '2026-11-22');
    assert.equal(isChecked(on.habits[0], '2026-11-22'), true);
    assert.equal(base.habits[0].checks.length, 0);
    const off = toggleCheck(on, 'a', '2026-11-22');
    assert.equal(isChecked(off.habits[0], '2026-11-22'), false);
    assert.equal(on.habits[0].checks.length, 1);
  });

  test('チェックは日付順に並ぶ', () => {
    let s = toggleCheck(base, 'a', '2026-11-22');
    s = toggleCheck(s, 'a', '2026-11-20');
    s = toggleCheck(s, 'a', '2026-11-21');
    assert.deepEqual(s.habits[0].checks, ['2026-11-20', '2026-11-21', '2026-11-22']);
  });

  test('ほかの習慣には影響しない・知らない id ならそのまま', () => {
    const two = addHabit(base, { name: '読書', id: 'b', today: '2026-11-20' }).state;
    const s = toggleCheck(two, 'b', '2026-11-22');
    assert.equal(s.habits[0], two.habits[0]);
    assert.equal(toggleCheck(two, 'zzz', '2026-11-22'), two);
  });
});

// ---------------------------------------------------------------------------
describe('連続日数(ストリーク)', () => {
  test('チェックがなければ 0', () => {
    assert.equal(getStreak(habitWith([]), '2026-11-22'), 0);
  });

  test('今日だけチェック → 1', () => {
    assert.equal(getStreak(habitWith(['2026-11-22']), '2026-11-22'), 1);
  });

  test('今日まだでも、昨日まで続いていれば途切れない', () => {
    const h = habitWith(run('2026-11-15', 7)); // 11/15〜11/21
    assert.equal(getStreak(h, '2026-11-22'), 7);
  });

  test('今日もチェックすると +1', () => {
    const h = habitWith(run('2026-11-15', 8)); // 11/15〜11/22
    assert.equal(getStreak(h, '2026-11-22'), 8);
  });

  test('昨日も今日もチェックしていなければ 0(おととい以前は数えない)', () => {
    const h = habitWith(run('2026-11-10', 11)); // 11/10〜11/20
    assert.equal(getStreak(h, '2026-11-22'), 0);
  });

  test('途中で1日抜けたら、そこまでで止まる', () => {
    const h = habitWith([...run('2026-11-01', 5), ...run('2026-11-07', 3)]); // 11/6 が抜け
    assert.equal(getStreak(h, '2026-11-09'), 3);
    assert.equal(getStreak(h, '2026-11-10'), 3);
  });

  test('月またぎ(10/31 → 11/1)', () => {
    const h = habitWith(run('2026-10-29', 5)); // 10/29〜11/2
    assert.equal(getStreak(h, '2026-11-02'), 5);
    assert.equal(getStreak(h, '2026-11-03'), 5);
  });

  test('年またぎ(12/31 → 1/1)', () => {
    const h = habitWith(run('2026-12-30', 4)); // 12/30〜1/2
    assert.equal(getStreak(h, '2027-01-02'), 4);
    assert.equal(getStreak(h, '2027-01-03'), 4);
  });

  test('うるう年(2/28 → 2/29 → 3/1)', () => {
    const h = habitWith(['2028-02-27', '2028-02-28', '2028-02-29', '2028-03-01']);
    assert.equal(getStreak(h, '2028-03-01'), 4);
  });

  test('うるう年に 2/29 だけ抜けると途切れる', () => {
    const h = habitWith(['2028-02-27', '2028-02-28', '2028-03-01']);
    assert.equal(getStreak(h, '2028-03-01'), 1);
  });

  test('うるう年でない年は 2/28 の次が 3/1 で続く', () => {
    const h = habitWith(['2027-02-27', '2027-02-28', '2027-03-01']);
    assert.equal(getStreak(h, '2027-03-01'), 3);
  });

  test('未来の日のチェックは数えない', () => {
    const h = habitWith(['2026-11-21', '2026-11-22', '2026-11-25']);
    assert.equal(getStreak(h, '2026-11-22'), 2);
  });

  test('1年以上の長い連続', () => {
    const h = habitWith(run('2027-11-23', 400));
    assert.equal(getStreak(h, addDays('2027-11-23', 399)), 400);
  });
});

// ---------------------------------------------------------------------------
describe('今月の記録', () => {
  const h = habitWith([
    '2026-10-31', // 先月(含めない)
    '2026-11-01', '2026-11-05', '2026-11-21', '2026-11-22',
    '2026-11-30',
    '2026-12-01', // 来月(含めない)
  ]);

  test('その月の日数・1日の曜日・チェック数', () => {
    const r = getMonthRecord(h, 2026, 11, '2026-11-22');
    assert.equal(r.daysInMonth, 30);
    assert.equal(r.days.length, 30);
    assert.equal(r.firstWeekday, 0); // 2026/11/1 は日曜
    assert.equal(r.checkedCount, 5);
    assert.deepEqual(r.days.filter((d) => d.checked).map((d) => d.day), [1, 5, 21, 22, 30]);
  });

  test('今日と未来の印・今日までの日数', () => {
    const r = getMonthRecord(h, 2026, 11, '2026-11-22');
    assert.equal(r.elapsedDays, 22);
    assert.equal(r.days[21].isToday, true);
    assert.equal(r.days[21].isFuture, false);
    assert.equal(r.days[22].isFuture, true);
    assert.equal(r.days.filter((d) => d.isToday).length, 1);
  });

  test('過去の月なら全日が経過済み・今日を渡さなければ未来の印なし', () => {
    assert.equal(getMonthRecord(h, 2026, 10, '2026-11-22').elapsedDays, 31);
    assert.equal(getMonthRecord(h, 2026, 10, '2026-11-22').checkedCount, 1);
    const noToday = getMonthRecord(h, 2026, 11);
    assert.equal(noToday.days.some((d) => d.isFuture || d.isToday), false);
  });

  test('2月の日数(うるう年 29日 / 平年 28日)', () => {
    const leap = getMonthRecord(habitWith(['2028-02-29']), 2028, 2, '2028-03-01');
    assert.equal(leap.daysInMonth, 29);
    assert.equal(leap.checkedCount, 1);
    assert.equal(leap.days.at(-1).date, '2028-02-29');
    assert.equal(getMonthRecord(habitWith([]), 2027, 2).daysInMonth, 28);
  });

  test('年またぎ: 12月の記録に翌年1月は混ざらない', () => {
    const y = habitWith(['2026-12-31', '2027-01-01']);
    assert.equal(getMonthRecord(y, 2026, 12).checkedCount, 1);
    assert.equal(getMonthRecord(y, 2027, 1).checkedCount, 1);
  });

  test('習慣がなくても空のカレンダーを返す', () => {
    const r = getMonthRecord(null, 2026, 11, '2026-11-22');
    assert.equal(r.checkedCount, 0);
    assert.equal(r.days.length, 30);
  });
});

// ---------------------------------------------------------------------------
describe('保存・読み込みの境目', () => {
  test('serialize → deserialize で元に戻る', () => {
    let s = addHabit(createState(), { name: '散歩', id: 'a', today: '2026-11-22' }).state;
    s = toggleCheck(s, 'a', '2026-11-22');
    const r = deserialize(serialize(s));
    assert.equal(r.ok, true);
    assert.deepEqual(r.state, s);
  });

  test('何も保存されていなければ空の state', () => {
    assert.deepEqual(deserialize(null), { ok: true, empty: true, state: createState() });
  });

  test('壊れた JSON・形の違うデータは ok: false で空の state', () => {
    for (const text of ['{壊れて', '[]', '{"version":2,"habits":[]}', '{"version":1}']) {
      const r = deserialize(text);
      assert.equal(r.ok, false, text);
      assert.deepEqual(r.state, createState());
      assert.ok(r.errors.length > 0);
    }
  });

  test('storage.js: 偽物の storage で保存・読み込み・退避', () => {
    const mem = new Map();
    const storage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)) };
    assert.equal(loadState(storage).empty, true);

    const s = addHabit(createState(), { name: '散歩', id: 'a', today: '2026-11-22' }).state;
    saveState(s, storage);
    assert.ok(mem.has(STORAGE_KEY));
    assert.deepEqual(loadState(storage).state, s);

    mem.set(STORAGE_KEY, '{壊れて');
    const broken = loadState(storage);
    assert.equal(broken.ok, false);
    assert.equal(broken.raw, '{壊れて');
    const key = rescueBrokenData(broken.raw, '20261122-090000', storage);
    assert.equal(key, `${STORAGE_KEY}:broken:20261122-090000`);
    assert.equal(mem.get(key), '{壊れて');
  });

  test('storage.js: storage が使えないときも落ちない', () => {
    const storage = { getItem: () => { throw new Error('denied'); } };
    const r = loadState(storage);
    assert.equal(r.ok, false);
    assert.deepEqual(r.state, createState());
  });
});

// ---------------------------------------------------------------------------
describe('バックアップの書き出し・読み込み', () => {
  const state = (() => {
    let s = addHabit(createState(), { name: '散歩', id: 'a', today: '2026-11-01' }).state;
    s = addHabit(s, { name: '読書', id: 'b', today: '2026-11-02' }).state;
    s = toggleCheck(s, 'a', '2026-11-21');
    s = toggleCheck(s, 'a', '2026-11-22');
    s = toggleCheck(s, 'b', '2026-11-22');
    return s;
  })();

  test('書き出した形には、このアプリの目印が付く', () => {
    const b = createBackup(state, '2026-11-22T21:05:00+09:00');
    assert.equal(b.app, 'habit-tracker');
    assert.equal(b.format, 1);
    assert.equal(b.exportedAt, '2026-11-22T21:05:00+09:00');
    assert.equal(b.data.version, 1);
    assert.equal(b.data.habits.length, 2);
  });

  test('書き出したバックアップを変えても、元の state は変わらない', () => {
    const b = createBackup(state, 'x');
    b.data.habits[0].checks.push('2026-01-01');
    assert.equal(state.habits[0].checks.length, 2);
  });

  test('書き出し → 読み込みで元どおりになる', () => {
    const text = backupToJSON(createBackup(state, '2026-11-22T21:05:00+09:00'));
    const r = parseBackup(text);
    assert.equal(r.ok, true);
    assert.deepEqual(r.state, state);
    assert.equal(r.exportedAt, '2026-11-22T21:05:00+09:00');
    assert.deepEqual(r.summary, { habitCount: 2, checkCount: 3 });
  });

  test('件数の要約', () => {
    assert.deepEqual(summarizeState(state), { habitCount: 2, checkCount: 3 });
    assert.deepEqual(summarizeState(createState()), { habitCount: 0, checkCount: 0 });
  });

  test('ファイル名は日付入り', () => {
    assert.equal(backupFileName('2026-11-22'), 'habit-tracker-backup-2026-11-22.json');
  });

  test('sample-backup.json はこのアプリの形として読み込める', () => {
    const r = parseBackup(readText('../sample-backup.json'));
    assert.equal(r.ok, true, JSON.stringify(r.errors));
    assert.equal(r.summary.habitCount, 3);
    assert.equal(r.summary.checkCount, 38);
    const walk = r.state.habits.find((h) => h.id === 'sample-walk');
    assert.equal(getStreak(walk, '2026-11-22'), 25); // 10/28〜11/21(月またぎ・今日まだ)
  });

  test('ほかのアプリのファイルは読み込まない', () => {
    const r = parseBackup(readText('./fixtures/not-this-app.json'));
    assert.equal(r.ok, false);
    assert.match(r.errors[0], /このアプリで書き出したファイルではありません/);
  });

  test('存在しない日付・形の違う日付が入っていたら読み込まない', () => {
    const r = parseBackup(readText('./fixtures/broken-dates.json'));
    assert.equal(r.ok, false);
    assert.match(r.errors.join('\n'), /2026-02-30/);
  });

  test('JSON でないもの・目印や中身が足りないものは読み込まない', () => {
    const good = createBackup(state, '2026-11-22T21:05:00+09:00');
    const cases = {
      'JSON でない': 'これは JSON ではありません',
      '配列': '[]',
      'format が違う': JSON.stringify({ ...good, format: 2 }),
      'exportedAt なし': JSON.stringify({ ...good, exportedAt: undefined }),
      'data なし': JSON.stringify({ ...good, data: undefined }),
      'version が違う': JSON.stringify({ ...good, data: { ...good.data, version: 9 } }),
      'habits が配列でない': JSON.stringify({ ...good, data: { version: 1, habits: {} } }),
      'id の重複': JSON.stringify({ ...good, data: { version: 1, habits: [good.data.habits[0], { ...good.data.habits[1], id: 'a' }] } }),
      '名前なし': JSON.stringify({ ...good, data: { version: 1, habits: [{ ...good.data.habits[0], name: ' ' }] } }),
      'checks なし': JSON.stringify({ ...good, data: { version: 1, habits: [{ ...good.data.habits[0], checks: undefined }] } }),
      '作成日がおかしい': JSON.stringify({ ...good, data: { version: 1, habits: [{ ...good.data.habits[0], createdAt: '2026-11-31' }] } }),
    };
    for (const [label, text] of Object.entries(cases)) {
      const r = parseBackup(text);
      assert.equal(r.ok, false, label);
      assert.ok(r.errors.length > 0, label);
    }
  });

  test('エラーが多すぎるときは5件と「ほか n 件」にまとめる', () => {
    const habits = Array.from({ length: 8 }, (_, i) => ({ id: `x${i}`, name: '', createdAt: '2026-11-01', checks: [] }));
    const r = validateBackup({ app: 'habit-tracker', format: 1, exportedAt: 'x', data: { version: 1, habits } });
    assert.equal(r.ok, false);
    assert.equal(r.errors.length, 6);
    assert.equal(r.errors[5], 'ほか 3 件');
  });

  test('重複したチェックは1つにまとめ、日付順に整える', () => {
    const r = validateBackup({
      app: 'habit-tracker', format: 1, exportedAt: 'x',
      data: { version: 1, habits: [{ id: 'a', name: '散歩', createdAt: '2026-11-01', checks: ['2026-11-03', '2026-11-01', '2026-11-03'] }] },
    });
    assert.equal(r.ok, true);
    assert.deepEqual(r.state.habits[0].checks, ['2026-11-01', '2026-11-03']);
  });
});
