// storage.js
// Saves the folder tree and your to-do items in the browser (localStorage), so
// nothing is lost when you close the app. No server required for this first version.

const STORAGE_KEYS = {
  tree: 'pm.tree',
  tasks: 'pm.tasks', // { [folderId]: Task[] }
};

// A Task: { id, text, due (ISO date string | null), done (bool), notified (bool) }

const Storage = {
  loadTree() {
    const raw = localStorage.getItem(STORAGE_KEYS.tree);
    if (!raw) return structuredClone(DEFAULT_TREE);
    try {
      return JSON.parse(raw);
    } catch {
      return structuredClone(DEFAULT_TREE);
    }
  },

  saveTree(tree) {
    localStorage.setItem(STORAGE_KEYS.tree, JSON.stringify(tree));
  },

  loadTasks() {
    const raw = localStorage.getItem(STORAGE_KEYS.tasks);
    if (!raw) return {};
    try {
      return JSON.parse(raw);
    } catch {
      return {};
    }
  },

  saveTasks(tasks) {
    localStorage.setItem(STORAGE_KEYS.tasks, JSON.stringify(tasks));
  },
};
