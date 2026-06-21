// app.js
// Ties everything together: the file-explorer sidebar, the "Today" dashboard,
// per-folder task lists, search, folder management, theme, and reminders.

// ---- State ------------------------------------------------------------------

const state = {
  tree: Storage.loadTree(),
  tasks: Storage.loadTasks(),     // { [folderId]: Task[] }
  ui: Storage.loadUI(),           // { theme, selectedFolderId, view, expanded }
};

let searchQuery = '';

const PRIORITIES = { high: 0, normal: 1, low: 2 };
const EMOJI_CHOICES = [
  '📁','🌱','💼','🚀','🎯','💕','📚','🏃',
  '💰','👨‍👩‍👧','✅','💡','🗓️','⏰','🧠','📱',
  '📆','🌟','🛒','🎨','🏠','✈️','🍽️','🎵',
  '📝','💪','🐶','☕','❤️','🔧','📈','🎓',
];

const uid = () => Math.random().toString(36).slice(2, 10);
const $ = (sel) => document.querySelector(sel);
const escapeHTML = (s) =>
  String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ---- Persistence ------------------------------------------------------------

function saveTree()  { Storage.saveTree(state.tree); }
function saveTasks() { Storage.saveTasks(state.tasks); }
function saveUI()    { Storage.saveUI(state.ui); }

// Ensure every task has the fields newer code expects (migrates old data).
function migrateTasks() {
  for (const list of Object.values(state.tasks)) {
    for (const t of list) {
      if (t.priority === undefined) t.priority = 'normal';
      if (t.notified === undefined) t.notified = false;
      if (t.recurrence === undefined) t.recurrence = 'none';
      if (t.estimated === undefined) t.estimated = false; // true = AI-suggested due date
    }
  }
}

// Effective "send reminders" setting per folder, with inheritance: a folder uses
// its own `reminders` flag if set, else inherits from its parent, else true.
// Lets reminders be on for to-do folders but off for project-work folders.
function buildReminderMap() {
  const map = {};
  const walk = (nodes, inherited) => {
    for (const node of nodes) {
      const eff = node.reminders === undefined ? inherited : node.reminders;
      map[node.id] = eff;
      if (node.children) walk(node.children, eff);
    }
  };
  walk(state.tree, true);
  return map;
}

function remindersOn(folderId) {
  return buildReminderMap()[folderId] !== false;
}

// ---- Tree helpers -----------------------------------------------------------

function tasksFor(folderId) {
  if (!state.tasks[folderId]) state.tasks[folderId] = [];
  return state.tasks[folderId];
}

function findNode(id, nodes = state.tree) {
  for (const node of nodes) {
    if (node.id === id) return node;
    if (node.children) {
      const found = findNode(id, node.children);
      if (found) return found;
    }
  }
  return null;
}

function pathTo(id, nodes = state.tree, trail = []) {
  for (const node of nodes) {
    const next = [...trail, node];
    if (node.id === id) return next;
    if (node.children) {
      const found = pathTo(id, node.children, next);
      if (found) return found;
    }
  }
  return null;
}

// Find a node's parent array (for delete). Returns the array containing it.
function parentArrayOf(id, nodes = state.tree) {
  for (const node of nodes) {
    if (node.id === id) return nodes;
    if (node.children) {
      const found = parentArrayOf(id, node.children);
      if (found) return found;
    }
  }
  return null;
}

// Open (not done) task count for a folder including its descendants.
function openCount(node) {
  let count = tasksFor(node.id).filter((t) => !t.done).length;
  if (node.children) for (const child of node.children) count += openCount(child);
  return count;
}

// Walk every folder and yield { node, path, tasks } — used by dashboard & search.
function eachFolder(callback, nodes = state.tree, trail = []) {
  for (const node of nodes) {
    const path = [...trail, node];
    callback(node, path, tasksFor(node.id));
    if (node.children) eachFolder(callback, node.children, path);
  }
}

function collectIds(node, acc = []) {
  acc.push(node.id);
  if (node.children) for (const c of node.children) collectIds(c, acc);
  return acc;
}

// ---- Date helpers -----------------------------------------------------------

function startOfToday() { const d = new Date(); d.setHours(0, 0, 0, 0); return d; }
function endOfToday()   { const d = new Date(); d.setHours(23, 59, 59, 999); return d; }

function dueClass(task) {
  if (task.done || !task.due) return '';
  const due = new Date(task.due);
  const now = new Date();
  if (due < now) return 'overdue';
  if ((due - now) / 36e5 <= 24) return 'soon';
  return '';
}

function formatDue(iso) {
  const d = new Date(iso);
  return 'Due ' + d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function sortTasks(a, b) {
  if (a.done !== b.done) return a.done ? 1 : -1;
  if (a.due && b.due && a.due !== b.due) return new Date(a.due) - new Date(b.due);
  if (a.due && !b.due) return -1;
  if (!a.due && b.due) return 1;
  return PRIORITIES[a.priority] - PRIORITIES[b.priority];
}

// ---- Rendering: top-level ---------------------------------------------------

function render() {
  renderSidebar();
  renderMain();
}

function renderMain() {
  const root = $('#main-view');
  root.innerHTML = '';
  if (searchQuery) {
    root.appendChild(renderSearch());
  } else if (state.ui.view === 'folder' && findNode(state.ui.selectedFolderId)) {
    root.appendChild(renderFolder(findNode(state.ui.selectedFolderId)));
  } else {
    root.appendChild(renderDashboard());
  }
}

// ---- Rendering: sidebar -----------------------------------------------------

function renderSidebar() {
  // "Today" pin + its overdue/today badge
  const pin = $('#dashboard-pin');
  pin.classList.toggle('active', !searchQuery && state.ui.view === 'dashboard');
  let dueSoonCount = 0;
  const reminders = buildReminderMap();
  eachFolder((node, path, tasks) => {
    if (reminders[node.id] === false) return; // project work doesn't nag
    for (const t of tasks) {
      if (!t.done && t.due && new Date(t.due) <= endOfToday()) dueSoonCount++;
    }
  });
  $('#dash-badge').textContent = dueSoonCount || '';

  const container = $('#tree');
  container.innerHTML = '';
  for (const node of state.tree) container.appendChild(renderNode(node));
}

function renderNode(node) {
  const wrapper = document.createElement('div');
  wrapper.className = 'tree-folder';

  const row = document.createElement('div');
  row.className = 'row';
  if (!searchQuery && state.ui.view === 'folder' && node.id === state.ui.selectedFolderId) {
    row.classList.add('selected');
  }

  const hasChildren = node.children && node.children.length > 0;
  const isOpen = !!state.ui.expanded[node.id];

  const twisty = document.createElement('span');
  twisty.className = 'twisty' + (isOpen ? ' open' : '');
  twisty.textContent = hasChildren ? '▶' : '';

  const icon = document.createElement('span');
  icon.className = 'row-icon';
  icon.textContent = node.icon || '📁';

  const label = document.createElement('span');
  label.className = 'row-label';
  label.textContent = node.title;

  row.append(twisty, icon, label);

  const count = openCount(node);
  if (count > 0) {
    const badge = document.createElement('span');
    badge.className = 'count-badge';
    badge.textContent = count;
    row.appendChild(badge);
  }

  // Hover actions: add subfolder, rename, delete
  const actions = document.createElement('span');
  actions.className = 'row-actions';
  actions.append(
    actionBtn('➕', 'Add subfolder', (e) => { e.stopPropagation(); addFolder(node); }),
    actionBtn('✏️', 'Rename', (e) => { e.stopPropagation(); renameFolder(node); }),
    actionBtn('🗑', 'Delete', (e) => { e.stopPropagation(); deleteFolder(node); }),
  );
  row.appendChild(actions);

  wrapper.appendChild(row);

  let childrenEl = null;
  if (hasChildren) {
    childrenEl = document.createElement('div');
    childrenEl.className = 'tree-children' + (isOpen ? ' open' : '');
    for (const child of node.children) childrenEl.appendChild(renderNode(child));
    wrapper.appendChild(childrenEl);
  }

  row.addEventListener('click', () => {
    if (hasChildren) {
      state.ui.expanded[node.id] = !state.ui.expanded[node.id];
      saveUI();
    }
    selectFolder(node.id);
  });

  return wrapper;
}

function actionBtn(text, title, onClick) {
  const b = document.createElement('button');
  b.className = 'row-action';
  b.textContent = text;
  b.title = title;
  b.setAttribute('aria-label', title);
  b.addEventListener('click', onClick);
  return b;
}

function toolbarBtn(text, title, onClick, variant = '') {
  const b = document.createElement('button');
  b.className = 'toolbar-btn' + (variant ? ' ' + variant : '');
  b.type = 'button';
  b.textContent = text;
  b.title = title;
  b.addEventListener('click', onClick);
  return b;
}

function selectFolder(folderId) {
  state.ui.selectedFolderId = folderId;
  state.ui.view = 'folder';
  searchQuery = '';
  $('#search').value = '';
  saveUI();
  closeSidebarOnMobile();
  render();
}

// ---- Rendering: dashboard ("Today") ----------------------------------------

function renderDashboard() {
  const frag = document.createElement('div');

  const title = document.createElement('h2');
  title.className = 'view-title';
  title.textContent = '🏠 Today';
  const sub = document.createElement('p');
  sub.className = 'view-sub';
  sub.textContent = new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
  frag.append(title, sub);

  // Gather tasks into buckets
  const overdue = [], today = [], upcoming = [];
  let total = 0, done = 0;
  const weekEnd = new Date(endOfToday().getTime() + 6 * 864e5);

  eachFolder((node, path, tasks) => {
    for (const t of tasks) {
      total++;
      if (t.done) { done++; continue; }
      if (!t.due) continue;
      const due = new Date(t.due);
      const entry = { task: t, node, path };
      if (due < startOfToday()) overdue.push(entry);
      else if (due <= endOfToday()) today.push(entry);
      else if (due <= weekEnd) upcoming.push(entry);
    }
  });
  const byDue = (a, b) => new Date(a.task.due) - new Date(b.task.due);
  overdue.sort(byDue); today.sort(byDue); upcoming.sort(byDue);

  // Progress bar
  const pct = total ? Math.round((done / total) * 100) : 0;
  const prog = document.createElement('div');
  prog.className = 'progress-wrap';
  prog.innerHTML =
    `<div class="progress-head"><span>${done} of ${total} tasks done</span><span>${pct}%</span></div>` +
    `<div class="progress-track"><div class="progress-fill" style="width:${pct}%"></div></div>`;
  frag.appendChild(prog);

  // Nothing scheduled at all?
  if (!overdue.length && !today.length && !upcoming.length) {
    frag.appendChild(emptyState('🎉', total ? "You're all caught up!" : 'No tasks yet',
      total ? 'Nothing due in the next 7 days. Nice work.' : 'Open a folder on the left and add your first to-do.'));
    return frag;
  }

  if (overdue.length)  frag.appendChild(dashboardGroup('Overdue', 'red', overdue));
  if (today.length)    frag.appendChild(dashboardGroup('Due today', 'amber', today));
  if (upcoming.length) frag.appendChild(dashboardGroup('Next 7 days', 'blue', upcoming));

  return frag;
}

function dashboardGroup(label, color, entries) {
  const wrap = document.createElement('div');
  const head = document.createElement('div');
  head.className = 'group-title';
  head.innerHTML = `<span class="dot ${color}"></span>${label} <span style="color:var(--muted);font-weight:600">${entries.length}</span>`;
  wrap.appendChild(head);

  const reminders = buildReminderMap();
  const ul = document.createElement('ul');
  ul.className = 'task-list';
  for (const { task, node } of entries) {
    ul.appendChild(renderTask(task, node.id, {
      showFolder: true,
      folderName: `${node.icon || '📁'} ${node.title}`,
      project: reminders[node.id] === false,
    }));
  }
  wrap.appendChild(ul);
  return wrap;
}

// ---- Rendering: a folder ----------------------------------------------------

function renderFolder(node) {
  const frag = document.createElement('div');

  const trail = pathTo(node.id) || [];
  const crumb = document.createElement('div');
  crumb.className = 'breadcrumb';
  crumb.textContent = trail.map((n) => n.title).join('  ›  ');
  frag.appendChild(crumb);

  const title = document.createElement('h2');
  title.className = 'view-title';
  title.textContent = `${node.icon || '📁'}  ${node.title}`;
  frag.appendChild(title);

  // Folder toolbar — reminders toggle + management (works on touch, no hover)
  const toolbar = document.createElement('div');
  toolbar.className = 'folder-toolbar';
  const on = remindersOn(node.id);
  toolbar.append(
    toolbarBtn(on ? '🔔 Reminders on' : '🔕 Reminders off',
      on ? 'Reminders on — you\'ll be notified when these are due. Tap to turn off (treat as project work).'
         : 'Reminders off — project work, no due-date notifications. Tap to turn on.',
      () => { node.reminders = !on; saveTree(); toast(node.reminders ? '🔔 Reminders on' : '🔕 Reminders off'); render(); },
      on ? 'active' : ''),
    toolbarBtn('⤵ Bulk add', 'Add many tasks at once', () => openBulkAdd(node.id)),
    toolbarBtn('➕ Subfolder', 'Add a sub-folder', () => addFolder(node)),
    toolbarBtn('✏️ Rename', 'Rename this folder', () => renameFolder(node)),
    toolbarBtn('🗑 Delete', 'Delete this folder', () => deleteFolder(node), 'danger'),
  );
  frag.appendChild(toolbar);

  // Add-task form
  const form = document.createElement('form');
  form.className = 'add-task';
  form.innerHTML =
    `<input type="text" class="new-task-text" placeholder="Add something to do…" autocomplete="off" />` +
    `<select class="new-task-prio" aria-label="Priority">
        <option value="normal">Normal</option>
        <option value="high">High</option>
        <option value="low">Low</option>
     </select>` +
    `<input type="datetime-local" class="new-task-due" aria-label="Due date" />` +
    `<select class="new-task-recur" aria-label="Repeat">` +
      RECURRENCE_OPTIONS.map((o) => `<option value="${o.value}">${o.value === 'none' ? '↻ ' + o.label : o.label}</option>`).join('') +
    `</select>` +
    `<button type="submit" class="primary">Add</button>`;
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = form.querySelector('.new-task-text').value.trim();
    if (!text) return;
    const dueVal = form.querySelector('.new-task-due').value;
    tasksFor(node.id).push({
      id: uid(),
      text,
      due: dueVal ? new Date(dueVal).toISOString() : null,
      done: false,
      notified: false,
      estimated: false,
      priority: form.querySelector('.new-task-prio').value,
      recurrence: form.querySelector('.new-task-recur').value,
    });
    saveTasks();
    toast('Task added');
    render();
    // keep focus for fast entry
    requestAnimationFrame(() => $('#main-view .new-task-text')?.focus());
  });
  frag.appendChild(form);

  // Task list
  const items = tasksFor(node.id).slice().sort(sortTasks);
  if (!items.length) {
    frag.appendChild(emptyState('📝', 'Nothing here yet', 'Add your first to-do above.'));
  } else {
    const ul = document.createElement('ul');
    ul.className = 'task-list';
    for (const task of items) ul.appendChild(renderTask(task, node.id));
    frag.appendChild(ul);
  }

  return frag;
}

// ---- Rendering: search ------------------------------------------------------

function renderSearch() {
  const frag = document.createElement('div');
  const title = document.createElement('h2');
  title.className = 'view-title';
  title.textContent = '🔍 Results';
  frag.appendChild(title);

  const q = searchQuery.toLowerCase();
  const matches = [];
  eachFolder((node, path, tasks) => {
    for (const t of tasks) {
      if (t.text.toLowerCase().includes(q)) matches.push({ task: t, node });
    }
  });

  const sub = document.createElement('p');
  sub.className = 'view-sub';
  sub.textContent = `${matches.length} task${matches.length === 1 ? '' : 's'} matching "${searchQuery}"`;
  frag.appendChild(sub);

  if (!matches.length) {
    frag.appendChild(emptyState('🔍', 'No matches', 'Try a different word.'));
    return frag;
  }

  matches.sort((a, b) => sortTasks(a.task, b.task));
  const ul = document.createElement('ul');
  ul.className = 'task-list';
  for (const { task, node } of matches) {
    ul.appendChild(renderTask(task, node.id, { showFolder: true, folderName: `${node.icon || '📁'} ${node.title}` }));
  }
  frag.appendChild(ul);
  return frag;
}

// ---- Rendering: a single task ----------------------------------------------

function renderTask(task, folderId, opts = {}) {
  const li = document.createElement('li');
  li.className = 'task-item' + (task.done ? ' done' : '') +
    (task.priority === 'high' ? ' prio-high' : task.priority === 'low' ? ' prio-low' : '');

  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.checked = task.done;
  checkbox.setAttribute('aria-label', task.done ? 'Mark not done' : 'Mark done');
  checkbox.addEventListener('change', () => {
    // Completing a recurring task with a due date rolls it forward instead.
    if (checkbox.checked && task.recurrence && task.recurrence !== 'none' && task.due) {
      task.due = Recurrence.next(task.due, task.recurrence);
      task.done = false;
      task.notified = false;
      saveTasks();
      toast('↻ Next: ' + new Date(task.due).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }));
      render();
      return;
    }
    task.done = checkbox.checked;
    if (!task.done) task.notified = false;
    saveTasks();
    render();
  });

  const main = document.createElement('div');
  main.className = 'task-main';

  const text = document.createElement('div');
  text.className = 'task-text';
  text.textContent = task.text;
  main.appendChild(text);

  const meta = document.createElement('div');
  meta.className = 'task-meta';
  if (task.due) {
    const due = document.createElement('span');
    due.className = 'task-due ' + dueClass(task) + (task.estimated ? ' estimated' : '');
    due.textContent = (task.estimated ? '~' : '') + formatDue(task.due);
    if (task.estimated) due.title = 'AI-estimated date — edit the task to confirm it';
    meta.appendChild(due);
  }
  if (task.priority === 'high' || task.priority === 'low') {
    const chip = document.createElement('span');
    chip.className = 'prio-chip ' + task.priority;
    chip.textContent = task.priority === 'high' ? '🔺 High' : 'Low';
    meta.appendChild(chip);
  }
  if (task.recurrence && task.recurrence !== 'none') {
    const chip = document.createElement('span');
    chip.className = 'recur-chip';
    chip.textContent = '↻ ' + Recurrence.label(task.recurrence);
    meta.appendChild(chip);
  }
  if (opts.project) {
    const tag = document.createElement('span');
    tag.className = 'project-chip';
    tag.textContent = 'project · no reminders';
    meta.appendChild(tag);
  }
  if (opts.showFolder) {
    const folder = document.createElement('span');
    folder.className = 'task-folder';
    folder.textContent = opts.folderName;
    folder.style.cursor = 'pointer';
    folder.title = 'Open folder';
    folder.addEventListener('click', () => selectFolder(folderId));
    meta.appendChild(folder);
  }
  if (meta.childNodes.length) main.appendChild(meta);

  const actions = document.createElement('div');
  actions.className = 'task-actions';
  actions.append(
    taskBtn('✏️', 'Edit', () => startEditTask(li, task, folderId, opts)),
    taskBtn('🗑', 'Delete', () => {
      state.tasks[folderId] = tasksFor(folderId).filter((t) => t.id !== task.id);
      saveTasks();
      toast('Task deleted');
      render();
    }, true),
  );

  li.append(checkbox, main, actions);
  return li;
}

function taskBtn(text, title, onClick, danger) {
  const b = document.createElement('button');
  b.className = 'task-btn' + (danger ? ' danger' : '');
  b.textContent = text;
  b.title = title;
  b.setAttribute('aria-label', title);
  b.addEventListener('click', onClick);
  return b;
}

// Swap a task row into an inline editor.
function startEditTask(li, task, folderId, opts) {
  li.innerHTML = '';
  const editor = document.createElement('div');
  editor.className = 'task-edit';

  const textInput = document.createElement('input');
  textInput.type = 'text';
  textInput.value = task.text;

  const prio = document.createElement('select');
  prio.innerHTML = `<option value="normal">Normal</option><option value="high">High</option><option value="low">Low</option>`;
  prio.value = task.priority || 'normal';

  const dueInput = document.createElement('input');
  dueInput.type = 'datetime-local';
  if (task.due) dueInput.value = toLocalInput(task.due);

  const recur = document.createElement('select');
  recur.innerHTML = RECURRENCE_OPTIONS.map((o) => `<option value="${o.value}">${o.value === 'none' ? '↻ ' + o.label : o.label}</option>`).join('');
  recur.value = task.recurrence || 'none';

  const save = document.createElement('button');
  save.className = 'primary';
  save.textContent = 'Save';

  const cancel = document.createElement('button');
  cancel.className = 'btn-ghost';
  cancel.textContent = 'Cancel';

  const commit = () => {
    const newText = textInput.value.trim();
    if (!newText) { toast('Task needs a name'); return; }
    task.text = newText;
    task.priority = prio.value;
    task.due = dueInput.value ? new Date(dueInput.value).toISOString() : null;
    task.recurrence = recur.value;
    task.notified = false;
    task.estimated = false; // a hand-set date is confirmed, not an estimate
    saveTasks();
    render();
  };

  save.addEventListener('click', commit);
  cancel.addEventListener('click', () => render());
  textInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') commit();
    if (e.key === 'Escape') render();
  });

  editor.append(textInput, prio, dueInput, recur, save, cancel);
  li.appendChild(editor);
  textInput.focus();
  textInput.select();
}

// Convert an ISO string to the value a <input type=datetime-local> expects.
function toLocalInput(iso) {
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// ---- Folder management ------------------------------------------------------

async function addFolder(parent) {
  const result = await nameModal({ title: parent ? `New folder in “${parent.title}”` : 'New folder' });
  if (!result) return;
  const node = { id: uid(), title: result.name, icon: result.icon, children: [] };
  if (parent) {
    parent.children = parent.children || [];
    parent.children.push(node);
    state.ui.expanded[parent.id] = true;
  } else {
    state.tree.push(node);
  }
  saveTree();
  saveUI();
  toast('Folder added');
  render();
}

async function renameFolder(node) {
  const result = await nameModal({ title: 'Rename folder', name: node.title, icon: node.icon });
  if (!result) return;
  node.title = result.name;
  node.icon = result.icon;
  saveTree();
  toast('Folder renamed');
  render();
}

async function deleteFolder(node) {
  const ids = collectIds(node);
  const taskTotal = ids.reduce((sum, id) => sum + tasksFor(id).length, 0);
  const ok = await confirmModal({
    title: `Delete “${node.title}”?`,
    message: taskTotal
      ? `This also deletes ${taskTotal} task${taskTotal === 1 ? '' : 's'} and any sub-folders. This can't be undone.`
      : `Any sub-folders will be removed too. This can't be undone.`,
    confirmLabel: 'Delete',
  });
  if (!ok) return;

  const arr = parentArrayOf(node.id);
  if (arr) arr.splice(arr.findIndex((n) => n.id === node.id), 1);
  for (const id of ids) {
    delete state.tasks[id];
    delete state.ui.expanded[id];
  }
  if (ids.includes(state.ui.selectedFolderId)) {
    state.ui.selectedFolderId = null;
    state.ui.view = 'dashboard';
  }
  saveTree(); saveTasks(); saveUI();
  toast('Folder deleted');
  render();
}

// ---- Bulk add & AI date estimates -------------------------------------------

// A flat <option> list of every folder, indented by depth.
function folderOptionsHTML(selectedId) {
  const opts = [];
  eachFolder((node, path) => {
    const indent = '— '.repeat(path.length - 1);
    opts.push(`<option value="${node.id}"${node.id === selectedId ? ' selected' : ''}>${indent}${escapeHTML(node.icon || '📁')} ${escapeHTML(node.title)}</option>`);
  });
  return opts.join('');
}

// One pasted line -> { text, priority }. A trailing "!high" / "!low" sets priority.
function parseBulkLine(line) {
  let text = line.trim();
  let priority = 'normal';
  const m = text.match(/\s!(high|h|low|l|med|m|normal|n)\s*$/i);
  if (m) {
    const p = m[1][0].toLowerCase();
    priority = p === 'h' ? 'high' : p === 'l' ? 'low' : 'normal';
    text = text.slice(0, m.index).trim();
  }
  return { text, priority };
}

function openBulkAdd(folderId) {
  const aiReady = AI.configured();
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true">
      <h3>Bulk add tasks</h3>
      <p class="modal-text">One task per line. Add <code>!high</code> or <code>!low</code> at the end of a line to set its priority.</p>
      <textarea class="bulk-text" rows="7" placeholder="Pay the electricity bill !high&#10;Book dentist appointment&#10;Finish chapter 3 of study plan"></textarea>
      <label style="margin-top:12px">Add to folder</label>
      <select class="bulk-folder">${folderOptionsHTML(folderId)}</select>
      <label class="bulk-ai ${aiReady ? '' : 'disabled'}">
        <input type="checkbox" class="bulk-estimate" ${aiReady ? 'checked' : 'disabled'} />
        Let the AI estimate due dates for these
        ${aiReady ? '' : '<span class="muted-note">— connect the Advisor first</span>'}
      </label>
      <div class="modal-actions">
        <button class="btn-ghost m-cancel">Cancel</button>
        <button class="primary m-ok">Add tasks</button>
      </div>
    </div>`;

  const close = () => { overlay.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  document.addEventListener('keydown', onKey);
  overlay.querySelector('.m-cancel').addEventListener('click', close);

  overlay.querySelector('.m-ok').addEventListener('click', async () => {
    const raw = overlay.querySelector('.bulk-text').value;
    const target = overlay.querySelector('.bulk-folder').value;
    const estimate = overlay.querySelector('.bulk-estimate').checked;
    const lines = raw.split('\n').map((l) => l.trim()).filter(Boolean);
    if (!lines.length) { close(); return; }

    const created = [];
    for (const line of lines) {
      const { text, priority } = parseBulkLine(line);
      if (!text) continue;
      const task = { id: uid(), text, due: null, done: false, notified: false, estimated: false, priority, recurrence: 'none' };
      tasksFor(target).push(task);
      created.push(task);
    }
    saveTasks();
    close();
    toast(`Added ${created.length} task${created.length === 1 ? '' : 's'}`);
    selectFolder(target);

    if (estimate && AI.configured() && created.length) {
      await estimateDatesFor(created.filter((t) => !t.due), findNode(target)?.title);
    }
  });

  $('#modal-root').appendChild(overlay);
  overlay.querySelector('.bulk-text').focus();
}

// Turn an estimate's date string (YYYY-MM-DD) into an ISO time (afternoon local).
function parseEstDate(s) {
  const m = /(\d{4})-(\d{2})-(\d{2})/.exec(String(s));
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 17, 0, 0, 0);
  return isNaN(d) ? null : d.toISOString();
}

// Apply AI estimates to tasks that don't already have a (user-set) date.
function applyEstimates(estimates) {
  const byId = {};
  eachFolder((node, path, tasks) => { for (const t of tasks) byId[t.id] = t; });
  let n = 0;
  for (const e of estimates || []) {
    const t = byId[e.id];
    if (t && !t.due) {
      const iso = parseEstDate(e.due);
      if (iso) { t.due = iso; t.estimated = true; t.notified = false; n++; }
    }
  }
  if (n) saveTasks();
  return n;
}

// Ask the AI for due dates for the given tasks and apply them. Returns count.
async function estimateDatesFor(tasks, folderTitle) {
  const items = tasks.filter((t) => !t.due).map((t) => ({ id: t.id, text: t.text, priority: t.priority, folder: folderTitle }));
  if (!items.length) return 0;
  toast('✨ Estimating due dates…');
  try {
    const estimates = await AI.estimateDueDates(items);
    const n = applyEstimates(estimates);
    toast(n ? `📅 Estimated ${n} date${n === 1 ? '' : 's'}` : 'No dates estimated');
    render();
    return n;
  } catch (err) {
    toast('Couldn\'t estimate dates: ' + err.message);
    return 0;
  }
}

// ---- Reusable UI: modal, confirm, toast -------------------------------------

// Name + emoji picker. Resolves to { name, icon } or null if cancelled.
function nameModal({ title, name = '', icon = '📁' }) {
  return new Promise((resolve) => {
    let chosen = icon;
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal" role="dialog" aria-modal="true">
        <h3>${escapeHTML(title)}</h3>
        <label>Name</label>
        <input type="text" class="m-name" maxlength="40" />
        <label style="margin-top:14px">Icon</label>
        <div class="emoji-grid"></div>
        <div class="modal-actions">
          <button class="btn-ghost m-cancel">Cancel</button>
          <button class="primary m-ok">Save</button>
        </div>
      </div>`;

    const grid = overlay.querySelector('.emoji-grid');
    EMOJI_CHOICES.forEach((e) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = e;
      if (e === chosen) b.classList.add('selected');
      b.addEventListener('click', () => {
        chosen = e;
        grid.querySelectorAll('button').forEach((x) => x.classList.remove('selected'));
        b.classList.add('selected');
      });
      grid.appendChild(b);
    });

    const input = overlay.querySelector('.m-name');
    input.value = name;

    const close = (val) => { overlay.remove(); document.removeEventListener('keydown', onKey); resolve(val); };
    const submit = () => {
      const v = input.value.trim();
      if (!v) { input.focus(); return; }
      close({ name: v, icon: chosen });
    };
    const onKey = (e) => { if (e.key === 'Escape') close(null); };

    overlay.querySelector('.m-ok').addEventListener('click', submit);
    overlay.querySelector('.m-cancel').addEventListener('click', () => close(null));
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(null); });
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
    document.addEventListener('keydown', onKey);

    $('#modal-root').appendChild(overlay);
    input.focus();
  });
}

function confirmModal({ title, message, confirmLabel = 'Confirm' }) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal" role="dialog" aria-modal="true">
        <h3>${escapeHTML(title)}</h3>
        <p class="modal-text">${escapeHTML(message)}</p>
        <div class="modal-actions">
          <button class="btn-ghost m-cancel">Cancel</button>
          <button class="btn-danger m-ok">${confirmLabel}</button>
        </div>
      </div>`;
    const close = (val) => { overlay.remove(); document.removeEventListener('keydown', onKey); resolve(val); };
    const onKey = (e) => { if (e.key === 'Escape') close(false); };
    overlay.querySelector('.m-ok').addEventListener('click', () => close(true));
    overlay.querySelector('.m-cancel').addEventListener('click', () => close(false));
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(false); });
    document.addEventListener('keydown', onKey);
    $('#modal-root').appendChild(overlay);
    overlay.querySelector('.m-ok').focus();
  });
}

function toast(message) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = message;
  $('#toast-root').appendChild(el);
  setTimeout(() => {
    el.style.transition = 'opacity .25s';
    el.style.opacity = '0';
    setTimeout(() => el.remove(), 250);
  }, 2200);
}

function emptyState(big, title, text) {
  const el = document.createElement('div');
  el.className = 'empty-state';
  el.innerHTML = `<div class="big">${big}</div><div style="font-size:17px;font-weight:600;margin-bottom:6px">${title}</div><div>${text}</div>`;
  return el;
}

// ---- Theme ------------------------------------------------------------------

function applyTheme() {
  document.documentElement.setAttribute('data-theme', state.ui.theme);
  $('#theme-toggle').textContent = state.ui.theme === 'dark' ? '🌙' : '☀️';
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', state.ui.theme === 'dark' ? '#1b2231' : '#ffffff');
}

function toggleTheme() {
  state.ui.theme = state.ui.theme === 'dark' ? 'light' : 'dark';
  saveUI();
  applyTheme();
}

// ---- Notifications ----------------------------------------------------------

async function enableNotifications() {
  const result = await Notifications.requestPermission();
  const btn = $('#enable-notifications');
  if (result === 'granted') {
    btn.textContent = '🔔 On';
    btn.classList.add('enabled');
    Notifications.send('Reminders on', "You'll be notified when tasks are due.");
  } else if (result === 'unsupported') {
    toast('Notifications not supported in this browser');
  } else {
    toast('Notifications blocked — enable them in browser settings');
  }
}

function runDueCheck() {
  const titleMap = {};
  eachFolder((node) => { titleMap[node.id] = node.title; });
  Notifications.checkDueTasks(state.tasks, titleMap, buildReminderMap());
}

// ---- Sidebar (mobile) -------------------------------------------------------

function closeSidebarOnMobile() {
  if (window.innerWidth <= 760) $('#sidebar').classList.remove('open');
}

// ---- Init -------------------------------------------------------------------

function init() {
  migrateTasks();
  applyTheme();
  render();

  // Search (debounced-ish: render on each input is fine for local data)
  $('#search').addEventListener('input', (e) => {
    searchQuery = e.target.value.trim();
    renderMain();
    renderSidebar();
  });

  $('#dashboard-pin').addEventListener('click', () => {
    state.ui.view = 'dashboard';
    state.ui.selectedFolderId = null;
    searchQuery = '';
    $('#search').value = '';
    saveUI();
    closeSidebarOnMobile();
    render();
  });

  $('#add-root-folder').addEventListener('click', () => addFolder(null));
  $('#advisor-btn').addEventListener('click', openAdvisor);
  $('#theme-toggle').addEventListener('click', toggleTheme);
  $('#enable-notifications').addEventListener('click', enableNotifications);
  $('#menu-toggle').addEventListener('click', () => $('#sidebar').classList.toggle('open'));

  if (Notifications.supported() && Notification.permission === 'granted') {
    const btn = $('#enable-notifications');
    btn.textContent = '🔔 On';
    btn.classList.add('enabled');
  }

  runDueCheck();
  setInterval(runDueCheck, 60 * 1000);

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('service-worker.js').catch(() => {});
  }
}

document.addEventListener('DOMContentLoaded', init);
