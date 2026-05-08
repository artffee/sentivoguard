// SentivoGuard — activity log helper
// Single source of truth for the dashboard activity feed.
// Every meaningful user action calls SG.activity.log(...).

SG.activity_log = (function () {
  const MAX = 50;

  function format(date) {
    const diff = (Date.now() - date) / 1000;
    if (diff < 60)        return Math.floor(diff) + "s ago";
    if (diff < 3600)      return Math.floor(diff / 60) + "m ago";
    if (diff < 86400)     return Math.floor(diff / 3600) + "h ago";
    return Math.floor(diff / 86400) + "d ago";
  }

  function refreshTimes() {
    if (!Array.isArray(SG.activity)) return;
    SG.activity.forEach(a => {
      if (a.ts) a.time = format(a.ts);
    });
  }

  function log(type, icon, msg) {
    if (!Array.isArray(SG.activity)) SG.activity = [];
    const ev = { type, icon, msg, ts: Date.now(), time: "now" };
    SG.activity.unshift(ev);
    while (SG.activity.length > MAX) SG.activity.pop();
    SG.store.set("activity", SG.activity);
    document.dispatchEvent(new CustomEvent("sg:activity"));
  }

  // Periodically rewrite "x m ago" labels in-memory so the feed stays current.
  setInterval(() => {
    refreshTimes();
    document.dispatchEvent(new CustomEvent("sg:activity-tick"));
  }, 30_000);

  return { log, refreshTimes };
})();
