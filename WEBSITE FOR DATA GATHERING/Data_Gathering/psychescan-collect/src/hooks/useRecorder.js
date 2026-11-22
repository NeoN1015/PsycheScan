import { useCallback, useEffect, useMemo, useRef } from "react";
import { CONFIG } from "../config.js";
import { buildRow } from "../lib/sampleRow.js";

/**
 * 1 Hz sampler (spec §2.1 rule 2, §9). Pushes rows into rowsRef.current,
 * never into React state. getContext(now) returns
 * { participantId, phase, tPhaseMs, run } for the row being written.
 * start() is safe to call twice (StrictMode).
 */
export function useRecorder({ latestSensorRef, rowsRef, taskLevelRef, getContext }) {
  const timerRef = useRef(null);
  const startRef = useRef(null);
  const getContextRef = useRef(getContext);

  useEffect(() => {
    getContextRef.current = getContext;
  }, [getContext]);

  const tick = useCallback(() => {
    const now = performance.now();
    const ctx = getContextRef.current(now);
    rowsRef.current.push(
      buildRow({
        participantId: ctx.participantId,
        now,
        iso: new Date().toISOString(),
        tSession: Math.round((now - startRef.current) / 1000),
        phase: ctx.phase,
        tPhase: Math.round(ctx.tPhaseMs / 1000),
        run: ctx.run,
        sensor: latestSensorRef.current,
        taskLevel: taskLevelRef.current,
      })
    );
  }, [latestSensorRef, rowsRef, taskLevelRef]);

  const start = useCallback(() => {
    if (timerRef.current) return; // already running
    startRef.current ??= performance.now(); // t_session_s counts from the first start
    timerRef.current = setInterval(tick, CONFIG.sampleIntervalMs);
  }, [tick]);

  const stop = useCallback(() => {
    clearInterval(timerRef.current);
    timerRef.current = null;
  }, []);

  /** Clear everything for a new session. */
  const reset = useCallback(() => {
    stop();
    startRef.current = null;
    rowsRef.current = [];
  }, [stop, rowsRef]);

  useEffect(() => stop, [stop]);

  return useMemo(() => ({ start, stop, reset }), [start, stop, reset]);
}
