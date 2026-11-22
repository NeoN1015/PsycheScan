import { useEffect, useState } from "react";
import { deleteSavedSession, listSavedSessions } from "../hooks/useAutosave.js";
import { buildAllFiles, downloadFiles } from "../lib/csv.js";
import { updateSessionLogEntry } from "../lib/storage.js";
import { PHASE_LABEL } from "../state/initialState.js";
import Banner from "./Banner.jsx";
import ConfirmDialog from "./ConfirmDialog.jsx";

/**
 * Unfinished sessions found in IndexedDB on page load (spec §9, §11):
 * Recover session (download what was saved) or Discard.
 */
export default function RecoveryPrompt() {
  const [saved, setSaved] = useState([]);
  const [confirmDiscard, setConfirmDiscard] = useState(null);

  useEffect(() => {
    let alive = true;
    listSavedSessions().then((list) => alive && setSaved(list));
    return () => {
      alive = false;
    };
  }, []);

  const forget = async (id) => {
    await deleteSavedSession(id);
    setSaved((list) => list.filter((s) => s.participantId !== id));
  };

  async function recover(s) {
    const event = { timestamp_iso: new Date().toISOString(), event: "recovered", detail: `from autosave of ${s.savedAt}` };
    await downloadFiles(buildAllFiles({ ...s.state, events: [...s.state.events, event] }, s.rows));
    updateSessionLogEntry(s.participantId, { status: "recovered" });
    await forget(s.participantId);
  }

  if (!saved.length) return null;
  return (
    <>
      {saved.map((s) => (
        <Banner key={s.participantId} kind="amber">
          Unfinished session {s.participantId} — saved {new Date(s.savedAt).toLocaleString()} during{" "}
          {PHASE_LABEL[s.state.phase]} ({s.rows.length} rows).
          <button type="button" className="btn small" onClick={() => recover(s)}>
            Recover session
          </button>
          <button type="button" className="btn small secondary" onClick={() => setConfirmDiscard(s.participantId)}>
            Discard
          </button>
        </Banner>
      ))}
      {confirmDiscard && (
        <ConfirmDialog
          title={`Discard ${confirmDiscard}?`}
          message="The autosaved data of this session will be deleted from this browser. This cannot be undone."
          yesLabel="Discard"
          noLabel="Keep it"
          danger
          onYes={() => {
            updateSessionLogEntry(confirmDiscard, { status: "discarded" });
            forget(confirmDiscard);
            setConfirmDiscard(null);
          }}
          onNo={() => setConfirmDiscard(null)}
        />
      )}
    </>
  );
}
