import { useEffect, useRef, useState } from "react";
import { CONFIG } from "../config.js";
import { checkStability } from "../lib/stability.js";
import { phaseElapsedMs } from "../state/sessionReducer.js";
import { useSession } from "../state/SessionContext.jsx";

/**
 * Calibration status (spec §6.4), updated on the display tick.
 * kind: "stabilizing" | "stable" | "timeout" | "paused"
 * "stable" advances automatically after advanceDelayMs; "timeout" waits for
 * the operator (Continue anyway / Restart calibration).
 */
export function useCalibration() {
  const { stateRef, refs, actions } = useSession();
  const cfg = CONFIG.calibration;
  const [status, setStatus] = useState({ kind: "stabilizing", remainingS: cfg.minSeconds, checks: null });
  const stableAtRef = useRef(null);
  const settledRef = useRef(false); // advanced, or timeout shown

  useEffect(() => {
    const id = setInterval(() => {
      const s = stateRef.current;
      if (settledRef.current || s.phase !== "calibration" || s.pendingCheckpoint) return;
      const now = performance.now();
      const elapsedS = phaseElapsedMs(s, now) / 1000;
      const remainingS = Math.max(0, cfg.minSeconds - elapsedS);
      const checks = checkStability(refs.rowsRef.current, s.phaseRun, cfg, CONFIG.validity.sensorFreshMs);

      if (s.paused) {
        setStatus({ kind: "paused", remainingS, checks });
        return;
      }
      if (stableAtRef.current != null || (remainingS === 0 && checks.stable)) {
        stableAtRef.current ??= now;
        if (now - stableAtRef.current >= cfg.advanceDelayMs) {
          settledRef.current = true;
          actions.finishCalibration(false);
        }
        setStatus({ kind: "stable", remainingS: 0, checks });
        return;
      }
      if (elapsedS >= cfg.maxSeconds) {
        settledRef.current = true;
        setStatus({ kind: "timeout", remainingS: 0, checks });
        return;
      }
      setStatus({ kind: "stabilizing", remainingS, checks });
    }, CONFIG.displayTickMs);
    return () => clearInterval(id);
  }, [stateRef, refs, actions, cfg]);

  return status;
}
