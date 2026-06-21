// recurrence.js
// Repeating tasks. A task's `recurrence` is one of the values below; when you
// complete a recurring task it rolls forward to its next due date instead of
// just being marked done.

const RECURRENCE_OPTIONS = [
  { value: 'none',     label: 'Does not repeat' },
  { value: 'daily',    label: 'Daily' },
  { value: 'weekdays', label: 'Every weekday' },
  { value: 'weekly',   label: 'Weekly' },
  { value: 'monthly',  label: 'Monthly' },
];

const Recurrence = {
  label(value) {
    const opt = RECURRENCE_OPTIONS.find((o) => o.value === value);
    return opt ? opt.label : '';
  },

  // Advance a single step.
  step(date, freq) {
    const d = new Date(date);
    switch (freq) {
      case 'daily':
        d.setDate(d.getDate() + 1);
        break;
      case 'weekdays':
        do { d.setDate(d.getDate() + 1); } while (d.getDay() === 0 || d.getDay() === 6);
        break;
      case 'weekly':
        d.setDate(d.getDate() + 7);
        break;
      case 'monthly':
        d.setMonth(d.getMonth() + 1);
        break;
      default:
        d.setDate(d.getDate() + 1);
    }
    return d;
  },

  // Next occurrence strictly in the future, starting from the task's due date.
  next(fromISO, freq) {
    const now = new Date();
    let d = new Date(fromISO);
    // Always advance at least once, then keep going until it's in the future
    // (so completing a long-overdue daily task doesn't land in the past).
    do { d = this.step(d, freq); } while (d <= now);
    return d.toISOString();
  },
};
