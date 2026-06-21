// storage.js
// Saves the folder tree, your to-do items, and lightweight UI state (theme,
// last-opened folder, which folders are expanded) in the browser so the app
// feels the same every time you open it. No server required for this version.

const STORAGE_KEYS = {
  tree: 'pm.tree',
  tasks: 'pm.tasks', // { [folderId]: Task[] }
  ui: 'pm.ui',
};

// A Task: { id, text, due (ISO string | null), done, notified, priority }
//   priority: 'high' | 'normal' | 'low'

const DEFAULT_UI = {
  theme: 'dark',
  selectedFolderId: null,
  view: 'dashboard',   // 'dashboard' | 'folder'
  expanded: {},        // { [folderId]: true }
};

function readJSON(key, fallback) {
  const raw = localStorage.getItem(key);
  if (!raw) return typeof fallback === 'function' ? fallback() : fallback;
  try {
    return JSON.parse(raw);
  } catch {
    return typeof fallback === 'function' ? fallback() : fallback;
  }
}

const Storage = {
  loadTree() {
    return readJSON(STORAGE_KEYS.tree, () => structuredClone(DEFAULT_TREE));
  },
  saveTree(tree) {
    localStorage.setItem(STORAGE_KEYS.tree, JSON.stringify(tree));
  },

  loadTasks() {
    return readJSON(STORAGE_KEYS.tasks, {});
  },
  saveTasks(tasks) {
    localStorage.setItem(STORAGE_KEYS.tasks, JSON.stringify(tasks));
  },

  loadUI() {
    return { ...DEFAULT_UI, ...readJSON(STORAGE_KEYS.ui, {}) };
  },
  saveUI(ui) {
    localStorage.setItem(STORAGE_KEYS.ui, JSON.stringify(ui));
  },
};
