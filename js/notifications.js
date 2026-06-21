// notifications.js
// Sends notifications to your device for tasks that are due or overdue.
//
// This first version uses the browser Notification API, which works while the
// app is open (or running in the background on your phone's browser). True
// "push when the app is fully closed" needs a small push server + the service
// worker's push event — that's the planned next step (see README).

const Notifications = {
  supported() {
    return 'Notification' in window;
  },

  async requestPermission() {
    if (!this.supported()) return 'unsupported';
    if (Notification.permission === 'granted') return 'granted';
    return await Notification.requestPermission();
  },

  send(title, body) {
    if (!this.supported() || Notification.permission !== 'granted') return;
    new Notification(title, {
      body,
      icon: 'icons/icon.svg',
      badge: 'icons/icon.svg',
    });
  },

  // Scan every folder's tasks and notify about anything due today or overdue
  // that we haven't already notified about. Marks tasks as notified so you
  // don't get pinged repeatedly for the same thing.
  checkDueTasks(tasksByFolder, folderTitleById) {
    if (!this.supported() || Notification.permission !== 'granted') return;

    const now = new Date();
    let changed = false;

    for (const [folderId, tasks] of Object.entries(tasksByFolder)) {
      for (const task of tasks) {
        if (task.done || task.notified || !task.due) continue;

        const due = new Date(task.due);
        // Notify when due time has arrived (or passed).
        if (due <= now) {
          const where = folderTitleById[folderId] || 'Tasks';
          this.send(`Due: ${task.text}`, `In ${where}`);
          task.notified = true;
          changed = true;
        }
      }
    }

    if (changed) Storage.saveTasks(tasksByFolder);
  },
};
