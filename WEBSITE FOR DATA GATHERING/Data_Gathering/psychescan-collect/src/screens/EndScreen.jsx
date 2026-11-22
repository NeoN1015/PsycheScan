import { useState } from "react";
import Banner from "../components/Banner.jsx";
import { CONFIG } from "../config.js";
import { buildAllFiles, downloadFiles, phaseStats, RECORDED_PHASES } from "../lib/csv.js";
import { gad7Level, gad7Total, pss10Level, pss10Total } from "../lib/scoring.js";
import { useSession } from "../state/SessionContext.jsx";

const show = (v, suffix = "") => (v == null ? "—" : `${v}${suffix}`);

/** End screen (spec §6.9): summary, Download all CSVs, New session. */
export default function EndScreen() {
  const { state, refs, actions, logEvent } = useSession();
  // Rows no longer change once the session has ended.
  const [rows] = useState(() => refs.rowsRef.current);
  const [busy, setBusy] = useState(false);
  const stats = phaseStats(rows);
  const g = gad7Total(state.gad7);
  const p = pss10Total(state.pss10);
  const lowQuality = RECORDED_PHASES.filter(
    (ph) => stats[ph].rows > 0 && stats[ph].validPct < CONFIG.validity.minValidPctWarning
  );

  async function download() {
    setBusy(true);
    const iso = new Date().toISOString();
    // The download event must be inside the events file being downloaded.
    const files = buildAllFiles(
      { ...state, events: [...state.events, { timestamp_iso: iso, event: "download", detail: "5 CSV files" }] },
      rows
    );
    logEvent("download", "5 CSV files");
    await downloadFiles(files);
    actions.markDownloaded();
    setBusy(false);
  }

  return (
    <section className="screen form-screen">
      <h1>{state.aborted ? "Session aborted" : "Session complete"}</h1>
      <table className="summary-table">
        <thead>
          <tr>
            <th>Phase</th>
            <th>Rows</th>
            <th>Valid rows</th>
          </tr>
        </thead>
        <tbody>
          {RECORDED_PHASES.map((ph) => (
            <tr key={ph}>
              <td className="phase-name">{ph}</td>
              <td className="num">{stats[ph].rows}</td>
              <td className={"num" + (lowQuality.includes(ph) ? " low" : "")}>{show(stats[ph].validPct, "%")}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <table className="summary-table">
        <tbody>
          <tr>
            <th>Checkpoints</th>
            <td>{state.checkpoints.length} of 4</td>
          </tr>
          <tr>
            <th>GAD-7</th>
            <td>{g == null ? "not completed" : `${g} — ${gad7Level(g)}`}</td>
          </tr>
          <tr>
            <th>PSS-10</th>
            <td>{p == null ? "not completed" : `${p} — ${pss10Level(p)}`}</td>
          </tr>
        </tbody>
      </table>

      {lowQuality.map((ph) => (
        <Banner key={ph} kind="amber">
          Low data quality in {ph} — consider repeating the session.
        </Banner>
      ))}

      <div className="button-row">
        <button type="button" className="btn" onClick={download} disabled={busy}>
          Download all CSVs
        </button>
        <button type="button" className="btn secondary" onClick={actions.reset} disabled={!state.downloaded}>
          New session
        </button>
      </div>
      {state.downloaded && (
        <p className="muted">Downloaded. Back up the files to the team Google Drive today.</p>
      )}
    </section>
  );
}
