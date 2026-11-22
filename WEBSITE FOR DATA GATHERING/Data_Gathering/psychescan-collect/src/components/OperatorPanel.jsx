import { useState } from "react";
import { useDisplayTick } from "../hooks/useDisplayTick.js";
import { gad7Total } from "../lib/scoring.js";
import { PHASE_LABEL, PHASE_SECONDS, RECORDING_PHASES } from "../state/initialState.js";
import { phaseElapsedMs } from "../state/sessionReducer.js";
import { isSerialLost, useSession } from "../state/SessionContext.jsx";
import Banner from "./Banner.jsx";
import ConfirmDialog from "./ConfirmDialog.jsx";
import LiveValues from "./LiveValues.jsx";
import SimulateSwitch from "./SimulateSwitch.jsx";

const mmss = (ms) => {
  const t = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`;
};

/**
 * Operator panel (spec §14), right side, 320 px: ID, phase, phase timer,
 * warnings, live sensor values, Pause / Abort.
 */
export default function OperatorPanel() {
  const { state } = useSession();
  return (
    <aside className="operator-panel">
      <h2 className="panel-title">Operator</h2>
      <div className="panel-block">
        <div className="panel-kv">
          <span>Participant</span>
          <b className="panel-id">{state.setup.participantId || "—"}</b>
        </div>
        <div className="panel-kv">
          <span>Phase</span>
          <b>{PHASE_LABEL[state.phase]}</b>
        </div>
        <PhaseTimer />
      </div>
      <SessionControls />
      <Alerts />
      <Gad7SafetyNote />
      <section className="panel-section">
        <h3 className="panel-title">Live sensors</h3>
        <LiveValues size="small" />
      </section>
      {import.meta.env.DEV && <SimulateSwitch />}
    </aside>
  );
}

/** Pause / Resume and Abort (spec §11). */
function SessionControls() {
  const { state, actions } = useSession();
  const [confirmAbort, setConfirmAbort] = useState(false);
  const [reason, setReason] = useState("");
  const canPause = RECORDING_PHASES.has(state.phase) && !state.pendingCheckpoint;
  const canAbort = !["setup", "end"].includes(state.phase);

  return (
    <div className="panel-controls">
      {state.paused ? (
        <button type="button" className="btn small" onClick={actions.resume}>
          Resume
        </button>
      ) : (
        <button type="button" className="btn small secondary" onClick={actions.pause} disabled={!canPause}>
          Pause
        </button>
      )}
      <button type="button" className="btn small danger-quiet" onClick={() => setConfirmAbort(true)} disabled={!canAbort}>
        Abort
      </button>
      {confirmAbort && (
        <ConfirmDialog
          title="Abort this session?"
          message="Recording stops and the session goes to the End screen. The data recorded so far can still be downloaded."
          yesLabel="Abort session"
          noLabel="Keep going"
          danger
          onYes={() => {
            setConfirmAbort(false);
            actions.abort(reason.trim());
            setReason("");
          }}
          onNo={() => setConfirmAbort(false)}
        >
          <label className="field">
            <span>Reason (optional, e.g. participant wants to stop)</span>
            <input type="text" value={reason} onChange={(e) => setReason(e.target.value)} />
          </label>
        </ConfirmDialog>
      )}
    </div>
  );
}

/** Red "Sensor signal lost" banner with Reconnect, while recording (spec §11). */
function Alerts() {
  const now = useDisplayTick();
  const { state, refs, serial } = useSession();
  const [error, setError] = useState("");
  if (!RECORDING_PHASES.has(state.phase)) return null;
  const serialLost = isSerialLost(refs.latestSensorRef, now);

  async function reconnect() {
    setError("");
    try {
      if (serial.connected && !serial.simulated) await serial.disconnect();
      await serial.reconnect();
    } catch (e) {
      if (e?.name !== "NotFoundError") setError(String(e?.message || e));
    }
  }

  if (!serialLost) return null;
  return (
    <Banner kind="red">
      Sensor signal lost
      {!serial.simulated && (
        <button type="button" className="btn small" onClick={reconnect}>
          Reconnect
        </button>
      )}
      {error && <small className="banner-detail">{error}</small>}
    </Banner>
  );
}

/** Spec §8.1 safety rule: shown to the operator only, once GAD-7 is complete and ≥ 15. */
function Gad7SafetyNote() {
  const { state } = useSession();
  const total = gad7Total(state.gad7);
  if (total == null || total < 15) return null;
  return <Banner kind="red">High score — give the participant the clinic&apos;s referral / support information.</Banner>;
}

/** Remaining time for fixed-length phases, elapsed time for calibration. */
function PhaseTimer() {
  const now = useDisplayTick();
  const { state: s } = useSession();
  if (s.phaseStartedAt == null || !(s.phase in PHASE_SECONDS || s.phase === "calibration")) return null;
  const elapsed = phaseElapsedMs(s, now);
  const total = PHASE_SECONDS[s.phase];
  return (
    <div className="phase-timer">
      {s.pendingCheckpoint ? (
        <span className="timer-word">Checkpoint</span>
      ) : (
        <>
          <span className="timer-value">{mmss(total ? total * 1000 - elapsed : elapsed)}</span>
          <span className="timer-unit">{total ? "left" : "elapsed"}</span>
        </>
      )}
      {s.paused && <span className="timer-flag">Paused</span>}
    </div>
  );
}
