import { useEffect, useRef } from "react";
import { CONFIG } from "../config.js";
import { phaseElapsedMs } from "../state/sessionReducer.js";
import { useSession } from "../state/SessionContext.jsx";

/**
 * Countdown for the current phase (spec §6). Calls onDone once when the phase
 * has run durationS seconds (pauses not counted, and not while a checkpoint
 * modal is open). Causes no re-renders: the operator panel shows the time.
 */
export function usePhaseTimer(durationS, onDone, enabled = true) {
  const { stateRef } = useSession();
  const onDoneRef = useRef(onDone);

  useEffect(() => {
    onDoneRef.current = onDone;
  }, [onDone]);

  useEffect(() => {
    if (!enabled) return undefined;
    let fired = false;
    const id = setInterval(() => {
      const s = stateRef.current;
      if (fired || s.paused || s.pendingCheckpoint) return;
      if (phaseElapsedMs(s, performance.now()) >= durationS * 1000) {
        fired = true;
        onDoneRef.current();
      }
    }, CONFIG.displayTickMs);
    return () => clearInterval(id);
  }, [durationS, enabled, stateRef]);
}
