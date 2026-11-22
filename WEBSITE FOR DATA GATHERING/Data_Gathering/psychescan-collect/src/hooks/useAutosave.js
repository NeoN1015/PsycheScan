import { del, entries, set } from "idb-keyval";
import { useEffect } from "react";
import { CONFIG } from "../config.js";
import { PHASES } from "../state/initialState.js";

// Autosave to IndexedDB (spec §9, §11): every 10 s the whole session (state + rows)
// is stored under the participant ID, until the CSVs have been downloaded.
const PREFIX = "psychescan-collect:session:";
const FIRST_SAVED_PHASE = PHASES.indexOf("consent"); // after screening: excluded people leave nothing

export function useAutosave(stateRef, rowsRef) {
  useEffect(() => {
    const id = setInterval(() => {
      const s = stateRef.current;
      if (!s.setup.participantId || s.downloaded || PHASES.indexOf(s.phase) < FIRST_SAVED_PHASE) return;
      set(PREFIX + s.setup.participantId, {
        savedAt: new Date().toISOString(),
        state: s,
        rows: rowsRef.current,
      }).catch((e) => console.warn("[autosave] failed:", e));
    }, CONFIG.autosaveMs);
    return () => clearInterval(id);
  }, [stateRef, rowsRef]);
}

/** Unfinished sessions found in this browser: [{ participantId, savedAt, state, rows }]. */
export async function listSavedSessions() {
  try {
    const all = await entries();
    return all
      .filter(([k]) => String(k).startsWith(PREFIX))
      .map(([k, v]) => ({ participantId: String(k).slice(PREFIX.length), ...v }));
  } catch (e) {
    console.warn("[autosave] could not read IndexedDB:", e);
    return [];
  }
}

export async function deleteSavedSession(participantId) {
  try {
    await del(PREFIX + participantId);
  } catch (e) {
    console.warn("[autosave] could not delete:", e);
  }
}
