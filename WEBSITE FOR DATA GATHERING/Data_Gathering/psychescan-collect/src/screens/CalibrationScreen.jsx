import LiveValues from "../components/LiveValues.jsx";
import { useCalibration } from "../hooks/useCalibration.js";
import { useSession } from "../state/SessionContext.jsx";

const mmss = (s) => {
  const t = Math.ceil(s);
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`;
};

/** Calibration (spec §6.4): live values (not zeroed), countdown, stability badge. */
export default function CalibrationScreen() {
  return (
    <section className="screen participant-screen">
      <p className="instruction">Please sit still and breathe normally.</p>
      <div className="calibration-values">
        <LiveValues size="large" />
      </div>
      <CalibrationStatus />
    </section>
  );
}

function CalibrationStatus() {
  const status = useCalibration();
  const { actions } = useSession();
  const c = status.checks;

  if (status.kind === "timeout") {
    return (
      <div className="banner amber calibration-timeout">
        Sensors not stable — check placement.
        <button type="button" className="btn small" onClick={() => actions.finishCalibration(true)}>
          Continue anyway
        </button>
        <button
          type="button"
          className="btn small secondary"
          onClick={() => actions.restartPhase("operator restarted calibration")}
        >
          Restart calibration
        </button>
      </div>
    );
  }

  return (
    <>
      {status.kind === "stable" ? (
        <span className="badge green">Stable ✓</span>
      ) : (
        <span className="badge amber">
          Stabilizing… {status.remainingS > 0 ? mmss(status.remainingS) : ""}
        </span>
      )}
      {c && (
        <p className="muted stability-detail">
          {c.enough ? "" : "Collecting 20 s of readings · "}
          Temp range {c.temp.range == null ? "—" : c.temp.range.toFixed(2)} °C {c.temp.ok ? "✓" : "✗"} · GSR range{" "}
          {c.gsr.rangePct == null ? "—" : c.gsr.rangePct.toFixed(1)}% {c.gsr.ok ? "✓" : "✗"} · HR SD{" "}
          {c.hr.std == null ? "—" : c.hr.std.toFixed(1)} bpm {c.hr.ok ? "✓" : "✗"}
        </p>
      )}
    </>
  );
}
