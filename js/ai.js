// ai.js
// AI Advisor — an optional assistant that can see your folders and tasks and
// help you plan, prioritise, and break work down.
//
// Connector: this static app calls the Claude API directly from the browser
// using a key you paste into Advisor settings (stored locally, on your device).
// That requires the `anthropic-dangerous-direct-browser-access` header. It's
// fine for a personal app on your own device; for a shared/production app you'd
// instead route calls through a small backend so the key never reaches the
// browser (see README "Next steps").

const AI_STORAGE_KEY = 'pm.ai';

const AI_DEFAULTS = {
  apiKey: '',
  model: 'claude-opus-4-8', // latest, most capable Claude model
};

const AI_MODELS = [
  { value: 'claude-opus-4-8',   label: 'Claude Opus 4.8 — most capable' },
  { value: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6 — fast & balanced' },
  { value: 'claude-haiku-4-5',  label: 'Claude Haiku 4.5 — quickest & cheapest' },
];

const AI_SYSTEM_PROMPT =
  "You are the user's personal project manager and life assistant, built into their " +
  "PM app. You can see their folders and tasks in the context below. Give concise, " +
  "practical, encouraging advice. When you plan or prioritise, refer to their actual " +
  "tasks and due dates by name. Prefer short paragraphs and tight bullet lists. " +
  "If something is overdue, gently flag it. Keep replies focused — don't pad.";

const AI_QUICK_PROMPTS = [
  { label: '🗓️ Plan my day', text: 'Plan my day. What should I focus on, in what order?' },
  { label: '🎯 What to prioritise', text: 'Given everything on my plate, what are the 3 most important things to do next and why?' },
  { label: '📅 Plan my week', text: 'Help me lay out a realistic plan for the next 7 days across my folders.' },
  { label: '🧩 Break down a project', text: 'Pick the biggest or vaguest item I have and break it into small, concrete next steps.' },
];

let aiMessages = []; // in-memory conversation for the current session

const AI = {
  loadConfig() {
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem(AI_STORAGE_KEY)) || {}; } catch { saved = {}; }
    return { ...AI_DEFAULTS, ...saved };
  },
  saveConfig(cfg) {
    localStorage.setItem(AI_STORAGE_KEY, JSON.stringify(cfg));
  },
  configured() {
    return !!this.loadConfig().apiKey;
  },

  // A compact, readable snapshot of all folders and their open tasks.
  buildContext() {
    const lines = [];
    const now = new Date();
    eachFolder((node, path, tasks) => {
      const open = tasks.filter((t) => !t.done);
      if (!open.length) return;
      lines.push(`\n## ${path.map((n) => n.title).join(' › ')}`);
      for (const t of open) {
        const bits = [];
        if (t.due) {
          const due = new Date(t.due);
          const when = due.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
          bits.push(due < now ? `OVERDUE (was due ${when})` : `due ${when}`);
        }
        if (t.priority && t.priority !== 'normal') bits.push(`${t.priority} priority`);
        if (t.recurrence && t.recurrence !== 'none') bits.push(`repeats ${t.recurrence}`);
        lines.push(`- ${t.text}${bits.length ? ' (' + bits.join(', ') + ')' : ''}`);
      }
    });
    const today = now.toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    return `Today is ${today}.\n` +
      (lines.length ? `Here are the user's open tasks by folder:${lines.join('\n')}` : 'The user has no open tasks yet.');
  },

  // Send the conversation to Claude and return the assistant's reply text.
  async ask(messages) {
    const cfg = this.loadConfig();
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': cfg.apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: cfg.model,
        max_tokens: 1024,
        system: AI_SYSTEM_PROMPT + '\n\n' + this.buildContext(),
        messages,
      }),
    });

    if (!res.ok) {
      let detail = `HTTP ${res.status}`;
      try {
        const err = await res.json();
        detail = err.error?.message || detail;
      } catch { /* keep status */ }
      if (res.status === 401) detail = 'Your API key was rejected. Check it in Advisor settings.';
      throw new Error(detail);
    }

    const data = await res.json();
    return (data.content || [])
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('\n')
      .trim();
  },

  // Ask Claude for JSON matching a schema (structured outputs).
  async requestJSON(userText, schema, system) {
    const cfg = this.loadConfig();
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': cfg.apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: cfg.model,
        max_tokens: 1024,
        system: system || '',
        messages: [{ role: 'user', content: userText }],
        output_config: { format: { type: 'json_schema', schema } },
      }),
    });
    if (!res.ok) {
      let detail = `HTTP ${res.status}`;
      try { detail = (await res.json()).error?.message || detail; } catch { /* keep */ }
      if (res.status === 401) detail = 'Your API key was rejected. Check it in Advisor settings.';
      throw new Error(detail);
    }
    const data = await res.json();
    const text = (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
    try {
      return JSON.parse(text);
    } catch {
      const m = text.match(/\{[\s\S]*\}/);
      if (m) return JSON.parse(m[0]);
      throw new Error('Unexpected response from the model');
    }
  },

  // Estimate due dates for tasks. items: [{ id, text, priority, folder }].
  // Returns [{ id, due }] with due as YYYY-MM-DD.
  async estimateDueDates(items) {
    const today = new Date().toISOString().slice(0, 10);
    const lines = items.map((i) =>
      `- id:${i.id} — ${i.text}` +
      (i.priority && i.priority !== 'normal' ? ` [${i.priority} priority]` : '') +
      (i.folder ? ` (folder: ${i.folder})` : '')
    ).join('\n');
    const userText =
      `Today is ${today}. Estimate a realistic target completion date for each task below ` +
      `(format YYYY-MM-DD, today or later). Weigh priority and typical effort, and spread them ` +
      `out sensibly rather than stacking everything on one day. Return exactly one entry per id.\n\n${lines}`;
    const schema = {
      type: 'object', additionalProperties: false, required: ['estimates'],
      properties: {
        estimates: {
          type: 'array',
          items: {
            type: 'object', additionalProperties: false, required: ['id', 'due'],
            properties: { id: { type: 'string' }, due: { type: 'string' } },
          },
        },
      },
    };
    const data = await this.requestJSON(userText, schema, 'You are a planning assistant that assigns realistic task due dates.');
    return data.estimates || [];
  },
};

// ---- Advisor UI -------------------------------------------------------------

// Tiny markdown: escape, then **bold** and line breaks.
function aiFormat(text) {
  return escapeHTML(text)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\n/g, '<br>');
}

function openAdvisor() {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  const panel = document.createElement('div');
  panel.className = 'advisor';
  overlay.appendChild(panel);

  const close = () => { overlay.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  document.addEventListener('keydown', onKey);

  renderAdvisor(panel, close);
  $('#modal-root').appendChild(overlay);
}

function renderAdvisor(panel, close) {
  if (!AI.configured()) { renderAdvisorSettings(panel, close); return; }

  panel.innerHTML = `
    <div class="advisor-head">
      <span class="advisor-title">✨ AI Advisor</span>
      <button class="task-btn" data-act="settings" title="Settings">⚙️</button>
      <button class="task-btn" data-act="close" title="Close">✕</button>
    </div>
    <div class="advisor-messages"></div>
    <div class="advisor-quick"></div>
    <form class="advisor-compose">
      <textarea rows="1" placeholder="Ask your advisor…" aria-label="Message"></textarea>
      <button type="submit" class="primary">Send</button>
    </form>`;

  panel.querySelector('[data-act="close"]').addEventListener('click', close);
  panel.querySelector('[data-act="settings"]').addEventListener('click', () => renderAdvisorSettings(panel, close));

  const messagesEl = panel.querySelector('.advisor-messages');
  const quickEl = panel.querySelector('.advisor-quick');
  const form = panel.querySelector('.advisor-compose');
  const input = form.querySelector('textarea');

  const renderMessages = () => {
    messagesEl.innerHTML = '';
    if (!aiMessages.length) {
      messagesEl.innerHTML = `<div class="advisor-hint">I can see your folders and tasks. Ask me to plan your day, prioritise, or break something down.</div>`;
    }
    for (const m of aiMessages) {
      const row = document.createElement('div');
      row.className = 'advisor-msg ' + m.role;
      row.innerHTML = aiFormat(m.content);
      messagesEl.appendChild(row);
    }
    messagesEl.scrollTop = messagesEl.scrollHeight;
  };

  const send = async (text) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    aiMessages.push({ role: 'user', content: trimmed });
    input.value = '';
    renderMessages();

    const thinking = document.createElement('div');
    thinking.className = 'advisor-msg assistant thinking';
    thinking.textContent = 'Thinking…';
    messagesEl.appendChild(thinking);
    messagesEl.scrollTop = messagesEl.scrollHeight;
    form.querySelector('button').disabled = true;

    try {
      const reply = await AI.ask(aiMessages);
      aiMessages.push({ role: 'assistant', content: reply || '(no response)' });
    } catch (err) {
      aiMessages.push({ role: 'assistant', content: '⚠️ ' + err.message });
    } finally {
      form.querySelector('button').disabled = false;
      renderMessages();
    }
  };

  // Action chip: estimate due dates (does work, not just chat).
  const estimateAction = async () => {
    const items = [];
    eachFolder((node, path, tasks) => {
      for (const t of tasks) {
        if (!t.done && !t.due) items.push({ id: t.id, text: t.text, priority: t.priority, folder: node.title });
      }
    });
    if (!items.length) {
      aiMessages.push({ role: 'assistant', content: 'All your open tasks already have dates. 👍' });
      renderMessages();
      return;
    }
    aiMessages.push({ role: 'user', content: `Estimate due dates for my ${items.length} undated task${items.length === 1 ? '' : 's'}.` });
    renderMessages();
    const thinking = document.createElement('div');
    thinking.className = 'advisor-msg assistant thinking';
    thinking.textContent = 'Estimating…';
    messagesEl.appendChild(thinking);
    messagesEl.scrollTop = messagesEl.scrollHeight;
    try {
      const estimates = await AI.estimateDueDates(items);
      const n = applyEstimates(estimates);
      render(); // refresh the app behind the panel
      aiMessages.push({ role: 'assistant', content: n
        ? `Done — I set estimated due dates for **${n}** task${n === 1 ? '' : 's'}. They show with a ~ so you know they're estimates; edit any task to confirm or change it.`
        : 'I couldn\'t produce usable dates for those — try again in a moment.' });
    } catch (err) {
      aiMessages.push({ role: 'assistant', content: '⚠️ ' + err.message });
    } finally {
      renderMessages();
    }
  };

  const estimateChip = document.createElement('button');
  estimateChip.type = 'button';
  estimateChip.className = 'quick-chip action-chip';
  estimateChip.textContent = '📅 Estimate due dates';
  estimateChip.addEventListener('click', estimateAction);
  quickEl.appendChild(estimateChip);

  for (const q of AI_QUICK_PROMPTS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'quick-chip';
    b.textContent = q.label;
    b.addEventListener('click', () => send(q.text));
    quickEl.appendChild(b);
  }

  form.addEventListener('submit', (e) => { e.preventDefault(); send(input.value); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(input.value); }
  });

  renderMessages();
  input.focus();
}

function renderAdvisorSettings(panel, close) {
  const cfg = AI.loadConfig();
  panel.innerHTML = `
    <div class="advisor-head">
      <span class="advisor-title">✨ Advisor settings</span>
      <button class="task-btn" data-act="close" title="Close">✕</button>
    </div>
    <div class="advisor-settings">
      <p class="modal-text">Connect your Anthropic API key to enable the AI advisor. It's stored only in this browser, on your device.</p>
      <label>API key</label>
      <input type="password" class="s-key" placeholder="sk-ant-…" autocomplete="off" value="${escapeHTML(cfg.apiKey)}" />
      <label style="margin-top:14px">Model</label>
      <select class="s-model"></select>
      <p class="modal-text" style="margin-top:14px">
        Get a key at <strong>console.anthropic.com</strong> → API Keys.
        Calls are billed to your Anthropic account.
      </p>
      <div class="modal-actions">
        ${cfg.apiKey ? '<button class="btn-ghost" data-act="forget">Remove key</button>' : ''}
        <button class="btn-ghost" data-act="cancel">Cancel</button>
        <button class="primary" data-act="save">Save</button>
      </div>
    </div>`;

  const select = panel.querySelector('.s-model');
  for (const m of AI_MODELS) {
    const opt = document.createElement('option');
    opt.value = m.value; opt.textContent = m.label;
    if (m.value === cfg.model) opt.selected = true;
    select.appendChild(opt);
  }

  panel.querySelector('[data-act="close"]').addEventListener('click', close);
  panel.querySelector('[data-act="cancel"]').addEventListener('click', () => renderAdvisor(panel, close));
  panel.querySelector('[data-act="save"]').addEventListener('click', () => {
    const apiKey = panel.querySelector('.s-key').value.trim();
    AI.saveConfig({ apiKey, model: select.value });
    if (apiKey) toast('Advisor connected');
    renderAdvisor(panel, close);
  });
  const forget = panel.querySelector('[data-act="forget"]');
  if (forget) forget.addEventListener('click', () => {
    AI.saveConfig({ apiKey: '', model: select.value });
    aiMessages = [];
    toast('API key removed');
    renderAdvisor(panel, close);
  });
}
