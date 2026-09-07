/**
 * Project configuration aligned with:
 * CpE28-COEN3133 POD Manuscript — Colegio de Muntinlupa, CpE Batch 28
 * "Development of a Real-Time Early Detection System for Mental Health Using
 * Vital Signs Sensors Applying Hybrid CNN-LSTM Algorithms..."
 */
const PROJECT_CONFIG = {
  auth: {
    operatorPassword: "CPE28"
  },

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
    wsUrl: "ws://192.168.4.1:81",
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

  /** Table 1: Biomarker Threshold Classification (manuscript) */
  biomarkers: {
    hr: {
      baselineMax: 85,
      mildMax: 95,
      moderateMax: 104
    },
    gsr: {
      restingMax: 1.1,
      mildMax: 2.4,
      moderateMax: 4.0
    },
    temp: {
      peripheralMin: 28,
      peripheralMax: 40,
      baseline: 34,
      mildDropMax: 0.3,
      moderateDropMax: 0.9,
      severeDropMin: 1.6
    },
    motion: {
      minimalMax: 0.03,
      mildMax: 0.05,
      moderateMax: 0.08
    }
  },

  severity: {
    labels: ["Minimal", "Mild", "Moderate", "Severe"],
    score: { mild: 25, moderate: 45, severe: 70 }
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
    motionMin: 0.03,
    motionMax: 0.05
  },

  lstm: {
    sequenceLength: 60,
    predictionIntervalMs: 5000
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

function createSensorMeta() {
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

function packetMarksSensorConnected(data, sensorId) {
  if (!data || typeof data !== "object") return false;
  const sensor = PROJECT_CONFIG.sensors[sensorId];
  if (!sensor) return false;
  if (data[sensorId] === true) return true;
  return (sensor.legacyFlags || []).some(flag => data[flag] === true);
}

function biomarkerRisk(key, value) {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;

  const b = PROJECT_CONFIG.biomarkers;
  if (key === "hr") {
    if (value <= b.hr.baselineMax) return 0;
    if (value <= b.hr.mildMax) return 33;
    if (value <= b.hr.moderateMax) return 66;
    return 100;
  }
  if (key === "gsr") {
    if (value <= b.gsr.restingMax) return 0;
    if (value <= b.gsr.mildMax) return 33;
    if (value <= b.gsr.moderateMax) return 66;
    return 100;
  }
  if (key === "temp") {
    if (value >= b.temp.peripheralMin && value <= b.temp.peripheralMax) return 0;
    if (value > b.temp.peripheralMax) return 0;
    const drop = b.temp.baseline - value;
    if (drop >= b.temp.severeDropMin) return 100;
    if (drop <= b.temp.mildDropMax) return 33;
    if (drop <= b.temp.moderateDropMax) return 66;
    return 100;
  }
  if (key === "motion") {
    if (value <= b.motion.minimalMax) return 0;
    if (value <= b.motion.mildMax) return 50;
    if (value <= b.motion.moderateMax) return 66;
    return 100;
  }
  return null;
}

function formatMotionValue(value) {
  if (value === null || value === undefined || Number.isNaN(value)) return "--";
  return Number(value).toFixed(3);
}
