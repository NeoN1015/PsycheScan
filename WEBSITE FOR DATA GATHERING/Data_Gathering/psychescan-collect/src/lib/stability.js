// Calibration stability check over the last 20 s (spec §6.4). Pure function.

const EPS = 1e-9; // so 34.5 - 34.3 (= 0.20000000000000284) still counts as 0.2

const range = (v) => (v.length ? Math.max(...v) - Math.min(...v) : null);
const mean = (v) => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : null);
const std = (v) => {
  if (!v.length) return null;
  const m = mean(v);
  return Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / v.length);
};

/**
 * @param rows      all sample rows so far
 * @param run       current calibration run (rows from before a restart are ignored)
 * @param cfg       CONFIG.calibration
 * @param freshMs   a row's sensor value counts only if its line was at most this old
 * @returns {{stable, enough, temp:{ok,range}, gsr:{ok,rangePct}, hr:{ok,std}}}
 */
export function checkStability(rows, run, cfg, freshMs) {
  const n = cfg.windowSeconds;
  const win = [];
  for (let i = rows.length - 1; i >= 0 && win.length < n; i--) {
    const r = rows[i];
    if (r.phase !== "calibration" || r._run !== run) break;
    win.push(r);
  }
  const need = Math.ceil((n * cfg.minSamplesPct) / 100);
  const fresh = (r) => r.sensor_age_ms != null && r.sensor_age_ms <= freshMs;

  const temps = win.filter((r) => fresh(r) && r.temp_ok && Number.isFinite(r.temp)).map((r) => r.temp);
  const gsrs = win.filter((r) => fresh(r) && r.gsr_ok && Number.isFinite(r.gsr)).map((r) => r.gsr);
  const hrs = win.filter((r) => fresh(r) && r.finger_ok && r.hr > 0).map((r) => r.hr);

  const enough = win.length >= n;
  const tempRange = range(temps);
  const gsrMean = mean(gsrs);
  const gsrRangePct = gsrs.length && gsrMean > 0 ? (range(gsrs) / gsrMean) * 100 : null;
  const hrStd = std(hrs);

  const temp = { ok: enough && temps.length >= need && tempRange <= cfg.tempRangeC + EPS, range: tempRange };
  const gsr = { ok: enough && gsrs.length >= need && gsrRangePct != null && gsrRangePct <= cfg.gsrRangePct + EPS, rangePct: gsrRangePct };
  const hr = { ok: enough && hrs.length >= need && hrStd <= cfg.hrStdBpm + EPS, std: hrStd };

  return { stable: temp.ok && gsr.ok && hr.ok, enough, temp, gsr, hr };
}
