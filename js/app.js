// app.js
// Ties everything together: renders the file-explorer tree, shows a folder's
// to-do items, handles adding/completing/deleting, and runs the notification check.

let tree = Storage.loadTree();
let tasks = Storage.loadTasks();         // { [folderId]: Task[] }
let selectedFolderId = null;

// --- helpers -----------------------------------------------------------------

// Build a flat lookup of folderId -> title so notifications can name the folder.
function buildFolderTitleMap(nodes, map = {}) {
  for (const node of nodes) {
    map[node.id] = node.title;
    if (node.children) buildFolderTitleMap(node.children, map);
  }
  return map;
}

function tasksFor(folderId) {
  if (!tasks[folderId]) tasks[folderId] = [];
  return tasks[folderId];
}

// Count open (not done) tasks within a folder and all its descendants.
function openCount(node) {
  let count = tasksFor(node.id).filter(t => !t.done).length;
  if (node.children) for (const child of node.children) count += openCount(child);
  return count;
}

function findNode(nodes, id) {
  for (const node of nodes) {
    if (node.id === id) return node;
    if (node.children) {
      const found = findNode(node.children, id);
      if (found) return found;
    }
  }
  return null;
}

// Path of titles from root to the given folder, for the breadcrumb.
function pathTo(nodes, id, trail = []) {
  for (const node of nodes) {
    const next = [...trail, node];
    if (node.id === id) return next;
    if (node.children) {
      const found = pathTo(node.children, id, next);
      if (found) return found;
    }
  }
  return null;
}

const uid = () => Math.random().toString(36).slice(2, 10);

// --- tree (file explorer) ----------------------------------------------------

function renderTree() {
  const container = document.getElementById('tree');
  container.innerHTML = '';
  for (const node of tree) container.appendChild(renderNode(node));
}

function renderNode(node) {
  const wrapper = document.createElement('div');
  wrapper.className = 'tree-folder';

  const row = document.createElement('div');
  row.className = 'row';
  if (node.id === selectedFolderId) row.classList.add('selected');

  const hasChildren = node.children && node.children.length > 0;

  const twisty = document.createElement('span');
  twisty.className = 'twisty';
  twisty.textContent = hasChildren ? '▶' : '';

  const icon = document.createElement('span');
  icon.textContent = node.icon || '📁';

  const label = document.createElement('span');
  label.textContent = node.title;

  row.append(twisty, icon, label);

  const count = openCount(node);
  if (count > 0) {
    const badge = document.createElement('span');
    badge.className = 'count-badge';
    badge.textContent = count;
    row.appendChild(badge);
  }

  wrapper.appendChild(row);

  let childrenEl = null;
  if (hasChildren) {
    childrenEl = document.createElement('div');
    childrenEl.className = 'tree-children';
    for (const child of node.children) childrenEl.appendChild(renderNode(child));
    wrapper.appendChild(childrenEl);
  }

  row.addEventListener('click', () => {
    // Toggle expand/collapse for folders that have children…
    if (hasChildren && childrenEl) {
      const open = childrenEl.classList.toggle('open');
      twisty.classList.toggle('open', open);
    }
    // …and always select the folder to show its tasks.
    selectFolder(node.id);
  });

  return wrapper;
}

// --- folder content (tasks) --------------------------------------------------

function selectFolder(folderId) {
  selectedFolderId = folderId;
  closeSidebarOnMobile();
  renderTree();   // refresh selection highlight + counts
  renderContent();
}

function renderContent() {
  const titleEl = document.getElementById('folder-title');
  const breadcrumbEl = document.getElementById('breadcrumb');
  const form = document.getElementById('add-task-form');
  const list = document.getElementById('task-list');
  const hint = document.getElementById('empty-hint');

  list.innerHTML = '';

  if (!selectedFolderId) {
    titleEl.textContent = 'Select a folder';
    breadcrumbEl.textContent = '';
    form.hidden = true;
    hint.textContent = 'Pick a folder on the left to see and add things to do.';
    return;
  }

  const node = findNode(tree, selectedFolderId);
  const trail = pathTo(tree, selectedFolderId) || [];
  breadcrumbEl.textContent = trail.map(n => n.title).join('  ›  ');
  titleEl.textContent = `${node.icon || '📁'}  ${node.title}`;
  form.hidden = false;

  const items = tasksFor(selectedFolderId)
    .slice()
    .sort(sortTasks);

  if (items.length === 0) {
    hint.textContent = 'Nothing here yet. Add your first to-do above.';
  } else {
    hint.textContent = '';
    for (const task of items) list.appendChild(renderTask(task));
  }
}

// Open tasks first (soonest due first), done tasks last.
function sortTasks(a, b) {
  if (a.done !== b.done) return a.done ? 1 : -1;
  if (a.due && b.due) return new Date(a.due) - new Date(b.due);
  if (a.due) return -1;
  if (b.due) return 1;
  return 0;
}

function renderTask(task) {
  const li = document.createElement('li');
  li.className = 'task-item' + (task.done ? ' done' : '');

  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.checked = task.done;
  checkbox.addEventListener('change', () => {
    task.done = checkbox.checked;
    persist();
    renderTree();
    renderContent();
  });

  const main = document.createElement('div');
  main.className = 'task-main';

  const text = document.createElement('div');
  text.className = 'task-text';
  text.textContent = task.text;
  main.appendChild(text);

  if (task.due) {
    const due = document.createElement('div');
    due.className = 'task-due ' + dueClass(task);
    due.textContent = formatDue(task.due);
    main.appendChild(due);
  }

  const del = document.createElement('button');
  del.className = 'delete-btn';
  del.textContent = '🗑';
  del.title = 'Delete';
  del.addEventListener('click', () => {
    tasks[selectedFolderId] = tasksFor(selectedFolderId).filter(t => t.id !== task.id);
    persist();
    renderTree();
    renderContent();
  });

  li.append(checkbox, main, del);
  return li;
}

function dueClass(task) {
  if (task.done) return '';
  const due = new Date(task.due);
  const now = new Date();
  if (due < now) return 'overdue';
  const hoursLeft = (due - now) / 36e5;
  if (hoursLeft <= 24) return 'soon';
  return '';
}

function formatDue(iso) {
  const d = new Date(iso);
  const opts = { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' };
  return 'Due ' + d.toLocaleString(undefined, opts);
}

// --- actions -----------------------------------------------------------------

function handleAddTask(event) {
  event.preventDefault();
  const input = document.getElementById('task-input');
  const dueInput = document.getElementById('task-due');
  const textValue = input.value.trim();
  if (!textValue || !selectedFolderId) return;

  tasksFor(selectedFolderId).push({
    id: uid(),
    text: textValue,
    due: dueInput.value ? new Date(dueInput.value).toISOString() : null,
    done: false,
    notified: false,
  });

  input.value = '';
  dueInput.value = '';
  persist();
  renderTree();
  renderContent();
}

function persist() {
  Storage.saveTasks(tasks);
}

// --- notifications -----------------------------------------------------------

async function enableNotifications() {
  const result = await Notifications.requestPermission();
  const btn = document.getElementById('enable-notifications');
  if (result === 'granted') {
    btn.textContent = '🔔 Notifications on';
    btn.classList.add('enabled');
    Notifications.send('Notifications enabled', "You'll be reminded when tasks are due.");
  } else if (result === 'unsupported') {
    btn.textContent = '🔕 Not supported here';
  } else {
    btn.textContent = '🔔 Notifications blocked';
  }
}

function runDueCheck() {
  const titleMap = buildFolderTitleMap(tree);
  Notifications.checkDueTasks(tasks, titleMap);
}

// --- sidebar (mobile) --------------------------------------------------------

function closeSidebarOnMobile() {
  if (window.innerWidth <= 720) {
    document.getElementById('sidebar').classList.remove('open');
  }
}

// --- init --------------------------------------------------------------------

function init() {
  renderTree();
  renderContent();

  document.getElementById('add-task-form').addEventListener('submit', handleAddTask);
  document.getElementById('enable-notifications').addEventListener('click', enableNotifications);
  document.getElementById('menu-toggle').addEventListener('click', () => {
    document.getElementById('sidebar').classList.toggle('open');
  });

  // Reflect existing notification permission on load.
  if (Notifications.supported() && Notification.permission === 'granted') {
    const btn = document.getElementById('enable-notifications');
    btn.textContent = '🔔 Notifications on';
    btn.classList.add('enabled');
  }

  // Check for due tasks now and then every minute while the app is open.
  runDueCheck();
  setInterval(runDueCheck, 60 * 1000);

  // Register the service worker so the app is installable / works offline.
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('service-worker.js').catch(() => {});
  }
}

document.addEventListener('DOMContentLoaded', init);
