/* App state and browser persistence. */

// Keys kept from earlier versions so existing patients and records still load.
const STORAGE_KEYS = {
  settings: "cnn_lstm_settings",
  profiles: "psychescan_profiles_v1",
  activeProfileId: "psychescan_active_profile_v1",
  records: "cnn_lstm_records_v3",
  baselineCollapsed: "psychescan_baseline_collapsed"
};

const DEFAULT_SETTINGS = {
  theme: "royal-violet",
  appearance: "light",
  mirrorCamera: true,
  showLandmarks: true,
  cameraDeviceId: "auto",
  cameraFacing: "auto",
  detectionInterval: 160,
  detectorInputSize: 512,
  detectionProfile: "phone-strong",
  smoothingFactor: 0.4,
  autoCapture: true,
  firstReadingDelaySec: 0,
  observationDurationSec: "180",
  customDurationMin: 3
};

const EMOTIONS = ["neutral", "happy", "sad", "angry", "fearful", "disgusted", "surprised"];

function emptyEmotions() {
  return Object.fromEntries(EMOTIONS.map(emotion => [emotion, 0]));
}

const state = {
  settings: { ...DEFAULT_SETTINGS },

  // Patients and records (persisted)
  profiles: [],
  activeProfileId: null,
  profileTabId: null,
  records: [],
  lastCaptureAt: 0,
  sessionId: null,
  sessionStartedAt: 0,

  // USB serial
  serial: {
    status: "disconnected",   // disconnected | connecting | connected | lost
    port: null,
    portInfo: null,
    simLost: false,           // the simulator's "unplug" button was used
    reader: null,
    readLoop: null,
    packets: 0,
    ignoredLines: 0,
    lastPacketAt: 0,
    lastRaw: "—"
  },
  simActive: false,

  // Latest valid reading per sensor and when it arrived
  latest: Object.fromEntries(SENSOR_KEYS.map(key => [key, { value: null, at: 0 }])),
  // One entry per received packet: { t, hr, gsr, temp, motion } (null = not valid)
  sensorLog: [],

  // Camera / face
  modelsLoaded: false,
  modelDetector: "tiny",
  cameraActive: false,
  stream: null,
  detectTimer: null,
  detectionBusy: false,
  emotionSmoothed: emptyEmotions(),
  dominantEmotion: "No Face",
  dominantConfidence: 0,
  visualFatigue: { eyebag: 0, wrinkle: 0, fatigue: 0 },
  // One entry per second while the camera runs: { t, faceDetected, dominantEmotion, emotions, eyebag, wrinkle, fatigue }
  faceLog: [],

  // Calibration and baseline (see baseline.js)
  calibration: { status: "idle", profileId: null, startedAt: 0, checks: null },
  baselineCapture: { active: false, startedAt: 0, endsAt: 0, error: "" },

  // LSTM (see lstm.js)
  lstm: { status: "loading", info: null, prediction: null, validFraction: 0 },

  charts: {}
};

function loadSettings() {
  const saved = loadJSON(STORAGE_KEYS.settings, {});
  Object.keys(DEFAULT_SETTINGS).forEach(key => {
    if (saved && saved[key] !== undefined) state.settings[key] = saved[key];
  });
  // Older versions stored the custom duration in seconds.
  if (saved && Number.isFinite(saved.customDurationSec) && saved.customDurationMin === undefined) {
    state.settings.customDurationMin = Math.max(1, Math.round(saved.customDurationSec / 60));
  }
  state.settings.observationDurationSec = String(state.settings.observationDurationSec);
}

function saveSettings() {
  saveJSON(STORAGE_KEYS.settings, state.settings);
}

// Fields from older versions (integrated score, severity decision) are dropped on load.
const REMOVED_RECORD_FIELDS = ["integratedScore", "decision", "decisionClass", "narrative", "connectedSensors", "heldSensors", "quality"];

function loadCollections() {
  const profiles = loadJSON(STORAGE_KEYS.profiles, []);
  state.profiles = Array.isArray(profiles) ? profiles.filter(profile => profile && profile.profileId) : [];
  state.profiles.forEach(profile => {
    if (profile.baseline) delete profile.baseline.score;
  });
  const records = loadJSON(STORAGE_KEYS.records, []);
  state.records = Array.isArray(records) ? records : [];
  state.records.forEach(record => REMOVED_RECORD_FIELDS.forEach(field => delete record[field]));
  const activeId = loadJSON(STORAGE_KEYS.activeProfileId, null);
  state.activeProfileId = state.profiles.some(profile => profile.profileId === activeId) ? activeId : null;
}

function persistCollections() {
  saveJSON(STORAGE_KEYS.profiles, state.profiles);
  saveJSON(STORAGE_KEYS.records, state.records);
  saveJSON(STORAGE_KEYS.activeProfileId, state.activeProfileId);
}

function getActiveProfile() {
  return state.profiles.find(profile => profile.profileId === state.activeProfileId) || null;
}

function getActiveBaseline() {
  return getActiveProfile()?.baseline || null;
}

function getBaselineDurationSec() {
  const minutes = state.settings.observationDurationSec === "custom"
    ? Number(state.settings.customDurationMin)
    : Number(state.settings.observationDurationSec) / 60;
  return clamp(Math.round((Number.isFinite(minutes) ? minutes : 3) * 60), 30, 3600);
}
