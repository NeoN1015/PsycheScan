/**
 * Project configuration aligned with:
 * CpE28-COEN3133 POD Manuscript — Colegio de Muntinlupa, CpE Batch 28
 * "Development of a Real-Time Early Detection System for Mental Health Using
 * Vital Signs Sensors Applying Hybrid CNN-LSTM Algorithms..."
 */
const PROJECT_CONFIG = {
  branding: {
    shortName: "PsycheScan",
    systemTitle: "Real-Time Early Detection System for Mental Health",
    fullTitle:
      "Development of a Real-Time Early Detection System for Mental Health Using Vital Signs Sensors Applying Hybrid CNN-LSTM Algorithms for In-Depth Analysis of Stress and Anxiety Parameters",
    subtitle: "Hybrid CNN-LSTM stress and anxiety screening for barangay health workers",
    institution: "Colegio de Muntinlupa",
    department: "Computer Engineering Department",
    course: "COEN3133 — Capstone Design Study",
    batch: "CpE Batch 28",
    authors: [
      "Ageas, Axel B.",
      "Carreon, Jannah Leigh M.",
      "Ruina, Shane R."
    ],
    adviser: "Engr. Ricrey E. Marquez, PCpE",
    platform: "Lenovo ThinkCentre M700 mini PC",
    mcu: "ESP32",
    participantAgeRange: "18–65 years old",
    validationReference: "PHQ-9"
  },

  hardware: {
    serialBaudRate: 115200,
    wsUrl: null, // resolved at runtime from PROJECT_CONFIG.hardware._wsUrl or defaults to same-origin
    _wsUrl: "ws://10.73.86.82:81",
    pins: {
      pulse: 35,
      gsr: 34,
      temperature: 4,
      i2cSda: 21,
      i2cScl: 22
    },
    bleServiceUuid: "6e400001-b5a3-f393-e0a9-e50e24dcca9e",
    bleCharacteristicUuid: "6e400003-b5a3-f393-e0a9-e50e24dcca9e"
  },

  sensors: {
    max30102: {
      name: "Analog Pulse Sensor",
      channel: "Heart rate",
      key: "hr",
      unit: "bpm",
      legacyFlags: ["HW827", "max30102"]
    },
    gsr: {
      name: "GSR Module",
      channel: "Skin conductance (EDA)",
      key: "gsr",
      unit: "µS",
      legacyFlags: ["gsrConnected"]
    },
    ds18b20: {
      name: "DS18B20",
      channel: "Peripheral body temperature",
      key: "temp",
      unit: "°C",
      legacyFlags: ["ds18b20"]
    },
    mpu6050: {
      name: "MPU6050",
      channel: "Motion / accelerometer RMS",
      key: "motion",
      unit: "g",
      legacyFlags: ["mpu6050"]
    }
  },

  /** Manually validated biomarker thresholds from the project specifications. */
  biomarkers: {
    hr: {
      validMin: 25,
      validMax: 240,
      minimalMin: 60,
      minimalMax: 85,
      mildMin: 86,
      mildMax: 95,
      moderateMin: 96,
      moderateMax: 105,
      severeMin: 106,
      relativeMildMin: 10,
      relativeModerateMin: 15,
      relativeSevereMin: 20
    },
    gsr: {
      validMin: 0,
      validMax: 100,
      minimalMin: 0.9,
      minimalMax: 1.1,
      mildMin: 1.2,
      mildMax: 2.4,
      moderateMin: 2.5,
      moderateMax: 4.0,
      severeMin: 4.1,
      relativeMildMin: 20,
      relativeModerateMin: 50,
      relativeSevereMin: 100
    },
    temp: {
      validMin: 15,
      validMax: 45,
      baselineMin: 0,
      baselineMax: 0.2,
      mildMin: 0.3,
      mildMax: 0.8,
      moderateMin: 0.9,
      moderateMax: 1.5,
      severeMin: 1.6,
      baselineTemp: 34,
      baselineDelta: 0
    },
    motion: {
      validMin: 0,
      validMax: 16,
      minimalMin: 0.00,
      minimalMax: 0.05,
      mildMin: 0.06,
      mildMax: 0.10,
      moderateMin: 0.11,
      moderateMax: 0.20,
      severeMin: 0.21
    }
  },

  severity: {
    labels: ["Minimal", "Mild", "Moderate", "Severe"],
    score: { mild: 25, moderate: 45, severe: 70 },
    percentBands: { minimalMax: 24, mildMax: 49, moderateMax: 74 }
  },

  fusion: {
    emotionWeight: 0.42,
    fatigueWeight: 0.18,
    sensorWeight: 0.40
  },

  demo: {
    hrMin: 60,
    hrMax: 85,
    gsrMin: 0.9,
    gsrMax: 1.1,
    tempMin: 33.0,
    tempMax: 35.0,
    motionMin: 0.05,
    motionMax: 0.20
  },

  lstm: {
    sequenceLength: 60,
    predictionIntervalMs: 5000
  },
  runtime: {
    sensorFreshnessMs: 6000,
    detectionThresholdStandard: 0.45,
    detectionThresholdStrong: 0.35,
    autoCaptureConfidenceMin: 30,
    autoCaptureCooldownMs: 3000,
    maxTemperatureDrop: 15,
    trendDeltaThreshold: 4,
    minFaceDetailWidth: 18,
    maxSensorLineBytes: 8192,
    historyWindowMs: 120000,
    telemetryQueueLimit: 1000
  },

  disclaimer:
    "Screening and decision-support tool only — not a clinical diagnosis substitute. Consult licensed professionals before deployment."
};

function getSensorRegistry() {
  return PROJECT_CONFIG.sensors;
}

function getSensorIds() {
  return Object.keys(PROJECT_CONFIG.sensors);
}

function createInitialSensors() {
  const sensors = {};
  getSensorIds().forEach(id => {
    sensors[id] = { connected: false, state: "disconnected", lastSeen: 0 };
  });
  return sensors;
}

function getSensorMeta() {
  const meta = {};
  Object.entries(PROJECT_CONFIG.sensors).forEach(([id, sensor]) => {
    meta[id] = {
      name: sensor.name,
      channel: sensor.channel,
      key: sensor.key,
      unit: sensor.unit
    };
  });
  return meta;
}

/** Resolve the WebSocket URL at runtime.
 *  Priority: explicit override → stored setting → same-origin fallback → hardcoded default. */
function getWebSocketUrl() {
  // Allow runtime override via window.__PS_WS_URL__ (useful for dev / CI)
  if (typeof window !== "undefined" && window.__PS_WS_URL__) {
    return window.__PS_WS_URL__;
  }
  // Check for a user-saved override in settings
  try {
    const settings = loadLocalJSON?.(STORAGE_KEYS?.settings, null);
    if (settings?.wsUrl && typeof settings.wsUrl === "string" && settings.wsUrl.length > 0) {
      return settings.wsUrl;
    }
  } catch (_) { /* settings not available yet */ }
  // Same-origin fallback (works when the WS server runs on the same host)
  if (typeof window !== "undefined" && window.location) {
    const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
    return `${proto}//${window.location.host}`;
  }
  // Hardcoded default as last resort
  return PROJECT_CONFIG.hardware._wsUrl;
}

function packetMarksSensorConnected(data, sensorId) {
  if (!data || typeof data !== "object") return false;
  const sensor = PROJECT_CONFIG.sensors[sensorId];
  if (!sensor) return false;
  if (data[sensorId] === true) return true;
  return (sensor.legacyFlags || []).some(flag => data[flag] === true);
}

function formatMotionValue(value) {
  if (value === null || value === undefined || Number.isNaN(value)) return "--";
  return Number(value).toFixed(3);
}
