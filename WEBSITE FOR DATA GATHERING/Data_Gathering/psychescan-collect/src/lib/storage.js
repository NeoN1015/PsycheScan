// localStorage helpers: remembered device names (spec §6.0) and this browser's
// session log (used for the next-ID suggestion, the "ID already used" check and
// the excluded-participant line of spec §6.1). Every access is wrapped in
// try/catch, so the app still works if storage is blocked.

const DEVICES_KEY = "psychescan-collect.devices";
const LOG_KEY = "psychescan-collect.sessionLog";

function read(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // storage full or blocked: nothing else to do
  }
}

export const loadDevices = () => read(DEVICES_KEY, { refHrDevice: "", refTempDevice: "", refGsrDevice: "None" });
export const saveDevices = (d) =>
  write(DEVICES_KEY, { refHrDevice: d.refHrDevice, refTempDevice: d.refTempDevice, refGsrDevice: d.refGsrDevice });

/** [{ id, date, status: "started" | "excluded" | "completed" | "aborted", note }] */
export const loadSessionLog = () => read(LOG_KEY, []);

export function addSessionLogEntry(entry) {
  write(LOG_KEY, [...loadSessionLog(), entry]);
}

export function updateSessionLogEntry(id, changes) {
  write(LOG_KEY, loadSessionLog().map((e) => (e.id === id ? { ...e, ...changes } : e)));
}

/** Next unused P### after the highest ID in the log (P001 when the log is empty). */
export function suggestNextId(log = loadSessionLog()) {
  const nums = log.map((e) => /^P(\d{3})$/.exec(e.id)).filter(Boolean).map((m) => Number(m[1]));
  const next = (nums.length ? Math.max(...nums) : 0) + 1;
  return "P" + String(Math.min(next, 999)).padStart(3, "0");
}
