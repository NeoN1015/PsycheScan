// CSV building and download (spec §12). UTF-8, comma-separated, header row,
// "." decimal point. Empty cell for null / undefined.
import { CONFIG } from "../config.js";
import { computeBaseline, withDeltas } from "./baseline.js";
import { round, SAMPLE_COLUMNS } from "./sampleRow.js";
import { gad7Level, gad7Total, pss10Level, pss10Total } from "./scoring.js";

export const RECORDED_PHASES = ["calibration", "rest", "stress", "recovery"];

export function csvCell(v) {
  if (v == null || (typeof v === "number" && !Number.isFinite(v))) return "";
  if (typeof v === "boolean") return v ? "1" : "0";
  const s = String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(columns, rows) {
  const lines = [columns.join(",")];
  for (const r of rows) lines.push(columns.map((c) => csvCell(r[c])).join(","));
  return lines.join("\n") + "\n";
}

export const fileName = (participantId, date, kind) => `${participantId}_${date}_${kind}.csv`;

/** _samples.csv: raw rows plus delta columns computed against the rest baseline. */
export function buildSamplesCsv(rows) {
  const baseline = computeBaseline(rows);
  return toCsv(SAMPLE_COLUMNS, rows.map((r) => withDeltas(r, baseline)));
}

export const CHECKPOINT_COLUMNS = [
  "participant_id", "checkpoint", "after_phase", "snapshot_time_iso", "entry_time_iso", "late",
  "our_hr", "our_gsr", "our_temp", "our_motion",
  "ref_hr", "ref_temp", "ref_gsr",
  "ref_hr_device", "ref_temp_device", "ref_gsr_device", "note",
];

/** _checkpoints.csv: one row per saved checkpoint (spec §12.2). */
export function buildCheckpointsCsv(state) {
  return toCsv(CHECKPOINT_COLUMNS, state.checkpoints);
}

export const STRESS_TASK_COLUMNS = [
  "participant_id", "n", "shown_time_iso", "t_phase_s", "level", "time_limit_s",
  "a", "b", "correct_answer", "given_answer", "result", "response_ms",
];

/** _stress_task.csv: one row per answered or timed-out problem (spec §12.4). */
export function buildStressTaskCsv(state) {
  return toCsv(STRESS_TASK_COLUMNS, state.stressTaskLog);
}

/** Rows and % valid rows per recorded phase. */
export function phaseStats(rows) {
  const stats = {};
  for (const p of RECORDED_PHASES) {
    const inPhase = rows.filter((r) => r.phase === p);
    const valid = inPhase.filter((r) => r.valid === 1).length;
    stats[p] = { rows: inPhase.length, validPct: inPhase.length ? round((valid / inPhase.length) * 100, 1) : null };
  }
  return stats;
}

const yn = (v) => (v === true ? 1 : v === false ? 0 : null);

export const SESSION_COLUMNS = [
  "participant_id", "date", "operator", "location", "age", "sex", "heart_condition",
  "mental_health_treatment", "clinic_supervised", "caffeine_2h", "smoked_1h", "sleep_hours",
  "dominant_hand", "glasses", "calibration_seconds", "calibration_forced",
  "baseline_hr", "baseline_gsr", "baseline_temp",
  "rows_calibration", "rows_rest", "rows_stress", "rows_recovery",
  "valid_pct_rest", "valid_pct_stress", "valid_pct_recovery",
  ...Array.from({ length: 7 }, (_, i) => `gad7_q${i + 1}`), "gad7_total", "gad7_level",
  ...Array.from({ length: 10 }, (_, i) => `pss10_q${i + 1}`), "pss10_total", "pss10_level",
  "task_problems", "task_correct", "task_wrong", "task_timeout", "task_max_level",
  "aborted", "app_version", "firmware_note",
];

/** _session.csv: one row (spec §12.3). */
export function buildSessionCsv(state, rows) {
  const sc = state.screening;
  const baseline = computeBaseline(rows);
  const stats = phaseStats(rows);
  const log = state.stressTaskLog;
  const g = gad7Total(state.gad7);
  const p = pss10Total(state.pss10);
  const row = {
    participant_id: state.setup.participantId,
    date: state.sessionDate,
    operator: state.setup.operator,
    location: state.setup.location,
    age: sc.age === "" ? null : sc.age,
    sex: sc.sex || null,
    heart_condition: yn(sc.heartCondition),
    mental_health_treatment: yn(sc.mhTreatment),
    clinic_supervised: sc.mhTreatment === true ? yn(sc.clinicSupervised) : 0,
    caffeine_2h: yn(sc.caffeine2h),
    smoked_1h: yn(sc.smoked1h),
    sleep_hours: sc.sleepHours === "" ? null : sc.sleepHours,
    dominant_hand: sc.dominantHand || null,
    glasses: yn(sc.glasses),
    // Seconds recorded in calibration (1 row = 1 s); also right for a session aborted mid-calibration.
    calibration_seconds: stats.calibration.rows,
    calibration_forced: state.calibration.forced ? 1 : 0,
    baseline_hr: round(baseline.hr, 3),
    baseline_gsr: round(baseline.gsr, 3),
    baseline_temp: round(baseline.temp, 3),
    rows_calibration: stats.calibration.rows,
    rows_rest: stats.rest.rows,
    rows_stress: stats.stress.rows,
    rows_recovery: stats.recovery.rows,
    valid_pct_rest: stats.rest.validPct,
    valid_pct_stress: stats.stress.validPct,
    valid_pct_recovery: stats.recovery.validPct,
    gad7_total: g,
    gad7_level: gad7Level(g),
    pss10_total: p,
    pss10_level: pss10Level(p),
    task_problems: log.length,
    task_correct: log.filter((r) => r.result === "correct").length,
    task_wrong: log.filter((r) => r.result === "wrong").length,
    task_timeout: log.filter((r) => r.result === "timeout").length,
    task_max_level: log.length ? Math.max(...log.map((r) => r.level)) : null,
    aborted: state.aborted ? 1 : 0,
    app_version: CONFIG.appVersion,
    firmware_note: CONFIG.firmwareNote + (state.simulated ? " | SIMULATED sensors (dev switch)" : ""),
  };
  state.gad7.forEach((a, i) => (row[`gad7_q${i + 1}`] = a));
  state.pss10.forEach((a, i) => (row[`pss10_q${i + 1}`] = a));
  return toCsv(SESSION_COLUMNS, [row]);
}

export const EVENT_COLUMNS = ["participant_id", "timestamp_iso", "event", "detail"];

/** _events.csv (spec §12.5). */
export function buildEventsCsv(state) {
  return toCsv(EVENT_COLUMNS, state.events.map((e) => ({ participant_id: state.setup.participantId, ...e })));
}

/** All 5 files of a session (spec §12), ready for downloadFiles(). */
export function buildAllFiles(state, rows) {
  const id = state.setup.participantId;
  const date = state.sessionDate;
  return [
    { name: fileName(id, date, "samples"), text: buildSamplesCsv(rows) },
    { name: fileName(id, date, "checkpoints"), text: buildCheckpointsCsv(state) },
    { name: fileName(id, date, "session"), text: buildSessionCsv(state, rows) },
    { name: fileName(id, date, "stress_task"), text: buildStressTaskCsv(state) },
    { name: fileName(id, date, "events"), text: buildEventsCsv(state) },
  ];
}

function downloadText(name, text) {
  const blob = new Blob([text], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

/** Download several files, spaced out so the browser does not drop any. */
export async function downloadFiles(files) {
  for (let i = 0; i < files.length; i++) {
    if (i) await new Promise((r) => setTimeout(r, 300));
    downloadText(files[i].name, files[i].text);
  }
}

/** Local calendar date, YYYY-MM-DD (used in file names). */
export function localDate(d = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
