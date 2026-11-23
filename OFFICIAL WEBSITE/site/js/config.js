/* PsycheScan configuration. All values the rest of the code tunes against live here. */
const CONFIG = {
  serial: {
    baudRate: 115200,
    maxLineLength: 4096,     // longer partial lines are dropped (garbage on the port)
    staleAfterMs: 5000        // a sensor with no valid reading for this long shows as "Waiting"
  },

  // The four channels in the ESP32 JSON line. `flag` is the per-sensor boolean in the packet.
  sensors: {
    hr:     { name: "Analog Pulse Sensor", channel: "Heart rate",                 unit: "bpm", flag: "max30102",     decimals: 0, validMin: 25, validMax: 240 },
    gsr:    { name: "GSR Module",          channel: "Skin conductance (EDA)",     unit: "µS",  flag: "gsrConnected", decimals: 2, validMin: 0,  validMax: 100 },
    temp:   { name: "DS18B20",             channel: "Peripheral skin temperature", unit: "°C", flag: "ds18b20",      decimals: 1, validMin: 15, validMax: 45 },
    motion: { name: "MPU6050",             channel: "Motion (accelerometer)",     unit: "g",   flag: "mpu6050",      decimals: 3, validMin: 0,  validMax: 16 }
  },

  calibration: {
    minDurationSec: 60,
    maxDurationSec: 180,
    windowSec: 20,
    minWindowCoverage: 0.8,   // share of the 20 s window that needs a valid reading per sensor
    tempMaxRangeC: 0.2,
    gsrMaxRangeFraction: 0.10,
    hrMaxSd: 5
  },

  lstm: {
    modelUrl: "./models/lstm/model.json",
    normParamsUrl: "./models/lstm/norm_params.json",
    workerUrl: "./js/lstm_worker.js",
    intervalMs: 5000,
    minValidFraction: 0.8
  },

  faceModelsUrl: "./models/face-api",

  runtime: {
    chartWindowSec: 120,
    sensorLogKeepSec: 600,        // per-packet readings kept in memory (calibration, baseline, LSTM)
    detectionThresholdStandard: 0.45,
    detectionThresholdStrong: 0.35,
    autoCaptureConfidenceMin: 30,
    autoCaptureCooldownMs: 3000,
    minFaceDetailWidth: 18,
    maxRecords: 1000
  },

  // Dev-only simulator, enabled with ?sim=1. Values drift slowly so calibration can stabilise.
  sim: {
    hr: 76, gsr: 2.1, temp: 34.5, motion: 0.03
  },

  disclaimer: "Decision-support tool only. Not a diagnosis. Does not replace clinical assessment."
};

const SENSOR_KEYS = Object.keys(CONFIG.sensors);
