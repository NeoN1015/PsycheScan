import { useSession } from "../state/SessionContext.jsx";

/**
 * DEV ONLY "Simulate sensors" switch. Rendered only when import.meta.env.DEV
 * is true, so it is removed from the production build.
 */
export default function SimulateSwitch() {
  const { serial } = useSession();
  const usbInUse = serial.connected && !serial.simulated;
  return (
    <label className="sim-switch" title={usbInUse ? "Disconnect the USB device first" : ""}>
      <input
        type="checkbox"
        checked={serial.simulated}
        disabled={usbInUse}
        onChange={(e) => (e.target.checked ? serial.startSim() : serial.stopSim())}
      />
      Simulate sensors <span className="dev-tag">DEV</span>
    </label>
  );
}
