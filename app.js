// app.js — 画面の処理(DOM・イベント)
// 計算やデータの検査は habits.js、localStorage との読み書きは storage.js に任せています。

import {
  NAME_MAX_LENGTH,
  addHabit,
  backupFileName,
  backupToJSON,
  createBackup,
  getMonthRecord,
  getStreak,
  isChecked,
  parseBackup,
  summarizeState,
  toLocalDateString,
  toLocalISOString,
  toggleCheck,
} from './habits.js';
import { loadState, rescueBrokenData, saveState } from './storage.js';

const $ = (id) => document.getElementById(id);
const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];

const els = {
  todayLabel: $('today-label'),
  addForm: $('add-form'),
  nameInput: $('habit-name'),
  addMessage: $('add-message'),
  list: $('habit-list'),
  empty: $('empty-message'),
  monthTitle: $('month-title'),
  monthSelectLabel: $('month-select-label'),
  monthSelect: $('month-habit'),
  monthSummary: $('month-summary'),
  calendar: $('calendar'),
  exportButton: $('export-button'),
  importButton: $('import-button'),
  importFile: $('import-file'),
  backupMessage: $('backup-message'),
  dialog: $('import-dialog'),
  currentSummary: $('current-summary'),
  incomingSummary: $('incoming-summary'),
  banner: $('update-banner'),
  updateButton: $('update-button'),
};

let state;
let selectedHabitId = null;
let lastRenderedDay = null;

const today = () => toLocalDateString(new Date());

// ---------------------------------------------------------------------------
// 保存
// ---------------------------------------------------------------------------

function commit(next) {
  state = next;
  try {
    saveState(state);
  } catch {
    showMessage(els.backupMessage, '保存できませんでした。ブラウザの保存領域がいっぱいか、使えない設定になっています。', true);
  }
  render();
}

function init() {
  const loaded = loadState();
  state = loaded.state;
  if (!loaded.ok) {
    if (loaded.raw) {
      const stamp = toLocalISOString(new Date()).replace(/[^0-9]/g, '').slice(0, 14);
      try {
        const key = rescueBrokenData(loaded.raw, stamp);
        showMessage(els.backupMessage, `保存データが読めなかったため、空の状態で始めました。元のデータは消さずに「${key}」に残してあります。`, true);
      } catch {
        showMessage(els.backupMessage, '保存データが読めなかったため、空の状態で始めました。', true);
      }
    } else {
      showMessage(els.backupMessage, 'この端末の保存領域が使えないため、記録は保存されません。', true);
    }
  }
  selectedHabitId = state.habits[0]?.id ?? null;
  bindEvents();
  render();
  setupServiceWorker();
}

// ---------------------------------------------------------------------------
// 描画
// ---------------------------------------------------------------------------

function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k.startsWith('aria-') || k.startsWith('data-')) node.setAttribute(k, v);
    else node[k] = v;
  }
  for (const c of children) node.append(c);
  return node;
}

function formatTodayLabel(dateString) {
  const [y, m, d] = dateString.split('-').map(Number);
  const w = WEEKDAYS[new Date(y, m - 1, d).getDay()];
  return `${y}年${m}月${d}日(${w})`;
}

function render() {
  const t = today();
  lastRenderedDay = t;
  els.todayLabel.textContent = formatTodayLabel(t);
  renderList(t);
  renderMonth(t);
}

function renderList(t) {
  els.list.replaceChildren();
  els.empty.hidden = state.habits.length > 0;
  for (const habit of state.habits) {
    const done = isChecked(habit, t);
    const streak = getStreak(habit, t);
    let streakText = 'まだ連続記録はありません';
    if (streak > 0) streakText = done ? `🔥 ${streak}日連続` : `🔥 ${streak}日連続(今日はまだ)`;

    const button = el('button', {
      type: 'button',
      class: 'check',
      text: '✓',
      'aria-pressed': String(done),
      'aria-label': `${habit.name}:今日の分をチェック`,
      'data-id': habit.id,
    });
    els.list.append(
      el('li', { class: 'habit' }, [
        button,
        el('div', { class: 'habit-text' }, [
          el('span', { class: 'habit-name', text: habit.name }),
          el('span', { class: streak > 0 ? 'streak on' : 'streak', text: streakText }),
        ]),
      ]),
    );
  }
}

function renderMonth(t) {
  const [year, month] = t.split('-').map(Number);
  els.monthTitle.textContent = `今月の記録(${year}年${month}月)`;

  if (!state.habits.some((h) => h.id === selectedHabitId)) {
    selectedHabitId = state.habits[0]?.id ?? null;
  }
  els.monthSelect.replaceChildren(
    ...state.habits.map((h) => el('option', { value: h.id, text: h.name, selected: h.id === selectedHabitId })),
  );
  els.monthSelectLabel.hidden = state.habits.length === 0;

  const habit = state.habits.find((h) => h.id === selectedHabitId) ?? null;
  const record = getMonthRecord(habit, year, month, t);

  if (habit) {
    els.monthSummary.replaceChildren(
      '今月 ',
      el('strong', { text: String(record.checkedCount) }),
      ` 日チェック(今日までの ${record.elapsedDays} 日中)`,
    );
  } else {
    els.monthSummary.textContent = '習慣を追加すると、ここに今月の記録が出ます。';
  }

  const cells = WEEKDAYS.map((w, i) => el('div', { class: i === 0 ? 'weekday sun' : 'weekday', text: w, 'aria-hidden': 'true' }));
  for (let i = 0; i < record.firstWeekday; i += 1) cells.push(el('div', { 'aria-hidden': 'true' }));
  for (const d of record.days) {
    const classes = ['day'];
    if (d.checked) classes.push('checked');
    if (d.isToday) classes.push('today');
    if (d.isFuture) classes.push('future');
    cells.push(el('div', {
      class: classes.join(' '),
      text: String(d.day),
      'aria-label': `${month}月${d.day}日${d.checked ? ' チェック済み' : ''}${d.isToday ? '(今日)' : ''}`,
    }));
  }
  els.calendar.replaceChildren(...cells);
}

function showMessage(target, text, isError = false, list = []) {
  target.classList.toggle('error', isError);
  target.replaceChildren(text);
  if (list.length > 0) target.append(el('ul', {}, list.map((item) => el('li', { text: item }))));
}

// ---------------------------------------------------------------------------
// 操作
// ---------------------------------------------------------------------------

function newId() {
  return `h_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

const ADD_ERRORS = {
  empty: '習慣の名前を入れてください。',
  'too-long': `名前は${NAME_MAX_LENGTH}文字までにしてください。`,
  duplicate: '同じ名前の習慣がすでにあります。',
  'bad-id': 'うまく追加できませんでした。もう一度試してください。',
};

function bindEvents() {
  els.addForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const result = addHabit(state, { name: els.nameInput.value, id: newId(), today: today() });
    if (!result.ok) {
      showMessage(els.addMessage, ADD_ERRORS[result.error], true);
      return;
    }
    els.nameInput.value = '';
    showMessage(els.addMessage, `「${result.habit.name}」を追加しました。`);
    if (!selectedHabitId) selectedHabitId = result.habit.id;
    commit(result.state);
  });

  els.list.addEventListener('click', (e) => {
    const button = e.target.closest('button.check');
    if (!button) return;
    commit(toggleCheck(state, button.dataset.id, today()));
    els.list.querySelector(`button.check[data-id="${CSS.escape(button.dataset.id)}"]`)?.focus();
  });

  els.monthSelect.addEventListener('change', () => {
    selectedHabitId = els.monthSelect.value;
    renderMonth(today());
  });

  els.exportButton.addEventListener('click', exportBackup);
  els.importButton.addEventListener('click', () => {
    els.importFile.value = '';
    els.importFile.click();
  });
  els.importFile.addEventListener('change', () => {
    const file = els.importFile.files?.[0];
    if (file) importBackup(file);
  });

  // 日付が変わったら(朝に開き直したときなど)描き直す
  const refreshIfNewDay = () => {
    if (today() !== lastRenderedDay) render();
  };
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') refreshIfNewDay();
  });
  setInterval(refreshIfNewDay, 60 * 1000);
}

// ---------------------------------------------------------------------------
// バックアップ
// ---------------------------------------------------------------------------

function describeSummary({ habitCount, checkCount }) {
  return `習慣 ${habitCount}件・チェック ${checkCount}回`;
}

function formatExportedAt(value) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function exportBackup() {
  const json = backupToJSON(createBackup(state, toLocalISOString(new Date())));
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = el('a', { href: url, download: backupFileName(today()) });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  showMessage(els.backupMessage, `${describeSummary(summarizeState(state))}を「${backupFileName(today())}」として書き出しました。`);
}

async function importBackup(file) {
  let text;
  try {
    text = await file.text();
  } catch {
    showMessage(els.backupMessage, 'ファイルを読めませんでした。', true);
    return;
  }

  // 1. このアプリで書き出した形か確かめる(違えば、今のデータには触れない)
  const result = parseBackup(text);
  if (!result.ok) {
    showMessage(els.backupMessage, `「${file.name}」は読み込みませんでした。今のデータはそのままです。`, true, result.errors);
    return;
  }

  // 2. 今のデータを置き換えてよいか確認する
  els.currentSummary.textContent = describeSummary(summarizeState(state));
  els.incomingSummary.replaceChildren(
    describeSummary(result.summary),
    el('small', { text: `${formatExportedAt(result.exportedAt)} に書き出し(${file.name})` }),
  );
  els.dialog.returnValue = '';
  els.dialog.showModal();
  els.dialog.querySelector('button[value="cancel"]').focus();
  const answer = await new Promise((resolve) => {
    els.dialog.addEventListener('close', () => resolve(els.dialog.returnValue), { once: true });
  });

  // 3. 「置き換える」を押したときだけ保存する
  if (answer !== 'replace') {
    showMessage(els.backupMessage, '読み込みをやめました。今のデータはそのままです。');
    return;
  }
  selectedHabitId = result.state.habits[0]?.id ?? null;
  showMessage(els.backupMessage, `「${file.name}」のデータに置き換えました(${describeSummary(result.summary)})。`);
  commit(result.state);
}

// ---------------------------------------------------------------------------
// Service Worker(オフライン対応と、新しい版への切り替え)
// ---------------------------------------------------------------------------

function setupServiceWorker() {
  if (!('serviceWorker' in navigator)) return;

  // すでに古い版が動いていたときだけ、切り替わった後に再読み込みする
  // (初めて開いたときは再読み込みしない)
  const hadController = Boolean(navigator.serviceWorker.controller);
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || reloading) return;
    reloading = true;
    location.reload();
  });

  const showUpdate = (worker) => {
    els.banner.hidden = false;
    els.updateButton.disabled = false;
    els.updateButton.onclick = () => {
      els.updateButton.disabled = true;
      worker.postMessage({ type: 'SKIP_WAITING' });
    };
  };

  navigator.serviceWorker
    .register('./sw.js', { updateViaCache: 'none' })
    .then((reg) => {
      if (reg.waiting && navigator.serviceWorker.controller) showUpdate(reg.waiting);
      reg.addEventListener('updatefound', () => {
        const worker = reg.installing;
        if (!worker) return;
        worker.addEventListener('statechange', () => {
          if (worker.state === 'installed' && navigator.serviceWorker.controller) showUpdate(worker);
        });
      });
      // アプリに戻ってきたときにも新しい版がないか確かめる
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') reg.update().catch(() => {});
      });
    })
    .catch((err) => console.warn('Service Worker を登録できませんでした', err));
}

init();
