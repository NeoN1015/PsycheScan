import { createInitialState, PHASES } from "./initialState.js";

// Pure reducer (spec §3.3). Times are passed in each action (now =
// performance.now(), iso = wall clock) so the reducer itself stays pure.

const ev = (iso, event, detail = "") => ({ timestamp_iso: iso, event, detail: String(detail ?? "") });

/** Milliseconds spent in the current phase, not counting pauses. */
export function phaseElapsedMs(s, now) {
  if (s.phaseStartedAt == null) return 0;
  const end = s.paused ? s.pausedAt : now;
  return Math.max(0, end - s.phaseStartedAt - s.pausedTotalMs);
}

export function sessionReducer(state, action) {
  switch (action.type) {
    case "SET_SETUP":
      return {
        ...state,
        setup: { ...state.setup, ...action.setup },
        sessionDate: action.date ?? state.sessionDate,
      };

    case "SET_SCREENING":
      return { ...state, screening: { ...state.screening, ...action.screening } };

    case "SET_CONSENT":
      return { ...state, consent: { ...state.consent, ...action.consent } };

    case "NEXT_PHASE": {
      const next = PHASES[PHASES.indexOf(state.phase) + 1];
      if (!next) return state;
      return {
        ...state,
        phase: next,
        phaseStartedAt: action.now,
        phaseRun: state.phaseRun + 1,
        paused: false,
        pausedAt: null,
        pausedTotalMs: 0,
        pendingCheckpoint: null,
        events: [...state.events, ev(action.iso, "phase_end", state.phase), ev(action.iso, "phase_start", next)],
      };
    }

    case "PAUSE":
      if (state.paused) return state;
      return {
        ...state,
        paused: true,
        pausedAt: action.now,
        events: [...state.events, ev(action.iso, "pause", state.phase)],
      };

    case "RESUME": {
      if (!state.paused) return state;
      const pausedMs = action.now - state.pausedAt;
      return {
        ...state,
        paused: false,
        pausedAt: null,
        pausedTotalMs: state.pausedTotalMs + pausedMs,
        events: [...state.events, ev(action.iso, "resume", `${state.phase}; paused ${Math.round(pausedMs / 1000)} s`)],
      };
    }

    case "RESTART_PHASE":
      return {
        ...state,
        phaseStartedAt: action.now,
        phaseRun: state.phaseRun + 1,
        paused: false,
        pausedAt: null,
        pausedTotalMs: 0,
        events: [...state.events, ev(action.iso, "phase_restarted", `${state.phase}: ${action.reason ?? ""}`)],
      };

    case "ABORT":
      return {
        ...state,
        aborted: true,
        phase: "end",
        phaseStartedAt: action.now,
        phaseRun: state.phaseRun + 1,
        paused: false,
        pausedAt: null,
        pendingCheckpoint: null,
        events: [
          ...state.events,
          ev(action.iso, "abort", `during ${state.phase}${action.reason ? ": " + action.reason : ""}`),
          ev(action.iso, "phase_start", "end"),
        ],
      };

    case "OPEN_CHECKPOINT":
      if (state.pendingCheckpoint) return state;
      return {
        ...state,
        pendingCheckpoint: action.checkpoint,
        events: [
          ...state.events,
          ev(action.iso, "checkpoint_open", `${action.checkpoint.checkpoint} after ${action.checkpoint.after_phase}`),
        ],
      };

    case "SAVE_CHECKPOINT":
      return {
        ...state,
        checkpoints: [...state.checkpoints, action.checkpoint],
        pendingCheckpoint: null,
        events: [
          ...state.events,
          ev(action.iso, "checkpoint_saved", `${action.checkpoint.checkpoint}${action.checkpoint.late ? " (late)" : ""}`),
        ],
      };

    case "SET_CALIBRATION":
      return { ...state, calibration: { ...state.calibration, ...action.calibration } };

    case "LOG_PROBLEM":
      return {
        ...state,
        stressTaskLog: [...state.stressTaskLog, { ...action.problem, n: state.stressTaskLog.length + 1 }],
      };

    case "SET_GAD7_ITEM": {
      const gad7 = [...state.gad7];
      gad7[action.index] = action.value;
      return { ...state, gad7 };
    }

    case "SET_PSS10_ITEM": {
      const pss10 = [...state.pss10];
      pss10[action.index] = action.value;
      return { ...state, pss10 };
    }

    case "LOG_EVENT":
      return { ...state, events: [...state.events, ev(action.iso, action.event, action.detail)] };

    case "MARK_DOWNLOADED":
      return { ...state, downloaded: true };

    case "MARK_SIMULATED":
      return state.simulated ? state : { ...state, simulated: true };

    case "RESET":
      return createInitialState();

    default:
      return state;
  }
}
