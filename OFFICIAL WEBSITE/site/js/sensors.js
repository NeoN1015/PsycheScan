/* ESP32 sensor intake over USB Web Serial (115200 baud), plus the dev-only simulator (?sim=1).
 *
 * The ESP32 prints one JSON line per second:
 *   {"hr":78.4,"gsr":2.15,"temp":34.6,"motion":0.042,"dataValid":true,
 *    "max30102":true,"gsrConnected":true,"ds18b20":true,"mpu6050":true}
 * Lines starting with "#" are debug output and are ignored, as is any "stress" field.
 */

const SIM_ENABLED = new URLSearchParams(window.location.search).get("sim") === "1";
const serialSupported = "serial" in navigator;

/* ---------- Reading accessors ---------- */

function sourceOnline() {
  return state.serial.status === "connected" || state.simActive;
}

// A reading is live when a valid value arrived recently from an open connection.
function getLiveValue(key) {
  const latest = state.latest[key];
  return sourceOnline() && latest.at && Date.now() - latest.at <= CONFIG.serial.staleAfterMs ? latest.value : null;
}

// The last valid value, kept on screen after the sensor stops sending.
function getHeldValue(key) {
  return state.latest[key].value;
}

function liveSensorCount() {
  return SENSOR_KEYS.filter(key => Number.isFinite(getLiveValue(key))).length;
}

function sensorLogSince(sinceMs) {
  return state.sensorLog.filter(entry => entry.t >= sinceMs);
}

function clearSensorReadings() {
  SENSOR_KEYS.forEach(key => { state.latest[key] = { value: null, at: 0 }; });
  state.sensorLog = [];
}

/* ---------- Packet parsing ---------- */

function handleSensorLine(line) {
  const text = line.trim();
  if (!text) return;
  if (text.startsWith("#") || !text.startsWith("{")) {
    state.serial.ignoredLines += 1;
    return;
  }
  let packet;
  try {
    packet = JSON.parse(text);
  } catch {
    state.serial.ignoredLines += 1;
    return;
  }
  if (!packet || typeof packet !== "object" || Array.isArray(packet)) {
    state.serial.ignoredLines += 1;
    return;
  }
  applyPacket(packet, text);
}

function readPacketValue(packet, key) {
  const meta = CONFIG.sensors[key];
  const value = typeof packet[key] === "number" ? packet[key] : Number(packet[key]);
  if (packet[meta.flag] !== true) return null;
  // dataValid=false means no skin contact at all; motion does not depend on contact.
  if (packet.dataValid === false && key !== "motion") return null;
  if (!Number.isFinite(value) || value < meta.validMin || value > meta.validMax) return null;
  return value;
}

function applyPacket(packet, raw) {
  const now = Date.now();
  const entry = { t: now };
  SENSOR_KEYS.forEach(key => {
    const value = readPacketValue(packet, key);
    entry[key] = value;
    if (value !== null) state.latest[key] = { value, at: now };
  });
  state.sensorLog.push(entry);
  const cutoff = now - CONFIG.runtime.sensorLogKeepSec * 1000;
  while (state.sensorLog.length && state.sensorLog[0].t < cutoff) state.sensorLog.shift();

  state.serial.packets += 1;
  state.serial.lastPacketAt = now;
  state.serial.lastRaw = raw;
  onSensorPacket(entry);
}

/* ---------- USB Web Serial ---------- */

function portMatches(port, info) {
  if (!info) return false;
  const candidate = port.getInfo();
  return candidate.usbVendorId === info.usbVendorId && candidate.usbProductId === info.usbProductId;
}

async function connectSerial() {
  if (!serialSupported) {
    alert("USB connection needs desktop Chrome or Edge, opened through https:// or localhost.");
    return;
  }
  if (state.serial.status === "connecting" || state.serial.status === "connected") return;
  let port;
  try {
    port = await navigator.serial.requestPort();
  } catch (error) {
    if (error.name !== "NotFoundError") alert(`Could not select a serial port: ${error.message}`);
    return;   // NotFoundError: the user closed the port picker
  }
  await openPort(port);
}

async function openPort(port) {
  if (state.simActive) stopSimulation();
  const previousStatus = state.serial.status;
  state.serial.status = "connecting";
  renderSerialStatus();
  try {
    await port.open({ baudRate: CONFIG.serial.baudRate });
  } catch (error) {
    state.serial.status = previousStatus === "lost" ? "lost" : "disconnected";
    renderSerialStatus();
    alert(`Failed to open serial port. Close the Arduino Serial Monitor or any other program using it.\n\n${error.message}`);
    return false;
  }
  state.serial.port = port;
  state.serial.portInfo = port.getInfo();
  state.serial.status = "connected";
  state.serial.readLoop = readSerialLoop(port);
  renderSerialStatus();
  return true;
}

async function readSerialLoop(port) {
  const decoder = new TextDecoder();
  let buffer = "";
  while (port.readable && state.serial.port === port && state.serial.status === "connected") {
    const reader = port.readable.getReader();
    state.serial.reader = reader;
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop();
        if (buffer.length > CONFIG.serial.maxLineLength) buffer = "";
        lines.forEach(handleSensorLine);
      }
    } catch (error) {
      // NetworkError: the device was unplugged. Framing/parity/overrun errors are recoverable,
      // so the outer loop takes a fresh reader and keeps going.
      if (error.name === "NetworkError") {
        reader.releaseLock();
        state.serial.reader = null;
        markPortLost(port);
        return;
      }
    }
    reader.releaseLock();
    state.serial.reader = null;
  }
}

function markPortLost(port) {
  if (state.serial.port !== port || state.serial.status !== "connected") return;
  state.serial.status = "lost";
  state.serial.port = null;
  state.serial.readLoop = null;
  port.close().catch(() => {});   // already gone; closing just releases the handle
  renderSerialStatus();
}

async function disconnectSerial() {
  const port = state.serial.port;
  state.serial.status = "disconnected";
  state.serial.port = null;
  if (state.serial.reader) await state.serial.reader.cancel().catch(() => {});
  if (state.serial.readLoop) await state.serial.readLoop;
  state.serial.readLoop = null;
  if (port) await port.close().catch(() => {});
  if (state.simActive) stopSimulation();
  renderSerialStatus();
}

async function reconnectSerial() {
  if (state.serial.simLost) {
    state.serial.simLost = false;
    state.serial.status = "disconnected";
    startSimulation();
    return;
  }
  if (!serialSupported) return;
  setText("disconnectBannerText", "Reconnecting…");
  const ports = await navigator.serial.getPorts();
  const known = ports.find(port => portMatches(port, state.serial.portInfo));
  if (known && await openPort(known)) return;
  // Not found (or it failed to open): let the user pick the port again.
  const filters = state.serial.portInfo?.usbVendorId
    ? [{ usbVendorId: state.serial.portInfo.usbVendorId }]
    : [];
  try {
    const port = await navigator.serial.requestPort({ filters });
    await openPort(port);
  } catch {
    renderSerialStatus();
  }
}

function bindSerialEvents() {
  if (!serialSupported) return;
  navigator.serial.addEventListener("disconnect", event => markPortLost(event.target));
  // The same ESP32 plugged back in: reopen it without asking.
  navigator.serial.addEventListener("connect", event => {
    if (state.serial.status === "lost" && !state.serial.simLost && portMatches(event.target, state.serial.portInfo)) {
      setText("disconnectBannerText", "Reconnecting…");
      openPort(event.target);
    }
  });
}

/* ---------- Simulator (dev only, ?sim=1) ---------- */

const sim = { timer: null, tick: 0, values: null };

function startSimulation() {
  if (!SIM_ENABLED || state.simActive || state.serial.status === "connected") return;
  const target = CONFIG.sim;
  // Start away from the resting values so calibration has something to settle.
  sim.values = { hr: target.hr + 9, gsr: target.gsr + 0.6, temp: target.temp - 0.9, motion: target.motion };
  sim.tick = 0;
  state.simActive = true;
  sim.timer = setInterval(simulationStep, 1000);
  renderSerialStatus();
}

function stopSimulation() {
  clearInterval(sim.timer);
  sim.timer = null;
  state.simActive = false;
  renderSerialStatus();
}

function simulationStep() {
  const target = CONFIG.sim;
  const noise = scale => (Math.random() - 0.5) * 2 * scale;
  const v = sim.values;
  v.hr += (target.hr - v.hr) * 0.08 + noise(1.2);
  v.gsr += (target.gsr - v.gsr) * 0.08 + noise(0.02);
  v.temp += (target.temp - v.temp) * 0.06 + noise(0.015);
  v.motion = Math.max(0, target.motion + noise(0.02));
  sim.tick += 1;
  const fingerOn = Math.random() > 0.03;
  if (sim.tick % 15 === 0) handleSensorLine("# sim: debug line (ignored)");
  handleSensorLine(JSON.stringify({
    hr: fingerOn ? Number(v.hr.toFixed(1)) : 0,
    gsr: Number(v.gsr.toFixed(2)),
    temp: Number(v.temp.toFixed(1)),
    motion: Number(v.motion.toFixed(3)),
    stress: "IGNORED",
    dataValid: true,
    max30102: fingerOn,
    gsrConnected: true,
    ds18b20: true,
    mpu6050: true
  }));
}

function simulateUnplug() {
  if (!state.simActive) return;
  stopSimulation();
  state.serial.simLost = true;
  state.serial.status = "lost";
  renderSerialStatus();
}

/* ---------- Rendering ---------- */

function renderSerialStatus() {
  const status = state.serial.status;
  const badgeText = state.simActive ? "SIMULATED"
    : { connected: "CONNECTED", connecting: "CONNECTING", lost: "LOST", disconnected: "DISCONNECTED" }[status];
  setStatusChip($("serialBadge"), status === "lost" ? "danger" : status === "connected" || state.simActive ? "success" : "muted", badgeText);
  setText("serialStatusText", state.simActive ? "Simulated (?sim=1)" : capitalize(status));

  const banner = $("disconnectBanner");
  if (banner) {
    banner.hidden = status !== "lost";
    document.body.classList.toggle("has-banner", status === "lost");
    if (status === "lost") setText("disconnectBannerText", "The USB connection to the ESP32 was lost. Plug it back in, then choose Reconnect.");
  }
  const connectButton = $("connectSerialBtn");
  if (connectButton) connectButton.disabled = status === "connecting" || status === "connected";
  const simButton = $("simulateSensorsBtn");
  if (simButton) {
    simButton.hidden = !SIM_ENABLED;
    simButton.querySelector("span").textContent = state.simActive ? "Stop simulation" : "Simulate sensors";
  }
  const unplugButton = $("simulateUnplugBtn");
  if (unplugButton) unplugButton.hidden = !SIM_ENABLED || !state.simActive;
  updateSystemStatus();
}

function renderSensorGrid() {
  const grid = $("sensorGrid");
  if (!grid) return;
  grid.innerHTML = SENSOR_KEYS.map(key => {
    const meta = CONFIG.sensors[key];
    const live = getLiveValue(key);
    const held = getHeldValue(key);
    const isHeld = !Number.isFinite(live) && Number.isFinite(held);
    const [stateClass, stateLabel] = Number.isFinite(live)
      ? (state.simActive ? ["demo", "SIMULATED"] : ["connected", "CONNECTED"])
      : sourceOnline() ? ["searching", "WAITING"] : ["disconnected", "DISCONNECTED"];
    return `
      <div class="sensor-card">
        <div class="sensor-meta">
          <div class="sensor-name">${escapeHtml(meta.name)}</div>
          <div class="sensor-channel">${escapeHtml(meta.channel)}</div>
        </div>
        <div class="sensor-reading ${Number.isFinite(held) ? "" : "empty"} ${isHeld ? "held" : ""}"${isHeld ? ' title="Last received reading; the sensor is not sending new data"' : ""}>
          ${Number.isFinite(held) ? escapeHtml(formatSensor(key, held)) : "No data"}
        </div>
        <div class="sensor-state ${stateClass}">${stateLabel}</div>
      </div>`;
  }).join("");

  setText("lastPacketTime", state.serial.lastPacketAt ? new Date(state.serial.lastPacketAt).toLocaleString() : "No packet received");
  setText("lastPacketRaw", state.serial.lastRaw);
  setText("packetCounts", `${state.serial.packets} / ${state.serial.ignoredLines}`);
}

function bindSensorControls() {
  $("connectSerialBtn")?.addEventListener("click", connectSerial);
  $("disconnectSerialBtn")?.addEventListener("click", disconnectSerial);
  $("reconnectSerialBtn")?.addEventListener("click", reconnectSerial);
  $("simulateSensorsBtn")?.addEventListener("click", () => (state.simActive ? stopSimulation() : startSimulation()));
  $("simulateUnplugBtn")?.addEventListener("click", simulateUnplug);
  const note = $("serialSupportNote");
  if (note) note.hidden = serialSupported;
  bindSerialEvents();
}
