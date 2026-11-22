import { CONFIG } from "../config.js";
import { useDisplayTick } from "../hooks/useDisplayTick.js";
import { sensorAge } from "../lib/serialParser.js";
import { useSession } from "../state/SessionContext.jsx";

const fmt = (v, d) => (v == null ? "—" : v.toFixed(d));

/**
 * Live sensor values with green/red dots. Re-reads latestSensorRef on the
 * 4 Hz display tick, so only this component re-renders.
 * size="large" is the calibration screen; "small" is the operator panel.
 */
export default function LiveValues({ size = "small" }) {
  const now = useDisplayTick();
  const { refs } = useSession();
  const s = refs.latestSensorRef.current;
  const fresh = sensorAge(s, now) <= CONFIG.serial.staleMs;

  const items = [
    { key: "hr", label: "Heart rate", value: fmt(s?.hr, 0), unit: "bpm", ok: fresh && s.max30102 },
    { key: "gsr", label: "GSR", value: fmt(s?.gsr, 2), unit: "µS", ok: fresh && s.gsrConnected },
    { key: "temp", label: "Temperature", value: fmt(s?.temp, 1), unit: "°C", ok: fresh && s.ds18b20 },
    { key: "motion", label: "Motion", value: fmt(s?.motion, 3), unit: "g", ok: fresh && s.mpu6050 },
  ];

  return (
    <div className={"live-values " + size}>
      {items.map((it) => (
        <div key={it.key} className={"live-value " + (it.ok ? "ok" : "bad")}>
          <span className="lv-label">
            <span className="dot" aria-hidden="true" />
            {it.label}
          </span>
          <span className="lv-number">
            {it.value} <small>{it.unit}</small>
          </span>
        </div>
      ))}
    </div>
  );
}
