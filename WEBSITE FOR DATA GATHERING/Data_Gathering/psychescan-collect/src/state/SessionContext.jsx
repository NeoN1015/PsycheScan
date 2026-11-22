import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef } from "react";
import { CONFIG } from "../config.js";
import { deleteSavedSession, useAutosave } from "../hooks/useAutosave.js";
import { useRecorder } from "../hooks/useRecorder.js";
import { useSerial } from "../hooks/useSerial.js";
import { sensorAge } from "../lib/serialParser.js";
import { updateSessionLogEntry } from "../lib/storage.js";
import { CHECKPOINT_AFTER, createInitialState, RECORDING_PHASES, ROW_TAG } from "./initialState.js";
import { phaseElapsedMs, sessionReducer } from "./sessionReducer.js";

const SessionContext = createContext(null);

const isoNow = () => new Date().toISOString();
const RESTART_AFTER_LONG_PAUSE = new Set(["rest", "stress", "recovery"]);

/** spec §11 warning condition, read from the ref: no valid sensor line for 3 s. */
// eslint-disable-next-line react/only-export-components -- shared by the panel and the event monitor
export function isSerialLost(latestSensorRef, now) {
  return sensorAge(latestSensorRef.current, now) > CONFIG.serial.staleMs;
}

/**
 * Session state (reducer) + refs for high-frequency data (spec §2.1, §3.3).
 * Also owns the serial hook and the 1 Hz recorder, so they live for the
 * whole page and are not restarted by screen changes.
 */
export function SessionProvider({ children }) {
  const [state, dispatch] = useReducer(sessionReducer, undefined, createInitialState);
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const latestSensorRef = useRef(null);
  const rowsRef = useRef([]);
  const taskLevelRef = useRef(null);

  const logEvent = useCallback((event, detail = "") => {
    dispatch({ type: "LOG_EVENT", event, detail: String(detail ?? ""), iso: isoNow() });
  }, []);

  const serial = useSerial(latestSensorRef, logEvent);

  // Phase tag and timing for each sample row.
  const getContext = useCallback((now) => {
    const s = stateRef.current;
    const base = { participantId: s.setup.participantId, run: s.phaseRun };
    if (s.pendingCheckpoint) {
      return { ...base, phase: "checkpoint", tPhaseMs: now - s.pendingCheckpoint.snapshotPerf };
    }
    return { ...base, phase: ROW_TAG[s.phase] ?? s.phase, tPhaseMs: phaseElapsedMs(s, now) };
  }, []);
  const recorder = useRecorder({ latestSensorRef, rowsRef, taskLevelRef, getContext });

  // Sampler runs from calibration start to the end of recovery, not while paused (spec §9, §11).
  const recording = RECORDING_PHASES.has(state.phase) && !state.paused && !state.aborted;
  useEffect(() => {
    if (recording) recorder.start();
    else recorder.stop();
  }, [recording, recorder]);

  // Flag sessions that used the dev sensor simulator.
  useEffect(() => {
    if (serial.simulated && !state.simulated) dispatch({ type: "MARK_SIMULATED" });
  }, [serial.simulated, state.simulated]);

  // Log sensor-signal losses while recording (spec §11). The banner is drawn
  // by the operator panel from the same ref.
  const monitoring = RECORDING_PHASES.has(state.phase) && !state.aborted;
  useEffect(() => {
    if (!monitoring) return undefined;
    let wasLost = false;
    const id = setInterval(() => {
      const lost = isSerialLost(latestSensorRef, performance.now());
      if (lost !== wasLost) {
        wasLost = lost;
        logEvent(lost ? "serial_lost" : "serial_reconnected", lost ? "no sensor data for 3 s" : "");
      }
    }, CONFIG.displayTickMs);
    return () => clearInterval(id);
  }, [monitoring, logEvent]);

  useAutosave(stateRef, rowsRef);

  const actions = useMemo(() => {
    const nextPhase = () => dispatch({ type: "NEXT_PHASE", now: performance.now(), iso: isoNow() });
    const restartPhase = (reason) =>
      dispatch({ type: "RESTART_PHASE", now: performance.now(), iso: isoNow(), reason });

    /** Open the checkpoint that follows the current phase, freezing our sensor values now (spec §10). */
    const openCheckpoint = () => {
      const s = stateRef.current;
      const n = CHECKPOINT_AFTER[s.phase];
      if (!n || s.pendingCheckpoint) return;
      const now = performance.now();
      const iso = isoNow();
      const sensor = latestSensorRef.current;
      const fresh = sensor && now - sensor.receivedAt <= CONFIG.serial.staleMs;
      dispatch({
        type: "OPEN_CHECKPOINT",
        iso,
        checkpoint: {
          checkpoint: n,
          after_phase: s.phase,
          snapshot_time_iso: iso,
          snapshotPerf: now,
          our_hr: fresh ? sensor.hr : null,
          our_gsr: fresh ? sensor.gsr : null,
          our_temp: fresh ? sensor.temp : null,
          our_motion: fresh ? sensor.motion : null,
        },
      });
    };

    return {
      nextPhase,
      restartPhase,
      /** End of rest / stress / recovery: the checkpoint modal opens. */
      finishPhase: openCheckpoint,
      finishCalibration(forced) {
        const seconds = rowsRef.current.filter((r) => r.phase === "calibration").length;
        dispatch({ type: "SET_CALIBRATION", calibration: { seconds, forced } });
        openCheckpoint();
      },
      /** Save the open checkpoint, then start the next phase. */
      saveCheckpoint({ ref_hr, ref_temp, ref_gsr, note }) {
        const s = stateRef.current;
        const cp = s.pendingCheckpoint;
        if (!cp) return;
        const now = performance.now();
        const { snapshotPerf, ...snapshot } = cp;
        dispatch({
          type: "SAVE_CHECKPOINT",
          iso: isoNow(),
          checkpoint: {
            ...snapshot,
            participant_id: s.setup.participantId,
            entry_time_iso: isoNow(),
            late: now - snapshotPerf > CONFIG.checkpoints.lateSeconds * 1000 ? 1 : 0,
            ref_hr,
            ref_temp,
            ref_gsr,
            ref_hr_device: s.setup.refHrDevice,
            ref_temp_device: s.setup.refTempDevice,
            ref_gsr_device: s.setup.refGsrDevice,
            note,
          },
        });
        nextPhase();
      },
      /** Pause: timer and sampler stop (spec §11). Not while a checkpoint modal is open. */
      pause() {
        const s = stateRef.current;
        if (s.paused || s.pendingCheckpoint || !RECORDING_PHASES.has(s.phase)) return;
        dispatch({ type: "PAUSE", now: performance.now(), iso: isoNow() });
      },
      /** Resume the same phase; a pause over 60 s restarts rest / stress / recovery from 0. */
      resume() {
        const s = stateRef.current;
        if (!s.paused) return;
        const now = performance.now();
        const pausedMs = now - s.pausedAt;
        dispatch({ type: "RESUME", now, iso: isoNow() });
        if (pausedMs > CONFIG.phases.pauseRestartSeconds * 1000 && RESTART_AFTER_LONG_PAUSE.has(s.phase)) {
          restartPhase(`paused ${Math.round(pausedMs / 1000)} s (> ${CONFIG.phases.pauseRestartSeconds} s)`);
        }
      },
      /** Abort: session marked aborted, straight to the End screen; data can still be downloaded. */
      abort(reason) {
        dispatch({ type: "ABORT", now: performance.now(), iso: isoNow(), reason });
      },
      /** After "Download all CSVs": log it, mark downloaded, clear the autosave copy (spec §18). */
      markDownloaded() {
        const s = stateRef.current;
        dispatch({ type: "MARK_DOWNLOADED" });
        updateSessionLogEntry(s.setup.participantId, { status: s.aborted ? "aborted" : "completed" });
        deleteSavedSession(s.setup.participantId);
      },
      reset() {
        const s = stateRef.current;
        if (s.downloaded) deleteSavedSession(s.setup.participantId);
        recorder.reset();
        taskLevelRef.current = null;
        dispatch({ type: "RESET" });
      },
    };
  }, [recorder]);

  const portRef = serial.portRef;
  const refs = useMemo(() => ({ latestSensorRef, rowsRef, taskLevelRef, portRef }), [portRef]);

  const value = useMemo(
    () => ({ state, dispatch, stateRef, actions, refs, serial, recorder, logEvent }),
    [state, actions, refs, serial, recorder, logEvent]
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

// eslint-disable-next-line react/only-export-components -- hook lives with its context
export function useSession() {
  return useContext(SessionContext);
}
