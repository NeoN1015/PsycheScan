import { useState } from "react";
import RecoveryPrompt from "../components/RecoveryPrompt.jsx";
import { localDate } from "../lib/csv.js";
import { addSessionLogEntry, loadDevices, loadSessionLog, saveDevices, suggestNextId } from "../lib/storage.js";
import { useSession } from "../state/SessionContext.jsx";

const LOCATIONS = ["Clinic", "School", "Other"];

/** Setup (spec §6.0): participant ID, operator, location, reference devices. */
export default function SetupScreen() {
  const { dispatch, actions } = useSession();
  const [form, setForm] = useState(() => ({
    participantId: suggestNextId(),
    operator: "",
    location: "",
    ...loadDevices(),
  }));
  const [touched, setTouched] = useState(false);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const id = form.participantId.trim().toUpperCase();
  const idFormatOk = /^P\d{3}$/.test(id);
  const idUsed = loadSessionLog().some((e) => e.id === id);
  const idError = !idFormatOk ? "Use the format P### (e.g. P031)." : idUsed ? `${id} was already used in this browser.` : "";
  const missing = ["operator", "location", "refHrDevice", "refTempDevice"].filter((k) => !form[k].trim());
  const valid = !idError && missing.length === 0;

  function onSubmit(e) {
    e.preventDefault();
    setTouched(true);
    if (!valid) return;
    const setup = {
      participantId: id,
      operator: form.operator.trim(),
      location: form.location,
      refHrDevice: form.refHrDevice.trim(),
      refTempDevice: form.refTempDevice.trim(),
      refGsrDevice: form.refGsrDevice.trim() || "None",
    };
    const date = localDate();
    saveDevices(setup);
    addSessionLogEntry({ id, date, status: "started", note: "" });
    dispatch({ type: "SET_SETUP", setup, date });
    actions.nextPhase();
  }

  const req = (k) => touched && missing.includes(k);

  return (
    <form className="screen form-screen" onSubmit={onSubmit} noValidate>
      <RecoveryPrompt />
      <h1>New session</h1>
      <h2 className="section-title">Session</h2>
      <div className="form-grid">
        <label className="field">
          <span>Participant ID</span>
          <input type="text" value={form.participantId} onChange={set("participantId")} aria-invalid={touched && !!idError} />
          {idError && <small className={touched ? "error-text" : "field-hint"}>{idError}</small>}
        </label>
        <label className="field">
          <span>Operator name</span>
          <input type="text" value={form.operator} onChange={set("operator")} aria-invalid={req("operator")} />
        </label>
        <label className="field">
          <span>Location</span>
          <select value={form.location} onChange={set("location")} aria-invalid={req("location")}>
            <option value="">Choose…</option>
            {LOCATIONS.map((l) => (
              <option key={l}>{l}</option>
            ))}
          </select>
        </label>
      </div>
      <h2 className="section-title section-gap">Reference devices</h2>
      <div className="form-grid">
        <label className="field">
          <span>Smartwatch model</span>
          <input type="text" value={form.refHrDevice} onChange={set("refHrDevice")} aria-invalid={req("refHrDevice")} />
        </label>
        <label className="field">
          <span>Thermometer model</span>
          <input type="text" value={form.refTempDevice} onChange={set("refTempDevice")} aria-invalid={req("refTempDevice")} />
        </label>
        <label className="field">
          <span>GSR reference device (or “None”)</span>
          <input type="text" value={form.refGsrDevice} onChange={set("refGsrDevice")} />
        </label>
      </div>
      <p className="field-hint">Device names are remembered for the next session. No names of participants in any field.</p>
      {touched && missing.length > 0 && <p className="error-text">Fill in every field.</p>}
      <button type="submit" className="btn next">
        Next
      </button>
    </form>
  );
}
