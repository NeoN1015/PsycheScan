// Rest baseline and delta columns (spec §12.1 footnote). Pure functions.
import { round } from "./sampleRow.js";

const mean = (values) => {
  const ok = values.filter(Number.isFinite);
  return ok.length ? ok.reduce((a, b) => a + b, 0) / ok.length : null;
};

/** Baseline = mean of the rest-phase rows with valid = 1. Null when there are none. */
export function computeBaseline(rows) {
  const rest = rows.filter((r) => r.phase === "rest" && r.valid === 1);
  return {
    hr: mean(rest.map((r) => r.hr)),
    gsr: mean(rest.map((r) => r.gsr)),
    temp: mean(rest.map((r) => r.temp)),
  };
}

const pct = (v, base) =>
  Number.isFinite(v) && Number.isFinite(base) && base !== 0 ? round(((v - base) / base) * 100, 2) : null;

/** Copy of the row with hr_delta_pct, gsr_delta_pct and temp_delta filled in. */
export function withDeltas(row, baseline) {
  return {
    ...row,
    hr_delta_pct: pct(row.hr, baseline.hr),
    gsr_delta_pct: pct(row.gsr, baseline.gsr),
    temp_delta:
      Number.isFinite(row.temp) && Number.isFinite(baseline.temp) ? round(row.temp - baseline.temp, 3) : null,
  };
}
