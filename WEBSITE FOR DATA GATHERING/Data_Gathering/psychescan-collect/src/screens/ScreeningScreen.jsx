import { useState } from "react";
import { updateSessionLogEntry } from "../lib/storage.js";
import { useSession } from "../state/SessionContext.jsx";

/** Button group for one answer. options: [[value, label], ...] */
function Choice({ value, options, onChange, label }) {
  return (
    <div className="choice-group" role="radiogroup" aria-label={label}>
      {options.map(([v, text]) => (
        <button
          key={String(v)}
          type="button"
          role="radio"
          aria-checked={value === v}
          className={"choice" + (value === v ? " selected" : "")}
          onClick={() => onChange(v)}
        >
          {text}
        </button>
      ))}
    </div>
  );
}

const YES_NO = [
  [true, "Yes"],
  [false, "No"],
];

function Question({ text, children, hint }) {
  return (
    <div className="question-row">
      <div>
        {text}
        {hint && <div className="field-hint">{hint}</div>}
      </div>
      <div>{children}</div>
    </div>
  );
}

/** Eligibility rules of spec §6.1. Returns the exclusion reason, or "" if eligible so far. */
function exclusionReason(f) {
  if (f.age !== "" && Number(f.age) < 18) return "under 18";
  if (f.heartCondition === true) return "heart condition or heart/blood-pressure medication";
  if (f.mhTreatment === true && !f.clinicSupervised) return "in mental health treatment, not clinic-supervised";
  return "";
}

/** Screening (spec §6.1): asked by the operator, answered verbally, entered here. */
export default function ScreeningScreen() {
  const { state, dispatch, actions } = useSession();
  const [f, setF] = useState(state.screening);
  const set = (k) => (v) => setF((prev) => ({ ...prev, [k]: v }));

  const ageOk = f.age !== "" && Number.isInteger(Number(f.age)) && Number(f.age) >= 0 && Number(f.age) <= 120;
  const sleepOk = f.sleepHours !== "" && Number(f.sleepHours) >= 0 && Number(f.sleepHours) <= 24;
  const reason = exclusionReason(f);
  const answered =
    ageOk && sleepOk && f.sex !== "" && f.dominantHand !== "" &&
    [f.heartCondition, f.mhTreatment, f.caffeine2h, f.smoked1h, f.glasses].every((v) => v !== null);

  function next() {
    dispatch({
      type: "SET_SCREENING",
      screening: { ...f, age: Number(f.age), sleepHours: Number(f.sleepHours), eligible: true },
    });
    actions.nextPhase();
  }

  function endExcluded() {
    updateSessionLogEntry(state.setup.participantId, { status: "excluded", note: reason });
    actions.reset();
  }

  return (
    <section className="screen form-screen">
      <h1>Screening</h1>
      <Question text="Age">
        <input type="number" min="0" max="120" value={f.age} onChange={(e) => set("age")(e.target.value)} style={{ width: 120 }} />
      </Question>
      <Question text="Sex">
        <Choice label="Sex" value={f.sex} onChange={set("sex")} options={[["Male", "Male"], ["Female", "Female"], ["Prefer not to say", "Prefer not to say"]]} />
      </Question>
      <Question text="Heart condition or heart/blood-pressure medication?">
        <Choice label="Heart condition" value={f.heartCondition} onChange={set("heartCondition")} options={YES_NO} />
      </Question>
      <Question text="Currently in treatment for severe anxiety or another mental health condition?">
        <Choice label="Mental health treatment" value={f.mhTreatment} onChange={set("mhTreatment")} options={YES_NO} />
        {f.mhTreatment === true && (
          <label className="check" style={{ marginTop: 8 }}>
            <input type="checkbox" checked={f.clinicSupervised} onChange={(e) => set("clinicSupervised")(e.target.checked)} />
            Clinic supervised
          </label>
        )}
      </Question>
      <Question text="Coffee, tea or energy drink in the last 2 hours?">
        <Choice label="Caffeine" value={f.caffeine2h} onChange={set("caffeine2h")} options={YES_NO} />
      </Question>
      <Question text="Smoked in the last hour?">
        <Choice label="Smoked" value={f.smoked1h} onChange={set("smoked1h")} options={YES_NO} />
      </Question>
      <Question text="Hours of sleep last night">
        <input type="number" min="0" max="24" step="0.5" value={f.sleepHours} onChange={(e) => set("sleepHours")(e.target.value)} style={{ width: 120 }} />
      </Question>
      <Question text="Dominant hand" hint="Smartwatch goes on this wrist; sensors on the other.">
        <Choice label="Dominant hand" value={f.dominantHand} onChange={set("dominantHand")} options={[["left", "Left"], ["right", "Right"]]} />
      </Question>
      <Question text="Wearing glasses?">
        <Choice label="Glasses" value={f.glasses} onChange={set("glasses")} options={YES_NO} />
      </Question>

      {(f.caffeine2h === true || f.smoked1h === true) && !reason && (
        <div className="banner amber">
          {f.caffeine2h === true && "Caffeine in the last 2 hours. "}
          {f.smoked1h === true && "Smoked in the last hour. "}
          This can raise heart rate — it is recorded in the session file.
        </div>
      )}

      {reason ? (
        <div className="banner red">
          Participant not eligible — thank them and end the session. ({reason})
          <button type="button" className="btn small danger" onClick={endExcluded}>
            End session
          </button>
        </div>
      ) : (
        <button type="button" className="btn next" disabled={!answered} onClick={next}>
          Next
        </button>
      )}
    </section>
  );
}
