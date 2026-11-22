// One per-second sample row (spec §9, §12.1; sensor-only, see NOTES.md). Pure function, no React.
import { CONFIG } from "../config.js";

export const SAMPLE_COLUMNS = [
  "participant_id", "timestamp_iso", "t_session_s", "phase", "t_phase_s",
  "hr", "gsr", "temp", "motion",
  "hr_delta_pct", "gsr_delta_pct", "temp_delta",
  "sensor_data_valid", "finger_ok", "gsr_ok", "temp_ok", "mpu_ok", "sensor_age_ms",
  "valid", "task_level",
];

export const round = (v, d) => (Number.isFinite(v) ? Math.round(v * 10 ** d) / 10 ** d : null);
const flag = (b) => (b ? 1 : 0);

/**
 * Build one raw row. Delta columns are added at download time (lib/baseline.js),
 * because the rest baseline is only known after the rest phase.
 * valid = sensor line received in the last 1.5 s AND firmware dataValid.
 * `run` is internal (not a CSV column): it tells phase restarts apart.
 */
export function buildRow({ participantId, now, iso, tSession, phase, tPhase, run, sensor, taskLevel }) {
  const age = sensor ? Math.round(now - sensor.receivedAt) : null;
  return {
    participant_id: participantId,
    timestamp_iso: iso,
    t_session_s: tSession,
    phase,
    t_phase_s: tPhase,
    hr: sensor?.hr ?? null,
    gsr: sensor?.gsr ?? null,
    temp: sensor?.temp ?? null,
    motion: sensor?.motion ?? null,
    sensor_data_valid: flag(sensor?.dataValid),
    finger_ok: flag(sensor?.max30102),
    gsr_ok: flag(sensor?.gsrConnected),
    temp_ok: flag(sensor?.ds18b20),
    mpu_ok: flag(sensor?.mpu6050),
    sensor_age_ms: age,
    valid: flag(age != null && age <= CONFIG.validity.sensorFreshMs && sensor.dataValid),
    task_level: phase === "stress" ? (taskLevel ?? null) : null,
    _run: run,
  };
}
