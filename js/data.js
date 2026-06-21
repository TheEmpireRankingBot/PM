// data.js
// The "main titles" of the app — the top-level folders of the file explorer.
// Each node can have children (sub-folders). Leaf folders hold your to-do items.
// This is just the default structure; the user can rename/add folders later and
// the changes are saved to the browser (see storage.js).

const DEFAULT_TREE = [
  {
    id: 'life',
    title: 'Life',
    icon: '🌱',
    children: [
      { id: 'girlfriend',      title: 'Girlfriend',        icon: '💕' },
      { id: 'study-plans',     title: 'Study Plans',       icon: '📚' },
      { id: 'health',          title: 'Health & Fitness',  icon: '🏃' },
      { id: 'finances',        title: 'Finances',          icon: '💰' },
      { id: 'family-friends',  title: 'Family & Friends',  icon: '👨‍👩‍👧' },
    ],
  },
  {
    id: 'work',
    title: 'Work',
    icon: '💼',
    children: [
      { id: 'tasks',        title: 'Tasks',        icon: '✅' },
      { id: 'innovations',  title: 'Innovations',  icon: '💡', reminders: false },
      { id: 'meetings',     title: 'Meetings',     icon: '🗓️' },
      { id: 'deadlines',    title: 'Deadlines',    icon: '⏰' },
    ],
  },
  {
    id: 'personal-projects',
    title: 'Personal Projects',
    icon: '🚀',
    // Project work is tracked but not nagged about — reminders off (inherited by
    // children). Flip it per-folder in the app. "Reminders are for tasks I need
    // to do, not for my project work."
    reminders: false,
    children: [
      { id: 'pm-app',        title: 'Project Manager App', icon: '📱' },
      { id: 'ideas-backlog', title: 'Ideas Backlog',       icon: '🧠' },
    ],
  },
  {
    id: 'goals',
    title: 'Goals',
    icon: '🎯',
    children: [
      { id: 'short-term', title: 'Short Term', icon: '📆' },
      { id: 'long-term',  title: 'Long Term',  icon: '🌟' },
    ],
  },
];
