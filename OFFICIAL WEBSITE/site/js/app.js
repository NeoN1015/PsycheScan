/* Page navigation, settings, theme, the once-per-second loop, and start-up. */

const PAGE_META = {
  dashboard: ["Dashboard", "Live camera feed and vital signs for stress and anxiety screening"],
  profiles: ["Patient Profiles", "Baselines and records for each patient"],
  live: ["Live Monitoring Hub", "Session status, live feed and capture settings"],
  sensors: ["Sensors", "ESP32 over USB: pulse sensor, GSR, DS18B20 and MPU6050"],
  summary: ["Status Summary", "Current readings compared with the patient's baseline"],
  reports: ["Reports", "Saved records, CSV export and printable report"],
  settings: ["Settings", "Appearance, camera and detection settings"]
};

function switchPage(page) {
  const section = $(`${page}Page`);
  if (!section) return;
  document.querySelectorAll(".page-section").forEach(element => element.classList.toggle("active-section", element === section));
  document.querySelectorAll(".nav-item").forEach(button => button.classList.toggle("active", button.dataset.page === page));
  setText("pageTitle", PAGE_META[page][0]);
  setText("pageSubtitle", PAGE_META[page][1]);
}

/* ---------- Settings ---------- */

const NUMERIC_SETTINGS = ["detectionInterval", "detectorInputSize", "smoothingFactor", "firstReadingDelaySec", "customDurationMin"];

function syncSettingControls() {
  document.querySelectorAll("[data-setting]").forEach(control => {
    const value = state.settings[control.dataset.setting];
    if (control.type === "checkbox") control.checked = Boolean(value);
    else control.value = String(value);
  });
}

function onSettingChanged(key, control) {
  let value = control.type === "checkbox" ? control.checked : control.value;
  if (NUMERIC_SETTINGS.includes(key)) {
    value = Number(value);
    if (!Number.isFinite(value)) return syncSettingControls();
    if (key === "customDurationMin") value = clamp(Math.round(value), 1, 60);
  }
  state.settings[key] = value;
  saveSettings();
  syncSettingControls();
  if (key === "theme" || key === "appearance") {
    applyTheme();
    buildCharts();
  }
  if (key === "mirrorCamera") applyTheme();
  if (key === "detectionInterval") restartDetectionLoop();
  // The SSD detector is only loaded for the stronger profiles.
  if (key === "detectionProfile" && state.modelsLoaded) {
    state.modelsLoaded = false;
    loadModels();
  }
  renderBaseline();
}

function bindSettings() {
  document.querySelectorAll("[data-setting]").forEach(control => {
    control.addEventListener("change", () => onSettingChanged(control.dataset.setting, control));
  });
  $("resetSettingsBtn")?.addEventListener("click", () => {
    state.settings = { ...DEFAULT_SETTINGS };
    saveSettings();
    syncSettingControls();
    applyTheme();
    buildCharts();
    restartDetectionLoop();
    renderBaseline();
  });
}

function resolvedAppearance() {
  if (state.settings.appearance === "auto") {
    return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  return state.settings.appearance === "dark" ? "dark" : "light";
}

function applyTheme() {
  document.body.dataset.theme = state.settings.theme;
  document.body.dataset.appearance = resolvedAppearance();
  document.querySelectorAll(".camera-video, .camera-overlay").forEach(element => element.classList.toggle("mirrored", Boolean(state.settings.mirrorCamera)));
}

/* ---------- Status and live readings ---------- */

function updateSystemStatus() {
  const dot = $("systemStatusDot");
  const sensorsOn = sourceOnline();
  let text = "Ready";
  let dotClass = "status-dot pulsing";
  if (state.serial.status === "lost") {
    text = "Sensor disconnected";
    dotClass = "status-dot danger";
  } else if (state.calibration.status === "running") {
    text = "Calibrating";
    dotClass = "status-dot amber pulsing";
  } else if (state.baselineCapture.active) {
    text = "Capturing baseline";
    dotClass = "status-dot amber pulsing";
  } else if (state.cameraActive && sensorsOn) {
    text = "Camera & sensors live";
  } else if (sensorsOn) {
    text = state.simActive ? "Simulated sensors" : "Sensors live";
  } else if (state.cameraActive) {
    text = "Camera active";
  }
  setText("systemStatus", text);
  if (dot) dot.className = dotClass;
}

function renderLiveReadings() {
  const ids = { hr: ["dashboardHrValue", "liveHr"], gsr: ["dashboardGsrValue", "liveGsr"], temp: ["dashboardTempValue", "liveTemp"], motion: ["dashboardMotionValue", "liveMotion"] };
  SENSOR_KEYS.forEach(key => {
    const live = getLiveValue(key);
    const held = getHeldValue(key);
    ids[key].forEach(id => {
      const element = $(id);
      if (!element) return;
      element.textContent = formatSensor(key, Number.isFinite(live) ? live : held);
      element.classList.toggle("held", !Number.isFinite(live) && Number.isFinite(held));
    });
  });
  const count = liveSensorCount();
  setText("metricSync", `${count} / 4`);
  setText("summarySensors", `${count} of 4`);
  setText("summaryEmotion", state.dominantEmotion);
  setText("summaryFatigue", formatPercent(state.visualFatigue.fatigue));
  setText("summaryEyebag", formatPercent(state.visualFatigue.eyebag));
  setText("summaryWrinkle", formatPercent(state.visualFatigue.wrinkle));
  const anyLive = state.cameraActive || count > 0;
  setStatusChip($("summaryStatusBadge"), anyLive ? "success" : "muted", anyLive ? "Live" : "No live data");
  setText("summaryNarrative", anyLive
    ? (getActiveBaseline()
      ? "Current readings compared with this patient's baseline. These are measurements, not a diagnosis."
      : "Live readings are arriving. Capture a baseline to see the change from resting values.")
    : "Start the camera and/or connect the sensors to see the current readings.");
}

function renderAll() {
  renderSensorGrid();
  renderSerialStatus();
  renderFace();
  renderLiveReadings();
  renderBaseline();
  renderRecords();
  renderLstm();
  updateCharts();
}

/* ---------- Event hooks ---------- */

// Called by sensors.js for every received packet.
function onSensorPacket(entry) {
  addBaselineSensorEntry(entry);
  updateCalibration(entry.t);
  renderSensorGrid();
  renderLiveReadings();
  updateCharts();
}

function tick() {
  const now = Date.now();
  setText("clockPill", new Date(now).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", second: "2-digit" }));
  setText("cameraTime", new Date(now).toLocaleTimeString());
  recordFaceSample(now);
  addBaselineFaceSample(state.cameraActive ? state.faceLog[state.faceLog.length - 1] : null);
  updateBaselineCapture(now);
  updateCalibration(now);
  captureRecord(now);
  renderSensorGrid();
  renderLiveReadings();
  renderBaseline();
  updateSystemStatus();
  updateCharts();
}

function clearLiveReadings() {
  if (!confirm("Clear the live readings and charts? A running baseline capture is canceled. Saved baselines and records stay.")) return;
  if (state.baselineCapture.active) {
    state.baselineCapture = { active: false, startedAt: 0, endsAt: 0, error: "Baseline capture canceled because the readings were cleared." };
  }
  clearSensorReadings();
  state.faceLog = [];
  resetFaceState();
  resetLstmPrediction();
  renderAll();
}

function bindBaselineToggle() {
  const button = $("toggleBaselineCardBtn");
  const card = document.querySelector(".dashboard-baseline-card");
  if (!button || !card) return;
  const setCollapsed = collapsed => {
    card.classList.toggle("collapsed", collapsed);
    setText("baselineToggleText", collapsed ? "Show Baseline" : "Hide Baseline");
    $("baselineToggleIcon")?.setAttribute("data-lucide", collapsed ? "chevron-down" : "chevron-up");
    refreshIcons(button);
    try {
      localStorage.setItem(STORAGE_KEYS.baselineCollapsed, collapsed ? "1" : "0");
    } catch { /* preference only */ }
  };
  try {
    if (localStorage.getItem(STORAGE_KEYS.baselineCollapsed) === "1") setCollapsed(true);
  } catch { /* preference only */ }
  button.addEventListener("click", () => setCollapsed(!card.classList.contains("collapsed")));
}

function init() {
  loadSettings();
  loadCollections();
  if (state.activeProfileId) {
    state.sessionId = `session-${Date.now()}`;
    state.sessionStartedAt = Date.now();
  }
  applyTheme();
  syncSettingControls();
  window.matchMedia?.("(prefers-color-scheme: dark)").addEventListener?.("change", () => {
    if (state.settings.appearance === "auto") {
      applyTheme();
      buildCharts();
    }
  });

  $("sidebarNav").addEventListener("click", event => {
    const button = event.target.closest(".nav-item");
    if (button) switchPage(button.dataset.page);
  });
  bindSettings();
  bindSensorControls();
  bindCameraControls();
  bindCalibrationControls();
  bindProfileControls();
  bindRecordControls();
  bindBaselineToggle();
  $("captureBaselineBtn")?.addEventListener("click", startBaselineCapture);
  $("clearReadingsBtn")?.addEventListener("click", clearLiveReadings);

  renderProfiles();
  buildCharts();
  renderAll();
  refreshIcons();
  populateCameraDevices();
  loadLstm();
  setInterval(tick, 1000);
  tick();
}

document.addEventListener("DOMContentLoaded", init, { once: true });
