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

- File-explorer sidebar with expandable folders and open-task counts.
- Add / complete / delete to-do items per folder, each with an optional due date.
- Overdue and due-soon items are colour-coded.
- Everything is saved in your browser (localStorage) — no account needed.
- Click **🔔 Enable notifications** to get a device notification when a task is due
  (works while the app is open or backgrounded).
- Installable & works offline (PWA: `manifest.webmanifest` + `service-worker.js`).

## Planned next steps

1. **Background push** — notify even when the app is fully closed. Needs a small
   push server (Web Push + VAPID keys) and a `push` handler in the service worker.
2. **Edit folders from the UI** — add/rename/reorder folders without touching code.
3. **Sync across devices** — optional backend so your data follows you.
4. **Recurring tasks & calendar view.**

## Project layout

```
index.html              App shell / markup
css/styles.css          Styling (dark theme, responsive)
js/data.js              Default folder structure — the "main titles"
js/storage.js           Saves tree + tasks to localStorage
js/notifications.js     Device notifications for due tasks
js/app.js               Rendering + interaction logic
manifest.webmanifest    PWA metadata (installable)
service-worker.js       Offline caching (push-ready)
icons/icon.svg          App icon
```
