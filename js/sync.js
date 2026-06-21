// sync.js
// Cross-device sync so your tasks and folders ("memory") are the same on every
// device. Backed by a free Supabase project you own.
//
// Privacy: your data is **end-to-end encrypted** with a passphrase before it
// leaves the device (AES-GCM, key derived via PBKDF2). The row is keyed by a
// hash of the passphrase, and the stored blob is ciphertext — so even though the
// app ships Supabase's public "anon" key, nobody can read your tasks without the
// passphrase. Enter the same passphrase on each device to share one memory.
//
// Conflict handling is whole-document last-write-wins: the most recent save
// wins, and other devices pick it up on their next sync (on load, on focus, and
// every ~45s). Fine for one person across devices; not a multi-user merge.

const SYNC_KEY = 'pm.sync';

const Sync = {
  _timer: null,
  _dirtyTimer: null,
  _applyingRemote: false,
  _pulling: false,
  status: 'off', // 'off' | 'syncing' | 'ok' | 'error'

  config() {
    try { return JSON.parse(localStorage.getItem(SYNC_KEY)) || {}; } catch { return {}; }
  },
  saveConfig(cfg) { localStorage.setItem(SYNC_KEY, JSON.stringify(cfg)); },
  configured() {
    const c = this.config();
    return !!(c.url && c.anonKey && c.pass && c.id);
  },
  cryptoReady() {
    return typeof crypto !== 'undefined' && crypto.subtle && typeof TextEncoder !== 'undefined';
  },

  // ---- lifecycle ----
  async connect(url, anonKey, pass) {
    if (!this.cryptoReady()) throw new Error('Sync needs a secure context — open the app over https:// or http://localhost.');
    url = String(url).trim().replace(/\/+$/, '');
    anonKey = String(anonKey).trim();
    pass = String(pass);
    if (!url || !anonKey || !pass) throw new Error('Fill in the project URL, anon key, and a passphrase.');
    const id = await syncId(pass);
    this.saveConfig({ url, anonKey, pass, id, lastSyncedAt: null });
    await this.pullNow();      // adopt existing remote, or seed it with local data
    this.start();
    return true;
  },

  disconnect() {
    clearInterval(this._timer);
    clearTimeout(this._dirtyTimer);
    localStorage.removeItem(SYNC_KEY);
    this.status = 'off';
    this._updateButton();
  },

  start() {
    if (!this.configured()) { this.status = 'off'; this._updateButton(); return; }
    this.pullNow();
    clearInterval(this._timer);
    this._timer = setInterval(() => this.pullNow(), 45000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) this.pullNow(); });
    window.addEventListener('online', () => this.pullNow());
  },

  // Local data changed — push soon (debounced).
  markDirty() {
    if (!this.configured() || this._applyingRemote) return;
    clearTimeout(this._dirtyTimer);
    this._dirtyTimer = setTimeout(() => this.push(), 1500);
  },

  async push() {
    if (!this.configured()) return;
    const cfg = this.config();
    this._setStatus('syncing');
    try {
      const enc = await encryptJSON({ tasks: state.tasks, tree: state.tree, savedAt: Date.now() }, cfg.pass);
      const updatedAt = new Date().toISOString();
      await remotePut(cfg, cfg.id, enc, updatedAt);
      cfg.lastSyncedAt = updatedAt;
      this.saveConfig(cfg);
      this._setStatus('ok');
    } catch (e) {
      this._setStatus('error', e.message);
    }
  },

  async pullNow() {
    if (!this.configured() || this._pulling) return;
    this._pulling = true;
    const cfg = this.config();
    this._setStatus('syncing');
    try {
      const row = await remoteGet(cfg, cfg.id);
      if (!row) {
        await this.push(); // nothing remote yet — seed it
      } else if (!cfg.lastSyncedAt || row.updated_at > cfg.lastSyncedAt) {
        const payload = await decryptJSON(row.data, cfg.pass);
        this._applyRemote(payload);
        cfg.lastSyncedAt = row.updated_at;
        this.saveConfig(cfg);
      }
      this._setStatus('ok');
    } catch (e) {
      this._setStatus('error', e.message);
    } finally {
      this._pulling = false;
    }
  },

  _applyRemote(payload) {
    if (!payload || !Array.isArray(payload.tree) || typeof payload.tasks !== 'object') return;
    this._applyingRemote = true;
    state.tasks = payload.tasks;
    state.tree = payload.tree;
    if (typeof migrateTasks === 'function') migrateTasks();
    saveTasks();
    saveTree();
    this._applyingRemote = false;
    if (typeof render === 'function') render();
  },

  _setStatus(status, msg) {
    this.status = status;
    this._updateButton();
    if (status === 'error' && msg && typeof toast === 'function') toast('Sync: ' + msg);
  },

  _updateButton() {
    const btn = document.getElementById('sync-btn');
    if (!btn) return;
    const glyph = { off: '☁️', syncing: '⏳', ok: '☁️', error: '⚠️' }[this.status] || '☁️';
    btn.textContent = glyph;
    btn.classList.toggle('synced', this.configured() && this.status !== 'error');
    btn.title = !this.configured() ? 'Sync across devices' :
      this.status === 'error' ? 'Sync error — tap for details' :
      this.status === 'syncing' ? 'Syncing…' : 'Synced across devices';
  },
};

// ---- crypto + encoding ------------------------------------------------------

function bytesToB64(bytes) {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}
function b64ToBytes(b64) {
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return arr;
}

async function syncId(pass) {
  const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('pm-sync-v1:' + pass));
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function deriveKey(pass, salt) {
  const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(pass), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

async function encryptJSON(obj, pass) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(pass, salt);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(obj))));
  const packed = new Uint8Array(salt.length + iv.length + ct.length);
  packed.set(salt, 0);
  packed.set(iv, salt.length);
  packed.set(ct, salt.length + iv.length);
  return bytesToB64(packed);
}

async function decryptJSON(b64, pass) {
  const packed = b64ToBytes(b64);
  const salt = packed.slice(0, 16);
  const iv = packed.slice(16, 28);
  const ct = packed.slice(28);
  const key = await deriveKey(pass, salt);
  try {
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
    return JSON.parse(new TextDecoder().decode(pt));
  } catch {
    throw new Error('Could not decrypt — is the passphrase the same on both devices?');
  }
}

// ---- Supabase REST ----------------------------------------------------------

function authHeaders(cfg) {
  return { apikey: cfg.anonKey, Authorization: 'Bearer ' + cfg.anonKey };
}

async function remoteGet(cfg, id) {
  const res = await fetch(`${cfg.url}/rest/v1/pm_state?id=eq.${encodeURIComponent(id)}&select=data,updated_at`, {
    headers: authHeaders(cfg),
  });
  if (!res.ok) throw new Error(await readErr(res, 'read'));
  const rows = await res.json();
  return rows[0] || null;
}

async function remotePut(cfg, id, dataStr, updatedAt) {
  const res = await fetch(`${cfg.url}/rest/v1/pm_state?on_conflict=id`, {
    method: 'POST',
    headers: { ...authHeaders(cfg), 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify([{ id, data: dataStr, updated_at: updatedAt }]),
  });
  if (!res.ok) throw new Error(await readErr(res, 'write'));
}

async function readErr(res, kind) {
  let detail = `HTTP ${res.status}`;
  try { detail = (await res.json()).message || detail; } catch { /* keep */ }
  if (res.status === 404) detail = 'table "pm_state" not found — run the setup SQL in Supabase.';
  if (res.status === 401 || res.status === 403) detail = 'access denied — check the anon key and the table policies.';
  return `${kind} failed: ${detail}`;
}

// ---- Settings UI ------------------------------------------------------------

const SYNC_SQL =
`create table if not exists pm_state (
  id text primary key,
  data text not null,
  updated_at timestamptz not null default now()
);
alter table pm_state enable row level security;
create policy "pm anon read"   on pm_state for select using (true);
create policy "pm anon insert" on pm_state for insert with check (true);
create policy "pm anon update" on pm_state for update using (true) with check (true);`;

function openSync() {
  const cfg = Sync.config();
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true">
      <h3>☁️ Sync across devices</h3>
      <p class="modal-text">Use the same passphrase on each device to share one memory. Your tasks are end-to-end encrypted with it before upload.</p>

      <details class="sync-help">
        <summary>One-time Supabase setup</summary>
        <ol class="sync-steps">
          <li>Create a free project at <strong>supabase.com</strong>.</li>
          <li>Open <strong>SQL Editor</strong> and run this, then press Run:
            <pre class="sync-sql">${escapeHTML(SYNC_SQL)}</pre>
          </li>
          <li>Open <strong>Project Settings → API</strong> and copy the <strong>Project URL</strong> and the <strong>anon public</strong> key.</li>
          <li>Paste them below, pick a passphrase, and Connect. Do the same on your other device.</li>
        </ol>
      </details>

      <label>Supabase project URL</label>
      <input type="text" class="sy-url" placeholder="https://xxxx.supabase.co" value="${escapeHTML(cfg.url || '')}" />
      <label style="margin-top:12px">anon public key</label>
      <input type="password" class="sy-key" placeholder="eyJhbGci…" value="${escapeHTML(cfg.anonKey || '')}" />
      <label style="margin-top:12px">Sync passphrase (same on every device)</label>
      <input type="password" class="sy-pass" placeholder="a phrase only you know" value="${escapeHTML(cfg.pass || '')}" />

      <div class="sync-status"></div>

      <div class="modal-actions">
        ${Sync.configured() ? '<button class="btn-ghost sy-off">Disconnect</button><button class="btn-ghost sy-now">Sync now</button>' : ''}
        <button class="btn-ghost sy-cancel">Close</button>
        <button class="primary sy-connect">${Sync.configured() ? 'Update' : 'Connect'}</button>
      </div>

      <hr class="sync-divider" />
      <p class="modal-text">Backup (works without an account):</p>
      <div class="modal-actions sync-backup">
        <button class="btn-ghost sy-export">⬇️ Export backup</button>
        <button class="btn-ghost sy-import">⬆️ Import backup</button>
      </div>
    </div>`;

  const statusEl = overlay.querySelector('.sync-status');
  const setMsg = (msg, kind) => { statusEl.textContent = msg; statusEl.className = 'sync-status ' + (kind || ''); };
  if (Sync.configured()) setMsg('Connected. Your devices share one memory.', 'ok');

  const close = () => { overlay.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  document.addEventListener('keydown', onKey);
  overlay.querySelector('.sy-cancel').addEventListener('click', close);

  overlay.querySelector('.sy-connect').addEventListener('click', async () => {
    setMsg('Connecting…');
    try {
      await Sync.connect(
        overlay.querySelector('.sy-url').value,
        overlay.querySelector('.sy-key').value,
        overlay.querySelector('.sy-pass').value,
      );
      setMsg('Connected and synced. ✅', 'ok');
      toast('☁️ Sync connected');
      setTimeout(close, 900);
    } catch (e) {
      setMsg(e.message, 'error');
    }
  });

  overlay.querySelector('.sy-off')?.addEventListener('click', () => {
    Sync.disconnect();
    toast('Sync disconnected');
    close();
  });
  overlay.querySelector('.sy-now')?.addEventListener('click', async () => {
    setMsg('Syncing…');
    await Sync.pullNow();
    setMsg(Sync.status === 'error' ? 'Sync failed — check settings.' : 'Synced. ✅', Sync.status === 'error' ? 'error' : 'ok');
  });

  overlay.querySelector('.sy-export').addEventListener('click', exportBackup);
  overlay.querySelector('.sy-import').addEventListener('click', importBackup);

  $('#modal-root').appendChild(overlay);
  overlay.querySelector('.sy-url').focus();
}

// ---- Export / Import (account-free backup) ----------------------------------

function exportBackup() {
  const payload = { app: 'PM', version: 1, exportedAt: new Date().toISOString(), tasks: state.tasks, tree: state.tree };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `pm-backup-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  toast('Backup downloaded');
}

function importBackup() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'application/json,.json';
  input.addEventListener('change', () => {
    const file = input.files && input.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      let data;
      try { data = JSON.parse(reader.result); } catch { toast('That file isn\'t valid JSON'); return; }
      if (!data || !Array.isArray(data.tree) || typeof data.tasks !== 'object') { toast('Not a PM backup'); return; }
      const ok = await confirmModal({
        title: 'Replace everything with this backup?',
        message: 'Your current folders and tasks will be replaced by the backup. This can\'t be undone.',
        confirmLabel: 'Replace',
      });
      if (!ok) return;
      state.tasks = data.tasks;
      state.tree = data.tree;
      if (typeof migrateTasks === 'function') migrateTasks();
      saveTasks();
      saveTree();
      render();
      toast('Backup imported');
      if (Sync.configured()) Sync.push();
    };
    reader.readAsText(file);
  });
  input.click();
}
