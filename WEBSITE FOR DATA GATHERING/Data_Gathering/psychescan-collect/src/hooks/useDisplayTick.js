import { useEffect, useState } from "react";
import { CONFIG } from "../config.js";

/**
 * 4 Hz re-render trigger (spec Section 2.1 rule 3). Call it only in the small
 * component that shows live values, so only that component re-renders.
 * Returns the performance.now() time of the latest tick, so render code can
 * compute ages without calling an impure clock itself.
 */
export function useDisplayTick(ms = CONFIG.displayTickMs) {
  const [now, setNow] = useState(() => performance.now());
  useEffect(() => {
    const id = setInterval(() => setNow(performance.now()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}
