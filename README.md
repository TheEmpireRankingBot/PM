# PM — Personal Project Manager

A simple, installable web app that organises your life and work like a **file
explorer**: top-level folders branch into sub-folders, and each folder holds the
things you have to do. It reminds you when tasks are due by sending a
**notification to your device**.

## The main titles (top-level folders)

| Folder | Sub-folders |
| --- | --- |
| 🌱 **Life** | Girlfriend, Study Plans, Health & Fitness, Finances, Family & Friends |
| 💼 **Work** | Tasks, Innovations, Meetings, Deadlines |
| 🚀 **Personal Projects** | Project Manager App, Ideas Backlog |
| 🎯 **Goals** | Short Term, Long Term |

These live in `js/data.js` — edit that file to rename, add, or remove folders.

## Run it

No build step. Serve the folder over HTTP (notifications and service workers
need `http://localhost`, not `file://`):

```bash
# from the project root
python3 -m http.server 8000
```

Then open <http://localhost:8000> in your browser. On a phone, open the same URL
and use "Add to Home Screen" to install it as an app.

## What works now

- **🏠 Today dashboard** — one home screen showing everything **Overdue**,
  **Due today**, and in the **Next 7 days** across all folders, plus a progress bar.
  The "Today" badge in the sidebar shows how many items need attention.
- **File-explorer sidebar** with expandable folders and open-task counts.
- **Manage folders in the app** — every folder has a toolbar to **add a sub-folder,
  rename, or delete** it (with an emoji picker), so it works on touch too. No code
  editing needed.
- **Rich tasks** — add / edit / complete / delete to-dos, each with an optional due
  date and a **priority** (High / Normal / Low). Overdue and due-soon items are
  colour-coded; high-priority items get a red flag.
- **Bulk add / import** — paste a whole list at once (one task per line). Add
  `!high` or `!low` to a line to set its priority.
- **Recurring tasks** — set a to-do to repeat **daily, every weekday, weekly, or
  monthly**. Checking it off rolls it forward to its next due date instead of just
  completing it.
- **Reminders are for to-dos, not project work** — each folder has a **🔔 Reminders
  on / 🔕 off** toggle. Project folders (Personal Projects, Innovations) default to
  **off**, so they're tracked but never nag you; the "Today" badge and device
  notifications only count reminder-on folders.
- **✨ AI Advisor** — an optional assistant that can see your folders and tasks and
  help you **plan your day, prioritise, plan your week, or break a project down**.
  It can also **estimate due dates** for undated tasks (shown with a `~`; editing a
  task confirms its date). Connect it with your own Anthropic API key (see below).
- **Search** every task from the top bar.
- **Light / dark theme** toggle, remembered between visits — along with your last
  open folder and which folders are expanded.
- **Device reminders** — tap **🔔 Reminders** to be notified when a to-do is due
  (works while the app is open or backgrounded).
- **Installable & offline** (PWA: `manifest.webmanifest` + `service-worker.js`).
- Everything is saved in your browser (localStorage) — no account needed.

## Connecting the AI Advisor

Tap **✨ Advisor** → **⚙️** and paste an Anthropic API key
(from <https://console.anthropic.com> → API Keys). Pick a model — it defaults to
**Claude Opus 4.8**, the most capable. The advisor then calls the Claude API
directly from your browser, sending a summary of your open tasks as context.

- The key is stored **only in this browser, on your device** (localStorage).
- Calls are billed to your Anthropic account.
- This direct-from-browser setup is great for a personal app on your own device.
  For a shared or production app, route the calls through a small backend so the
  key never reaches the browser (see *Planned next steps*).

Once connected, the advisor can **estimate completion dates**: use **📅 Estimate
due dates** in the advisor, or tick *"Let the AI estimate due dates"* in Bulk add.
It only fills tasks that don't already have a date — anything you set by hand is
left untouched.

## Planned next steps

1. **AI advisor backend** — a tiny proxy so the API key lives on a server, not in
   the browser (the secure setup for a multi-user app).
2. **Background push** — notify even when the app is fully closed. Needs a small
   push server (Web Push + VAPID keys) and a `push` handler in the service worker.
3. **Drag-and-drop** to reorder tasks and folders.
4. **Sync across devices** — optional backend so your data follows you.
5. **Calendar view** of upcoming and recurring tasks.

## Project layout

```
index.html              App shell / markup
css/styles.css          Styling (dark theme, responsive)
js/data.js              Default folder structure — the "main titles"
js/storage.js           Saves tree + tasks to localStorage
js/recurrence.js        Repeating-task options and next-due calculation
js/ai.js                AI Advisor — Claude API connector + chat UI
js/notifications.js     Device notifications for due tasks
js/app.js               Rendering + interaction logic
manifest.webmanifest    PWA metadata (installable)
service-worker.js       Offline caching (push-ready)
icons/icon.svg          App icon
```
