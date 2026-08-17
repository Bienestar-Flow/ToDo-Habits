(() => {
  'use strict';

  const STORAGE_KEY = 'todoAppDataV2';
  const OLD_STORAGE_KEY = 'todoAppData';

  const CATEGORIES = [
    { key: 'work', label: 'Work', color: '#4c7ef0' },
    { key: 'personal', label: 'Personal', color: '#ef9b3d' },
    { key: 'study', label: 'Study', color: '#9b7ee0' },
    { key: 'health', label: 'Health', color: '#3fae87' },
  ];

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  /* ---------- Date helpers ---------- */

  function dateToStr(d) {
    const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }
  function todayStr() { return dateToStr(new Date()); }
  function addDays(dateStr, n) {
    const d = new Date(dateStr + 'T00:00:00');
    d.setDate(d.getDate() + n);
    return dateToStr(d);
  }
  const WD_JP = ['日', '月', '火', '水', '木', '金', '土'];
  function formatDateJP(dateStr) {
    const d = new Date(dateStr + 'T00:00:00');
    return `${d.getMonth() + 1}月${d.getDate()}日（${WD_JP[d.getDay()]}）`;
  }
  function relativeGroupLabel(dateStr) {
    const today = todayStr();
    if (dateStr === addDays(today, 1)) return 'Tomorrow';
    const d = new Date(dateStr + 'T00:00:00');
    return `${d.getMonth() + 1}/${d.getDate()}（${WD_JP[d.getDay()]}）`;
  }

  /* ---------- Data validation ---------- */

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, ch => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[ch]));
  }

  const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
  const TIME_RE = /^\d{2}:\d{2}$/;
  const PRIORITIES = ['high', 'medium', 'low'];
  const FREQ_TYPES = ['daily', 'weekdays', 'weekends', 'custom'];

  /** Coerces one loaded/imported task into a well-formed shape. Returns null for unusable entries. */
  function normalizeTask(t) {
    if (!t || typeof t !== 'object') return null;
    if (typeof t.title !== 'string' || !t.title.trim()) return null;
    return {
      id: typeof t.id === 'string' && t.id ? t.id : ('t' + Date.now() + Math.random().toString(16).slice(2)),
      title: t.title,
      date: typeof t.date === 'string' && DATE_RE.test(t.date) ? t.date : '',
      time: typeof t.time === 'string' && TIME_RE.test(t.time) ? t.time : '',
      priority: PRIORITIES.includes(t.priority) ? t.priority : 'medium',
      category: typeof t.category === 'string' ? t.category : '',
      note: typeof t.note === 'string' ? t.note : '',
      completed: !!t.completed,
      completedAt: typeof t.completedAt === 'string' && DATE_RE.test(t.completedAt) ? t.completedAt : undefined,
    };
  }

  /** Coerces one loaded/imported habit into a well-formed shape. Returns null for unusable entries. */
  function normalizeHabit(h) {
    if (!h || typeof h !== 'object') return null;
    if (typeof h.name !== 'string' || !h.name.trim()) return null;
    const freqType = h.frequency && FREQ_TYPES.includes(h.frequency.type) ? h.frequency.type : 'daily';
    const freqDays = h.frequency && Array.isArray(h.frequency.days)
      ? h.frequency.days.filter(d => Number.isInteger(d) && d >= 0 && d <= 6)
      : [];
    const out = {
      id: typeof h.id === 'string' && h.id ? h.id : ('h' + Date.now() + Math.random().toString(16).slice(2)),
      name: h.name,
      icon: typeof h.icon === 'string' ? h.icon : null,
      category: typeof h.category === 'string' ? h.category : '',
      frequency: { type: freqType, days: freqDays },
      startDate: typeof h.startDate === 'string' && DATE_RE.test(h.startDate) ? h.startDate : todayStr(),
      status: (h.status === 'archived') ? 'archived' : 'active',
      completions: Array.isArray(h.completions) ? [...new Set(h.completions.filter(d => typeof d === 'string' && DATE_RE.test(d)))] : [],
      createdAt: typeof h.createdAt === 'number' ? h.createdAt : Date.now(),
    };
    if (typeof h.endDate === 'string' && DATE_RE.test(h.endDate)) out.endDate = h.endDate;
    if (typeof h.plannedEndDate === 'string' && DATE_RE.test(h.plannedEndDate)) out.plannedEndDate = h.plannedEndDate;
    return out;
  }

  /** Reassigns any id already present in `seen` so two items never collide (e.g. re-importing the same backup). */
  function dedupeIds(list, seen) {
    return list.map(item => {
      let id = item.id;
      if (!id || seen.has(id)) id = 'x' + Date.now().toString(36) + Math.random().toString(36).slice(2);
      seen.add(id);
      return id === item.id ? item : { ...item, id };
    });
  }

  /** Keeps only recognized, well-typed preferences — same defense-in-depth as tasks/habits.
   *  References CHARACTERS, which is declared further down; safe because this only ever
   *  runs later, in response to a load or import, never at parse time. */
  function normalizeSettings(s) {
    if (!s || typeof s !== 'object') return {};
    const out = {};
    if (s.theme === 'light' || s.theme === 'dark') out.theme = s.theme;
    if (typeof s.notifyEnabled === 'boolean') out.notifyEnabled = s.notifyEnabled;
    if (s.characterMode === 'fixed' || s.characterMode === 'random') out.characterMode = s.characterMode;
    if (typeof s.characterKey === 'string' && CHARACTERS.some(c => c.key === s.characterKey)) out.characterKey = s.characterKey;
    return out;
  }

  const CHARACTERS = [
    { key: 'dog', label: 'いぬ' },
    { key: 'cat', label: 'ねこ' },
    { key: 'hamster', label: 'ハムスター' },
    { key: 'rabbit', label: 'うさぎ' },
    { key: 'penguin', label: 'ペンギン' },
    { key: 'shiba', label: 'しばいぬ' },
    { key: 'bear', label: 'くま' },
    { key: 'otter', label: 'かわうそ' },
  ];
  const DEFAULT_CHARACTER = 'dog';

  /* ---------- Persistence ---------- */

  function migrateFromV1() {
    const raw = localStorage.getItem(OLD_STORAGE_KEY);
    if (!raw) return null;
    try {
      const old = JSON.parse(raw);
      const catByLabel = {};
      CATEGORIES.forEach(c => { catByLabel[c.label.toLowerCase()] = c.key; });

      const tasks = (old.tasks || []).map(t => {
        let date = '', time = '';
        if (t.dueDate) {
          const d = new Date(t.dueDate);
          if (!isNaN(d)) { date = dateToStr(d); time = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); }
        }
        return {
          id: t.id || ('t' + Math.random().toString(36).slice(2)),
          title: t.title || '',
          date, time,
          priority: t.priority || 'medium',
          category: catByLabel[(t.category || '').toLowerCase()] || '',
          note: '',
          completed: !!t.completed,
          completedAt: t.completed ? (date || todayStr()) : undefined,
        };
      });

      const habits = (old.habits || []).map(h => {
        const completions = Array.isArray(h.completedDates) ? h.completedDates.slice() : [];
        const createdDate = h.createdAt ? dateToStr(new Date(h.createdAt)) : todayStr();
        const earliestCompletion = completions.length ? completions.slice().sort()[0] : createdDate;
        return {
          id: h.id || ('h' + Math.random().toString(36).slice(2)),
          name: h.title || '',
          icon: null,
          category: '',
          frequency: { type: 'daily', days: [] },
          startDate: earliestCompletion < createdDate ? earliestCompletion : createdDate,
          completions,
          createdAt: h.createdAt || Date.now(),
        };
      });

      return { tasks, habits };
    } catch (e) {
      return null;
    }
  }

  // Set when saved data exists but fails to parse, so the user finds out their
  // data didn't silently vanish. Read (and shown) once the rest of the module —
  // including showToast's own `let toastTimer` — has finished initializing;
  // loadState() runs too early in the file to safely call showToast() itself.
  let dataLoadCorrupted = false;

  function loadState() {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        const tasks = dedupeIds((Array.isArray(parsed.tasks) ? parsed.tasks : []).map(normalizeTask).filter(Boolean), new Set());
        const habits = dedupeIds((Array.isArray(parsed.habits) ? parsed.habits : []).map(normalizeHabit).filter(Boolean), new Set());
        return {
          tasks,
          habits,
          settings: normalizeSettings(parsed.settings),
        };
      } catch (e) { dataLoadCorrupted = true; /* fall through to a fresh/migrated state */ }
    }
    const migrated = migrateFromV1();
    if (migrated) {
      const state = { tasks: migrated.tasks, habits: migrated.habits, settings: {} };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      return state;
    }
    return { tasks: [], habits: [], settings: {} };
  }

  /** Returns true on success. Callers that show their own "saved" toast should
   *  check this and show the failure message instead — otherwise a later
   *  success toast would silently overwrite the warning. */
  function saveState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ tasks, habits, settings }));
      return true;
    } catch (e) {
      showToast('保存に失敗しました。ブラウザの空き容量をご確認ください。');
      return false;
    }
  }

  const initial = loadState();
  let tasks = initial.tasks;
  let habits = initial.habits;
  let settings = initial.settings;

  let currentView = 'today';
  let activeCategory = null;
  let editingId = null;
  let editingHabitId = null;
  let currentHabitDetailId = null;
  let calendarCursor = { year: new Date().getFullYear(), month: new Date().getMonth() };
  let justCompletedTaskId = null;
  let justCompletedHabitId = null;

  function firePop(el) {
    if (!el) return;
    el.classList.remove('just-done');
    void el.offsetWidth;
    el.classList.add('just-done');
    setTimeout(() => el.classList.remove('just-done'), 550);
  }

  /* ---------- Icons ---------- */

  const iconCheck = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12.5l5 5L20 6.5"></path></svg>';
  const iconClock = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"></circle><path d="M12 7v5l3.3 2"></path></svg>';
  const iconEdit = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"></path><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"></path></svg>';
  const iconTrash = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"></path><path d="M8 6V4.5A1.5 1.5 0 0 1 9.5 3h5A1.5 1.5 0 0 1 16 4.5V6"></path><path d="M19 6l-.8 13.4A2 2 0 0 1 16.2 21H7.8a2 2 0 0 1-2-1.6L5 6"></path></svg>';
  const iconFlame = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21c4 0 6.5-2.5 6.5-6 0-3-2-4.8-3-7.5-.5 1.5-1.3 2.3-2 2.3-1 0-1-1.5-1-3-2.5 2-4 5-4 8.2 0 3.5 2.5 6 3.5 6Z"></path></svg>';
  const iconBolt = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2 4 14h7l-1 8 9-12h-7l1-8Z"></path></svg>';
  const iconCalendarSmall = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4.5" width="18" height="16" rx="2.5"></rect><path d="M3 9.5h18M8 2.5v4M16 2.5v4"></path></svg>';

  function greetingText() {
    const h = new Date().getHours();
    if (h < 5) return 'おやすみなさい';
    if (h < 12) return 'Good morning!';
    if (h < 18) return 'Good afternoon!';
    return 'Good evening!';
  }
  /** Character's line in the speech bubble — reacts to today's overall progress. */
  function pickBubbleMessage(pct, total) {
    if (total === 0) return '今日も一日頑張ろう！';
    if (pct >= 100) return '今日のタスクを全部完了したよ！素晴らしい！';
    if (pct >= 80) return 'あと少しで全部終わるよ！';
    if (pct >= 50) return 'かなり順調だよ！';
    if (pct >= 20) return 'いいスタートだね！';
    return '今日も一日頑張ろう！';
  }
  function pickTodayMessage(done, total) {
    if (total === 0) return 'タスクを追加して今日を始めましょう。';
    if (done >= total) return '今日のタスクを全部完了しました！';
    if (done === 0) return '今日もいいスタートを。';
    if (total - done === 1) return 'あと1つで完了です！';
    if (done / total >= 0.5) return 'かなり進んでいます。';
    return 'その調子で進めましょう。';
  }

  /* ---------- Characters ---------- */

  // Shared drawing helpers so all eight animals read as one set.
  const OUTLINE = 'stroke="var(--char-line)" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round"';
  const GROUND = '<ellipse cx="70" cy="121" rx="42" ry="7" fill="var(--char-grass)" opacity="0.45"></ellipse>';
  const EYES = (lx, rx, y, r = 3.3) =>
    `<g class="char-eyes" fill="var(--char-ink)"><ellipse cx="${lx}" cy="${y}" rx="${r}" ry="${r * 1.28}"></ellipse><ellipse cx="${rx}" cy="${y}" rx="${r}" ry="${r * 1.28}"></ellipse></g>`;
  const BLUSH = (lx, rx, y, w = 5) =>
    `<ellipse cx="${lx}" cy="${y}" rx="${w}" ry="${w * 0.64}" fill="var(--char-blush)" opacity="0.7"></ellipse><ellipse cx="${rx}" cy="${y}" rx="${w}" ry="${w * 0.64}" fill="var(--char-blush)" opacity="0.7"></ellipse>`;
  const SMILE = (y) =>
    `<g fill="none" stroke="var(--char-ink)" stroke-width="1.7" stroke-linecap="round"><path d="M70 ${y}v3"></path><path d="M70 ${y + 3}q-4 3.4-6.6.4"></path><path d="M70 ${y + 3}q4 3.4 6.6.4"></path></g>`;
  const SUN = `<g class="char-sun"><circle cx="20" cy="19" r="8" fill="var(--char-sun)"></circle><g stroke="var(--char-sun)" stroke-width="2.4" stroke-linecap="round"><path d="M20 6v-4M20 32v4M7 19H3M37 19h4M11 10 8.2 7.2M29 28l2.8 2.8M29 10l2.8-2.8M11 28l-2.8 2.8"></path></g></g>`;
  const HEART = (x, y, s = 1) =>
    `<g class="char-sun" transform="translate(${x} ${y}) scale(${s})"><path d="M0 8C-9 1-7-6-2-6c2 0 3 1 2 2 1-1 2-2 4-2 5 0 7 7-4 14z" fill="var(--char-blush)" opacity="0.75"></path></g>`;
  const SPARKS = (x, y) =>
    `<g class="char-sun" fill="var(--char-sun)" transform="translate(${x} ${y})"><path d="M0-9 2-2l7 2-7 2-2 7-2-7-7-2 7-2z"></path></g>`;
  const SPROUT = (x) =>
    `<g fill="var(--char-grass)"><path d="M${x} 121c0-6 3-10 7-12-1 5 0 9 2 12z"></path></g>`;

  const CHARACTER_SVG = {
    dog: `<svg viewBox="0 0 140 132" xmlns="http://www.w3.org/2000/svg">${SUN}${GROUND}${SPROUT(112)}
      <g ${OUTLINE}>
        <ellipse cx="70" cy="94" rx="26" ry="23" fill="var(--c-main)"></ellipse>
        <ellipse cx="56" cy="114" rx="10" ry="5.5" fill="var(--c-belly)"></ellipse>
        <ellipse cx="84" cy="114" rx="10" ry="5.5" fill="var(--c-belly)"></ellipse>
        <ellipse cx="97" cy="97" rx="7.5" ry="10" fill="var(--c-main)" transform="rotate(22 97 97)"></ellipse>
        <g class="char-wave"><ellipse cx="43" cy="70" rx="7.5" ry="10" fill="var(--c-main)" transform="rotate(-30 43 70)"></ellipse></g>
        <ellipse cx="44" cy="53" rx="9" ry="15" fill="var(--c-sub)" transform="rotate(-12 44 53)"></ellipse>
        <ellipse cx="96" cy="53" rx="9" ry="15" fill="var(--c-sub)" transform="rotate(12 96 53)"></ellipse>
        <circle cx="70" cy="54" r="29" fill="var(--c-main)"></circle>
      </g>
      <ellipse cx="70" cy="98" rx="15" ry="12.5" fill="var(--c-belly)"></ellipse>
      <ellipse cx="70" cy="63" rx="14.5" ry="10.5" fill="var(--c-belly)"></ellipse>
      ${EYES(60, 80, 51)}${BLUSH(50, 90, 60)}
      <ellipse cx="70" cy="59.5" rx="3.5" ry="2.6" fill="var(--char-ink)"></ellipse>${SMILE(62)}
      ${HEART(114, 74, 0.75)}</svg>`,

    cat: `<svg viewBox="0 0 140 132" xmlns="http://www.w3.org/2000/svg">${GROUND}${SPROUT(110)}
      <g ${OUTLINE}>
        <path d="M104 112c12-2 16-12 12-20-3-6-10-6-12 0-2 5 1 9 4 9" fill="var(--c-main)"></path>
        <ellipse cx="70" cy="94" rx="25" ry="23" fill="var(--c-main)"></ellipse>
        <ellipse cx="57" cy="114" rx="9.5" ry="5.5" fill="var(--c-belly)"></ellipse>
        <ellipse cx="83" cy="114" rx="9.5" ry="5.5" fill="var(--c-belly)"></ellipse>
        <g class="char-wave"><ellipse cx="44" cy="71" rx="7" ry="9.5" fill="var(--c-main)" transform="rotate(-32 44 71)"></ellipse></g>
        <path d="M48 34 44 55l19-8z" fill="var(--c-main)"></path>
        <path d="M92 34 96 55l-19-8z" fill="var(--c-main)"></path>
        <circle cx="70" cy="55" r="28" fill="var(--c-main)"></circle>
      </g>
      <path d="M50 36.5 47.5 50l11-4.6z" fill="var(--char-blush)" opacity="0.55"></path>
      <path d="M90 36.5 92.5 50l-11-4.6z" fill="var(--char-blush)" opacity="0.55"></path>
      <ellipse cx="70" cy="98" rx="14" ry="12" fill="var(--c-belly)"></ellipse>
      <g stroke="var(--c-sub)" stroke-width="2.6" stroke-linecap="round" fill="none">
        <path d="M62 33.5q8-4 16 0M58 41q12-5 24 0"></path>
      </g>
      <ellipse cx="70" cy="64" rx="13.5" ry="9.5" fill="var(--c-belly)"></ellipse>
      ${EYES(60, 80, 53)}${BLUSH(50, 90, 61)}
      <path d="M70 60.5 66.8 58h6.4z" fill="var(--char-ink)"></path>${SMILE(62.5)}
      <g stroke="var(--char-ink)" stroke-width="1.5" stroke-linecap="round" opacity="0.75">
        <path d="M44 58h-11M45 64l-10 3M96 58h11M95 64l10 3"></path>
      </g>
      ${HEART(115, 70, 0.7)}</svg>`,

    hamster: `<svg viewBox="0 0 140 132" xmlns="http://www.w3.org/2000/svg">${GROUND}
      <g ${OUTLINE}>
        <circle cx="46" cy="41" r="8" fill="var(--c-sub)"></circle>
        <circle cx="94" cy="41" r="8" fill="var(--c-sub)"></circle>
        <ellipse cx="70" cy="80" rx="35" ry="38" fill="var(--c-main)"></ellipse>
        <ellipse cx="58" cy="116" rx="9" ry="5" fill="var(--c-belly)"></ellipse>
        <ellipse cx="82" cy="116" rx="9" ry="5" fill="var(--c-belly)"></ellipse>
      </g>
      <path d="M52 47q6-6 12 0M76 47q6-6 12 0" stroke="var(--c-sub)" stroke-width="3" stroke-linecap="round" fill="none"></path>
      <ellipse cx="70" cy="93" rx="21" ry="22" fill="var(--c-belly)"></ellipse>
      <g ${OUTLINE}>
        <ellipse cx="70" cy="92" rx="10" ry="8.5" fill="#d9b183" transform="rotate(-8 70 92)"></ellipse>
        <ellipse cx="55" cy="88" rx="6.5" ry="7.5" fill="var(--c-main)" transform="rotate(20 55 88)"></ellipse>
        <ellipse cx="85" cy="88" rx="6.5" ry="7.5" fill="var(--c-main)" transform="rotate(-20 85 88)"></ellipse>
      </g>
      <path d="M64 90q6 5 12 0" stroke="var(--char-line)" stroke-width="1.4" fill="none" opacity="0.6"></path>
      ${EYES(58, 82, 62)}${BLUSH(45, 95, 71, 6)}
      <ellipse cx="70" cy="70" rx="3.4" ry="2.5" fill="var(--char-ink)"></ellipse>
      <g fill="none" stroke="var(--char-ink)" stroke-width="1.7" stroke-linecap="round"><path d="M70 72.5v2.5"></path><path d="M70 75q-3.6 3-6 .4"></path><path d="M70 75q3.6 3 6 .4"></path></g>
      <g transform="translate(112 78)"><path d="M0 0v-14" stroke="var(--char-grass)" stroke-width="2.6" stroke-linecap="round"></path><circle cx="0" cy="-18" r="6" fill="var(--char-sun)"></circle><circle cx="0" cy="-18" r="2.4" fill="var(--c-sub)"></circle></g></svg>`,

    rabbit: `<svg viewBox="0 0 140 132" xmlns="http://www.w3.org/2000/svg">${GROUND}${SPROUT(111)}
      <g ${OUTLINE}>
        <ellipse cx="56" cy="30" rx="8.5" ry="24" fill="var(--c-main)" transform="rotate(-8 56 30)"></ellipse>
        <ellipse cx="84" cy="30" rx="8.5" ry="24" fill="var(--c-main)" transform="rotate(8 84 30)"></ellipse>
        <ellipse cx="70" cy="95" rx="25" ry="23" fill="var(--c-main)"></ellipse>
        <ellipse cx="57" cy="115" rx="9.5" ry="5.5" fill="var(--c-belly)"></ellipse>
        <ellipse cx="83" cy="115" rx="9.5" ry="5.5" fill="var(--c-belly)"></ellipse>
        <ellipse cx="97" cy="97" rx="7" ry="9.5" fill="var(--c-main)" transform="rotate(22 97 97)"></ellipse>
        <g class="char-wave"><ellipse cx="43" cy="71" rx="7" ry="9.5" fill="var(--c-main)" transform="rotate(-32 43 71)"></ellipse></g>
        <circle cx="70" cy="61" r="27" fill="var(--c-main)"></circle>
      </g>
      <ellipse cx="56" cy="30" rx="4.5" ry="17" fill="var(--char-blush)" opacity="0.5" transform="rotate(-8 56 30)"></ellipse>
      <ellipse cx="84" cy="30" rx="4.5" ry="17" fill="var(--char-blush)" opacity="0.5" transform="rotate(8 84 30)"></ellipse>
      <ellipse cx="70" cy="99" rx="14" ry="12" fill="var(--c-belly)"></ellipse>
      ${EYES(60, 80, 59)}${BLUSH(50, 90, 67)}
      <path d="M70 66.5 67 64.2h6z" fill="var(--char-ink)"></path>${SMILE(68.5)}
      ${HEART(116, 66, 0.75)}</svg>`,

    penguin: `<svg viewBox="0 0 140 132" xmlns="http://www.w3.org/2000/svg">
      <ellipse cx="70" cy="121" rx="42" ry="7" fill="#cfe4f2" opacity="0.6"></ellipse>
      ${SPARKS(24, 46)}${SPARKS(115, 62)}
      <g ${OUTLINE}>
        <path d="M52 118q-6 2-9-1 3-4 9-4z" fill="#f0a94e"></path>
        <path d="M88 118q6 2 9-1-3-4-9-4z" fill="#f0a94e"></path>
        <ellipse cx="70" cy="72" rx="32" ry="42" fill="var(--c-main)"></ellipse>
        <ellipse cx="102" cy="80" rx="8" ry="17" fill="var(--c-sub)" transform="rotate(14 102 80)"></ellipse>
        <g class="char-wave"><ellipse cx="38" cy="72" rx="8" ry="17" fill="var(--c-sub)" transform="rotate(-26 38 72)"></ellipse></g>
      </g>
      <path d="M70 34c16 0 24 14 24 34s-10 30-24 30-24-12-24-30 8-34 24-34z" fill="var(--c-belly)"></path>
      ${EYES(59, 81, 58, 3.6)}
      <ellipse cx="59" cy="56.6" rx="1.2" ry="1.4" fill="#ffffff"></ellipse>
      <ellipse cx="81" cy="56.6" rx="1.2" ry="1.4" fill="#ffffff"></ellipse>
      ${BLUSH(48, 92, 68, 5.4)}
      <path d="M70 66q-6 0-6 3.5t6 4.5q6-1 6-4.5T70 66z" fill="#f0a94e" ${OUTLINE} stroke-width="1.8"></path></svg>`,

    shiba: `<svg viewBox="0 0 140 132" xmlns="http://www.w3.org/2000/svg">${GROUND}${SPROUT(30)}
      <g ${OUTLINE}>
        <path d="M100 100c14-4 16-16 9-22-6-5-13 0-12 7 1 6 6 8 9 6" fill="var(--c-belly)"></path>
        <ellipse cx="70" cy="96" rx="27" ry="22" fill="var(--c-main)"></ellipse>
        <ellipse cx="55" cy="114" rx="10" ry="5.5" fill="var(--c-belly)"></ellipse>
        <ellipse cx="85" cy="114" rx="10" ry="5.5" fill="var(--c-belly)"></ellipse>
        <g class="char-wave"><ellipse cx="44" cy="74" rx="7" ry="9.5" fill="var(--c-main)" transform="rotate(-30 44 74)"></ellipse></g>
        <path d="M49 32 44 54l20-9z" fill="var(--c-main)"></path>
        <path d="M91 32 96 54l-20-9z" fill="var(--c-main)"></path>
        <circle cx="70" cy="56" r="28" fill="var(--c-main)"></circle>
      </g>
      <path d="M51 35 48 49l9-4z" fill="var(--char-blush)" opacity="0.5"></path>
      <path d="M89 35 92 49l-9-4z" fill="var(--char-blush)" opacity="0.5"></path>
      <path d="M70 100c-11 0-15-8-15-8 4-4 9-6 15-6s11 2 15 6c0 0-4 8-15 8z" fill="var(--c-belly)"></path>
      <path d="M70 78c-13 0-18-9-18-9 5-6 11-9 18-9s13 3 18 9c0 0-5 9-18 9z" fill="var(--c-belly)"></path>
      <g fill="none" stroke="var(--char-ink)" stroke-width="2.2" stroke-linecap="round">
        <path d="M54 54q5.5-5 11 0M75 54q5.5-5 11 0"></path>
      </g>
      ${BLUSH(48, 92, 62, 5.4)}
      <ellipse cx="70" cy="66" rx="3.6" ry="2.7" fill="var(--char-ink)"></ellipse>
      <g fill="none" stroke="var(--char-ink)" stroke-width="1.7" stroke-linecap="round"><path d="M70 68.7v2.6"></path><path d="M70 71.3q-4 3.4-6.6.4"></path><path d="M70 71.3q4 3.4 6.6.4"></path></g>
      <path d="M53 88q17 7 34 0l-3 7q-14 5-28 0z" fill="#8fbf72" ${OUTLINE} stroke-width="1.8"></path>
      ${HEART(112, 72, 0.7)}</svg>`,

    bear: `<svg viewBox="0 0 140 132" xmlns="http://www.w3.org/2000/svg">${GROUND}${SPROUT(108)}
      <g ${OUTLINE}>
        <circle cx="47" cy="34" r="12" fill="var(--c-main)"></circle>
        <circle cx="93" cy="34" r="12" fill="var(--c-main)"></circle>
        <ellipse cx="70" cy="94" rx="27" ry="24" fill="var(--c-main)"></ellipse>
        <ellipse cx="56" cy="115" rx="10" ry="5.5" fill="var(--c-belly)"></ellipse>
        <ellipse cx="84" cy="115" rx="10" ry="5.5" fill="var(--c-belly)"></ellipse>
        <ellipse cx="98" cy="97" rx="7.5" ry="10" fill="var(--c-main)" transform="rotate(22 98 97)"></ellipse>
        <g class="char-wave"><ellipse cx="42" cy="70" rx="7.5" ry="10" fill="var(--c-main)" transform="rotate(-30 42 70)"></ellipse></g>
        <circle cx="70" cy="56" r="29" fill="var(--c-main)"></circle>
      </g>
      <circle cx="47" cy="34" r="6" fill="var(--char-blush)" opacity="0.5"></circle>
      <circle cx="93" cy="34" r="6" fill="var(--char-blush)" opacity="0.5"></circle>
      <ellipse cx="70" cy="99" rx="15" ry="12.5" fill="var(--c-belly)"></ellipse>
      <ellipse cx="70" cy="66" rx="16" ry="12" fill="var(--c-belly)"></ellipse>
      ${EYES(59, 81, 53)}${BLUSH(48, 92, 62, 5.4)}
      <ellipse cx="70" cy="62" rx="4" ry="3" fill="var(--char-ink)"></ellipse>${SMILE(64.5)}</svg>`,

    otter: `<svg viewBox="0 0 140 132" xmlns="http://www.w3.org/2000/svg">
      <ellipse cx="70" cy="121" rx="44" ry="7" fill="#cfe4f2" opacity="0.55"></ellipse>
      <g ${OUTLINE}>
        <path d="M96 112q22 2 30-6-10-8-30-6z" fill="var(--c-sub)"></path>
        <ellipse cx="66" cy="93" rx="29" ry="25" fill="var(--c-main)"></ellipse>
        <ellipse cx="52" cy="114" rx="10" ry="5.5" fill="var(--c-belly)"></ellipse>
        <ellipse cx="80" cy="114" rx="10" ry="5.5" fill="var(--c-belly)"></ellipse>
        <circle cx="45" cy="43" r="7.5" fill="var(--c-sub)"></circle>
        <circle cx="91" cy="43" r="7.5" fill="var(--c-sub)"></circle>
        <ellipse cx="68" cy="58" rx="29" ry="26" fill="var(--c-main)"></ellipse>
      </g>
      <ellipse cx="66" cy="97" rx="16" ry="12" fill="var(--c-belly)"></ellipse>
      <ellipse cx="68" cy="68" rx="19" ry="13" fill="var(--c-belly)"></ellipse>
      <g ${OUTLINE}>
        <path d="M68 82q-9 0-9-6t9-6q9 0 9 6t-9 6z" fill="#f2aab4"></path>
        <ellipse cx="54" cy="82" rx="6.5" ry="7.5" fill="var(--c-main)" transform="rotate(24 54 82)"></ellipse>
        <ellipse cx="82" cy="82" rx="6.5" ry="7.5" fill="var(--c-main)" transform="rotate(-24 82 82)"></ellipse>
      </g>
      ${EYES(57, 79, 55)}${BLUSH(46, 90, 64, 5.4)}
      <ellipse cx="68" cy="62" rx="3.6" ry="2.7" fill="var(--char-ink)"></ellipse>
      <g fill="none" stroke="var(--char-ink)" stroke-width="1.6" stroke-linecap="round"><path d="M68 64.7v2.2"></path></g>
      <g stroke="var(--char-ink)" stroke-width="1.5" stroke-linecap="round" opacity="0.7">
        <path d="M46 66h-10M47 71l-9 3M90 66h10M89 71l9 3"></path>
      </g>
      ${HEART(115, 52, 0.7)}</svg>`,
  };

  /** Stable hash so a given date always maps to the same animal. */
  function hashString(str) {
    let h = 0;
    for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0;
    return Math.abs(h);
  }

  function getCharacterKey() {
    if (settings.characterMode === 'fixed') {
      return CHARACTERS.some(c => c.key === settings.characterKey) ? settings.characterKey : DEFAULT_CHARACTER;
    }
    return CHARACTERS[hashString(todayStr()) % CHARACTERS.length].key;
  }
  function characterLabel(key) {
    const c = CHARACTERS.find(c => c.key === key);
    return c ? c.label : CHARACTERS[0].label;
  }

  /**
   * Artwork lives in images/<key>.png. If a file is missing or fails to decode
   * we fall back to the built-in SVG so the layout never shows a broken image.
   */
  function buildCharacterVisual(key) {
    const wrap = document.createElement('span');
    wrap.className = 'character-visual';
    const img = document.createElement('img');
    img.src = `images/${key}.png`;
    img.alt = '';
    img.addEventListener('error', () => {
      wrap.innerHTML = CHARACTER_SVG[key] || CHARACTER_SVG[DEFAULT_CHARACTER];
    }, { once: true });
    wrap.appendChild(img);
    return wrap;
  }

  function renderCharacter() {
    const key = getCharacterKey();
    const art = $('#characterArt');
    if (!art) return;
    art.className = 'character-art char-' + key;
    art.innerHTML = '';
    art.appendChild(buildCharacterVisual(key));
  }

  const HABIT_ICONS = {
    dumbbell: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="1.5" y="9" width="3" height="6" rx="1"></rect><rect x="19.5" y="9" width="3" height="6" rx="1"></rect><rect x="5.5" y="7" width="2.4" height="10" rx="1"></rect><rect x="16.1" y="7" width="2.4" height="10" rx="1"></rect><line x1="8" y1="12" x2="16" y2="12"></line></svg>',
    book: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5.5C4 4.7 4.7 4 5.5 4H11v16H5.5C4.7 20 4 19.3 4 18.5Z"></path><path d="M20 5.5c0-.8-.7-1.5-1.5-1.5H13v16h5.5c.8 0 1.5-.7 1.5-1.5Z"></path></svg>',
    droplet: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2.5c3.5 5 7 8.7 7 12.4a7 7 0 0 1-14 0c0-3.7 3.5-7.4 7-12.4Z"></path></svg>',
    moon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20.5 14.5a8.5 8.5 0 1 1-9-11 7 7 0 0 0 9 11z"></path></svg>',
    pencil: iconEdit,
    leaf: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 21c8 0 14-6 14-14V4h-3C8 4 3 9 3 17v4"></path><path d="M5 21c0-4.5 3-8.5 8-10.5"></path></svg>',
    music: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="7" cy="18" r="2.3"></circle><circle cx="17" cy="16" r="2.3"></circle><path d="M9.3 18V5.5L19.3 4v11.5"></path></svg>',
    heart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20.5S3.5 15 3.5 9a4.7 4.7 0 0 1 8.5-2.7A4.7 4.7 0 0 1 20.5 9c0 6-8.5 11.5-8.5 11.5Z"></path></svg>',
  };
  const ICON_ORDER = ['dumbbell', 'book', 'droplet', 'moon', 'pencil', 'leaf', 'music', 'heart'];
  const ICON_LABELS = {
    dumbbell: 'ダンベル', book: '本', droplet: '水滴', moon: '月',
    pencil: '鉛筆', leaf: '葉', music: '音符', heart: 'ハート',
  };

  function catInfo(key) { return CATEGORIES.find(c => c.key === key); }

  /* ---------- Task helpers ---------- */

  function isOverdue(t) {
    if (!t.date || t.completed) return false;
    const now = new Date();
    if (t.date < todayStr()) return true;
    if (t.date === todayStr() && t.time) {
      return new Date(`${t.date}T${t.time}:00`) < now;
    }
    return false;
  }
  function priorityLabel(p) { return { high: '高', medium: '中', low: '低' }[p]; }

  function buildMetaChips(t) {
    let html = '';
    if (t.date && !t.completed && t.date < todayStr()) {
      html += `<span class="meta-chip overdue">${iconCalendarSmall}${escapeHtml(formatDateJP(t.date))} 期限切れ</span>`;
    }
    if (t.time) html += `<span class="meta-chip meta-time ${isOverdue(t) ? 'overdue' : ''}">${iconClock}${escapeHtml(t.time)}</span>`;
    const priority = PRIORITIES.includes(t.priority) ? t.priority : 'medium';
    html += `<span class="meta-chip"><span class="priority-dot ${priority}"></span>優先度: ${priorityLabel(priority)}</span>`;
    const c = catInfo(t.category);
    if (c) html += `<span class="cat-chip" style="--dot:${c.color}"><span class="cat-dot"></span>${escapeHtml(c.label)}</span>`;
    return html;
  }

  function createTaskRow(t) {
    const row = document.createElement('div');
    row.className = 'task-row' + (t.completed ? ' done' : '');
    row.dataset.id = t.id;

    const check = document.createElement('button');
    check.className = 'checkbox';
    check.innerHTML = iconCheck;
    check.setAttribute('aria-label', t.completed ? '未完了に戻す' : '完了にする');
    check.setAttribute('aria-pressed', String(t.completed));
    check.addEventListener('click', (e) => { e.stopPropagation(); toggleComplete(t.id); });
    if (t.id === justCompletedTaskId) { firePop(check); justCompletedTaskId = null; }

    const mainEl = document.createElement('div');
    mainEl.className = 'task-main';
    const titleEl = document.createElement('div');
    titleEl.className = 'task-title';
    titleEl.textContent = t.title;
    const metaEl = document.createElement('div');
    metaEl.className = 'task-meta';
    metaEl.innerHTML = buildMetaChips(t);
    mainEl.appendChild(titleEl);
    mainEl.appendChild(metaEl);
    mainEl.addEventListener('click', () => openEditModal(t.id));

    const actions = document.createElement('div');
    actions.className = 'task-actions';
    actions.innerHTML = `<button class="icon-btn" data-act="edit" title="編集">${iconEdit}</button><button class="icon-btn danger" data-act="delete" title="削除">${iconTrash}</button>`;
    actions.querySelector('[data-act="edit"]').addEventListener('click', (e) => { e.stopPropagation(); openEditModal(t.id); });
    actions.querySelector('[data-act="delete"]').addEventListener('click', (e) => { e.stopPropagation(); deleteTask(t.id); });

    row.appendChild(check);
    row.appendChild(mainEl);
    row.appendChild(actions);
    return row;
  }

  function emptyState(icon, title, desc, compact) {
    const el = document.createElement('div');
    el.className = 'empty-state' + (compact ? ' compact' : '');
    el.innerHTML = `<div class="empty-icon">${icon}</div><h3>${title}</h3><p>${desc}</p>`;
    return el;
  }

  /** When a category filter is active and it's the *reason* the list is empty
   *  (there would be items without it), say so — instead of implying there's
   *  nothing here at all. `unfilteredCount` is the same list before the category
   *  filter was applied. */
  function emptyStateForList(unfilteredCount, icon, fallbackTitle, fallbackDesc, compact) {
    if (activeCategory && unfilteredCount > 0) {
      const c = catInfo(activeCategory);
      return emptyState(
        icon,
        `「${c ? c.label : ''}」のタスクはありません`,
        '別のカテゴリーを選ぶか、「すべて」に切り替えてください。',
        compact
      );
    }
    return emptyState(icon, fallbackTitle, fallbackDesc, compact);
  }

  const ICON_SUN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="12" cy="12" r="4.2"></circle><path d="M12 2.5v2M12 19.5v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2.5 12h2M19.5 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"></path></svg>';
  const ICON_INBOX = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M22 12h-6l-2 3h-4l-2-3H2"></path><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"></path></svg>';
  const ICON_CHECK_CIRCLE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="12" cy="12" r="9"></circle><path d="M8.3 12.3l2.4 2.4 5-5"></path></svg>';

  function filteredTasks(list) { return activeCategory ? list.filter(t => t.category === activeCategory) : list; }

  function renderToday() {
    const list = $('#list-today');
    list.innerHTML = '';
    const today = todayStr();
    const rawOverdue = tasks.filter(t => t.date && t.date < today && !t.completed);
    const rawItems = tasks.filter(t => t.date === today);
    const overdue = filteredTasks(rawOverdue).sort((a, b) => a.date.localeCompare(b.date));
    let items = filteredTasks(rawItems);
    const active = items.filter(t => !t.completed).sort((a, b) => (a.time || '99:99').localeCompare(b.time || '99:99'));
    const done = items.filter(t => t.completed);

    if (overdue.length === 0 && items.length === 0) {
      list.appendChild(emptyStateForList(
        rawOverdue.length + rawItems.length,
        ICON_SUN, '今日のタスクはありません', 'Quick Addから今日やることを追加しましょう。'
      ));
    } else {
      if (overdue.length) {
        const block = document.createElement('div');
        block.className = 'group-block';
        block.innerHTML = `<div class="group-eyebrow overdue">期限切れ（${overdue.length}）</div>`;
        const inner = document.createElement('div');
        inner.className = 'task-list';
        overdue.forEach(t => inner.appendChild(createTaskRow(t)));
        block.appendChild(inner);
        list.appendChild(block);
      }
      active.forEach(t => list.appendChild(createTaskRow(t)));
      if (done.length) {
        const block = document.createElement('div');
        block.className = 'group-block';
        block.innerHTML = `<div class="group-eyebrow">完了済み（${done.length}）</div>`;
        const inner = document.createElement('div');
        inner.className = 'task-list';
        done.forEach(t => inner.appendChild(createTaskRow(t)));
        block.appendChild(inner);
        list.appendChild(block);
      }
    }
    renderTodayHero();
  }

  function getHabitsTodayStats() {
    const today = todayStr();
    const activeHabits = habits.filter(h => h.status !== 'archived');
    const scheduled = activeHabits.filter(h => isHabitScheduled(h, today));
    const done = scheduled.filter(h => isHabitDone(h, today));
    return { scheduled, done: done.length, total: scheduled.length };
  }

  function renderTodayHero() {
    const today = todayStr();
    const todays = tasks.filter(t => t.date === today);
    const tasksDone = todays.filter(t => t.completed).length;
    const tasksTotal = todays.length;
    const habitStats = getHabitsTodayStats();

    const combinedDone = tasksDone + habitStats.done;
    const combinedTotal = tasksTotal + habitStats.total;
    const pct = combinedTotal ? Math.round((combinedDone / combinedTotal) * 100) : 0;

    $('#heroGreeting').textContent = greetingText();
    $('#bubbleMessage').textContent = pickBubbleMessage(pct, combinedTotal);
    $('#heroDate').innerHTML = `${iconCalendarSmall}${formatDateJP(today)}`;
    $('#heroProgressFill').style.width = pct + '%';
    $('#heroProgressPct').textContent = `${pct}%`;
    $('#heroTasksBreakdown').textContent = `${tasksDone} / ${tasksTotal}`;
    $('#heroHabitsBreakdown').textContent = `${habitStats.done} / ${habitStats.total}`;
    $('#heroMessage').textContent = pickTodayMessage(combinedDone, combinedTotal);
  }

  function renderHomeHabitsSummary() {
    const stats = getHabitsTodayStats();
    $('#homeHabitProgressText').textContent = stats.total
      ? `${stats.done} / ${stats.total} habits completed`
      : '';
  }

  function renderStreakCard() {
    const card = $('#homeStreakCard');
    const activeHabits = habits.filter(h => h.status !== 'archived');
    if (activeHabits.length === 0) { card.classList.add('hidden'); return; }
    card.classList.remove('hidden');
    let best = activeHabits[0], bestStreak = calcCurrentStreak(activeHabits[0]);
    activeHabits.forEach(h => {
      const s = calcCurrentStreak(h);
      if (s > bestStreak) { best = h; bestStreak = s; }
    });
    $('#streakCardValue').innerHTML = `${bestStreak}<span class="unit">${bestStreak === 1 ? 'day' : 'days'}</span>`;
    $('#streakCardLabel').textContent = best.name;
  }

  function renderHomeUpcoming() {
    const wrap = $('#homeUpcomingList');
    const today = todayStr();
    const items = tasks.filter(t => t.date && t.date > today && !t.completed)
      .sort((a, b) => (a.date + (a.time || '99:99')).localeCompare(b.date + (b.time || '99:99')))
      .slice(0, 4);
    if (items.length === 0) {
      wrap.innerHTML = '<div class="home-card-subline" style="margin:4px 2px 14px;">近い予定はまだありません。</div>';
      return;
    }
    const list = document.createElement('div');
    list.className = 'home-upcoming-list';
    items.forEach(t => {
      const row = document.createElement('div');
      row.className = 'home-upcoming-item';
      row.innerHTML = `<span class="upcoming-date">${relativeGroupLabel(t.date)}</span><span class="upcoming-title"></span>`;
      row.querySelector('.upcoming-title').textContent = t.title;
      row.addEventListener('click', () => openEditModal(t.id));
      row.style.cursor = 'pointer';
      list.appendChild(row);
    });
    wrap.innerHTML = '';
    wrap.appendChild(list);
  }

  function renderInbox() {
    const list = $('#list-inbox');
    list.innerHTML = '';
    const rawItems = tasks.filter(t => !t.date && !t.completed);
    const items = filteredTasks(rawItems);
    if (items.length === 0) {
      list.appendChild(emptyStateForList(rawItems.length, ICON_INBOX, 'Inboxは空です', '日付が決まっていないタスクはここに集まります。'));
    } else {
      items.forEach(t => list.appendChild(createTaskRow(t)));
    }
  }

  function renderUpcoming() {
    const wrap = $('#list-upcoming');
    wrap.innerHTML = '';
    const today = todayStr();
    const rawItems = tasks.filter(t => t.date && t.date > today && !t.completed);
    const items = filteredTasks(rawItems);
    if (items.length === 0) {
      wrap.appendChild(emptyStateForList(rawItems.length, ICON_SUN, '予定はまだありません', '先の予定を追加すると、ここに日付ごとに表示されます。'));
      return;
    }
    const byDate = {};
    items.forEach(t => { (byDate[t.date] ||= []).push(t); });
    Object.keys(byDate).sort().forEach(date => {
      const group = byDate[date].sort((a, b) => (a.time || '99:99').localeCompare(b.time || '99:99'));
      const block = document.createElement('div');
      block.className = 'group-block';
      block.innerHTML = `<div class="group-eyebrow">${relativeGroupLabel(date)}</div>`;
      const inner = document.createElement('div');
      inner.className = 'task-list';
      group.forEach(t => inner.appendChild(createTaskRow(t)));
      block.appendChild(inner);
      wrap.appendChild(block);
    });
  }

  function renderCompleted() {
    const wrap = $('#list-completed');
    wrap.innerHTML = '';
    const today = todayStr();
    const rawItems = tasks.filter(t => t.completed);
    const items = filteredTasks(rawItems).sort((a, b) => (b.completedAt || '').localeCompare(a.completedAt || ''));
    $('#completedSubtitle').textContent = `${items.length} 件のタスクを完了しました`;
    if (items.length === 0) {
      wrap.appendChild(emptyStateForList(rawItems.length, ICON_CHECK_CIRCLE, 'まだ完了したタスクがありません', 'タスクを完了すると、ここに記録されます。'));
      return;
    }
    const byDate = {};
    items.forEach(t => { (byDate[t.completedAt || ''] ||= []).push(t); });
    Object.keys(byDate).sort().reverse().forEach(date => {
      const label = date === today ? '今日' : date === addDays(today, -1) ? '昨日' : (date ? relativeGroupLabel(date) : '日付なし');
      const block = document.createElement('div');
      block.className = 'group-block';
      block.innerHTML = `<div class="group-eyebrow">${label}</div>`;
      const inner = document.createElement('div');
      inner.className = 'task-list';
      byDate[date].forEach(t => inner.appendChild(createTaskRow(t)));
      block.appendChild(inner);
      wrap.appendChild(block);
    });
  }

  /* ---------- Habit helpers ---------- */

  function isScheduledDay(freq, dow) {
    if (freq.type === 'daily') return true;
    if (freq.type === 'weekdays') return dow >= 1 && dow <= 5;
    if (freq.type === 'weekends') return dow === 0 || dow === 6;
    if (freq.type === 'custom') return (freq.days || []).includes(dow);
    return false;
  }
  function isHabitScheduled(habit, dateStr) {
    if (dateStr < habit.startDate) return false;
    const dow = new Date(dateStr + 'T00:00:00').getDay();
    return isScheduledDay(habit.frequency, dow);
  }
  function isHabitDone(habit, dateStr) { return habit.completions.includes(dateStr); }

  /** Habits accumulate one completion entry per day they're kept up, so a year-old
   *  habit can have hundreds of entries. Building a Set once turns each day-lookup
   *  below into O(1) instead of Array.includes()'s O(n), which mattered in practice:
   *  a 3-year daily streak took ~200ms per render before this change. */
  function calcCurrentStreak(habit) {
    const done = new Set(habit.completions);
    let streak = 0;
    let cursor = todayStr();
    let isToday = true;
    let guard = 0;
    while (cursor >= habit.startDate && guard < 20000) {
      if (isHabitScheduled(habit, cursor)) {
        if (done.has(cursor)) streak++;
        else if (!isToday) break;
      }
      cursor = addDays(cursor, -1);
      isToday = false;
      guard++;
    }
    return streak;
  }
  function calcLongestStreak(habit) {
    const done = new Set(habit.completions);
    let longest = 0, running = 0;
    let cursor = habit.startDate;
    const end = todayStr();
    let guard = 0;
    while (cursor <= end && guard < 20000) {
      if (isHabitScheduled(habit, cursor)) {
        if (done.has(cursor)) { running++; if (running > longest) longest = running; }
        else running = 0;
      }
      cursor = addDays(cursor, 1);
      guard++;
    }
    return longest;
  }
  function calcCompletionStats(habit) {
    const done = new Set(habit.completions);
    let scheduled = 0, doneCount = 0;
    let cursor = habit.startDate;
    const end = todayStr();
    let guard = 0;
    while (cursor <= end && guard < 20000) {
      if (isHabitScheduled(habit, cursor)) { scheduled++; if (done.has(cursor)) doneCount++; }
      cursor = addDays(cursor, 1);
      guard++;
    }
    return { scheduled, done: doneCount, rate: scheduled ? Math.round((doneCount / scheduled) * 100) : 0 };
  }

  function frequencyLabel(freq) {
    if (freq.type === 'daily') return 'Every day';
    if (freq.type === 'weekdays') return 'Weekdays';
    if (freq.type === 'weekends') return 'Weekends';
    const names = { 1: 'Mon', 2: 'Tue', 3: 'Wed', 4: 'Thu', 5: 'Fri', 6: 'Sat', 0: 'Sun' };
    const order = [1, 2, 3, 4, 5, 6, 0];
    const days = (freq.days || []).slice().sort((a, b) => order.indexOf(a) - order.indexOf(b));
    return days.length ? days.map(d => names[d]).join(' / ') : 'Custom';
  }

  function habitIconSvg(habit) { return HABIT_ICONS[habit.icon] || iconBolt; }

  function autoCompleteExpiredHabits() {
    const today = todayStr();
    let changed = false;
    habits.forEach(h => {
      if (h.status === 'active' && h.plannedEndDate && h.plannedEndDate < today && !h.endDate) {
        h.status = 'archived';
        h.endDate = h.plannedEndDate;
        changed = true;
      }
    });
    return changed;
  }

  function toggleHabitToday(id) {
    const h = habits.find(h => h.id === id);
    const today = todayStr();
    if (!isHabitScheduled(h, today)) return;
    const idx = h.completions.indexOf(today);
    if (idx >= 0) h.completions.splice(idx, 1);
    else { h.completions.push(today); justCompletedHabitId = id; }
    saveState();
    renderAll();
  }

  function createHabitCard(h) {
    const today = todayStr();
    const scheduled = isHabitScheduled(h, today);
    const done = isHabitDone(h, today);
    const streak = calcCurrentStreak(h);

    const card = document.createElement('div');
    card.className = 'habit-card';
    card.dataset.id = h.id;

    const icon = document.createElement('div');
    icon.className = 'habit-icon';
    icon.innerHTML = habitIconSvg(h);

    const main = document.createElement('div');
    main.className = 'habit-main';
    const nameEl = document.createElement('div');
    nameEl.className = 'habit-name';
    nameEl.textContent = h.name;
    const meta = document.createElement('div');
    meta.className = 'habit-meta';
    const c = catInfo(h.category);
    meta.innerHTML = `
      <span class="streak-chip ${streak === 0 ? 'zero' : ''}">${iconFlame}<strong>${streak}</strong>&nbsp;day streak</span>
      <span class="meta-chip">${frequencyLabel(h.frequency)}</span>
      ${c ? `<span class="cat-chip" style="--dot:${c.color}"><span class="cat-dot"></span>${c.label}</span>` : ''}
    `;
    main.appendChild(nameEl);
    main.appendChild(meta);
    main.addEventListener('click', () => openHabitDetail(h.id));

    card.appendChild(icon);
    card.appendChild(main);

    if (scheduled) {
      const check = document.createElement('button');
      check.className = 'habit-check' + (done ? ' done' : '');
      check.innerHTML = `<span class="dot-ring">${iconCheck}</span>${done ? 'Completed' : 'Not completed'}`;
      check.setAttribute('aria-pressed', String(done));
      check.addEventListener('click', (e) => { e.stopPropagation(); toggleHabitToday(h.id); });
      if (currentView === 'habits' && h.id === justCompletedHabitId) { firePop(check.querySelector('.dot-ring')); justCompletedHabitId = null; }
      card.appendChild(check);
    } else {
      const notDue = document.createElement('div');
      notDue.className = 'habit-not-due';
      notDue.textContent = '今日は対象外';
      card.appendChild(notDue);
    }
    return card;
  }

  function renderHabits() {
    if (autoCompleteExpiredHabits()) saveState();
    const list = $('#list-habits');
    list.innerHTML = '';
    const activeHabits = habits.filter(h => h.status !== 'archived');
    const archivedHabits = habits.filter(h => h.status === 'archived');

    if (activeHabits.length === 0) {
      list.appendChild(emptyState(iconBolt, 'Habitはまだありません', '「Add habit」から続けたい習慣を登録しましょう。'));
    } else {
      activeHabits.forEach(h => list.appendChild(createHabitCard(h)));
    }

    const stats = getHabitsTodayStats();
    $('#habitProgressText').textContent = `${stats.done} / ${stats.total} habits completed`;
    $('#habitProgressFill').style.width = stats.total ? `${Math.round(stats.done / stats.total * 100)}%` : '0%';

    renderHabitHistory();
  }

  function renderHabitHistory() {
    const historyList = $('#list-habits-history');
    historyList.innerHTML = '';
    const archivedHabits = habits.filter(h => h.status === 'archived').sort((a, b) => (b.endDate || '').localeCompare(a.endDate || ''));

    if (archivedHabits.length === 0) {
      historyList.appendChild(emptyState(iconBolt, '終了した習慣はありません', '習慣を終了すると、ここに履歴として表示されます。'));
      return;
    }

    archivedHabits.forEach(h => {
      const stats = calcCompletionStats(h);
      const card = document.createElement('div');
      card.className = 'habit-card';
      card.dataset.id = h.id;
      card.style.cursor = 'pointer';
      card.style.opacity = '0.75';

      const icon = document.createElement('div');
      icon.className = 'habit-icon';
      icon.innerHTML = habitIconSvg(h);

      const main = document.createElement('div');
      main.className = 'habit-main';
      const nameEl = document.createElement('div');
      nameEl.className = 'habit-name';
      nameEl.textContent = h.name;
      const meta = document.createElement('div');
      meta.className = 'habit-meta';
      const startLabel = new Date(h.startDate + 'T00:00:00').toLocaleDateString('ja-JP', { month: 'short', day: 'numeric' });
      const endLabel = h.endDate ? new Date(h.endDate + 'T00:00:00').toLocaleDateString('ja-JP', { month: 'short', day: 'numeric' }) : '−';
      meta.innerHTML = `
        <span class="meta-chip">${startLabel} → ${endLabel}</span>
        <span class="meta-chip">${stats.done} / ${stats.scheduled} days</span>
        <span class="meta-chip">${stats.rate}%</span>
      `;
      main.appendChild(nameEl);
      main.appendChild(meta);
      main.addEventListener('click', () => openHabitDetail(h.id));

      card.appendChild(icon);
      card.appendChild(main);
      historyList.appendChild(card);
    });
  }

  function renderTodayHabits() {
    const list = $('#list-today-habits');
    const block = $('#todayHabitsBlock');
    list.innerHTML = '';
    const activeHabits = habits.filter(h => h.status !== 'archived');
    if (activeHabits.length === 0) { block.classList.add('hidden'); return; }
    block.classList.remove('hidden');
    const today = todayStr();
    const scheduledToday = activeHabits.filter(h => isHabitScheduled(h, today));
    if (scheduledToday.length === 0) {
      list.appendChild(emptyState(iconBolt, '今日予定の習慣はありません', '', true));
      return;
    }
    scheduledToday.forEach(h => {
      const done = isHabitDone(h, today);
      const streak = calcCurrentStreak(h);
      const row = document.createElement('div');
      row.className = 'habit-today-row';
      row.innerHTML = `
        <div class="habit-today-head">
          <div class="habit-icon" style="width:30px;height:30px;flex-shrink:0;">${habitIconSvg(h)}</div>
          <div class="habit-main-text">
            <div class="habit-name"></div>
            <div class="habit-meta"><span class="streak-chip ${streak === 0 ? 'zero' : ''}">${iconFlame}<strong>${streak}</strong>&nbsp;day streak</span></div>
          </div>
        </div>
      `;
      row.querySelector('.habit-name').textContent = h.name;
      row.querySelector('.habit-name').title = h.name;
      const check = document.createElement('button');
      check.className = 'habit-check compact' + (done ? ' done' : '');
      check.innerHTML = `<span class="dot-ring">${iconCheck}</span>${done ? 'Completed' : 'Complete'}`;
      check.setAttribute('aria-pressed', String(done));
      check.addEventListener('click', (e) => { e.stopPropagation(); toggleHabitToday(h.id); });
      if (currentView === 'today' && h.id === justCompletedHabitId) { firePop(check.querySelector('.dot-ring')); justCompletedHabitId = null; }
      row.appendChild(check);
      row.addEventListener('click', () => openHabitDetail(h.id));
      list.appendChild(row);
    });
  }

  /* ---------- Habit detail ---------- */

  function openHabitDetail(id) {
    currentHabitDetailId = id;
    const now = new Date();
    calendarCursor = { year: now.getFullYear(), month: now.getMonth() };
    switchView('habit-detail');
    renderHabitDetail();
  }

  function renderHabitDetail() {
    const h = habits.find(h => h.id === currentHabitDetailId);
    if (!h) { switchView('habits'); return; }

    $('#detailIcon').innerHTML = habitIconSvg(h);
    $('#detailTitle').textContent = h.name;
    const c = catInfo(h.category);
    const startLabel = new Date(h.startDate + 'T00:00:00').toLocaleDateString('ja-JP', { year: 'numeric', month: 'long', day: 'numeric' });
    let metaHtml = `
      ${c ? `<span class="cat-chip" style="--dot:${c.color}"><span class="cat-dot"></span>${c.label}</span>` : ''}
      <span class="meta-chip">${frequencyLabel(h.frequency)}</span>
      <span class="meta-chip">開始: ${startLabel}</span>
    `;
    if (h.status === 'active' && h.plannedEndDate) {
      const plannedLabel = new Date(h.plannedEndDate + 'T00:00:00').toLocaleDateString('ja-JP', { year: 'numeric', month: 'long', day: 'numeric' });
      metaHtml += `<span class="meta-chip">予定終了日: ${plannedLabel}</span>`;
    }
    if (h.status === 'archived' && h.endDate) {
      const endLabel = new Date(h.endDate + 'T00:00:00').toLocaleDateString('ja-JP', { year: 'numeric', month: 'long', day: 'numeric' });
      metaHtml += `<span class="meta-chip" style="opacity: 0.6;">終了: ${endLabel}</span>`;
    }
    $('#detailMeta').innerHTML = metaHtml;

    const streak = calcCurrentStreak(h);
    const longest = calcLongestStreak(h);
    const stats = calcCompletionStats(h);
    const total = h.completions.length;
    $('#statGrid').innerHTML = `
      <div class="stat-card"><div class="stat-label">Current streak</div><div class="stat-value">${streak}<span class="unit">days</span></div></div>
      <div class="stat-card"><div class="stat-label">Longest streak</div><div class="stat-value">${longest}<span class="unit">days</span></div></div>
      <div class="stat-card"><div class="stat-label">Completion rate</div><div class="stat-value">${stats.rate}<span class="unit">%</span></div></div>
      <div class="stat-card"><div class="stat-label">Total completions</div><div class="stat-value">${total}</div></div>
    `;

    renderCalendar(h);
  }

  function renderCalendar(h) {
    const { year, month } = calendarCursor;
    $('#calendarMonthLabel').textContent = new Date(year, month, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

    const grid = $('#calendarGrid');
    grid.innerHTML = '';
    ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].forEach(w => {
      const el = document.createElement('div');
      el.className = 'calendar-weekday';
      el.textContent = w;
      grid.appendChild(el);
    });

    const firstOfMonth = new Date(year, month, 1);
    const startOffset = (firstOfMonth.getDay() + 6) % 7; // Monday-first
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const today = todayStr();

    for (let i = 0; i < startOffset; i++) {
      const el = document.createElement('div');
      el.className = 'calendar-day empty';
      grid.appendChild(el);
    }
    for (let day = 1; day <= daysInMonth; day++) {
      const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      const el = document.createElement('div');
      let cls = 'calendar-day';
      if (dateStr > today) cls += ' future';
      else if (isHabitScheduled(h, dateStr)) cls += isHabitDone(h, dateStr) ? ' done' : ' missed scheduled';
      if (dateStr === today) cls += ' today-marker';
      el.className = cls;
      el.textContent = day;
      if (dateStr <= today && isHabitScheduled(h, dateStr)) {
        el.style.cursor = 'pointer';
        el.title = isHabitDone(h, dateStr) ? '達成済み（クリックで取り消し）' : '未達成（クリックで達成にする）';
        el.addEventListener('click', () => {
          const idx = h.completions.indexOf(dateStr);
          if (idx >= 0) h.completions.splice(idx, 1); else h.completions.push(dateStr);
          saveState();
          renderHabitDetail();
          renderHabits();
          renderTodayHabits();
          renderCounts();
        });
      }
      grid.appendChild(el);
    }
  }

  $('#calendarPrevBtn').addEventListener('click', () => {
    calendarCursor.month--;
    if (calendarCursor.month < 0) { calendarCursor.month = 11; calendarCursor.year--; }
    const h = habits.find(h => h.id === currentHabitDetailId);
    if (h) renderCalendar(h);
  });
  $('#calendarNextBtn').addEventListener('click', () => {
    calendarCursor.month++;
    if (calendarCursor.month > 11) { calendarCursor.month = 0; calendarCursor.year++; }
    const h = habits.find(h => h.id === currentHabitDetailId);
    if (h) renderCalendar(h);
  });
  function archiveHabit(id) {
    const h = habits.find(h => h.id === id);
    if (!h) return;
    h.status = 'archived';
    h.endDate = todayStr();
    const ok = saveState();
    switchView('habits');
    renderAll();
    if (ok) showToast('習慣を終了しました。過去の記録はHistoryに保存されています。');
  }

  $('#habitDetailBack').addEventListener('click', () => switchView('habits'));
  $('#detailEditBtn').addEventListener('click', () => openEditHabitModal(currentHabitDetailId));
  $('#detailArchiveBtn').addEventListener('click', () => {
    const h = habits.find(h => h.id === currentHabitDetailId);
    if (!h) return;
    const msg = `「${h.name}」を終了しますか？\n\n終了すると、今日以降のHabit一覧には表示されなくなります。\nこれまでの達成記録は履歴として保存されます。`;
    if (confirm(msg)) {
      archiveHabit(currentHabitDetailId);
    }
  });
  $('#detailDeleteBtn').addEventListener('click', () => {
    if (confirm('この習慣を削除しますか？達成履歴もすべて削除されます。')) {
      habits = habits.filter(h => h.id !== currentHabitDetailId);
      const ok = saveState();
      switchView('habits');
      renderAll();
      if (ok) showToast('習慣を削除しました');
    }
  });

  /* ---------- Sidebar / counts ---------- */

  function renderCounts() {
    const today = todayStr();
    $('[data-count="inbox"]').textContent = tasks.filter(t => !t.date && !t.completed).length || '';
    $('[data-count="today"]').textContent = tasks.filter(t => t.date && t.date <= today && !t.completed).length || '';
    $('[data-count="upcoming"]').textContent = tasks.filter(t => t.date && t.date > today && !t.completed).length || '';
    $('[data-count="completed"]').textContent = tasks.filter(t => t.completed).length || '';
    const remainingHabits = habits.filter(h => isHabitScheduled(h, today) && !isHabitDone(h, today)).length;
    $('[data-count="habits"]').textContent = remainingHabits || '';
  }

  function renderCategorySidebar() {
    const wrap = $('#categoryList');
    wrap.innerHTML = '';
    const allBtn = document.createElement('button');
    allBtn.className = 'category-item' + (activeCategory === null ? ' active' : '');
    allBtn.innerHTML = `<span class="cat-dot" style="--dot:var(--text-faint)"></span>すべて<span class="count">${tasks.filter(t => !t.completed).length}</span>`;
    allBtn.addEventListener('click', () => { activeCategory = null; renderAll(); });
    wrap.appendChild(allBtn);
    CATEGORIES.forEach(c => {
      const count = tasks.filter(t => t.category === c.key && !t.completed).length;
      const btn = document.createElement('button');
      btn.className = 'category-item' + (activeCategory === c.key ? ' active' : '');
      btn.innerHTML = `<span class="cat-dot" style="--dot:${c.color}"></span>${c.label}<span class="count">${count}</span>`;
      btn.addEventListener('click', () => { activeCategory = c.key; renderAll(); });
      wrap.appendChild(btn);
    });
  }

  function renderCategoryManage() {
    const wrap = $('#categoryManageList');
    wrap.innerHTML = '';
    CATEGORIES.forEach(c => {
      const count = tasks.filter(t => t.category === c.key).length + habits.filter(h => h.category === c.key).length;
      const el = document.createElement('div');
      el.className = 'category-manage-item';
      el.innerHTML = `<span class="cat-dot" style="--dot:${c.color}"></span><span>${c.label}</span><span class="count">${count}</span>`;
      wrap.appendChild(el);
    });
  }

  function populateCategorySelect(sel) {
    sel.innerHTML = CATEGORIES.map(c => `<option value="${c.key}">${c.label}</option>`).join('');
  }

  function renderAll() {
    renderToday();
    renderTodayHabits();
    renderHomeHabitsSummary();
    renderStreakCard();
    renderHomeUpcoming();
    renderInbox();
    renderUpcoming();
    renderCompleted();
    renderHabits();
    renderCounts();
    renderCategorySidebar();
    renderCategoryManage();
  }

  /* ---------- Mutations ---------- */

  /** Single creation path for tasks — used by both the full modal and Quick Add. */
  function createTask({ title, date = '', time = '', category = '', priority = 'medium', note = '' }) {
    const task = {
      id: 't' + Date.now() + Math.random().toString(16).slice(2),
      title, date, time, category, note, priority,
      completed: false,
    };
    tasks.push(task);
    return task;
  }

  function toggleComplete(id) {
    const t = tasks.find(t => t.id === id);
    t.completed = !t.completed;
    if (t.completed) { t.completedAt = todayStr(); justCompletedTaskId = id; } else delete t.completedAt;
    const ok = saveState();
    renderAll();
    if (ok) showToast(t.completed ? 'タスクを完了しました' : '未完了に戻しました');
  }
  function deleteTask(id) {
    tasks = tasks.filter(t => t.id !== id);
    const ok = saveState();
    renderAll();
    if (ok) showToast('タスクを削除しました');
  }

  let toastTimer = null;
  function showToast(msg) {
    const el = $('#toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
  }

  /* ---------- Habit view toggle (Active/History) ---------- */

  $$('#habitViewToggle button').forEach(b => b.addEventListener('click', () => {
    const view = b.dataset.habitView;
    $$('#habitViewToggle button').forEach(btn => btn.classList.toggle('active', btn.dataset.habitView === view));
    if (view === 'active') {
      $('#list-habits').style.display = '';
      $('#list-habits-history').style.display = 'none';
    } else {
      $('#list-habits').style.display = 'none';
      $('#list-habits-history').style.display = '';
    }
  }));

  /* ---------- View switching ---------- */

  function switchView(view) {
    currentView = view;
    $$('.view').forEach(v => v.classList.remove('active'));
    $(`#view-${view}`).classList.add('active');
    $$('.nav-item').forEach(b => {
      const isActive = b.dataset.view === view;
      b.classList.toggle('active', isActive);
      if (isActive) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
    });
    $$('#mobileTabbar button').forEach(b => b.classList.toggle('active', b.dataset.view === view));
    if (!['today', 'inbox', 'upcoming', 'completed'].includes(view)) activeCategory = null;
    $('.main').scrollTo({ top: 0 });
  }

  $$('.nav-item').forEach(b => b.addEventListener('click', () => switchView(b.dataset.view)));
  $$('#mobileTabbar button').forEach(b => b.addEventListener('click', () => switchView(b.dataset.view)));
  $$('[data-view-link]').forEach(b => b.addEventListener('click', () => switchView(b.dataset.viewLink)));
  $('#brandBtn').addEventListener('click', () => switchView('today'));
  $('#settingsBtn').addEventListener('click', () => switchView('settings'));

  /* ---------- Task modal ---------- */

  const overlay = $('#modalOverlay');
  const nameInput = $('#taskNameInput');
  const dateInput = $('#taskDateInput');
  const timeInput = $('#taskTimeInput');
  const catSelect = $('#taskCategorySelect');
  const noteInput = $('#taskNoteInput');
  const saveBtn = $('#saveTaskBtn');
  const deleteBtn = $('#deleteTaskBtn');
  let currentPriority = 'medium';

  function setPriority(p) {
    currentPriority = p;
    $$('#priorityPicker button').forEach(b => b.classList.toggle('active', b.dataset.priority === p));
  }
  $$('#priorityPicker button').forEach(b => b.addEventListener('click', () => setPriority(b.dataset.priority)));

  function openAddModal() {
    editingId = null;
    nameInput.value = '';
    dateInput.value = ['today', 'upcoming'].includes(currentView) ? todayStr() : '';
    timeInput.value = '';
    catSelect.value = activeCategory || CATEGORIES[0].key;
    noteInput.value = '';
    setPriority('medium');
    saveBtn.textContent = '追加';
    saveBtn.disabled = true;
    deleteBtn.classList.add('hidden');
    openModal(overlay, nameInput);
  }
  function openEditModal(id) {
    const t = tasks.find(t => t.id === id);
    if (!t) return;
    editingId = id;
    nameInput.value = t.title;
    dateInput.value = t.date || '';
    timeInput.value = t.time || '';
    catSelect.value = t.category || CATEGORIES[0].key;
    noteInput.value = t.note || '';
    setPriority(t.priority);
    saveBtn.textContent = '保存';
    saveBtn.disabled = false;
    deleteBtn.classList.remove('hidden');
    openModal(overlay, nameInput);
  }
  function openModal(ov, focusEl) {
    ov.classList.add('open');
    setTimeout(() => focusEl.focus(), 50);
  }
  function closeModal(ov) { ov.classList.remove('open'); }

  nameInput.addEventListener('input', () => { saveBtn.disabled = nameInput.value.trim().length === 0; });
  $$('[data-add]').forEach(b => b.addEventListener('click', openAddModal));
  $('#fabAdd').addEventListener('click', () => { if (currentView === 'habits' || currentView === 'habit-detail') openAddHabitModal(); else openAddModal(); });
  $('#cancelModalBtn').addEventListener('click', () => closeModal(overlay));
  overlay.addEventListener('click', (e) => { if (e.target === overlay) closeModal(overlay); });

  saveBtn.addEventListener('click', () => {
    const title = nameInput.value.trim();
    if (!title) return;
    if (editingId) {
      const t = tasks.find(t => t.id === editingId);
      t.title = title; t.date = dateInput.value; t.time = timeInput.value;
      t.category = catSelect.value; t.note = noteInput.value; t.priority = currentPriority;
      showToast('タスクを更新しました');
    } else {
      createTask({ title, date: dateInput.value, time: timeInput.value, category: catSelect.value, note: noteInput.value, priority: currentPriority });
      showToast('タスクを追加しました');
    }
    saveState();
    closeModal(overlay);
    renderAll();
  });
  deleteBtn.addEventListener('click', () => { if (editingId) deleteTask(editingId); closeModal(overlay); });

  /* ---------- Habit modal ---------- */

  const habitOverlay = $('#habitModalOverlay');
  const habitNameInput = $('#habitNameInput');
  const habitCategorySelect = $('#habitCategorySelect');
  const habitStartInput = $('#habitStartInput');
  const habitSaveBtn = $('#saveHabitBtn');
  const habitDeleteBtn = $('#deleteHabitBtn');
  const habitPeriodNone = $('#habitPeriodNone');
  const habitPeriodSet = $('#habitPeriodSet');
  const habitEndDateContainer = $('#habitEndDateContainer');
  const habitEndInput = $('#habitEndInput');
  let currentHabitIcon = null;
  let currentHabitFreqType = 'daily';
  let currentHabitDays = [];
  let currentHabitPeriodMode = 'none';

  function renderIconPicker() {
    const wrap = $('#habitIconPicker');
    wrap.innerHTML = '';
    ICON_ORDER.forEach(key => {
      const btn = document.createElement('button');
      btn.type = 'button';
      const isActive = currentHabitIcon === key;
      btn.className = 'icon-swatch' + (isActive ? ' active' : '');
      btn.innerHTML = HABIT_ICONS[key];
      btn.setAttribute('aria-label', ICON_LABELS[key]);
      btn.setAttribute('aria-pressed', String(isActive));
      btn.addEventListener('click', () => { currentHabitIcon = currentHabitIcon === key ? null : key; renderIconPicker(); });
      wrap.appendChild(btn);
    });
  }

  function setHabitFrequency(type) {
    currentHabitFreqType = type;
    $$('#habitFrequencyPicker button').forEach(b => b.classList.toggle('active', b.dataset.freq === type));
    $('#habitWeekdayPicker').classList.toggle('hidden', type !== 'custom');
    validateHabitForm();
  }
  $$('#habitFrequencyPicker button').forEach(b => b.addEventListener('click', () => setHabitFrequency(b.dataset.freq)));

  function renderWeekdayPicker() {
    $$('.weekday-chip').forEach(b => b.classList.toggle('active', currentHabitDays.includes(Number(b.dataset.day))));
  }
  $$('.weekday-chip').forEach(b => b.addEventListener('click', () => {
    const day = Number(b.dataset.day);
    const idx = currentHabitDays.indexOf(day);
    if (idx >= 0) currentHabitDays.splice(idx, 1); else currentHabitDays.push(day);
    renderWeekdayPicker();
    validateHabitForm();
  }));

  function validateHabitForm() {
    const nameOk = habitNameInput.value.trim().length > 0;
    const freqOk = currentHabitFreqType !== 'custom' || currentHabitDays.length > 0;
    habitSaveBtn.disabled = !(nameOk && freqOk);
  }
  habitNameInput.addEventListener('input', validateHabitForm);

  function openAddHabitModal() {
    editingHabitId = null;
    habitNameInput.value = '';
    currentHabitIcon = null;
    renderIconPicker();
    populateCategorySelect(habitCategorySelect);
    habitCategorySelect.value = CATEGORIES[0].key;
    habitStartInput.value = todayStr();
    currentHabitDays = [];
    renderWeekdayPicker();
    setHabitFrequency('daily');
    currentHabitPeriodMode = 'none';
    habitPeriodNone.checked = true;
    habitPeriodSet.checked = false;
    habitEndDateContainer.style.display = 'none';
    habitEndInput.value = '';
    habitSaveBtn.textContent = '追加';
    habitDeleteBtn.classList.add('hidden');
    validateHabitForm();
    openModal(habitOverlay, habitNameInput);
  }
  function openEditHabitModal(id) {
    const h = habits.find(h => h.id === id);
    if (!h) return;
    editingHabitId = id;
    habitNameInput.value = h.name;
    currentHabitIcon = h.icon;
    renderIconPicker();
    populateCategorySelect(habitCategorySelect);
    habitCategorySelect.value = h.category || CATEGORIES[0].key;
    habitStartInput.value = h.startDate;
    currentHabitDays = (h.frequency.days || []).slice();
    renderWeekdayPicker();
    setHabitFrequency(h.frequency.type);
    currentHabitPeriodMode = h.plannedEndDate ? 'set' : 'none';
    habitPeriodNone.checked = (currentHabitPeriodMode === 'none');
    habitPeriodSet.checked = (currentHabitPeriodMode === 'set');
    if (currentHabitPeriodMode === 'set') {
      habitEndDateContainer.style.display = '';
      habitEndInput.value = h.plannedEndDate || '';
    } else {
      habitEndDateContainer.style.display = 'none';
      habitEndInput.value = '';
    }
    habitSaveBtn.textContent = '保存';
    habitDeleteBtn.classList.remove('hidden');
    validateHabitForm();
    openModal(habitOverlay, habitNameInput);
  }

  $$('input[name="habitPeriodMode"]').forEach(radio => radio.addEventListener('change', (e) => {
    currentHabitPeriodMode = e.target.value;
    if (currentHabitPeriodMode === 'set') {
      habitEndDateContainer.style.display = '';
      habitEndInput.value = addDays(habitStartInput.value || todayStr(), 30);
    } else {
      habitEndDateContainer.style.display = 'none';
      habitEndInput.value = '';
    }
  }));

  $('#addHabitBtn').addEventListener('click', openAddHabitModal);
  $('#cancelHabitModalBtn').addEventListener('click', () => closeModal(habitOverlay));
  habitOverlay.addEventListener('click', (e) => { if (e.target === habitOverlay) closeModal(habitOverlay); });

  habitSaveBtn.addEventListener('click', () => {
    const name = habitNameInput.value.trim();
    if (!name) return;
    const frequency = { type: currentHabitFreqType, days: currentHabitFreqType === 'custom' ? currentHabitDays.slice() : [] };
    const plannedEndDate = (currentHabitPeriodMode === 'set' && habitEndInput.value) ? habitEndInput.value : undefined;
    if (editingHabitId) {
      const h = habits.find(h => h.id === editingHabitId);
      h.name = name; h.icon = currentHabitIcon; h.category = habitCategorySelect.value;
      h.startDate = habitStartInput.value || todayStr(); h.frequency = frequency;
      if (currentHabitPeriodMode === 'set' && plannedEndDate) h.plannedEndDate = plannedEndDate;
      else delete h.plannedEndDate;
      showToast('習慣を更新しました');
    } else {
      const newHabit = {
        id: 'h' + Date.now() + Math.random().toString(16).slice(2),
        name, icon: currentHabitIcon, category: habitCategorySelect.value,
        frequency, startDate: habitStartInput.value || todayStr(),
        status: 'active',
        completions: [], createdAt: Date.now(),
      };
      if (plannedEndDate) newHabit.plannedEndDate = plannedEndDate;
      habits.push(newHabit);
      showToast('習慣を追加しました');
    }
    saveState();
    closeModal(habitOverlay);
    renderAll();
    if (currentView === 'habit-detail') renderHabitDetail();
  });
  habitDeleteBtn.addEventListener('click', () => {
    if (editingHabitId && confirm('この習慣を削除しますか？達成履歴もすべて削除されます。')) {
      habits = habits.filter(h => h.id !== editingHabitId);
      const ok = saveState();
      closeModal(habitOverlay);
      if (currentView === 'habit-detail') switchView('habits');
      renderAll();
      if (ok) showToast('習慣を削除しました');
    }
  });

  function getFocusable(container) {
    return [...container.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')]
      .filter(el => !el.disabled && el.offsetParent !== null);
  }

  // Escape closes whichever modal is open; Tab is kept from leaking focus onto
  // the 30+ background controls (sidebar, other views) while a modal is open.
  document.addEventListener('keydown', (e) => {
    const openOverlay = overlay.classList.contains('open') ? overlay
      : habitOverlay.classList.contains('open') ? habitOverlay : null;
    if (!openOverlay) return;

    if (e.key === 'Escape') { closeModal(openOverlay); return; }
    if (e.key !== 'Tab') return;

    const focusable = getFocusable(openOverlay);
    if (!focusable.length) return;
    const first = focusable[0], last = focusable[focusable.length - 1];
    const focusInside = openOverlay.contains(document.activeElement);
    if (e.shiftKey) {
      if (!focusInside || document.activeElement === first) { e.preventDefault(); last.focus(); }
    } else {
      if (!focusInside || document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  });

  /* ---------- Quick Add ---------- */

  const quickForm = $('#quickAddForm');
  const quickInput = $('#quickAddInput');
  const quickToggle = $('#quickAddToggle');
  const quickDetails = $('#quickAddDetails');
  const quickDate = $('#quickAddDate');
  const quickTime = $('#quickAddTime');
  const quickCategory = $('#quickAddCategory');
  const quickSubmit = $('#quickAddSubmit');
  let quickPriority = 'medium';

  function setQuickPriority(p) {
    quickPriority = p;
    $$('#quickPriorityPicker button').forEach(b => b.classList.toggle('active', b.dataset.qpriority === p));
  }
  $$('#quickPriorityPicker button').forEach(b => {
    b.addEventListener('click', () => setQuickPriority(b.dataset.qpriority));
  });

  function resetQuickAdd() {
    quickInput.value = '';
    quickSubmit.disabled = true;
    quickDate.value = todayStr();
    quickTime.value = '';
    quickCategory.value = activeCategory || CATEGORIES[0].key;
    setQuickPriority('medium');
    quickDetails.classList.add('hidden');
    quickToggle.classList.remove('open');
    quickToggle.setAttribute('aria-expanded', 'false');
  }

  quickInput.addEventListener('input', () => {
    quickSubmit.disabled = quickInput.value.trim().length === 0;
  });

  quickToggle.addEventListener('click', () => {
    const willOpen = quickDetails.classList.contains('hidden');
    quickDetails.classList.toggle('hidden', !willOpen);
    quickToggle.classList.toggle('open', willOpen);
    quickToggle.setAttribute('aria-expanded', String(willOpen));
    if (willOpen) quickDate.focus(); else quickInput.focus();
  });

  quickForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const title = quickInput.value.trim();
    if (!title) return;
    createTask({
      title,
      date: quickDate.value,
      time: quickTime.value,
      category: quickCategory.value,
      priority: quickPriority,
    });
    const ok = saveState();
    resetQuickAdd();
    renderAll();
    quickInput.focus();
    if (ok) showToast('タスクを追加しました');
  });

  quickInput.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      if (quickInput.value) { resetQuickAdd(); } else { quickInput.blur(); }
    }
  });

  /* ---------- Settings: character ---------- */

  function renderCharacterSettings() {
    const isFixed = settings.characterMode === 'fixed';
    $$('#characterModeSegmented button').forEach(b =>
      b.classList.toggle('active', b.dataset.charMode === (isFixed ? 'fixed' : 'random')));

    $('#characterModeDesc').textContent = isFixed
      ? '選んだキャラクターがいつも表示されます'
      : `日付に応じて毎日変わります（今日は「${characterLabel(getCharacterKey())}」）`;

    const picker = $('#characterPicker');
    picker.classList.toggle('is-locked', !isFixed);
    const selected = getCharacterKey();
    picker.innerHTML = '';
    CHARACTERS.forEach(c => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'character-option char-' + c.key + (isFixed && c.key === selected ? ' selected' : '');
      btn.appendChild(buildCharacterVisual(c.key));
      btn.insertAdjacentHTML('beforeend', `<span>${c.label}</span><span class="char-check">${iconCheck}</span>`);
      btn.addEventListener('click', () => {
        settings.characterMode = 'fixed';
        settings.characterKey = c.key;
        const ok = saveState();
        renderCharacter();
        renderCharacterSettings();
        if (ok) showToast(`キャラクターを「${c.label}」にしました`);
      });
      picker.appendChild(btn);
    });
  }

  $$('#characterModeSegmented button').forEach(b => b.addEventListener('click', () => {
    settings.characterMode = b.dataset.charMode;
    if (settings.characterMode === 'fixed' && !settings.characterKey) {
      settings.characterKey = getCharacterKey();
    }
    saveState();
    renderCharacter();
    renderCharacterSettings();
  }));

  /* ---------- Settings ---------- */

  $$('#themeSegmented button').forEach(b => b.addEventListener('click', () => {
    const choice = b.dataset.themeChoice;
    $$('#themeSegmented button').forEach(x => x.classList.remove('active'));
    b.classList.add('active');
    settings.theme = choice;
    if (choice === 'system') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', choice);
    saveState();
  }));
  $$('#notifySegmented button').forEach(b => b.addEventListener('click', () => {
    $$('#notifySegmented button').forEach(x => x.classList.remove('active'));
    b.classList.add('active');
    settings.notifyEnabled = b.dataset.notifyChoice === 'on';
    saveState();
  }));

  function applyStoredNotifySetting() {
    if (typeof settings.notifyEnabled !== 'boolean') return; // no saved choice yet — keep the default markup
    const choice = settings.notifyEnabled ? 'on' : 'off';
    $$('#notifySegmented button').forEach(b => b.classList.toggle('active', b.dataset.notifyChoice === choice));
  }

  function applyStoredTheme() {
    const theme = settings.theme;
    if (theme === 'light' || theme === 'dark') {
      document.documentElement.setAttribute('data-theme', theme);
      $$('#themeSegmented button').forEach(b => b.classList.toggle('active', b.dataset.themeChoice === theme));
    } else {
      document.documentElement.removeAttribute('data-theme');
      $$('#themeSegmented button').forEach(b => b.classList.toggle('active', b.dataset.themeChoice === 'system'));
    }
  }

  $('#exportBtn').addEventListener('click', () => {
    const data = JSON.stringify({ tasks, habits, settings }, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `todo-backup-${todayStr()}.json`;
    document.body.appendChild(a); a.click(); a.remove();
    // Revoking immediately after click() can cancel the download in Safari.
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    showToast('エクスポートしました');
  });
  const importFile = $('#importFile');
  $('#importBtn').addEventListener('click', () => importFile.click());
  importFile.addEventListener('change', () => {
    const file = importFile.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(reader.result);
        if (!Array.isArray(parsed.tasks) || !Array.isArray(parsed.habits)) throw new Error('invalid');
        const importedTasks = parsed.tasks.map(normalizeTask).filter(Boolean);
        const importedHabits = parsed.habits.map(normalizeHabit).filter(Boolean);

        // Cancelling either dialog must never destroy data. Step 1: proceed at all?
        const proceed = confirm(
          `${importedTasks.length}件のタスクと${importedHabits.length}件の習慣を読み込みます。\n\n` +
          'OK: インポートを続ける\nキャンセル: 何もしない'
        );
        if (!proceed) { importFile.value = ''; return; }

        // Step 2: an explicit second OK is required to replace; cancelling merges (non-destructive default).
        const replace = confirm(
          '既存のタスク・習慣をすべて置き換えますか？\n\n' +
          'OK: 置き換える（現在のデータは削除されます）\nキャンセル: 統合する（両方を残します）'
        );
        if (replace) {
          tasks = dedupeIds(importedTasks, new Set());
          habits = dedupeIds(importedHabits, new Set());
          // Preferences (theme/character/notify) only make sense to adopt wholesale,
          // not "merged" with the current ones — so only apply them on replace.
          settings = normalizeSettings(parsed.settings);
        } else {
          tasks = tasks.concat(dedupeIds(importedTasks, new Set(tasks.map(t => t.id))));
          habits = habits.concat(dedupeIds(importedHabits, new Set(habits.map(h => h.id))));
        }
        const ok = saveState();
        renderAll();
        applyStoredTheme();
        applyStoredNotifySetting();
        renderCharacter();
        renderCharacterSettings();
        if (ok) showToast('インポートしました');
      } catch (e) {
        showToast('インポートに失敗しました（ファイル形式を確認してください）');
      }
      importFile.value = '';
    };
    reader.readAsText(file);
  });

  /* ---------- Date rollover ---------- */

  // If the tab is left open across midnight, nothing else re-checks todayStr() on
  // its own — Today's Tasks, the header date, and the character would keep showing
  // yesterday until the user happens to interact. Catch it on a light interval and
  // whenever the tab regains focus (the common case: laptop closed overnight).
  let lastKnownDate = todayStr();
  function checkDateRollover() {
    const now = todayStr();
    if (now === lastKnownDate) return;
    lastKnownDate = now;
    $('#todayPill').innerHTML = `${iconCalendarSmall}${formatDateJP(now)}`;
    renderCharacter();
    renderAll();
  }
  setInterval(checkDateRollover, 60000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) checkDateRollover(); });

  /* ---------- Init ---------- */

  $('#todayPill').innerHTML = `${iconCalendarSmall}${formatDateJP(todayStr())}`;
  populateCategorySelect(catSelect);
  populateCategorySelect(quickCategory);
  resetQuickAdd();
  applyStoredTheme();
  applyStoredNotifySetting();
  renderCharacter();
  renderCharacterSettings();
  renderIconPicker();
  renderWeekdayPicker();
  renderAll();
  if (dataLoadCorrupted) showToast('保存データの読み込みに失敗したため、新しい状態で開始しました。');
})();
