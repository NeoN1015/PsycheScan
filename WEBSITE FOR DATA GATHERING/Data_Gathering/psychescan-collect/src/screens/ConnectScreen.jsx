import { useState } from "react";
import StatusRow from "../components/StatusRow.jsx";
import { CONFIG } from "../config.js";
import { useDisplayTick } from "../hooks/useDisplayTick.js";
import { sensorAge } from "../lib/serialParser.js";
import { useSession } from "../state/SessionContext.jsx";

const inRange = (v, [lo, hi]) => v != null && v >= lo && v <= hi;
const fmt = (v, d) => (v == null ? "—" : v.toFixed(d));

/** Connect screen (spec §6.3): USB, then one live check row per device. */
export default function ConnectScreen() {
  const { serial } = useSession();
  const [error, setError] = useState("");
  const [watchOk, setWatchOk] = useState(false);

  async function onConnectUsb() {
    setError("");
    try {
      await serial.connect();
    } catch (e) {
      // NotFoundError = the operator closed the port chooser without picking one
      if (e?.name !== "NotFoundError") setError(String(e?.message || e));
    }
  }

  return (
    <section className="screen form-screen">
      <h1>Connect devices</h1>
      <div className="button-row">
        <button type="button" className="btn" onClick={onConnectUsb} disabled={serial.connected}>
          {serial.connected ? "USB connected" : "Connect USB"}
        </button>
      </div>
      {error && <p className="error-text">{error}</p>}

      <ConnectChecks watchOk={watchOk}>
        <label className="check big-check">
          <input type="checkbox" checked={watchOk} onChange={(e) => setWatchOk(e.target.checked)} />
          Smartwatch on and reading
        </label>
      </ConnectChecks>
    </section>
  );
}

/**
 * The live status rows; re-renders on the 4 Hz display tick.
 * children (the smartwatch tick box) sit between the rows and Start Calibration.
 */
function ConnectChecks({ watchOk, children }) {
  const now = useDisplayTick();
  const { refs, serial, actions } = useSession();
  const s = refs.latestSensorRef.current;
  const fresh = sensorAge(s, now) <= CONFIG.connect.freshMs;

  const rows = [
    { label: "USB connected", ok: serial.connected && fresh, detail: serial.connected ? (fresh ? "receiving data" : "no data in the last 2 s") : "not connected" },
    { label: "Pulse sensor", ok: fresh && s.max30102 && inRange(s.hr, CONFIG.connect.hrRange), detail: fresh ? `${fmt(s.hr, 0)} bpm` : "—" },
    { label: "GSR", ok: fresh && s.gsrConnected, detail: fresh ? `${fmt(s.gsr, 2)} µS` : "—" },
    { label: "Temperature", ok: fresh && s.ds18b20 && inRange(s.temp, CONFIG.connect.tempRange), detail: fresh ? `${fmt(s.temp, 1)} °C` : "—" },
    { label: "Motion", ok: fresh && s.mpu6050, detail: fresh ? `${fmt(s.motion, 3)} g` : "—" },
    { label: "Smartwatch", ok: watchOk, detail: watchOk ? "ticked" : "tick the box below when on and reading" },
  ];

  const allOk = rows.every((r) => r.ok);

  return (
    <>
      <div className="status-list">
        {rows.map((r) => (
          <StatusRow key={r.label} label={r.label} ok={r.ok} detail={r.detail} />
        ))}
      </div>
      {children}
      <button type="button" className="btn next" disabled={!allOk} onClick={actions.nextPhase}>
        Start Calibration
      </button>
    </>
  );
}
