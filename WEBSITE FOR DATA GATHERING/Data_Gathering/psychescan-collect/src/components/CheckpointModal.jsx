import { useState } from "react";
import { CONFIG } from "../config.js";
import { useDisplayTick } from "../hooks/useDisplayTick.js";
import { hasGsrReference } from "../state/initialState.js";
import { useSession } from "../state/SessionContext.jsx";
import ConfirmDialog from "./ConfirmDialog.jsx";

const toNum = (s) => (String(s).trim() === "" ? null : Number(s));
const outside = (v, [lo, hi]) => v < lo || v > hi;

/**
 * Reference-device checkpoint (spec §10). Our sensor values were frozen when
 * the modal opened (state.pendingCheckpoint); the operator types the
 * reference readings and saves. Our values are not shown, so they cannot
 * influence what the operator reads off the reference devices.
 */
export default function CheckpointModal() {
  const { state, actions } = useSession();
  const cp = state.pendingCheckpoint;
  const showGsr = hasGsrReference(state.setup);
  const [form, setForm] = useState({ hr: "", temp: "", gsr: "", note: "" });
  const [error, setError] = useState("");
  const [confirm, setConfirm] = useState(null);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  function save() {
    actions.saveCheckpoint({
      ref_hr: toNum(form.hr),
      ref_temp: toNum(form.temp),
      ref_gsr: showGsr ? toNum(form.gsr) : null,
      note: form.note.trim(),
    });
  }

  function onSubmit(e) {
    e.preventDefault();
    const hr = toNum(form.hr);
    const temp = toNum(form.temp);
    const gsr = toNum(form.gsr);
    if (hr == null || !Number.isFinite(hr)) return setError("Enter the smartwatch heart rate.");
    if (temp == null || !Number.isFinite(temp)) return setError("Enter the thermometer temperature.");
    if (showGsr && gsr != null && !Number.isFinite(gsr)) return setError("GSR reference must be a number.");
    setError("");
    const issues = [];
    if (outside(hr, CONFIG.checkpoints.hrRange)) issues.push(`Heart rate ${hr} bpm is outside ${CONFIG.checkpoints.hrRange.join("–")} bpm.`);
    if (outside(temp, CONFIG.checkpoints.tempRange)) issues.push(`Temperature ${temp} °C is outside ${CONFIG.checkpoints.tempRange.join("–")} °C.`);
    if (issues.length) setConfirm(issues);
    else save();
  }

  return (
    // Backdrop covers the participant area only, so the operator panel (Abort) stays usable.
    <div className="overlay area-overlay" role="dialog" aria-modal="true" aria-labelledby="cp-title">
      <form className="modal" onSubmit={onSubmit}>
        <h2 id="cp-title">Checkpoint {cp.checkpoint} of 4 — read the reference devices NOW.</h2>
        <SinceSnapshot snapshotPerf={cp.snapshotPerf} />
        <label className="field">
          <span>Smartwatch heart rate (bpm) — required</span>
          <input type="number" step="any" inputMode="decimal" value={form.hr} onChange={set("hr")} autoFocus />
        </label>
        <label className="field">
          <span>Thermometer temperature (°C) — required</span>
          <input type="number" step="any" inputMode="decimal" value={form.temp} onChange={set("temp")} />
        </label>
        {showGsr && (
          <label className="field">
            <span>GSR reference (µS) — {state.setup.refGsrDevice}</span>
            <input type="number" step="any" inputMode="decimal" value={form.gsr} onChange={set("gsr")} />
          </label>
        )}
        <label className="field">
          <span>Note (optional)</span>
          <input type="text" value={form.note} onChange={set("note")} />
        </label>
        {error && <p className="error-text">{error}</p>}
        <button type="submit" className="btn next">
          Save
        </button>
      </form>
      {confirm && (
        <ConfirmDialog
          title="Are you sure?"
          yesLabel="Yes, save"
          noLabel="No, fix it"
          onYes={() => {
            setConfirm(null);
            save();
          }}
          onNo={() => setConfirm(null)}
        >
          {confirm.map((t) => (
            <p key={t}>{t}</p>
          ))}
        </ConfirmDialog>
      )}
    </div>
  );
}

function SinceSnapshot({ snapshotPerf }) {
  const now = useDisplayTick();
  const s = Math.max(0, Math.floor((now - snapshotPerf) / 1000));
  const late = s > CONFIG.checkpoints.lateSeconds;
  return (
    <p className={"snapshot-age" + (late ? " late" : "")}>
      {s} s since our sensor snapshot{late ? " — late (over 15 s)" : ""}
    </p>
  );
}
