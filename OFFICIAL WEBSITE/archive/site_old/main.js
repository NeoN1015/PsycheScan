const STORAGE_KEYS = {
  settings: "cnn_lstm_settings"
};

const state = {
  page: "dashboard",
  mode: "Real-Time",
  loggedInUser: "Guest",

  modelsLoaded: false,
  cameraActive: false,
  detectionFrameActive: false,
  stream: null,
  detectLoop: null,

  serialConnected: false,
  serialPort: null,
  serialReader: null,
  serialKeepReading: false,
  lastPacketTimestamp: 0,
  lastPacketRaw: "—",

  settings: {
    theme: "royal-violet",
    appearance: "light",
    mirrorCamera: true,
    showLandmarks: true,
    detectionInterval: 160,
    detectorInputSize: 512,
    smoothingFactor: 0.4,
    autoCapture: true,
    demoSensors: false,
    firstReadingDelaySec: 0,
    observationDurationSec: 180,
    customDurationSec: 180,
    connectionMode: "serial",
    samplingIntervalMs: 1000
  },

  sensors: createInitialSensors(),

  sensorValues: {
    hr: null,
    gsr: null,
    temp: null,
    tempDrop: null,
    motion: null
  },
  // Last valid reading per sensor, held for display until a new valid reading arrives.
  displaySensorValues: {
    hr: null,
    gsr: null,
    temp: null,
    motion: null
  },
  sensorContact: {
    hr: false,
    gsr: false,
    temp: false,
    motion: false
  },

  emotionRaw: {
    neutral: 0,
    happy: 0,
    sad: 0,
    angry: 0,
    fearful: 0,
    disgusted: 0,
    surprised: 0
  },

  emotionSmoothed: {
    neutral: 0,
    happy: 0,
    sad: 0,
    angry: 0,
    fearful: 0,
    disgusted: 0,
    surprised: 0
  },

  dominantEmotion: "No Face",
  dominantConfidence: 0,

  visualFatigue: {
    eyebag: 0,
    wrinkle: 0,
    fatigue: 0
  },

  records: [],
  reports: [],
  faceSummaries: {},
  lastCaptureAt: 0,

  history: [],
  session: {
    id: null,
    startedAt: 0,
    firstReadingAt: 0,
    lstmPrediction: null,
    phase: "baseline",
    baselineCompletedAt: 0,
    baselineSummary: null,
    baselineCaptureActive: false,
    baselineEndsAt: 0,
    baselineTimer: null,
    baselineError: ""
  },
  lastHistorySampleAt: 0,
  charts: {
    live: null,
    emotion: null,
    sensorHr: null,
    sensorGsr: null,
    sensorTemp: null,
    sensorMotion: null
  },

  selectedRecord: null
};

const offscreenCanvas = document.createElement("canvas");
const offscreenCtx = offscreenCanvas.getContext("2d", { willReadFrequently: true });

const pageMeta = {
  dashboard: ["Dashboard", "Live camera feed and biometric sensor fusion for stress/anxiety screening"],
  profiles: ["Patient Profiles", "Baseline summaries and longitudinal records for each patient"],
  live: ["Live Monitoring Hub", "Camera controls, sensor connections, and capture settings"],
  sensors: ["Sensors", "Real‑time serial intake from MAX30102, GSR, DS18B20, MPU6050 via ESP32"],
  summary: ["Status Summary", "Classification: Minimal / Mild / Moderate / Severe — integrated decision support"],
  reports: ["Reports", "Exportable session logs for clinical benchmarking and documentation"],
  settings: ["Settings", "UI theme, detection thresholds, and runtime parameter tuning"]
};

const sensorMeta = getSensorMeta();

function $(id) {
  return document.getElementById(id);
}

function getIntegratedSeverityLabel(score) {
  const thresholds = PROJECT_CONFIG.severity.score;
  if (score >= thresholds.severe) return "Severe";
  if (score >= thresholds.moderate) return "Moderate";
  if (score >= thresholds.mild) return "Mild";
  return "Minimal";
}

function getSavedFaceSummary(profileId, profileName) {
  const normalizedName = String(profileName || "").trim().toLowerCase();
  const records = Array.isArray(state.records) ? state.records : [];
  const profileRecords = records.filter(record => {
    if (record.profileId) return record.profileId === profileId;
    return normalizedName && String(record.profileName || "").trim().toLowerCase() === normalizedName;
  });
  if (!profileRecords.length) return null;

  const faceRecords = profileRecords.filter(record => {
    const emotion = String(record.emotion || "").trim().toLowerCase();
    return emotion && !["no face", "no face detected", "none"].includes(emotion);
  });
  if (!faceRecords.length) return null;

  const mean = key => {
    const values = faceRecords.map(record => record[key]).filter(Number.isFinite);
    return values.length ? values.reduce((total, value) => total + value, 0) / values.length : null;
  };
  const emotionCounts = new Map();
  faceRecords.forEach(record => {
    const emotion = String(record.emotion || "").trim();
    if (emotion) emotionCounts.set(emotion, (emotionCounts.get(emotion) || 0) + 1);
  });
  const dominantEmotion = [...emotionCounts.entries()]
    .sort((left, right) => right[1] - left[1])[0]?.[0] || null;

  return {
    faceSampleCount: faceRecords.length,
    faceDetectionRate: (faceRecords.length / profileRecords.length) * 100,
    dominantEmotion,
    fatigue: mean("fatigue"),
    wrinkle: mean("wrinkle"),
    eyebag: mean("eyebag"),
    source: "Saved records"
  };
}

function getTelemetryFaceSummary(profileId) {
  const summary = state.faceSummaries?.[profileId];
  return summary && Number.isFinite(summary.faceSampleCount) && summary.faceSampleCount > 0
    ? summary
    : null;
}

function getProfileFaceSummary(profileId, profileName) {
  return getSavedFaceSummary(profileId, profileName) || getTelemetryFaceSummary(profileId);
}

function hasFaceMeasurements(summary) {
  if (!summary || typeof summary !== "object") return false;
  if (Number.isFinite(summary.faceSampleCount)) return summary.faceSampleCount > 0;
  const emotion = String(summary.dominantEmotion || "").trim().toLowerCase();
  return Boolean(emotion && !["no face", "no face detected", "none"].includes(emotion))
    || ["fatigue", "wrinkle", "eyebag"].some(key => Number.isFinite(summary[key]) && summary[key] !== 0);
}

function renderDashboardBaselineSummary() {
  const summary = state.session.baselineSummary;
  const profileName = state.session.profileName || "";
  const caption = $("dashboardBaselineCaption");
  const level = $("dashboardBaselineLevel");
  const score = $("dashboardBaselineScore");
  if (!caption || !level || !score) return;

  if (!summary) {
    const capturing = state.session.baselineCaptureActive;
    caption.textContent = capturing
      ? `Capturing a new baseline for ${profileName || "the active patient"}; the summary will update when capture completes.`
      : profileName
        ? `${profileName} has no captured baseline yet.`
        : "Select a patient and capture a baseline to see the summary.";
    level.className = "status-badge muted";
    level.textContent = capturing ? "Capturing" : "Not recorded";
    score.textContent = "-- / 100";
  } else {
    const completedAt = Number.isFinite(summary.completedAt)
      ? new Date(summary.completedAt).toLocaleString()
      : "date unavailable";
    caption.textContent = `${profileName || "Active patient"} · captured ${completedAt} · ${summary.samples || 0} sensor sample(s)`;
    if (Number.isFinite(summary.score)) {
      const label = getIntegratedSeverityLabel(summary.score);
      level.className = `severity-badge ${getSeverityBadgeClass(label)}`;
      level.textContent = label;
      score.textContent = `${Math.round(summary.score)} / 100`;
    } else {
      level.className = "status-badge muted";
      level.textContent = "Score unavailable";
      score.textContent = "-- / 100";
    }
  }

  const setBaselineValue = (id, value, unit, decimals = 1) => {
    const element = $(id);
    if (element) element.textContent = Number.isFinite(value) ? `${Number(value).toFixed(decimals)}${unit}` : "--";
  };
  setBaselineValue("dashboardBaselineHr", summary?.hr, " bpm");
  setBaselineValue("dashboardBaselineGsr", summary?.gsr, " µS", 2);
  setBaselineValue("dashboardBaselineTemp", summary?.temp, " °C");
  setBaselineValue("dashboardBaselineMotion", summary?.motion, " g", 3);

  const hasBaselineFaceData = hasFaceMeasurements(summary);
  const fallbackFaceSummary = getProfileFaceSummary(state.session.profileId, profileName);
  const faceSummary = hasBaselineFaceData ? summary : fallbackFaceSummary;
  const faceSource = $("dashboardBaselineFaceSource");
  if (faceSource) {
    faceSource.textContent = hasBaselineFaceData
      ? "Captured baseline"
      : fallbackFaceSummary?.source === "Live baseline telemetry"
        ? `Live baseline avg · ${fallbackFaceSummary.faceSampleCount} samples`
        : fallbackFaceSummary
          ? `Saved-record avg · ${fallbackFaceSummary.faceSampleCount} records`
        : "No face data";
  }

  const faceElement = $("dashboardBaselineFace");
  if (faceElement) {
    faceElement.textContent = Number.isFinite(faceSummary?.faceSampleCount)
      ? `${Math.round(faceSummary.faceDetectionRate || 0)}% · ${faceSummary.faceSampleCount} ${(hasBaselineFaceData || faceSummary.source === "Live baseline telemetry") ? "sample(s)" : "record(s)"}`
      : summary?.faceSampleCount === 0 ? "0% · 0 sample(s)" : summary ? "Not recorded" : "--";
  }
  const emotionElement = $("dashboardBaselineEmotion");
  if (emotionElement) {
    emotionElement.textContent = faceSummary?.dominantEmotion
      || (summary?.faceSampleCount === 0 ? "No face detected" : summary ? "Not recorded" : "--");
  }
  const setFaceMetric = (id, value) => {
    const element = $(id);
    if (!element) return;
    if (!Number.isFinite(value)) {
      element.textContent = summary ? "Not captured" : "--";
      return;
    }
    element.textContent = `${Math.round(value)}% · ${getSeverityLabelFromPercent(value)}`;
  };
  setFaceMetric("dashboardBaselineFatigue", faceSummary?.fatigue);
  setFaceMetric("dashboardBaselineWrinkle", faceSummary?.wrinkle);
  setFaceMetric("dashboardBaselineEyebag", faceSummary?.eyebag);
}

function loadLocalJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (error) {
    console.warn(`Failed to read local data: ${key}`, error);
    return fallback;
  }
}

function saveLocalJSON(key, value) {
  try {
    if (value === null || value === undefined) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (error) {
    if (error.name === "QuotaExceededError" || error.code === 22) {
      console.error(`[Storage] Quota exceeded for key "${key}". Data was not persisted. Consider clearing old data.`);
      window.dispatchEvent(new CustomEvent("storage-quota-exceeded", { detail: { key } }));
    } else {
      console.warn(`Failed to save local data: ${key}`, error);
    }
    return false;
  }
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, character => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;"
  })[character]);
}

function qs(selector) {
  return document.querySelector(selector);
}

function clamp(value, min, max) {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

function average(values) {
  const valid = (values || []).filter(value => Number.isFinite(value));
  if (!valid.length) return 0;
  return valid.reduce((a, b) => a + b, 0) / valid.length;
}

function formatNumber(value, decimals = 1) {
  if (value === null || value === undefined || Number.isNaN(value)) return "--";
  return Number(value).toFixed(decimals);
}

function safePercent(value) {
  return `${Number.isFinite(value) ? Math.round(value) : 0}%`;
}

function getSeverityLabelFromPercent(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "Minimal";
  const bands = PROJECT_CONFIG.severity.percentBands;
  if (numeric <= bands.minimalMax) return "Minimal";
  if (numeric <= bands.mildMax) return "Mild";
  if (numeric <= bands.moderateMax) return "Moderate";
  return "Severe";
}

function getSeverityBadgeClass(label) {
  const normalized = String(label || "Minimal").toLowerCase();
  if (normalized === "mild") return "mild";
  if (normalized === "moderate") return "moderate";
  if (normalized === "severe") return "severe";
  return "minimal";
}

function getSeverityBadgeMarkup(label, extraClass = "") {
  const severityClass = getSeverityBadgeClass(label);
  const safeExtra = /^[a-z-]*$/.test(extraClass) ? extraClass : "";
  return `<span class="severity-badge ${severityClass} ${safeExtra}">${escapeHtml(label)}</span>`;
}

const SEVERITY_LEVELS = ["Minimal", "Mild", "Moderate", "Severe"];

// Level index 0-3. Mild/Moderate start AT their min; Severe starts strictly ABOVE
// `severeAbove` (Table 1: ">105 bpm", ">4.0 µS", ">0.20 g"), or AT `severeMin` (temperature drop ≥ 1.6 °C).
// EPS absorbs floating-point error at exact boundaries (34.0 − 33.7 = 0.2999…, not 0.3).
const THRESHOLD_EPS = 1e-9;
function levelFromBands(value, mildMin, moderateMin, { severeAbove, severeMin }) {
  if (!Number.isFinite(value)) return 0;
  const severe = Number.isFinite(severeAbove)
    ? value > severeAbove + THRESHOLD_EPS
    : value >= severeMin - THRESHOLD_EPS;
  if (severe) return 3;
  if (value >= moderateMin - THRESHOLD_EPS) return 2;
  if (value >= mildMin - THRESHOLD_EPS) return 1;
  return 0;
}

// Rolling motion buffer: one entry per received motion reading (hardware or demo).
// Kept separate from state.history, which skips samples without an active profile.
const motionSamples = [];

function pruneMotionSamples(now = Date.now()) {
  const keepMs = (PROJECT_CONFIG.biomarkers.motion.sustainedWindowSec || 30) * 1000;
  while (motionSamples.length && now - motionSamples[0].t > keepMs) motionSamples.shift();
}

function recordMotionSample(value, now = Date.now()) {
  if (!Number.isFinite(value)) return;
  motionSamples.push({ t: now, v: value });
  pruneMotionSamples(now);
}

function clearMotionSamples() {
  motionSamples.length = 0;
}

function medianOf(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Motion level from the rolling window instead of a single reading:
 * 1. Base level = Table 1 band of the median over the last `windowSec`
 *    (a single spike or a reading wobbling on a band edge does not flip the label).
 * 2. Sustained bump: if the buffer covers ~`sustainedWindowSec` and at least
 *    `sustainedFraction` of it is at or above the base band, raise one level.
 *    Minimal never escalates; Severe is already the top.
 * Too few samples → classify the current reading alone.
 */
function getMotionWindowLevel(currentValue) {
  const t = PROJECT_CONFIG.biomarkers.motion;
  const now = Date.now();
  pruneMotionSamples(now);
  const windowMs = (t.windowSec || 10) * 1000;
  const recent = motionSamples.filter(sample => now - sample.t <= windowMs).map(sample => sample.v);
  if (recent.length < (t.minWindowSamples || 3)) {
    return levelFromBands(currentValue, t.mildMin, t.moderateMin, t);
  }

  const baseLevel = levelFromBands(medianOf(recent), t.mildMin, t.moderateMin, t);
  if (baseLevel === 0 || baseLevel === 3) return baseLevel;

  const sustainedMs = (t.sustainedWindowSec || 30) * 1000;
  const coveredMs = now - motionSamples[0].t;
  if (coveredMs < sustainedMs * 0.9) return baseLevel;

  const lowerBound = baseLevel === 1 ? t.mildMin : t.moderateMin;
  const atOrAbove = motionSamples.filter(sample => sample.v >= lowerBound - THRESHOLD_EPS).length;
  return atOrAbove / motionSamples.length >= (t.sustainedFraction ?? 0.7) ? baseLevel + 1 : baseLevel;
}

/**
 * Classify one biomarker with the Table 1 thresholds.
 * - HR and GSR: the more severe of the absolute level and the relative level
 *   (% rise over the patient's captured baseline, when a baseline exists).
 * - Temperature: drop from baseline (from the ESP32 packet, else baseline − current).
 * - Motion: rolling-window level with a sustained-motion bump (see getMotionWindowLevel).
 */
function classifyBiomarkerSeverity(key, value, baseline = null) {
  if (value === null || value === undefined || (typeof value === "string" && !value.trim())) return "Minimal";
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "Minimal";

  const t = PROJECT_CONFIG.biomarkers[key];
  if (!t) return getSeverityLabelFromPercent(numeric);

  if (key === "temp") {
    const drop = Number.isFinite(state.sensorValues.tempDrop)
      ? state.sensorValues.tempDrop
      : Number.isFinite(baseline) ? baseline - numeric : null;
    return SEVERITY_LEVELS[levelFromBands(drop, t.mildMin, t.moderateMin, t)];
  }

  if (key === "motion") return SEVERITY_LEVELS[getMotionWindowLevel(numeric)];

  let level = levelFromBands(numeric, t.mildMin, t.moderateMin, t);
  const baselineValue = Number(baseline);
  // Table 2: a reading inside the Minimal range (HR 60–85 bpm, GSR 0.9–1.1 µS) is Minimal.
  // The % rise over baseline can only raise a reading that is already above that range.
  const aboveMinimalRange = !Number.isFinite(t.minimalMax) || numeric > t.minimalMax + THRESHOLD_EPS;
  if (aboveMinimalRange && Number.isFinite(t.relativeMildMin) && baseline !== null && Number.isFinite(baselineValue) && baselineValue > 0) {
    const percentRise = ((numeric - baselineValue) / baselineValue) * 100;
    const relativeLevel = levelFromBands(percentRise, t.relativeMildMin, t.relativeModerateMin, {
      severeAbove: t.relativeSevereAbove
    });
    level = Math.max(level, relativeLevel);
  }
  return SEVERITY_LEVELS[level];
}

function classifySensorStress() {
  const activeValues = ["hr", "gsr", "temp", "motion"].filter(key =>
    state.sensorContact[key] && Number.isFinite(state.sensorValues[key])
  );
  if (!activeValues.length) {
    return { level: "WAITING FOR SENSOR", votes: { severe: 0, moderate: 0, mild: 0, minimal: 0 } };
  }

  const votes = { severe: 0, moderate: 0, mild: 0, minimal: 0 };
  const addVotes = (key, value, count = 1, baseline = null) => {
    if (!Number.isFinite(value)) return;
    const severity = classifyBiomarkerSeverity(key, value, baseline).toLowerCase();
    votes[severity] += count;
  };
  // The patient's captured baseline drives the temperature drop and the HR/GSR % rules.
  const baseline = state.session.baselineSummary || {};

  activeValues.forEach(key => addVotes(
    key,
    state.sensorValues[key],
    key === "gsr" ? 2 : 1,
    Number.isFinite(baseline[key]) ? baseline[key] : null
  ));

  for (const severity of ["severe", "moderate", "mild", "minimal"]) {
    if (votes[severity] > 0) return { level: severity.toUpperCase(), votes };
  }
  return { level: "WAITING FOR SENSOR", votes };
}

function normalizeTelemetryNumber(value) {
  const candidate = Array.isArray(value) ? value[value.length - 1] : value;
  if (typeof candidate !== "number" && typeof candidate !== "string") return null;
  if (typeof candidate === "string" && !candidate.trim()) return null;
  const numeric = Number(candidate);
  return Number.isFinite(numeric) ? numeric : null;
}

function formatSeverityValue(key, value, baseline = null) {
  const label = classifyBiomarkerSeverity(key, value, baseline);
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return { label: "Minimal", text: "--" };

  const suffix = key === "hr" ? " bpm" : key === "gsr" ? " µS" : key === "temp" ? " °C" : key === "motion" ? " g" : "%";
  return {
    label,
    text: `${formatSensorValue(key, numeric)}${suffix}`.replace(/\s+/g, " ").trim()
  };
}

function humanTime(ts) {
  if (!ts) return "—";
  return new Date(ts).toLocaleString();
}

function capitalize(text) {
  if (!text) return text;
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function updateClock() {
  const now = new Date();
  $("clockPill").textContent = now.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit"
  });
  $("cameraTime").textContent = now.toLocaleTimeString();
}

function initHistory() {
  if (Array.isArray(state.history) && state.history.length) {
    state.lastHistorySampleAt = state.history[state.history.length - 1].timestamp || 0;
    return;
  }
  state.history = [];
  state.lastHistorySampleAt = 0;
}

function getObservationDurationSec() {
  const selected = state.settings.observationDurationSec === "custom"
    ? state.settings.customDurationSec
    : state.settings.observationDurationSec;
  return clamp(Number(selected) || 180, 30, 3600);
}

function getWindowHistory() {
  const cutoff = Date.now() - PROJECT_CONFIG.runtime.historyWindowMs;
  const profileId = state.session.profileId || state.activeProfileId;
  return state.history.filter(item =>
    (!profileId || item.profileId === profileId) && (!item.timestamp || item.timestamp >= cutoff)
  );
}

function formatHistoryLabel(timestamp) {
  return new Date(timestamp).toLocaleTimeString([], { minute: "2-digit", second: "2-digit" });
}

function historyPoints(history, selectValue, now = Date.now(), holdLast = false) {
  let lastValue = null;
  return history.flatMap(item => {
    if (!Number.isFinite(item.timestamp)) return [];
    let value = selectValue(item);
    if (Number.isFinite(value)) lastValue = value;
    else if (holdLast && lastValue !== null) value = lastValue;
    else return [];
    return [{ x: (item.timestamp - now) / 1000, y: value }];
  });
}

// Returns the latest valid reading for a sensor, holding the previous one while
// the sensor reports nothing (e.g. no finger/skin contact) so the display stays stable.
function getDisplaySensorValue(key) {
  const live = state.sensorValues[key];
  if (Number.isFinite(live)) state.displaySensorValues[key] = live;
  return state.displaySensorValues[key] ?? null;
}

const HELD_SENSOR_KEYS = ["hr", "gsr", "temp", "motion"];

// Snapshot of the latest reading per sensor for graphs and records. When a sensor
// is disconnected or sends no valid data, its last valid reading is carried over
// and its key is listed in `heldSensors` so analysis can tell it apart from live data.
function getHeldSensorSnapshot() {
  const values = {};
  const heldSensors = [];
  HELD_SENSOR_KEYS.forEach(key => {
    const live = state.sensorValues[key];
    const shown = getDisplaySensorValue(key);
    values[key] = shown;
    if (!Number.isFinite(live) && Number.isFinite(shown)) heldSensors.push(key);
  });
  return { values, heldSensors };
}

function hasAnyHeldSensorValue() {
  return HELD_SENSOR_KEYS.some(key => Number.isFinite(getDisplaySensorValue(key)));
}

// The value a history sample measured live, or null if it was carried over.
function liveSampleValue(item, key) {
  return Array.isArray(item.heldSensors) && item.heldSensors.includes(key) ? null : item[key];
}

function isWithinFirstReadingDelay() {
  return state.session.firstReadingAt && Date.now() < state.session.firstReadingAt;
}

function getSessionPhase(timestamp = Date.now()) {
  return state.session.baselineCaptureActive && timestamp < state.session.baselineEndsAt
    ? "baseline"
    : "questionnaire";
}

function persistBaselineSession() {
  const session = { ...state.session, baselineTimer: null };
  const cutoff = Date.now() - PROJECT_CONFIG.runtime.historyWindowMs;
  try {
    localStorage.setItem("cnn_lstm_session_v1", JSON.stringify({
      ...session,
      history: state.history.filter(item => item.timestamp >= cutoff)
    }));
  } catch (error) {
    console.warn("Failed to persist baseline session", error);
  }
  if (
    window.PsycheScanBackend &&
    (!state.session.profileId || state.profiles.some(profile => profile.profileId === state.session.profileId))
  ) {
    window.PsycheScanBackend.sync("session");
  }
}

function finalizeBaseline() {
  if (!state.session.baselineCaptureActive) return false;
  state.session.baselineCaptureActive = false;
  state.session.baselineTimer = null;
  const samples = state.history.filter(item => item.sessionId === state.session.id && item.phase === "baseline");
  // Baseline uses live readings only; values carried over from a disconnected sensor are ignored.
  const biometricSamples = samples.filter(item => HELD_SENSOR_KEYS.some(key => Number.isFinite(liveSampleValue(item, key))));
  if (!biometricSamples.length) {
    state.session.baselineCompletedAt = Date.now();
    state.session.baselineError = "No sensor readings were received. Connect a sensor and capture again.";
    persistBaselineSession();
    return false;
  }
  const meanOrNull = key => {
    const values = biometricSamples.map(item => liveSampleValue(item, key)).filter(Number.isFinite);
    return values.length ? average(values) : null;
  };
  const faceSamples = samples.filter(item => item.faceDetected === true);
  const faceMeanOrNull = key => {
    const values = faceSamples.map(item => item[key]).filter(Number.isFinite);
    return values.length ? average(values) : null;
  };
  const emotionCounts = new Map();
  faceSamples.forEach(item => {
    if (typeof item.dominantEmotion !== "string" || !item.dominantEmotion) return;
    emotionCounts.set(item.dominantEmotion, (emotionCounts.get(item.dominantEmotion) || 0) + 1);
  });
  const dominantEmotion = [...emotionCounts.entries()]
    .sort((left, right) => right[1] - left[1])[0]?.[0] || null;
  state.session.baselineSummary = {
    samples: biometricSamples.length,
    completedAt: Date.now(),
    durationSec: Math.round((Date.now() - state.session.startedAt) / 1000),
    hr: meanOrNull("hr"),
    gsr: meanOrNull("gsr"),
    temp: meanOrNull("temp"),
    motion: meanOrNull("motion"),
    score: average(biometricSamples.map(item => item.score)),
    faceSampleCount: faceSamples.length,
    faceDetectionRate: samples.length ? (faceSamples.length / samples.length) * 100 : null,
    dominantEmotion,
    fatigue: faceMeanOrNull("fatigue"),
    wrinkle: faceMeanOrNull("wrinkle"),
    eyebag: faceMeanOrNull("eyebag")
  };
  state.session.baselineCompletedAt = state.session.baselineSummary.completedAt;
  state.session.phase = "questionnaire";
  state.session.baselineError = "";
  completeBaselineProfile(state.session.baselineSummary);
  persistBaselineSession();
  return true;
}

function startBaselineCapture() {
  if (state.session.baselineCaptureActive) {
    if (state.session.baselineTimer) clearTimeout(state.session.baselineTimer);
    state.session.baselineCaptureActive = false;
    state.session.baselineTimer = null;
    state.session.baselineCompletedAt = Date.now();
    state.session.phase = "questionnaire";
    state.session.baselineError = "Baseline capture canceled. Start another capture when ready.";
    persistBaselineSession();
    renderAll();
    return;
  }
  const hasBiometrics = Object.values(state.sensorValues).some(Number.isFinite);
  if (!hasBiometrics) {
    alert("Connect a biometric sensor or enable Demo sensors before capturing a baseline.");
    return;
  }

  const targetProfile = state.profiles.find(profile => profile.profileId === state.activeProfileId);
  if (!targetProfile) {
    alert("Add a patient or select an active profile before capturing a baseline.");
    return;
  }

  const now = Date.now();
  const durationMs = getObservationDurationSec() * 1000;
  if (state.session.baselineTimer) clearTimeout(state.session.baselineTimer);
  state.session.id = `session-${now}`;
  state.session.profileId = targetProfile.profileId;
  state.session.profileName = targetProfile.name;
  state.session.startedAt = now;
  state.session.firstReadingAt = now;
  state.session.baselineCompletedAt = 0;
  state.session.baselineSummary = null;
  state.session.baselineError = "";
  state.session.baselineCaptureActive = true;
  state.session.baselineEndsAt = now + durationMs;
  state.session.phase = "baseline";
  persistBaselineSession();
  state.session.baselineTimer = setTimeout(() => {
    finalizeBaseline();
    renderAll();
  }, durationMs);
  renderBaselineWorkflow();
}

function formatBaselineValue(value, unit, decimals = 1) {
  return Number.isFinite(value) ? `${Number(value).toFixed(decimals)}${unit}` : "--";
}

function renderBaselineWorkflow() {
  const badge = $("baselineStatusBadge");
  const text = $("baselineStatusText");
  const comparison = $("baselineComparisonText");
  if (!badge || !text || !comparison) return;

  const summary = state.session.baselineSummary;
  const captureButton = $("captureBaselineBtn");
  const captureLabel = $("baselineCaptureButtonLabel");
  const captureProgress = $("baselineCaptureProgress");
  if (state.session.baselineCaptureActive) {
    const remaining = Math.max(0, Math.ceil((state.session.baselineEndsAt - Date.now()) / 1000));
    const timeLabel = `${String(Math.floor(remaining / 60)).padStart(2, "0")}:${String(remaining % 60).padStart(2, "0")}`;
    setStatusChip(badge, "warning", "CAPTURING");
    text.textContent = `Collecting normal sensor readings for ${Math.ceil(getObservationDurationSec() / 60)} minute(s). Keep the participant still until capture completes.`;
    if (captureLabel) captureLabel.textContent = "Cancel capture";
    if (captureProgress) captureProgress.textContent = `${timeLabel} remaining`;
  } else if (summary) {
    setStatusChip(badge, "muted", "RECORDED");
    text.textContent = `Normal baseline recorded from ${summary.samples} sensor sample(s). New readings are compared with this reference.`;
    if (captureLabel) captureLabel.textContent = "Capture baseline again";
    if (captureProgress) captureProgress.textContent = `Recorded ${new Date(summary.completedAt).toLocaleTimeString()}`;
  } else if (state.session.baselineError) {
    setStatusChip(badge, "danger", "NO DATA");
    text.textContent = state.session.baselineError;
    if (captureLabel) captureLabel.textContent = "Capture baseline";
    if (captureProgress) captureProgress.textContent = "No baseline stored";
  } else {
    setStatusChip(badge, "muted", "READY");
    text.textContent = "No baseline recorded. Start a timed capture from the Dashboard camera panel.";
    if (captureLabel) captureLabel.textContent = "Capture baseline";
    if (captureProgress) captureProgress.textContent = "Uses the duration set in Live Monitoring Hub.";
  }
  if (captureButton) captureButton.disabled = false;

  $("baselineHrValue").textContent = formatBaselineValue(summary?.hr, " bpm");
  $("baselineGsrValue").textContent = formatBaselineValue(summary?.gsr, " µS", 2);
  $("baselineTempValue").textContent = formatBaselineValue(summary?.temp, " °C");
  $("baselineMotionValue").textContent = formatBaselineValue(summary?.motion, " g", 3);
  renderDashboardBaselineSummary();

  if (!summary) {
    comparison.textContent = "This record will serve as the participant's normal reference.";
    return;
  }
  const deltas = [
    ["HR", state.sensorValues.hr, summary.hr, " bpm"],
    ["GSR", state.sensorValues.gsr, summary.gsr, " µS"],
    ["temperature", state.sensorValues.temp, summary.temp, " °C"]
  ].filter(([, current, baseline]) => Number.isFinite(current) && Number.isFinite(baseline));
  comparison.textContent = deltas.length
    ? `Compared with baseline: ${deltas.map(([label, current, baseline, unit]) => `${label} ${current - baseline >= 0 ? "+" : ""}${(current - baseline).toFixed(label === "GSR" ? 2 : 1)}${unit}`).join(" · ")}.`
    : "Baseline captured. Waiting for current questionnaire readings.";
}

function getConnectedSensorCount() {
  return Object.values(state.sensors).filter(sensor => sensor.connected).length;
}

function setStatusChip(el, type, text) {
  if (!el) return;
  el.classList.remove("muted", "warning", "danger");
  if (type === "muted") el.classList.add("muted");
  if (type === "warning") el.classList.add("warning");
  if (type === "danger") el.classList.add("danger");
  el.textContent = text;
}

function saveSettings() {
  saveLocalJSON(STORAGE_KEYS.settings, state.settings);
  if (window.PsycheScanBackend) window.PsycheScanBackend.sync("settings");
}

function loadSettings() {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.settings);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    state.settings = { ...state.settings, ...parsed };
  } catch (error) {
    console.warn("Failed to load settings", error);
  }
}

function unlockApp() {
  document.body.classList.remove("auth-locked");
  document.body.classList.add("auth-ready");
  $("loggedInUserText").textContent = state.loggedInUser;
}

function lockApp() {
  state.loggedInUser = "Guest";
  document.body.classList.remove("auth-ready");
  document.body.classList.add("auth-locked");
}

function clearWorkspacePatientData() {
  state.records = [];
  state.reports = [];
  state.profiles = [];
  state.history = [];
  state.activeProfileId = null;
  state.activeProfileTabId = null;
  state.session.profileId = null;
  state.session.profileName = null;
  state.session.baselineSummary = null;
  state.session.id = null;
}

async function logout() {
  try {
    if (window.PsycheScanBackend) {
      await window.PsycheScanBackend.logout();
      return;
    }
    clearWorkspacePatientData();
    lockApp();
  } catch (error) {
    console.warn("Server logout failed; clearing this tab's session token", error);
    clearWorkspacePatientData();
    lockApp();
  }
}

function bindLogin() {
  $("loginForm").addEventListener("submit", async event => {
    event.preventDefault();
    const name = $("loginName").value.trim();
    const password = $("loginPassword").value;
    const submitButton = $("loginForm").querySelector('[type="submit"]');
    submitButton.disabled = true;
    try {
      if (!window.PsycheScanBackend) throw new Error("The authentication service is unavailable.");
      await window.PsycheScanBackend.login(name, password);
      state.loggedInUser = name;
      $("loginError").classList.remove("show");
      $("loginPassword").value = "";
      unlockApp();
    } catch (error) {
      console.warn("Operator sign-in failed", error);
      $("loginError").textContent = "Sign-in failed. Check the credentials and ensure the server is configured.";
      $("loginError").classList.add("show");
    } finally {
      submitButton.disabled = false;
    }
  });

  $("logoutBtn").addEventListener("click", logout);
  window.addEventListener("psychescan-auth-expired", () => {
    clearWorkspacePatientData();
    lockApp();
    $("loginError").textContent = "Your session expired. Sign in again.";
    $("loginError").classList.add("show");
  });
  window.addEventListener("psychescan-logout", () => {
    clearWorkspacePatientData();
    lockApp();
  });
}

function switchPage(page) {
  const section = $(`${page}Page`);
  if (!section) return;
  state.page = page;
  document.querySelectorAll(".page-section").forEach(section => section.classList.remove("active-section"));
  document.querySelectorAll(".nav-item").forEach(btn => btn.classList.toggle("active", btn.dataset.page === page));
  section.classList.add("active-section");
  const meta = pageMeta[page] || ["Dashboard", "Live camera feed and biometric sensor fusion for stress/anxiety screening"];
  $("pageTitle").textContent = meta[0];
  $("pageSubtitle").textContent = meta[1];
  if (page === "profiles") renderProfiles();
}

function bindSidebar() {
  $("sidebarNav").addEventListener("click", (event) => {
    const button = event.target.closest(".nav-item");
    if (!button) return;
    switchPage(button.dataset.page);
  });
}

function updateSystemStatusIndicator(customText, customType) {
  const statusEl = $("systemStatus");
  const dotEl = $("systemStatusDot");
  if (!statusEl) return;

  if (customText) {
    statusEl.textContent = customText;
    if (dotEl) {
      dotEl.className = "status-dot" + (customType === "amber" ? " amber pulsing" : customType === "accent" ? " accent" : customType === "danger" ? " danger" : " pulsing");
    }
    return;
  }

  let text = "System Ready";
  let dotClass = "status-dot pulsing";

  if (state.session?.baselineCaptureActive) {
    text = "Capturing Baseline";
    dotClass = "status-dot amber pulsing";
  } else if (state.mode === "Review") {
    text = "Review Active";
    dotClass = "status-dot accent";
  } else if (state.cameraActive && (state.serialConnected || state.bleConnected || state.wsConnected)) {
    text = "Live & Sensors Active";
    dotClass = "status-dot pulsing";
  } else if (state.cameraActive) {
    text = "Camera Active";
    dotClass = "status-dot pulsing";
  } else if (state.serialConnected || state.bleConnected || state.wsConnected) {
    text = "Sensors Active";
    dotClass = "status-dot pulsing";
  } else {
    text = "Ready";
    dotClass = "status-dot pulsing";
  }

  statusEl.textContent = text;
  if (dotEl) dotEl.className = dotClass;
}
window.updateSystemStatusIndicator = updateSystemStatusIndicator;

function bindModeButtons() {
  document.querySelectorAll(".mode-btn").forEach(button => {
    button.addEventListener("click", () => {
      document.querySelectorAll(".mode-btn").forEach(btn => btn.classList.remove("active"));
      button.classList.add("active");
      state.mode = button.dataset.mode;
      $("modeValueText").textContent = state.mode;
      updateSystemStatusIndicator();
    });
  });
}

// Smallest vertical range each sensor chart shows, so sensor jitter (e.g. a DS18B20
// flicking between 36.2 and 36.4 °C) isn't stretched to fill the whole chart.
const SENSOR_CHART_MIN_SPAN = { hr: 20, gsr: 0.5, temp: 1, motion: 0.1 };

function minSpanYAxis(span) {
  return {
    afterDataLimits(scale) {
      const range = scale.max - scale.min;
      if (!Number.isFinite(range) || range >= span) return;
      const nonNegative = scale.min >= 0;
      const mid = (scale.max + scale.min) / 2;
      scale.min = mid - span / 2;
      scale.max = mid + span / 2;
      if (nonNegative && scale.min < 0) {
        scale.min = 0;
        scale.max = span;
      }
    }
  };
}

function buildCharts() {
  const dashboardWindowSeconds = PROJECT_CONFIG.runtime.historyWindowMs / 1000;
  const commonOptions = {
    responsive: true,
    maintainAspectRatio: false,
    // Live streaming charts redraw every sample. Animating made each new point
    // rise from the bottom of the axis, which looked like a drop at the right edge.
    animation: false,
    plugins: {
      legend: {
        labels: {
          color: getComputedStyle(document.body).getPropertyValue("--text").trim()
        }
      }
    },
    scales: {
      x: {
        type: "linear",
        min: -dashboardWindowSeconds,
        max: 0,
        ticks: {
          callback: (value) => `${value}s`,
          color: getComputedStyle(document.body).getPropertyValue("--text-soft").trim()
        },
        grid: { color: getComputedStyle(document.body).getPropertyValue("--line").trim() }
      },
      y: {
        ticks: { color: getComputedStyle(document.body).getPropertyValue("--text-soft").trim() },
        grid: { color: getComputedStyle(document.body).getPropertyValue("--line").trim() }
      }
    }
  };

  Object.values(state.charts).forEach(chart => chart?.destroy());

  const history = getWindowHistory();
  const labels = history.map(item => item.label);
  const chartNow = Date.now();

  const liveCanvas = $("liveChart");
  state.charts.live = liveCanvas ? new Chart(liveCanvas, {
    type: "line",
    data: {
      labels,
      datasets: [
        { label: "Heart rate (bpm)", data: historyPoints(history, item => item.hr, chartNow, true), borderColor: getComputedStyle(document.body).getPropertyValue("--accent").trim(), tension: 0.34, pointRadius: 0, spanGaps: false },
        { label: "GSR / EDA (µS)", data: historyPoints(history, item => item.gsr, chartNow, true), borderColor: getComputedStyle(document.body).getPropertyValue("--accent-2").trim(), tension: 0.34, pointRadius: 0, spanGaps: false },
        { label: "Temperature (°C)", data: historyPoints(history, item => item.temp, chartNow, true), borderColor: "#f59e0b", tension: 0.34, pointRadius: 0, spanGaps: false },
        { label: "Motion (g)", data: historyPoints(history, item => item.motion, chartNow, true), borderColor: "#22c55e", tension: 0.34, pointRadius: 0, spanGaps: false }
      ]
    },
    options: commonOptions
  }) : null;

  const sensorCharts = [
    ["sensorHr", "sensorHrChart", "Heart rate (bpm)", "hr", "--accent"],
    ["sensorGsr", "sensorGsrChart", "GSR / EDA (µS)", "gsr", "--accent-2"],
    ["sensorTemp", "sensorTempChart", "Temperature (°C)", "temp", "#f59e0b"],
    ["sensorMotion", "sensorMotionChart", "Motion (g)", "motion", "#22c55e"]
  ];
  // The dashboard sensor charts are small, so use lighter tick labels.
  const compactTicks = { font: { size: 10 }, maxTicksLimit: 4 };
  const sensorChartScales = {
    x: { ...commonOptions.scales.x, ticks: { ...commonOptions.scales.x.ticks, ...compactTicks } },
    y: { ...commonOptions.scales.y, ticks: { ...commonOptions.scales.y.ticks, ...compactTicks } }
  };
  sensorCharts.forEach(([key, canvasId, label, field, color]) => {
    const canvas = $(canvasId);
    if (!canvas) return;
    const borderColor = color.startsWith("--")
      ? getComputedStyle(document.body).getPropertyValue(color).trim()
      : color;
    state.charts[key] = new Chart(canvas, {
      type: "line",
      data: {
        labels,
        datasets: [{ label, data: historyPoints(history, item => item[field], chartNow, true), borderColor, tension: 0.3, pointRadius: 0, spanGaps: false }]
      },
      options: { ...commonOptions, scales: { ...sensorChartScales, y: { ...sensorChartScales.y, ...minSpanYAxis(SENSOR_CHART_MIN_SPAN[field]) } }, plugins: { ...commonOptions.plugins, legend: { display: false } } }
    });
  });

  if ($("emotionChart")) {
    const emotions = Object.keys(state.emotionSmoothed);
    const colors = ["#64748b", "#f59e0b", "#38bdf8", "#ef4444", "#8b5cf6", "#14b8a6", "#ec4899"];
    state.charts.emotion = new Chart($("emotionChart"), {
      type: "line",
      data: {
        labels,
        datasets: emotions.map((emotion, index) => ({
          label: capitalize(emotion),
          data: historyPoints(history, item => item.emotions?.[emotion], chartNow),
          borderColor: colors[index],
          tension: 0.3,
          pointRadius: 2,
          pointHoverRadius: 5,
          borderWidth: 2,
          spanGaps: false
        }))
      },
      options: {
        ...commonOptions,
        plugins: {
          ...commonOptions.plugins,
          // Compact single-line legend so the chart keeps its plot height.
          legend: {
            ...commonOptions.plugins.legend,
            labels: {
              ...commonOptions.plugins.legend.labels,
              usePointStyle: true,
              pointStyle: "circle",
              boxWidth: 8,
              boxHeight: 8,
              padding: 10,
              font: { size: 11 }
            }
          }
        },
        scales: { ...commonOptions.scales, y: { ...commonOptions.scales.y, min: 0, max: 1 } }
      }
    });
  }
  updateEmotionChartEmptyState(history);
}

function updateEmotionChartEmptyState(history) {
  const emptyState = $("emotionChartEmptyState");
  if (!emptyState) return;
  const hasEmotionSamples = history.some(item =>
    item.emotions && Object.values(item.emotions).some(value => Number.isFinite(value) && value > 0)
  );
  emptyState.hidden = hasEmotionSamples;
}

function updateCharts() {
  const history = getWindowHistory();
  const labels = history.map(item => item.label);
  const chartNow = Date.now();

  if (state.charts.live) {
    state.charts.live.data.labels = labels;
    state.charts.live.data.datasets[0].data = historyPoints(history, item => item.hr, chartNow, true);
    state.charts.live.data.datasets[1].data = historyPoints(history, item => item.gsr, chartNow, true);
    state.charts.live.data.datasets[2].data = historyPoints(history, item => item.temp, chartNow, true);
    state.charts.live.data.datasets[3].data = historyPoints(history, item => item.motion, chartNow, true);
    state.charts.live.update();
  }

  [["sensorHr", "hr"], ["sensorGsr", "gsr"], ["sensorTemp", "temp"], ["sensorMotion", "motion"]].forEach(([chartKey, field]) => {
    const chart = state.charts[chartKey];
    if (!chart) return;
    chart.data.labels = labels;
    chart.data.datasets[0].data = historyPoints(history, item => item[field], chartNow, true);
    chart.update();
  });

  if (state.charts.emotion) {
    state.charts.emotion.data.labels = labels;
    Object.keys(state.emotionSmoothed).forEach((emotion, index) => {
      state.charts.emotion.data.datasets[index].data = historyPoints(history, item => item.emotions?.[emotion], chartNow);
    });
    state.charts.emotion.update();
  }
  updateEmotionChartEmptyState(history);
}

function pushHistory(score) {
  const now = Date.now();
  if (isWithinFirstReadingDelay() && !state.session.baselineCaptureActive) return;
  if (!state.session.profileId && !state.activeProfileId) return;
  if (state.lastHistorySampleAt && now - state.lastHistorySampleAt < (Number(state.settings.samplingIntervalMs) || 1000)) return;
  const phase = getSessionPhase(now);
  if (state.session.baselineCaptureActive && phase === "questionnaire") finalizeBaseline();
  state.lastHistorySampleAt = now;
  const readings = getHeldSensorSnapshot();
  const sample = {
    timestamp: now,
    label: formatHistoryLabel(now),
    secondsAgo: 0,
    profileId: state.session.profileId || state.activeProfileId,
    sessionId: state.session.baselineCaptureActive ? state.session.id : null,
    phase,
    score,
    hr: readings.values.hr,
    gsr: readings.values.gsr,
    temp: readings.values.temp,
    motion: readings.values.motion,
    heldSensors: readings.heldSensors,
    emotions: { ...state.emotionSmoothed },
    faceDetected: state.dominantEmotion !== "No Face",
    dominantEmotion: state.dominantEmotion,
    dominantConfidence: state.dominantConfidence,
    eyebag: state.visualFatigue.eyebag,
    wrinkle: state.visualFatigue.wrinkle,
    fatigue: state.visualFatigue.fatigue,
    source: state.settings.demoSensors ? "demo" : "live",
    quality: getConnectedSensorCount() === 4 ? "complete" : "partial"
  };
  state.history.push(sample);
  if (window.PsycheScanBackend) window.PsycheScanBackend.persistTelemetry({ kind: "sample", payload: sample });
  const cutoff = now - PROJECT_CONFIG.runtime.historyWindowMs;
  state.history = state.history.filter(item =>
    item.timestamp >= cutoff || (item.sessionId === state.session.id && item.phase === "baseline" && !state.session.baselineCompletedAt)
  );
  updateCharts();
}

function markSensorConnected(key, explicitState = "connected") {
  const sensor = state.sensors[key];
  sensor.connected = true;
  sensor.state = explicitState;
  sensor.lastSeen = Date.now();
}

function renderSensorGrid(targetId) {
  const target = $(targetId);
  if (!target) return;
  const html = Object.entries(sensorMeta).map(([key, meta]) => {
    const sensor = state.sensors[key];
    const reading = getDisplaySensorValue(meta.key);
    const isHeld = reading !== null && !Number.isFinite(state.sensorValues[meta.key]);
    const stateLabel = sensor.state === "connected" ? "CONNECTED"
      : sensor.state === "searching" ? "WAITING"
      : sensor.state === "demo" ? "DEMO"
      : "DISCONNECTED";
    return `
      <div class="sensor-card">
        <div class="sensor-meta">
          <div class="sensor-name">${meta.name}</div>
          <div class="sensor-channel">${meta.channel}</div>
        </div>
        <div class="sensor-reading ${reading === null || reading === undefined ? "empty" : ""} ${isHeld ? "held" : ""}"${isHeld ? ' title="Last received reading; sensor is not sending new data"' : ""}>
          ${reading === null || reading === undefined ? "No data" : `${formatSensorValue(meta.key, reading)} ${meta.unit}`.trim()}
        </div>
        <div class="sensor-state ${sensor.state}">${stateLabel}</div>
      </div>
    `;
  }).join("");
  target.innerHTML = html;
}

function renderProbabilities() {
  const labels = [
    ["Neutral", state.emotionSmoothed.neutral],
    ["Happy", state.emotionSmoothed.happy],
    ["Sad", state.emotionSmoothed.sad],
    ["Angry", state.emotionSmoothed.angry],
    ["Fearful", state.emotionSmoothed.fearful],
    ["Disgusted", state.emotionSmoothed.disgusted],
    ["Surprised", state.emotionSmoothed.surprised]
  ];
  const html = labels.map(([label, value]) => `
    <div class="prob-row">
      <div class="prob-head">
        <span>${label}</span>
        <strong>${Math.round(value * 100)}%</strong>
      </div>
      <div class="prob-track">
        <div class="prob-fill" style="width:${Math.round(value * 100)}%"></div>
      </div>
    </div>
  `).join("");
  if ($("probabilityList")) $("probabilityList").innerHTML = html;
  if ($("dashboardEmotionBadge")) {
    $("dashboardEmotionBadge").textContent = state.dominantEmotion.toUpperCase();
  }
}

function computeAssessment() {
  const connectedSensors = getConnectedSensorCount();
  const hasFace = state.dominantEmotion !== "No Face";
  const negativeEmotionStrength =
    state.emotionSmoothed.sad +
    state.emotionSmoothed.angry +
    state.emotionSmoothed.fearful +
    state.emotionSmoothed.disgusted * 0.8 +
    state.emotionSmoothed.surprised * 0.35;

  let emotionRisk = 0;
  if (hasFace) {
    emotionRisk = clamp(negativeEmotionStrength * 100, 0, 100);
    if (["Sad", "Angry", "Fearful", "Disgusted"].includes(state.dominantEmotion)) {
      emotionRisk += state.dominantConfidence * 0.3;
    }
    emotionRisk = clamp(emotionRisk, 0, 100);
  }

  const sensorStress = classifySensorStress();
  const sensorSeverityScores = { minimal: 0, mild: 33, moderate: 66, severe: 100 };
  const sensorVoteCount = Object.values(sensorStress.votes).reduce((sum, count) => sum + count, 0);
  const sensorRisk = sensorVoteCount
    ? sensorSeverityScores[sensorStress.level.toLowerCase()]
    : 0;
  const fatigueRisk = state.visualFatigue.fatigue;

  let total = 0;
  let weight = 0;

  const fusion = PROJECT_CONFIG.fusion;
  if (hasFace) {
    total += emotionRisk * fusion.emotionWeight;
    weight += fusion.emotionWeight;
    total += fatigueRisk * fusion.fatigueWeight;
    weight += fusion.fatigueWeight;
  }
  if (sensorVoteCount) {
    total += sensorRisk * fusion.sensorWeight;
    weight += fusion.sensorWeight;
  }

  const integratedScore = weight ? clamp(total / weight, 0, 100) : 0;

  let level = "Minimal";
  let temporal = "High";
  let decision = "Minimal"; // will mirror `level` to use severity labels throughout
  let decisionClass = "minimal";
  let risk = "Low";

  const severityScore = PROJECT_CONFIG.severity.score;
  if (integratedScore >= severityScore.severe) {
    level = "Severe";
    temporal = "Low";
    risk = "High";
  } else if (integratedScore >= severityScore.moderate) {
    level = "Moderate";
    temporal = "Medium";
    risk = "Guarded";
  } else if (integratedScore >= severityScore.mild) {
    level = "Mild";
    temporal = "Medium";
    risk = "Watch";
  }

  // Use the severity label as the canonical `decision` value for storage and UI
  decision = level;
  decisionClass = level.toLowerCase();

  const recentScores = state.history.map(item => item.score).filter(value => typeof value === "number");
  const trailing = recentScores.slice(-6);
  const leading = recentScores.slice(-12, -6);
  const recentAvg = trailing.length ? average(trailing) : 0;
  const priorAvg = leading.length ? average(leading) : recentAvg;
  const trendDelta = recentAvg - priorAvg;
  const trendThreshold = PROJECT_CONFIG.runtime.trendDeltaThreshold;
  const trend = trendDelta > trendThreshold ? "Rising" : trendDelta < -trendThreshold ? "Falling" : "Stable";

  const variance = trailing.length
    ? average(trailing.map(value => Math.pow(value - recentAvg, 2)))
    : 0;
  const sequenceScore = clamp(1 - variance / 900, 0.12, 0.97);

  return {
    integratedScore: Math.round(integratedScore),
    level,
    temporal,
    decision,
    decisionClass,
    risk,
    trend,
    sequenceScore: sequenceScore.toFixed(2),
    connectedSensors,
    fatigueRisk: Math.round(fatigueRisk),
    emotionRisk: Math.round(emotionRisk),
    sensorRisk: Math.round(sensorRisk)
  };
}

function updateMetrics() {
  updateSensorPresence();
  const assessment = computeAssessment();
  const sensorStress = classifySensorStress();
  renderBaselineWorkflow();

  $("metricStress").textContent = assessment.level;
  $("metricCnn").textContent = `${state.dominantConfidence}%`;
  $("metricTemporal").textContent = assessment.temporal;
  $("metricTemporalNote").textContent = `${assessment.sequenceScore} stability score`;
  $("metricSync").textContent = `${assessment.connectedSensors} / 4`;

  $("summaryIntegratedScore").textContent = `${assessment.integratedScore} / 100`;
  $("summaryEmotion").textContent = state.dominantEmotion;
  $("summarySensors").textContent = `${assessment.connectedSensors} of 4 sensors active`;
  if ($("dashboardSensorStress")) {
    $("dashboardSensorStress").textContent = sensorStress.level;
    $("dashboardSensorStress").className = sensorStress.level === "WAITING FOR SENSOR"
      ? "status-badge muted"
      : `severity-badge ${getSeverityBadgeClass(capitalize(sensorStress.level))}`;
  }
  if ($("summarySensorStress")) $("summarySensorStress").textContent = sensorStress.level;
  $("summaryFatigue").textContent = safePercent(assessment.fatigueRisk);
  $("summaryEyebag").textContent = safePercent(state.visualFatigue.eyebag);
  $("summaryWrinkle").textContent = safePercent(state.visualFatigue.wrinkle);

  const badge = $("summaryStatusBadge");
  const summaryPill = $("summaryOkayValue");
  // clear any severity classes
  summaryPill.classList.remove("minimal", "mild", "moderate", "severe");
  summaryPill.classList.add(assessment.decisionClass);
  summaryPill.textContent = assessment.decision;
  // map severity to chip style: Severe->danger, Moderate/Mild->warning, Minimal->muted
  const chipType = assessment.decisionClass === "severe" ? "danger" : (assessment.decisionClass === "moderate" || assessment.decisionClass === "mild") ? "warning" : "muted";
  setStatusChip(badge, chipType, assessment.decision);

  if (!state.cameraActive && assessment.connectedSensors === 0) {
    $("summaryHeadline").textContent = "Insufficient live evidence";
    $("summaryNarrative").textContent = "Start the camera and/or connect sensors to generate a current participant screening summary.";
  } else if (assessment.level === "Severe") {
    $("summaryHeadline").textContent = "Elevated concern requires closer review";
    $("summaryNarrative").textContent = `The integrated evidence is high (${assessment.integratedScore}/100). Negative affect, fatigue, and/or sensor strain are elevated. Review the detailed inputs and consider human escalation.`;
  } else if (assessment.level === "Moderate") {
    $("summaryHeadline").textContent = "Participant should be monitored";
    $("summaryNarrative").textContent = `The integrated evidence is moderate (${assessment.integratedScore}/100). Signals are shifting upward. Continue observation and verify whether the trend persists.`;
  } else if (assessment.level === "Mild") {
    $("summaryHeadline").textContent = "Slight elevation in evidence";
    $("summaryNarrative").textContent = `The integrated evidence is mildly elevated (${assessment.integratedScore}/100). Continue observation for persistent changes.`;
  } else {
    $("summaryHeadline").textContent = "Current evidence suggests the participant is minimal";
    $("summaryNarrative").textContent = `The current integrated evidence is ${assessment.integratedScore}/100. No major sustained concern is visible right now, but continue routine monitoring.`;
  }
}

function renderSummary() {
  updateMetrics();
}

function bindModal() {
  const closeRecordModal = () => {
    $("recordModal").classList.remove("show");
    $("recordModal").setAttribute("aria-hidden", "true");
  };
  $("closeRecordModalBtn").addEventListener("click", closeRecordModal);
  $("recordModal").addEventListener("click", (event) => {
    if (event.target.id === "recordModal") closeRecordModal();
  });
  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && $("recordModal").classList.contains("show")) closeRecordModal();
  });
}

function exportCsv() {
  if (!state.records.length) return;
  const headers = ["timestamp", "profileId", "profileName", "emotion", "confidence", "hr", "gsr", "temp", "motion", "eyebag", "wrinkle", "fatigue", "integratedScore", "decision"];
  const csvCell = value => {
    let text = String(value ?? "");
    if (typeof value === "string" && /^[\t\r\n ]*[=+\-@]/.test(value)) text = `'${text}`;
    return `"${text.replace(/"/g, '""')}"`;
  };
  const lines = [
    headers.map(csvCell).join(","),
    ...state.records.map(record => headers.map(key => {
      if (key === "profileName") return csvCell(record.profileName || record.participantId || "");
      return csvCell(record[key] ?? "");
    }).join(","))
  ];
  const blob = new Blob([`\uFEFF${lines.join("\r\n")}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "cnn-lstm-mental-health-records.csv";
  a.click();
  URL.revokeObjectURL(url);
}

function savePdf() {
  const assessment = computeAssessment();
  const profile = state.profiles.find(item => item.profileId === state.activeProfileId);
  const profileName = profile?.name || "No active profile";
  const sessionId = state.session.id || "Not started";
  const generatedAt = new Date().toLocaleString();
  const sensorCharts = [
    ["Heart rate", $("sensorHrChart")?.toDataURL("image/png") || ""],
    ["GSR / EDA", $("sensorGsrChart")?.toDataURL("image/png") || ""],
    ["Temperature", $("sensorTempChart")?.toDataURL("image/png") || ""],
    ["Motion", $("sensorMotionChart")?.toDataURL("image/png") || ""]
  ];
  const emotionImage = $("emotionChart")?.toDataURL("image/png") || "";
  const reportWindow = window.open("", "_blank", "width=1100,height=800");
  if (!reportWindow) return;
  reportWindow.document.write(`<!doctype html><html><head><title>PsycheScan Report</title><style>
    body{font-family:Arial,sans-serif;color:#172033;margin:32px}h1{margin-bottom:4px}h2{margin-top:28px;border-bottom:1px solid #d8dee9;padding-bottom:6px}.meta{color:#526174}.metric{display:inline-block;margin:8px 18px 8px 0;padding:10px 14px;background:#f1f5f9;border-radius:6px}.metric strong{display:block;font-size:20px}img{max-width:100%;margin-top:12px}small{color:#526174}
  </style></head><body><h1>PsycheScan Monitoring Report</h1>
  <p class="meta">Generated ${escapeHtml(generatedAt)} · Patient ${escapeHtml(profileName)} · Session ${escapeHtml(sessionId)}</p>
  <div class="metric"><small>Integrated level</small><strong>${escapeHtml(assessment.level)}</strong></div>
  <div class="metric"><small>Integrated score</small><strong>${escapeHtml(assessment.integratedScore)}/100</strong></div>
  <div class="metric"><small>Sensor coverage</small><strong>${escapeHtml(assessment.connectedSensors)}/4</strong></div>
  <div class="metric"><small>Observation window</small><strong>${escapeHtml(Math.round(getObservationDurationSec() / 60))} min</strong></div>
  <h2>Biometric trends</h2>${sensorCharts.map(([label, image]) => image ? `<h3>${escapeHtml(label)}</h3><img src="${escapeHtml(image)}" alt="${escapeHtml(label)} trend">` : `<p>No ${escapeHtml(label)} chart data.</p>`).join("")}
  <h2>Emotion trend</h2>${emotionImage ? `<img src="${escapeHtml(emotionImage)}" alt="Emotion trend">` : "<p>No emotion chart data.</p>"}
  <h2>Facial fatigue indicators</h2><p>Eyebag: ${escapeHtml(Math.round(state.visualFatigue.eyebag))}% · Wrinkle: ${escapeHtml(Math.round(state.visualFatigue.wrinkle))}% · Visual fatigue: ${escapeHtml(Math.round(state.visualFatigue.fatigue))}%</p>
  <p><small>${escapeHtml(PROJECT_CONFIG.disclaimer)}</small></p></body></html>`);
  reportWindow.document.close();
  reportWindow.focus();
  setTimeout(() => reportWindow.print(), 250);
}

function stopCamera(reset = true) {
  if (state.detectLoop) {
    clearInterval(state.detectLoop);
    state.detectLoop = null;
  }
  if (state.stream) {
    state.stream.getTracks().forEach(track => track.stop());
    state.stream = null;
  }
  $("video").srcObject = null;
  $("liveVideo").srcObject = null;
  state.cameraActive = false;
  setStatusChip($("cameraBadge"), "muted", "READY");
  setStatusChip($("liveStatusBadge"), "muted", "IDLE");
  $("cameraStatusText").textContent = "Inactive";
  $("systemStatus").textContent = "Stopped";
  if (reset) resetFaceState();
}

function resetFaceState() {
  state.emotionRaw = { neutral: 0, happy: 0, sad: 0, angry: 0, fearful: 0, disgusted: 0, surprised: 0 };
  state.emotionSmoothed = { neutral: 0, happy: 0, sad: 0, angry: 0, fearful: 0, disgusted: 0, surprised: 0 };
  state.dominantEmotion = "No Face";
  state.dominantConfidence = 0;
  state.visualFatigue = { eyebag: 0, wrinkle: 0, fatigue: 0 };
  $("faceCountText").textContent = "0 face";
  $("dominantEmotion").textContent = "No Face";
  $("dominantConfidence").textContent = "0%";
  clearCanvas($("overlay"));
  clearCanvas($("liveOverlay"));
  renderProbabilities();
  renderLiveStatCards();
  updateMetrics();
}

function clearCanvas(canvas) {
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);
}

function getDominantExpression(expressions) {
  let maxKey = "neutral";
  let maxValue = 0;
  Object.entries(expressions).forEach(([key, value]) => {
    if (value > maxValue) {
      maxValue = value;
      maxKey = key;
    }
  });
  return [maxKey, maxValue];
}

function smoothExpressions(raw) {
  const alpha = clamp(state.settings.smoothingFactor, 0.05, 0.9);
  Object.keys(state.emotionSmoothed).forEach(key => {
    state.emotionSmoothed[key] = state.emotionSmoothed[key] * alpha + raw[key] * (1 - alpha);
  });
}

function getBounds(points) {
  const xs = points.map(point => point.x);
  const ys = points.map(point => point.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

function sampleRegionLuma(ctx, canvasWidth, canvasHeight, region) {
  if (!region) return 0;

  let x = Math.round(region.x);
  let y = Math.round(region.y);
  let width = Math.round(region.width);
  let height = Math.round(region.height);

  if (![x, y, width, height].every(Number.isFinite)) return 0;

  x = clamp(x, 0, canvasWidth - 1);
  y = clamp(y, 0, canvasHeight - 1);
  width = clamp(width, 1, canvasWidth - x);
  height = clamp(height, 1, canvasHeight - y);

  if (width < 1 || height < 1) return 0;

  const image = ctx.getImageData(x, y, width, height).data;
  let total = 0;
  let count = 0;

  for (let i = 0; i < image.length; i += 16) {
    const r = image[i];
    const g = image[i + 1];
    const b = image[i + 2];
    total += 0.299 * r + 0.587 * g + 0.114 * b;
    count++;
  }

  return count ? total / count : 0;
}

function sampleTextureScore(ctx, canvasWidth, canvasHeight, region) {
  if (!region) return 0;

  let x = Math.round(region.x);
  let y = Math.round(region.y);
  let width = Math.round(region.width);
  let height = Math.round(region.height);

  if (![x, y, width, height].every(Number.isFinite)) return 0;

  x = clamp(x, 0, canvasWidth - 2);
  y = clamp(y, 0, canvasHeight - 2);
  width = clamp(width, 2, canvasWidth - x);
  height = clamp(height, 2, canvasHeight - y);

  if (width < 2 || height < 2) return 0;

  const image = ctx.getImageData(x, y, width, height).data;
  let total = 0;
  let count = 0;
  const stride = width * 4;

  for (let py = 0; py < height - 1; py += 2) {
    for (let px = 0; px < width - 1; px += 2) {
      const index = py * stride + px * 4;
      const current = 0.299 * image[index] + 0.587 * image[index + 1] + 0.114 * image[index + 2];
      const rightIndex = index + 4;
      const downIndex = index + stride;
      const right = 0.299 * image[rightIndex] + 0.587 * image[rightIndex + 1] + 0.114 * image[rightIndex + 2];
      const down = 0.299 * image[downIndex] + 0.587 * image[downIndex + 1] + 0.114 * image[downIndex + 2];
      total += Math.abs(current - right) + Math.abs(current - down);
      count++;
    }
  }

  return count ? total / count : 0;
}

function computeVisualFatigue(videoEl, landmarks) {
  if (!videoEl.videoWidth || !landmarks) return;

  offscreenCanvas.width = videoEl.videoWidth;
  offscreenCanvas.height = videoEl.videoHeight;
  offscreenCtx.drawImage(videoEl, 0, 0, offscreenCanvas.width, offscreenCanvas.height);

  const leftEye = landmarks.getLeftEye();
  const rightEye = landmarks.getRightEye();
  const leftBrow = landmarks.getLeftEyeBrow();
  const rightBrow = landmarks.getRightEyeBrow();

  if (!leftEye?.length || !rightEye?.length || !leftBrow?.length || !rightBrow?.length) {
    state.visualFatigue.eyebag = 0;
    state.visualFatigue.wrinkle = 0;
    state.visualFatigue.fatigue = 0;
    return;
  }

  const leftBounds = getBounds(leftEye);
  const rightBounds = getBounds(rightEye);
  const browBounds = getBounds([...leftBrow, ...rightBrow]);

  const faceDetailWidth = average([leftBounds.width, rightBounds.width]);
  if (!Number.isFinite(faceDetailWidth) || faceDetailWidth < PROJECT_CONFIG.runtime.minFaceDetailWidth) {
    state.visualFatigue.eyebag = 0;
    state.visualFatigue.wrinkle = 0;
    state.visualFatigue.fatigue = 0;
    return;
  }

  const underLeft = {
    x: leftBounds.x - leftBounds.width * 0.15,
    y: leftBounds.y + leftBounds.height * 0.45,
    width: leftBounds.width * 1.3,
    height: leftBounds.height * 0.95
  };
  const underRight = {
    x: rightBounds.x - rightBounds.width * 0.15,
    y: rightBounds.y + rightBounds.height * 0.45,
    width: rightBounds.width * 1.3,
    height: rightBounds.height * 0.95
  };

  const cheekLeft = {
    x: leftBounds.x - leftBounds.width * 0.1,
    y: leftBounds.y + leftBounds.height * 1.55,
    width: leftBounds.width * 1.2,
    height: leftBounds.height * 1.1
  };
  const cheekRight = {
    x: rightBounds.x - rightBounds.width * 0.1,
    y: rightBounds.y + rightBounds.height * 1.55,
    width: rightBounds.width * 1.2,
    height: rightBounds.height * 1.1
  };

  const underLum = average([
    sampleRegionLuma(offscreenCtx, offscreenCanvas.width, offscreenCanvas.height, underLeft),
    sampleRegionLuma(offscreenCtx, offscreenCanvas.width, offscreenCanvas.height, underRight)
  ]);

  const cheekLum = average([
    sampleRegionLuma(offscreenCtx, offscreenCanvas.width, offscreenCanvas.height, cheekLeft),
    sampleRegionLuma(offscreenCtx, offscreenCanvas.width, offscreenCanvas.height, cheekRight)
  ]);

  const foreheadRegion = {
    x: browBounds.x - browBounds.width * 0.08,
    y: browBounds.y - browBounds.height * 1.25,
    width: browBounds.width * 1.16,
    height: browBounds.height * 0.95
  };
  const crowLeft = {
    x: leftBounds.x - leftBounds.width * 0.65,
    y: leftBounds.y - leftBounds.height * 0.1,
    width: leftBounds.width * 0.55,
    height: leftBounds.height * 1.25
  };
  const crowRight = {
    x: rightBounds.x + rightBounds.width * 1.02,
    y: rightBounds.y - rightBounds.height * 0.1,
    width: rightBounds.width * 0.55,
    height: rightBounds.height * 1.25
  };

  const cheekTexture = average([
    sampleTextureScore(offscreenCtx, offscreenCanvas.width, offscreenCanvas.height, cheekLeft),
    sampleTextureScore(offscreenCtx, offscreenCanvas.width, offscreenCanvas.height, cheekRight)
  ]);
  const foreheadTexture = sampleTextureScore(offscreenCtx, offscreenCanvas.width, offscreenCanvas.height, foreheadRegion);
  const crowTexture = average([
    sampleTextureScore(offscreenCtx, offscreenCanvas.width, offscreenCanvas.height, crowLeft),
    sampleTextureScore(offscreenCtx, offscreenCanvas.width, offscreenCanvas.height, crowRight)
  ]);

  if (
    !Number.isFinite(underLum) ||
    !Number.isFinite(cheekLum) ||
    !Number.isFinite(cheekTexture) ||
    !Number.isFinite(foreheadTexture) ||
    !Number.isFinite(crowTexture)
  ) {
    state.visualFatigue.eyebag = 0;
    state.visualFatigue.wrinkle = 0;
    state.visualFatigue.fatigue = 0;
    return;
  }

  const detailFactor = clamp((faceDetailWidth - 18) / 22, 0.15, 1);
  const eyebagDelta = clamp(cheekLum - underLum, 0, 25);
  const wrinkleSignal = clamp(average([foreheadTexture, crowTexture]) - cheekTexture, 0, 14);

  const eyebagScore = clamp(eyebagDelta * 4.6 * detailFactor, 0, 100);
  const wrinkleScore = clamp(wrinkleSignal * 9.2 * detailFactor, 0, 100);
  const fatigueScore = clamp(eyebagScore * 0.58 + wrinkleScore * 0.42, 0, 100);

  if (
    !Number.isFinite(eyebagScore) ||
    !Number.isFinite(wrinkleScore) ||
    !Number.isFinite(fatigueScore)
  ) {
    return;
  }

  const alpha = clamp(state.settings.smoothingFactor, 0.05, 0.9);
  state.visualFatigue.eyebag = clamp(state.visualFatigue.eyebag * alpha + eyebagScore * (1 - alpha), 0, 100);
  state.visualFatigue.wrinkle = clamp(state.visualFatigue.wrinkle * alpha + wrinkleScore * (1 - alpha), 0, 100);
  state.visualFatigue.fatigue = clamp(state.visualFatigue.fatigue * alpha + fatigueScore * (1 - alpha), 0, 100);
}

function drawDetection(result, canvasId, videoId) {
  const canvas = $(canvasId);
  const video = $(videoId);
  const context = canvas.getContext("2d");

  const width = video.videoWidth || 640;
  const height = video.videoHeight || 480;
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;
  context.clearRect(0, 0, canvas.width, canvas.height);

  if (!result) return;

  const box = result.detection.box;
  context.strokeStyle = "#22c55e";
  context.lineWidth = 3;
  context.strokeRect(box.x, box.y, box.width, box.height);

  if (state.settings.showLandmarks) {
    faceapi.draw.drawFaceLandmarks(canvas, result);
  }
}

function restartDetectionLoop() {
  if (state.detectLoop) {
    clearInterval(state.detectLoop);
    state.detectLoop = null;
  }
  state.detectLoop = setInterval(runDetectionFrame, state.settings.detectionInterval);
}

async function connectSerial() {
  if (!("serial" in navigator)) {
    alert("Web Serial works in Chromium browsers like Chrome or Edge.");
    return;
  }
  if (state.serialConnecting || state.serialConnected) return;
  state.serialConnecting = true;
  try {
    if (state.serialPort) await disconnectSerial();
    state.serialPort = await navigator.serial.requestPort();
    await state.serialPort.open({ baudRate: PROJECT_CONFIG.hardware.serialBaudRate });
    state.serialConnected = true;
    state.serialKeepReading = true;
    setStatusChip($("serialBadge"), "muted", "CONNECTED");
    if ($("serialStatusText")) $("serialStatusText").textContent = "Connected";
    if ($("systemStatus")) $("systemStatus").textContent = "Serial Connected";
    updateSensorPresence();
    renderSensorGrid("sensorGrid");
    state.serialReadPromise = readSerialLoop();
  } catch (error) {
    if (error.name !== "NotFoundError") {
      console.error("Serial connection failed", error);
      alert("Serial connection failed.");
    }
    if (state.serialPort && !state.serialConnected) await disconnectSerial();
  } finally {
    state.serialConnecting = false;
  }
}

async function readSerialLoop() {
  const decoder = new TextDecoder();
  let buffer = "";

  while (state.serialPort && state.serialPort.readable && state.serialKeepReading) {
    state.serialReader = state.serialPort.readable.getReader();
    try {
      while (true) {
        const { value, done } = await state.serialReader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const maxLineBytes = PROJECT_CONFIG.runtime.maxSensorLineBytes;
        if (buffer.length > maxLineBytes) {
          console.warn("Discarding an oversized incomplete serial line.");
          const lastNewline = buffer.lastIndexOf("\n");
          buffer = lastNewline >= 0 ? buffer.slice(lastNewline + 1) : buffer.slice(-maxLineBytes);
        }
        const lines = buffer.split("\n");
        buffer = lines.pop();
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          try {
            const data = JSON.parse(trimmed);
            applySerialData(data, trimmed);
          } catch (error) {
            console.warn("Invalid serial JSON:", trimmed, error);
          }
        }
      }
    } catch (error) {
      console.error(error);
    } finally {
      if (state.serialReader) {
        state.serialReader.releaseLock();
        state.serialReader = null;
      }
    }
  }
}

function renderAll(options = {}) {
  renderSensorGrid("sensorGrid");
  renderProbabilities();
  renderLiveStatCards();
  updateMetrics();
  renderSummary();
  if (options.tables !== false) {
    renderInputRecords();
    renderReports();
  }
  updateStatusPanel();
}

function bindInputTable() {
  $("inputTableBody").addEventListener("click", (event) => {
    const row = event.target.closest("tr[data-record-index]");
    if (!row) return;
    openRecordModal(Number(row.dataset.recordIndex));
  });
}

function initIcons() {
  if (window.lucide) lucide.createIcons();
}

