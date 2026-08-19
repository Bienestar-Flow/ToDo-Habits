(() => {
  'use strict';

  const STORAGE_KEY = 'todoAppDataV2';
  const OLD_STORAGE_KEY = 'todoAppData';
  const ABANDONED_KEY = 'todoAppDataV3';

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
    if (dateStr === addDays(today, 1)) return '明日';
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
    const out = {
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
    // Optional, and absent on every task written before Projects existed — so it
    // stays off the object entirely rather than becoming an explicit undefined.
    if (typeof t.projectId === 'string' && t.projectId) out.projectId = t.projectId;
    return out;
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

  /** Coerces one loaded/imported project into a well-formed shape. Returns null for unusable entries.
   *  Note there is no task list here: a project's tasks are always derived from
   *  `task.projectId`, so there is only ever one copy of that relationship to keep correct. */
  function normalizeProject(p) {
    if (!p || typeof p !== 'object') return null;
    if (typeof p.name !== 'string' || !p.name.trim()) return null;
    const out = {
      id: typeof p.id === 'string' && p.id ? p.id : ('p' + Date.now() + Math.random().toString(16).slice(2)),
      name: p.name,
      description: typeof p.description === 'string' ? p.description : '',
      // Unknown keys are kept as-is and fall back to the default glyph at render
      // time, so an icon set that grows later never invalidates saved projects.
      icon: typeof p.icon === 'string' && p.icon ? p.icon : null,
      status: p.status === 'completed' ? 'completed' : 'active',
      createdAt: typeof p.createdAt === 'number' ? p.createdAt : Date.now(),
    };
    if (typeof p.deadline === 'string' && DATE_RE.test(p.deadline)) out.deadline = p.deadline;
    if (typeof p.completedAt === 'string' && DATE_RE.test(p.completedAt)) out.completedAt = p.completedAt;
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

  /** A task may only point at a project that actually exists. Anything else — a
   *  half-restored backup, a hand-edited export — is downgraded to a plain task
   *  rather than left pointing into nothing. */
  function pruneDanglingProjectIds(taskList, projectList) {
    const ids = new Set(projectList.map(p => p.id));
    taskList.forEach(t => { if (t.projectId && !ids.has(t.projectId)) delete t.projectId; });
    return taskList;
  }

  function buildState(parsed) {
    const tasks = dedupeIds((Array.isArray(parsed.tasks) ? parsed.tasks : []).map(normalizeTask).filter(Boolean), new Set());
    const habits = dedupeIds((Array.isArray(parsed.habits) ? parsed.habits : []).map(normalizeHabit).filter(Boolean), new Set());
    const projects = dedupeIds((Array.isArray(parsed.projects) ? parsed.projects : []).map(normalizeProject).filter(Boolean), new Set());
    return {
      tasks: pruneDanglingProjectIds(tasks, projects),
      habits,
      projects,
      settings: normalizeSettings(parsed.settings),
    };
  }

  /** An earlier, short-lived build of Projects saved under its own key instead of
   *  extending V2. Where that key exists it holds strictly newer data than V2 (it
   *  was seeded from V2), so fold it back in once and drop it — left in place it
   *  would shadow every future V2 write. */
  function reclaimAbandonedKey() {
    const raw = localStorage.getItem(ABANDONED_KEY);
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed.tasks) || !Array.isArray(parsed.habits)) return null;
      const state = buildState(parsed);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      localStorage.removeItem(ABANDONED_KEY); // only after the copy is safely committed
      return state;
    } catch (e) { return null; }
  }

  function loadState() {
    const reclaimed = reclaimAbandonedKey();
    if (reclaimed) return reclaimed;

    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      try {
        return buildState(JSON.parse(raw));
      } catch (e) { dataLoadCorrupted = true; /* fall through to a fresh/migrated state */ }
    }
    const migrated = migrateFromV1();
    if (migrated) {
      const state = { tasks: migrated.tasks, habits: migrated.habits, projects: [], settings: {} };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      return state;
    }
    return { tasks: [], habits: [], projects: [], settings: {} };
  }

  /** Returns true on success. Callers that show their own "saved" toast should
   *  check this and show the failure message instead — otherwise a later
   *  success toast would silently overwrite the warning. */
  function saveState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ tasks, habits, projects, settings }));
      return true;
    } catch (e) {
      showToast('保存に失敗しました。ブラウザの空き容量をご確認ください。');
      return false;
    }
  }

  const initial = loadState();
  let tasks = initial.tasks;
  let habits = initial.habits;
  let projects = initial.projects;
  let settings = initial.settings;

  let currentView = 'today';
  let activeCategory = null;
  let editingId = null;
  let editingHabitId = null;
  let editingProjectId = null;
  let currentHabitDetailId = null;
  let currentProjectDetailId = null;
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
  const iconLayers = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m12 3 9 5-9 5-9-5 9-5Z"></path><path d="m3 12.5 9 5 9-5"></path><path d="m3 16.5 9 5 9-5"></path></svg>';

  /* ---------- Project icons ----------
     Same line-art vocabulary as HABIT_ICONS so a project reads as part of the same
     app, not a sticker pasted on top. Icons stay optional: `iconLayers` is the
     default, and an unrecognised saved key falls back to it rather than breaking. */

  const PROJECT_ICONS = {
    target: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8.5"></circle><circle cx="12" cy="12" r="4.3"></circle><circle cx="12" cy="12" r="1.3" fill="currentColor" stroke="none"></circle></svg>',
    flag: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5.5 21V3.5"></path><path d="M5.5 4.6h11.8l-2.4 4 2.4 4H5.5"></path></svg>',
    star: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m12 3.4 2.7 5.5 6 .9-4.35 4.25 1.03 6-5.38-2.83L6.6 20.05l1.03-6L3.28 9.8l6.02-.9Z"></path></svg>',
    rocket: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2.6c3.2 2.6 4.9 6.1 4.9 9.8v3.4H7.1v-3.4c0-3.7 1.7-7.2 4.9-9.8Z"></path><circle cx="12" cy="10" r="2.1"></circle><path d="M7.1 14.2 4.4 16.9v3.3l2.9-1.7M16.9 14.2l2.7 2.7v3.3l-2.9-1.7"></path></svg>',
    briefcase: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="2.8" y="7" width="18.4" height="13" rx="2.2"></rect><path d="M9 7V5.3A1.3 1.3 0 0 1 10.3 4h3.4A1.3 1.3 0 0 1 15 5.3V7"></path><path d="M2.8 12.6h18.4"></path></svg>',
    book: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5.5C4 4.7 4.7 4 5.5 4H11v16H5.5C4.7 20 4 19.3 4 18.5Z"></path><path d="M20 5.5c0-.8-.7-1.5-1.5-1.5H13v16h5.5c.8 0 1.5-.7 1.5-1.5Z"></path></svg>',
    palette: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3.4c-4.9 0-8.8 3.7-8.8 8.4 0 4.5 3.6 7.5 7.2 7.5 1.6 0 2.3-.9 2.3-1.9 0-1.3-1.1-1.6-1.1-2.6 0-.9.7-1.6 1.8-1.6h1.8c3 0 5.6-2.2 5.6-5.1 0-3-3.6-4.7-8.8-4.7Z"></path><circle cx="7.8" cy="11.4" r="1.1"></circle><circle cx="10.6" cy="7.9" r="1.1"></circle><circle cx="14.8" cy="8.2" r="1.1"></circle></svg>',
    cart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="9.6" cy="19.4" r="1.5"></circle><circle cx="17.2" cy="19.4" r="1.5"></circle><path d="M2.6 3.6h2.7l2.5 12h11"></path><path d="M6.6 7.2h14.3l-1.6 6.5H7.9"></path></svg>',
    plane: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20.6 3.4 3.7 10.2c-.75.3-.72 1.38.05 1.63l5.2 1.7 1.7 5.2c.25.77 1.33.8 1.63.05Z"></path><path d="m8.95 13.53 4.6-4.6"></path></svg>',
    home: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m3 10 9-7 9 7"></path><path d="M5 9.5V20a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9.5"></path><path d="M9.5 21v-6h5v6"></path></svg>',
  };
  const PROJECT_ICON_ORDER = ['target', 'flag', 'star', 'rocket', 'briefcase', 'book', 'palette', 'cart', 'plane', 'home'];
  const PROJECT_ICON_LABELS = {
    target: '目標', flag: '旗', star: '星', rocket: 'ロケット', briefcase: '仕事',
    book: '学習', palette: '制作', cart: '買い物', plane: '旅行', home: '住まい',
  };
  function projectIconSvg(p) { return (p && p.icon && PROJECT_ICONS[p.icon]) || iconLayers; }

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
  function buildCharacterVisual(key, { lazy = false } = {}) {
    const wrap = document.createElement('span');
    wrap.className = 'character-visual';
    const img = document.createElement('img');
    img.src = `images/${key}.png`;
    img.alt = '';
    // Only for the settings picker, where most options sit below the fold. The
    // Home character is the first thing on screen and must never be deferred.
    if (lazy) img.loading = 'lazy';
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

  /* ---------- Project helpers ----------
     A project never stores its own task list. Membership lives on `task.projectId`
     alone and everything below is derived from it, so a project's progress and the
     task lists in Today / Upcoming / Completed can never disagree. */

  function projectById(id) { return id ? projects.find(p => p.id === id) : undefined; }
  function projectTasks(id) { return tasks.filter(t => t.projectId === id); }
  function activeProjects() { return projects.filter(p => p.status !== 'completed'); }

  function projectStats(id) {
    const list = projectTasks(id);
    const done = list.filter(t => t.completed).length;
    return { total: list.length, done, pct: list.length ? Math.round((done / list.length) * 100) : 0 };
  }

  /** Deadline presentation. Returns null when none is set so callers render nothing
   *  at all — an unset deadline must never surface as a placeholder date. */
  function projectDeadline(p) {
    if (!p.deadline) return null;
    const today = todayStr();
    const daysLeft = Math.round((new Date(p.deadline + 'T00:00:00') - new Date(today + 'T00:00:00')) / 86400000);
    const label = new Date(p.deadline + 'T00:00:00').toLocaleDateString('ja-JP', { month: 'short', day: 'numeric' });
    // Only a finished project stops being "late"; the tone stays soft either way —
    // amber for approaching, and red reserved for genuinely overdue.
    if (p.status === 'completed') return { label, tone: '' };
    if (daysLeft < 0) return { label, tone: 'overdue', note: '期限切れ' };
    if (daysLeft <= 3) return { label, tone: 'soon', note: 'まもなく期限' };
    return { label, tone: '' };
  }

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

  /** `showProject` is off inside a project's own task list, where repeating the
   *  project name on every row would be noise. */
  function buildMetaChips(t, { showProject = true } = {}) {
    let html = '';
    if (t.date && !t.completed && t.date < todayStr()) {
      html += `<span class="meta-chip overdue">${iconCalendarSmall}${escapeHtml(formatDateJP(t.date))} 期限切れ</span>`;
    }
    if (t.time) html += `<span class="meta-chip meta-time ${isOverdue(t) ? 'overdue' : ''}">${iconClock}${escapeHtml(t.time)}</span>`;
    const priority = PRIORITIES.includes(t.priority) ? t.priority : 'medium';
    html += `<span class="meta-chip"><span class="priority-dot ${priority}"></span>優先度: ${priorityLabel(priority)}</span>`;
    const c = catInfo(t.category);
    if (c) html += `<span class="cat-chip" style="--dot:${c.color}"><span class="cat-dot"></span>${escapeHtml(c.label)}</span>`;
    if (showProject) {
      const p = projectById(t.projectId);
      if (p) html += `<span class="project-chip">${projectIconSvg(p)}${escapeHtml(p.name)}</span>`;
    }
    return html;
  }

  function createTaskRow(t, opts = {}) {
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
    metaEl.innerHTML = buildMetaChips(t, opts);
    mainEl.appendChild(titleEl);
    mainEl.appendChild(metaEl);
    mainEl.addEventListener('click', () => openEditModal(t.id));

    const actions = document.createElement('div');
    actions.className = 'task-actions';
    actions.innerHTML = `<button class="icon-btn" data-act="edit" title="編集">${iconEdit}</button><button class="icon-btn danger" data-act="delete" title="削除">${iconTrash}</button>`;
    actions.querySelector('[data-act="edit"]').addEventListener('click', (e) => { e.stopPropagation(); openEditModal(t.id); });
    actions.querySelector('[data-act="delete"]').addEventListener('click', (e) => { e.stopPropagation(); confirmDeleteTask(t.id); });

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
      ? `${stats.done} / ${stats.total} 件を達成`
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
  /** A habit is only "on" for days inside its own lifetime. Without the endDate
   *  bound a finished habit keeps accruing scheduled days forever: its completion
   *  rate erodes a little every day, the days after it ended read as missed, and
   *  they stay clickable in the calendar long after the record should be final. */
  function isHabitScheduled(habit, dateStr) {
    if (dateStr < habit.startDate) return false;
    if (habit.endDate && dateStr > habit.endDate) return false;
    const dow = new Date(dateStr + 'T00:00:00').getDay();
    return isScheduledDay(habit.frequency, dow);
  }

  /** The last day this habit was live — its end date once finished, otherwise
   *  today. Bounds the history scans below so a habit ended years ago isn't
   *  walked day by day up to the present on every render. */
  function lastActiveDay(habit) {
    const today = todayStr();
    return habit.endDate && habit.endDate < today ? habit.endDate : today;
  }
  function isHabitDone(habit, dateStr) { return habit.completions.includes(dateStr); }

  /** Habits accumulate one completion entry per day they're kept up, so a year-old
   *  habit can have hundreds of entries. Building a Set once turns each day-lookup
   *  below into O(1) instead of Array.includes()'s O(n), which mattered in practice:
   *  a 3-year daily streak took ~200ms per render before this change. */
  function calcCurrentStreak(habit) {
    const done = new Set(habit.completions);
    let streak = 0;
    let cursor = lastActiveDay(habit);
    // Today gets grace — there is still time to tick it off. A finished habit's
    // final day gets none: its record is already closed.
    let isToday = cursor === todayStr();
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
    const end = lastActiveDay(habit);
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
    const end = lastActiveDay(habit);
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
      <span class="streak-chip ${streak === 0 ? 'zero' : ''}">${iconFlame}<strong>${streak}</strong>日連続</span>
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
      check.innerHTML = `<span class="dot-ring">${iconCheck}</span>${done ? '達成' : '未達成'}`;
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
    $('#habitProgressText').textContent = `${stats.done} / ${stats.total} 件を達成`;
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
        <span class="meta-chip">${stats.done} / ${stats.scheduled} 日を達成</span>
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
            <div class="habit-meta"><span class="streak-chip ${streak === 0 ? 'zero' : ''}">${iconFlame}<strong>${streak}</strong>日連続</span></div>
          </div>
        </div>
      `;
      row.querySelector('.habit-name').textContent = h.name;
      row.querySelector('.habit-name').title = h.name;
      const check = document.createElement('button');
      check.className = 'habit-check compact' + (done ? ' done' : '');
      check.innerHTML = `<span class="dot-ring">${iconCheck}</span>${done ? '達成' : '未達成'}`;
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

  /* ---------- Projects ---------- */

  /** Nearest deadline first, then undated newest-first — so what needs attention
   *  sits at the top without any manual ordering. */
  function sortActiveProjects(a, b) {
    if (a.deadline && b.deadline) return a.deadline.localeCompare(b.deadline);
    if (a.deadline) return -1;
    if (b.deadline) return 1;
    return b.createdAt - a.createdAt;
  }

  function createProjectCard(p) {
    const stats = projectStats(p.id);
    const due = projectDeadline(p);
    const isDone = p.status === 'completed';

    const card = document.createElement('div');
    card.className = 'project-card' + (isDone ? ' is-complete' : '');
    card.dataset.id = p.id;

    const icon = document.createElement('div');
    icon.className = 'project-icon';
    icon.innerHTML = projectIconSvg(p);

    const head = document.createElement('div');
    head.className = 'project-card-head';
    const titleWrap = document.createElement('div');
    titleWrap.className = 'project-card-title-wrap';
    const nameEl = document.createElement('div');
    nameEl.className = 'project-card-name';
    nameEl.textContent = p.name;
    const subEl = document.createElement('div');
    subEl.className = 'project-card-sub';
    subEl.textContent = stats.total === 0 ? 'タスクはまだありません' : `${stats.done} / ${stats.total} 件が完了`;
    titleWrap.appendChild(nameEl);
    titleWrap.appendChild(subEl);
    head.appendChild(icon);
    head.appendChild(titleWrap);

    const progress = document.createElement('div');
    progress.className = 'project-card-progress';
    progress.innerHTML = `<div class="project-bar"><div class="project-bar-fill" style="width:${stats.pct}%"></div></div><span class="project-pct">${stats.pct}%</span>`;

    card.appendChild(head);
    card.appendChild(progress);

    const footBits = [];
    if (isDone) {
      const at = p.completedAt ? new Date(p.completedAt + 'T00:00:00').toLocaleDateString('ja-JP', { month: 'short', day: 'numeric' }) : '';
      footBits.push(`<span class="project-foot-chip done">${iconCheck}Completed${at ? ' · ' + escapeHtml(at) : ''}</span>`);
    } else if (due) {
      footBits.push(`<span class="project-foot-chip ${due.tone}">${iconCalendarSmall}Deadline · ${escapeHtml(due.label)}</span>`);
      if (due.note) footBits.push(`<span class="project-foot-note ${due.tone}">${escapeHtml(due.note)}</span>`);
    }
    if (footBits.length) {
      const foot = document.createElement('div');
      foot.className = 'project-card-foot';
      foot.innerHTML = footBits.join('');
      card.appendChild(foot);
    }

    card.addEventListener('click', () => openProjectDetail(p.id));
    return card;
  }

  function renderProjects() {
    const list = $('#list-projects');
    const history = $('#list-projects-history');
    list.innerHTML = '';
    history.innerHTML = '';

    const active = activeProjects().slice().sort(sortActiveProjects);
    const completed = projects.filter(p => p.status === 'completed')
      .sort((a, b) => (b.completedAt || '').localeCompare(a.completedAt || ''));

    if (active.length === 0) {
      const empty = emptyState(iconLayers, 'まだプロジェクトがありません', '大きな目標をプロジェクトとしてまとめてみましょう。');
      // The header's "New project" button is hidden on phones (same as Add task /
      // Add habit), so the empty state carries its own always-visible CTA.
      const cta = document.createElement('button');
      cta.className = 'btn btn-primary empty-cta';
      cta.textContent = '+ New project';
      cta.addEventListener('click', openAddProjectModal);
      empty.appendChild(cta);
      list.appendChild(empty);
    } else {
      active.forEach(p => list.appendChild(createProjectCard(p)));
    }

    if (completed.length === 0) {
      history.appendChild(emptyState(iconLayers, '完了したプロジェクトはありません', 'プロジェクトを完了すると、ここに記録として残ります。'));
    } else {
      completed.forEach(p => history.appendChild(createProjectCard(p)));
    }
  }

  function renderHomeProjects() {
    const card = $('#homeProjectsCard');
    const wrap = $('#homeProjectList');
    const active = activeProjects().slice().sort(sortActiveProjects).slice(0, 3);
    // Home stays a dashboard, not a second Projects page: hidden entirely for
    // anyone not using the feature, and never more than three entries.
    if (active.length === 0) { card.classList.add('hidden'); return; }
    card.classList.remove('hidden');

    wrap.innerHTML = '';
    active.forEach(p => {
      const stats = projectStats(p.id);
      const due = projectDeadline(p);
      const row = document.createElement('button');
      row.className = 'home-project-item';
      row.innerHTML = `
        <span class="home-project-icon">${projectIconSvg(p)}</span>
        <span class="home-project-main">
          <span class="home-project-name"></span>
          <span class="project-bar sm"><span class="project-bar-fill" style="width:${stats.pct}%"></span></span>
        </span>
        <span class="home-project-side">
          <span class="home-project-pct">${stats.pct}%</span>
          ${due ? `<span class="home-project-due ${due.tone}">${escapeHtml(due.label)}</span>` : ''}
        </span>`;
      row.querySelector('.home-project-name').textContent = p.name;
      row.addEventListener('click', () => openProjectDetail(p.id));
      wrap.appendChild(row);
    });
  }

  /* ---------- Project detail ---------- */

  function openProjectDetail(id) {
    currentProjectDetailId = id;
    switchView('project-detail');
    renderProjectDetail();
  }

  function renderProjectDetail() {
    const p = projectById(currentProjectDetailId);
    if (!p) { switchView('projects'); return; }

    const stats = projectStats(p.id);
    const due = projectDeadline(p);
    const isDone = p.status === 'completed';

    $('#projectDetailIcon').innerHTML = projectIconSvg(p);
    $('#projectDetailTitle').textContent = p.name;

    let meta = '';
    if (isDone) {
      const at = p.completedAt ? new Date(p.completedAt + 'T00:00:00').toLocaleDateString('ja-JP', { year: 'numeric', month: 'long', day: 'numeric' }) : '';
      meta += `<span class="meta-chip done-chip">${iconCheck}完了${at ? ' · ' + escapeHtml(at) : ''}</span>`;
    }
    if (p.deadline) {
      const full = new Date(p.deadline + 'T00:00:00').toLocaleDateString('ja-JP', { year: 'numeric', month: 'long', day: 'numeric' });
      meta += `<span class="meta-chip ${due && due.tone === 'overdue' ? 'overdue' : ''}">${iconCalendarSmall}Deadline · ${escapeHtml(full)}</span>`;
      if (due && due.note) meta += `<span class="project-foot-note ${due.tone}">${escapeHtml(due.note)}</span>`;
    }
    $('#projectDetailMeta').innerHTML = meta;

    const desc = $('#projectDetailDesc');
    desc.textContent = p.description || '';
    desc.classList.toggle('hidden', !p.description);

    $('#projectDetailPct').textContent = `${stats.pct}%`;
    $('#projectDetailFill').style.width = `${stats.pct}%`;
    $('#projectDetailCount').textContent = stats.total === 0 ? 'タスクはまだありません' : `${stats.done} / ${stats.total} 件が完了`;

    const completeBtn = $('#projectCompleteBtn');
    completeBtn.title = isDone ? '進行中に戻す' : 'プロジェクトを完了';
    completeBtn.classList.toggle('is-reopen', isDone);
    // All tasks done is a cue to finish the project, never the finish itself —
    // completing stays an explicit act so the two states remain distinguishable.
    completeBtn.classList.toggle('suggest', !isDone && stats.total > 0 && stats.done === stats.total);

    const list = $('#list-project-tasks');
    list.innerHTML = '';
    const own = projectTasks(p.id);
    if (own.length === 0) {
      list.appendChild(emptyState(ICON_CHECK_CIRCLE, 'タスクはまだありません', '「Add task」からこのプロジェクトのタスクを追加しましょう。', true));
    } else {
      const open = own.filter(t => !t.completed)
        .sort((a, b) => (a.date || '9999-99-99').localeCompare(b.date || '9999-99-99'));
      const done = own.filter(t => t.completed);
      open.forEach(t => list.appendChild(createTaskRow(t, { showProject: false })));
      if (done.length) {
        const block = document.createElement('div');
        block.className = 'group-block';
        block.innerHTML = `<div class="group-eyebrow">完了済み（${done.length}）</div>`;
        const inner = document.createElement('div');
        inner.className = 'task-list';
        done.forEach(t => inner.appendChild(createTaskRow(t, { showProject: false })));
        block.appendChild(inner);
        list.appendChild(block);
      }
    }
  }

  /* ---------- Project mutations ---------- */

  function completeProject(id) {
    const p = projectById(id);
    if (!p) return;
    p.status = 'completed';
    p.completedAt = todayStr();
    const ok = saveState();
    renderAll();
    if (ok) showToast('プロジェクトを完了しました。記録はHistoryに残ります。');
  }

  function reopenProject(id) {
    const p = projectById(id);
    if (!p) return;
    p.status = 'active';
    delete p.completedAt;
    const ok = saveState();
    renderAll();
    if (ok) showToast('プロジェクトを進行中に戻しました');
  }

  /** Deleting a project removes the grouping only. Every task it held survives as
   *  an ordinary todo with no project set. */
  function deleteProject(id) {
    projects = projects.filter(p => p.id !== id);
    tasks.forEach(t => { if (t.projectId === id) delete t.projectId; });
    const ok = saveState();
    switchView('projects');
    renderAll();
    if (ok) showToast('プロジェクトを削除しました。タスクはそのまま残っています。');
  }

  $('#projectDetailBack').addEventListener('click', () => switchView('projects'));
  $('#projectEditBtn').addEventListener('click', () => openEditProjectModal(currentProjectDetailId));
  $('#projectCompleteBtn').addEventListener('click', () => {
    const p = projectById(currentProjectDetailId);
    if (!p) return;
    if (p.status === 'completed') { reopenProject(p.id); return; }
    const stats = projectStats(p.id);
    const remaining = stats.total - stats.done;
    const msg = remaining > 0
      ? `「${p.name}」を完了しますか？\n\n未完了のタスクが${remaining}件あります。\nタスクはそのまま残り、Todoとして引き続き使えます。`
      : `「${p.name}」を完了しますか？\n\nActive一覧から外れ、Historyに記録として残ります。`;
    if (confirm(msg)) completeProject(p.id);
  });
  $('#projectDeleteBtn').addEventListener('click', () => {
    const p = projectById(currentProjectDetailId);
    if (!p) return;
    if (confirm('このプロジェクトを削除しますか？\n\nプロジェクトを削除しても、関連するタスクは削除されません。')) {
      deleteProject(p.id);
    }
  });

  $$('#projectViewToggle button').forEach(b => b.addEventListener('click', () => {
    const view = b.dataset.projectView;
    $$('#projectViewToggle button').forEach(btn => btn.classList.toggle('active', btn.dataset.projectView === view));
    $('#list-projects').style.display = view === 'active' ? '' : 'none';
    $('#list-projects-history').style.display = view === 'active' ? 'none' : '';
  }));

  /* ---------- Sidebar / counts ---------- */

  function renderCounts() {
    const today = todayStr();
    $('[data-count="inbox"]').textContent = tasks.filter(t => !t.date && !t.completed).length || '';
    $('[data-count="today"]').textContent = tasks.filter(t => t.date && t.date <= today && !t.completed).length || '';
    $('[data-count="upcoming"]').textContent = tasks.filter(t => t.date && t.date > today && !t.completed).length || '';
    $('[data-count="completed"]').textContent = tasks.filter(t => t.completed).length || '';
    // Reuses the Habits page's own figures rather than re-deriving them: this was
    // the one place that forgot to exclude archived habits, so the badge claimed
    // work that the list itself showed as done and gone.
    const habitStats = getHabitsTodayStats();
    $('[data-count="habits"]').textContent = (habitStats.total - habitStats.done) || '';
    $('[data-count="projects"]').textContent = activeProjects().length || '';
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

  /** Only active projects are offered, plus `keepId` — the project the task being
   *  edited already belongs to — so opening a task inside a finished project and
   *  pressing save can never silently detach it. */
  function populateProjectSelect(sel, keepId) {
    const listed = activeProjects();
    const kept = projectById(keepId);
    if (kept && !listed.includes(kept)) listed.push(kept);
    sel.innerHTML = '<option value="">プロジェクトなし</option>' +
      listed.map(p => `<option value="${escapeHtml(p.id)}">${escapeHtml(p.name)}</option>`).join('');
  }

  function renderAll() {
    renderToday();
    renderTodayHabits();
    renderHomeHabitsSummary();
    renderStreakCard();
    renderHomeUpcoming();
    renderHomeProjects();
    renderInbox();
    renderUpcoming();
    renderCompleted();
    renderProjects();
    renderHabits();
    renderCounts();
    renderCategorySidebar();
    renderCategoryManage();
    // The open project detail is a view onto the same task data, so it refreshes
    // with everything else — completing a task there updates its progress at once.
    if (currentView === 'project-detail') renderProjectDetail();
  }

  /* ---------- Mutations ---------- */

  /** Single creation path for tasks — used by both the full modal and Quick Add. */
  function createTask({ title, date = '', time = '', category = '', priority = 'medium', note = '', projectId = '' }) {
    const task = {
      id: 't' + Date.now() + Math.random().toString(16).slice(2),
      title, date, time, category, note, priority,
      completed: false,
    };
    if (projectId && projectById(projectId)) task.projectId = projectId;
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

  /** The entry point every delete control uses. The trash icon sits right next to
   *  edit and is easy to catch by accident on a phone, and a deleted task has no
   *  undo — habits and projects already confirm, tasks were the one destructive
   *  action that did not. */
  function confirmDeleteTask(id) {
    const t = tasks.find(t => t.id === id);
    if (!t) return;
    const label = t.title.length > 40 ? t.title.slice(0, 40) + '…' : t.title;
    if (confirm(`「${label}」を削除しますか？\n\nこの操作は取り消せません。`)) deleteTask(id);
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
    if (view === 'settings') buildCharacterPicker();
    syncFab();
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
  const projectSelect = $('#taskProjectSelect');
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
    // Adding from inside a project means adding *to* that project — the field is
    // still shown and still editable, just pre-filled with the obvious answer.
    const presetProject = currentView === 'project-detail' ? currentProjectDetailId : '';
    populateProjectSelect(projectSelect, presetProject);
    projectSelect.value = presetProject || '';
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
    populateProjectSelect(projectSelect, t.projectId);
    projectSelect.value = t.projectId || '';
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
  // The header's Add buttons are hidden on phones, so the FAB is the only entry
  // point there — it has to mean "add the thing this view is about". On a project's
  // detail page that thing is still a task, which openAddModal pre-links.
  const fabBtn = $('#fabAdd');
  function fabAction() {
    if (currentView === 'habits' || currentView === 'habit-detail') return { run: openAddHabitModal, label: '習慣を追加' };
    if (currentView === 'projects') return { run: openAddProjectModal, label: 'プロジェクトを追加' };
    return { run: openAddModal, label: 'タスクを追加' };
  }
  function syncFab() { fabBtn.setAttribute('aria-label', fabAction().label); }
  fabBtn.addEventListener('click', () => fabAction().run());
  $('#cancelModalBtn').addEventListener('click', () => closeModal(overlay));
  overlay.addEventListener('click', (e) => { if (e.target === overlay) closeModal(overlay); });

  saveBtn.addEventListener('click', () => {
    const title = nameInput.value.trim();
    if (!title) return;
    if (editingId) {
      const t = tasks.find(t => t.id === editingId);
      t.title = title; t.date = dateInput.value; t.time = timeInput.value;
      t.category = catSelect.value; t.note = noteInput.value; t.priority = currentPriority;
      if (projectSelect.value && projectById(projectSelect.value)) t.projectId = projectSelect.value;
      else delete t.projectId;
      showToast('タスクを更新しました');
    } else {
      createTask({ title, date: dateInput.value, time: timeInput.value, category: catSelect.value, note: noteInput.value, priority: currentPriority, projectId: projectSelect.value });
      showToast('タスクを追加しました');
    }
    saveState();
    closeModal(overlay);
    renderAll();
  });
  // Closes only once the delete is confirmed, so cancelling leaves the task open
  // for editing instead of dropping the user back with nothing changed and no clue.
  deleteBtn.addEventListener('click', () => {
    if (!editingId) return;
    const id = editingId;
    confirmDeleteTask(id);
    if (!tasks.some(t => t.id === id)) closeModal(overlay);
  });

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

  /* ---------- Project modal ---------- */

  const projectOverlay = $('#projectModalOverlay');
  const projectNameInput = $('#projectNameInput');
  const projectDescInput = $('#projectDescInput');
  const projectDeadlineInput = $('#projectDeadlineInput');
  const projectSaveBtn = $('#saveProjectBtn');
  const projectDeleteBtn = $('#deleteProjectBtn');
  let currentProjectIcon = null;

  function renderProjectIconPicker() {
    const wrap = $('#projectIconPicker');
    wrap.innerHTML = '';
    PROJECT_ICON_ORDER.forEach(key => {
      const btn = document.createElement('button');
      btn.type = 'button';
      const isActive = currentProjectIcon === key;
      btn.className = 'icon-swatch' + (isActive ? ' active' : '');
      btn.innerHTML = PROJECT_ICONS[key];
      btn.setAttribute('aria-label', PROJECT_ICON_LABELS[key]);
      btn.setAttribute('aria-pressed', String(isActive));
      // Tapping the active icon clears it — an icon stays genuinely optional.
      btn.addEventListener('click', () => { currentProjectIcon = isActive ? null : key; renderProjectIconPicker(); });
      wrap.appendChild(btn);
    });
  }

  function validateProjectForm() {
    projectSaveBtn.disabled = projectNameInput.value.trim().length === 0;
  }

  function openAddProjectModal() {
    editingProjectId = null;
    projectNameInput.value = '';
    projectDescInput.value = '';
    projectDeadlineInput.value = '';
    currentProjectIcon = null;
    renderProjectIconPicker();
    projectSaveBtn.textContent = '追加';
    projectDeleteBtn.classList.add('hidden');
    validateProjectForm();
    openModal(projectOverlay, projectNameInput);
  }

  function openEditProjectModal(id) {
    const p = projectById(id);
    if (!p) return;
    editingProjectId = id;
    projectNameInput.value = p.name;
    projectDescInput.value = p.description || '';
    projectDeadlineInput.value = p.deadline || '';
    currentProjectIcon = p.icon || null;
    renderProjectIconPicker();
    projectSaveBtn.textContent = '保存';
    projectDeleteBtn.classList.remove('hidden');
    validateProjectForm();
    openModal(projectOverlay, projectNameInput);
  }

  projectNameInput.addEventListener('input', validateProjectForm);
  $('#addProjectBtn').addEventListener('click', openAddProjectModal);
  $('#addProjectTaskBtn').addEventListener('click', openAddModal);
  $('#cancelProjectModalBtn').addEventListener('click', () => closeModal(projectOverlay));
  $('#projectDeadlineClear').addEventListener('click', () => { projectDeadlineInput.value = ''; });
  projectOverlay.addEventListener('click', (e) => { if (e.target === projectOverlay) closeModal(projectOverlay); });

  projectSaveBtn.addEventListener('click', () => {
    const name = projectNameInput.value.trim();
    if (!name) return;
    const description = projectDescInput.value.trim();
    const deadline = DATE_RE.test(projectDeadlineInput.value) ? projectDeadlineInput.value : '';

    if (editingProjectId) {
      const p = projectById(editingProjectId);
      if (!p) return;
      p.name = name;
      p.description = description;
      p.icon = currentProjectIcon;
      if (deadline) p.deadline = deadline; else delete p.deadline;
      showToast('プロジェクトを更新しました');
    } else {
      const p = {
        id: 'p' + Date.now() + Math.random().toString(16).slice(2),
        name, description,
        icon: currentProjectIcon,
        status: 'active',
        createdAt: Date.now(),
      };
      if (deadline) p.deadline = deadline;
      projects.push(p);
      showToast('プロジェクトを作成しました');
    }
    saveState();
    closeModal(projectOverlay);
    renderAll();
  });

  projectDeleteBtn.addEventListener('click', () => {
    if (!editingProjectId) return;
    if (confirm('このプロジェクトを削除しますか？\n\nプロジェクトを削除しても、関連するタスクは削除されません。')) {
      closeModal(projectOverlay);
      deleteProject(editingProjectId);
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
      : habitOverlay.classList.contains('open') ? habitOverlay
      : projectOverlay.classList.contains('open') ? projectOverlay : null;
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

  // The picker shows one portrait per character. Building it during start-up meant
  // every first load fetched all eight — the bulk of the page's weight — for a
  // screen most people open rarely, if ever. It is built the first time Settings
  // becomes visible and behaves normally from then on.
  let characterPickerBuilt = false;

  function renderCharacterSettings() {
    const isFixed = settings.characterMode === 'fixed';
    $$('#characterModeSegmented button').forEach(b =>
      b.classList.toggle('active', b.dataset.charMode === (isFixed ? 'fixed' : 'random')));

    $('#characterModeDesc').textContent = isFixed
      ? '選んだキャラクターがいつも表示されます'
      : `日付に応じて毎日変わります（今日は「${characterLabel(getCharacterKey())}」）`;

    const picker = $('#characterPicker');
    picker.classList.toggle('is-locked', !isFixed);
    if (!characterPickerBuilt) return;

    const selected = getCharacterKey();
    picker.innerHTML = '';
    CHARACTERS.forEach(c => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'character-option char-' + c.key + (isFixed && c.key === selected ? ' selected' : '');
      btn.appendChild(buildCharacterVisual(c.key, { lazy: true }));
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

  /** Runs the first time Settings is shown, which is the point at which the
   *  portraits are actually about to be looked at. */
  function buildCharacterPicker() {
    if (characterPickerBuilt) return;
    characterPickerBuilt = true;
    renderCharacterSettings();
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
  // Deadline reminders were offered in Settings but never actually implemented —
  // no Notification API call existed anywhere — so the control is gone rather than
  // promising something the app does not do. `notifyEnabled` is still read and
  // written by normalizeSettings/saveState, so anyone who already picked a value
  // keeps it for whenever the feature ships.

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
    const data = JSON.stringify({ tasks, habits, projects, settings }, null, 2);
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
        // Backups written before Projects existed simply have no `projects` key.
        const importedProjects = (Array.isArray(parsed.projects) ? parsed.projects : []).map(normalizeProject).filter(Boolean);

        // Cancelling either dialog must never destroy data. Step 1: proceed at all?
        const proceed = confirm(
          `${importedTasks.length}件のタスクと${importedHabits.length}件の習慣` +
          (importedProjects.length ? `、${importedProjects.length}件のプロジェクト` : '') +
          'を読み込みます。\n\nOK: インポートを続ける\nキャンセル: 何もしない'
        );
        if (!proceed) { importFile.value = ''; return; }

        // Step 2: an explicit second OK is required to replace; cancelling merges (non-destructive default).
        const replace = confirm(
          '既存のタスク・習慣をすべて置き換えますか？\n\n' +
          'OK: 置き換える（現在のデータは削除されます）\nキャンセル: 統合する（両方を残します）'
        );
        // dedupeIds may hand a colliding project a fresh id, which would strand the
        // imported tasks still pointing at the old one — so the rewrites are tracked
        // and replayed onto those tasks before anything is committed.
        const remapProjectIds = (projectsBefore, projectsAfter, taskList) => {
          const remap = new Map();
          projectsBefore.forEach((p, i) => { if (projectsAfter[i].id !== p.id) remap.set(p.id, projectsAfter[i].id); });
          if (remap.size) taskList.forEach(t => { if (t.projectId && remap.has(t.projectId)) t.projectId = remap.get(t.projectId); });
        };

        if (replace) {
          const nextProjects = dedupeIds(importedProjects, new Set());
          remapProjectIds(importedProjects, nextProjects, importedTasks);
          projects = nextProjects;
          tasks = pruneDanglingProjectIds(dedupeIds(importedTasks, new Set()), projects);
          habits = dedupeIds(importedHabits, new Set());
          // Preferences (theme/character/notify) only make sense to adopt wholesale,
          // not "merged" with the current ones — so only apply them on replace.
          settings = normalizeSettings(parsed.settings);
        } else {
          const addedProjects = dedupeIds(importedProjects, new Set(projects.map(p => p.id)));
          remapProjectIds(importedProjects, addedProjects, importedTasks);
          projects = projects.concat(addedProjects);
          tasks = pruneDanglingProjectIds(
            tasks.concat(dedupeIds(importedTasks, new Set(tasks.map(t => t.id)))),
            projects
          );
          habits = habits.concat(dedupeIds(importedHabits, new Set(habits.map(h => h.id))));
        }
        const ok = saveState();
        renderAll();
        applyStoredTheme();
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
  renderCharacter();
  renderCharacterSettings();
  renderIconPicker();
  renderProjectIconPicker();
  renderWeekdayPicker();
  populateProjectSelect(projectSelect);
  syncFab();
  renderAll();
  if (dataLoadCorrupted) showToast('保存データの読み込みに失敗したため、新しい状態で開始しました。');
})();
