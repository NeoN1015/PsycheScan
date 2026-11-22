// All tunable values (spec Section 15). Values marked "spec §x" come from
// that section's text rather than the Section 15 listing.
// Sensor-only build: the camera / CNN settings of Section 15 were removed (see NOTES.md).

export const CONFIG = {
  appVersion: "collect-1.1-react",
  // Written to the firmware_note column of _session.csv.
  firmwareNote: "ESP32 USB Serial JSON at 1 line/s (spec Section 4)",

  serial: { baudRate: 115200, staleMs: 3000, maxLineBytes: 1024 },
  sampleIntervalMs: 1000,
  autosaveMs: 10000,

  calibration: {
    minSeconds: 60, maxSeconds: 180, windowSeconds: 20,
    tempRangeC: 0.2, gsrRangePct: 10, hrStdBpm: 5,
    advanceDelayMs: 3000,     // spec §6.4: advance 3 s after "Stable ✓"
    minSamplesPct: 80,        // NOTES.md: share of the 20 s window that must hold a usable value
  },
  phases: {
    restSeconds: 60, stressSeconds: 60, recoverySeconds: 60,   // NOTES.md: shortened from the spec's 180 s
    stressInstructionSeconds: 10,
    pauseRestartSeconds: 60,  // spec §11: pause longer than this restarts rest/stress/recovery
  },
  stressTask: {
    startLimitS: 4.0, minLimitS: 2.5, maxLimitS: 4.0, stepS: 0.5,
    upAfterCorrect: 3, downAfterWrong: 2, feedbackMs: 600, noRepeat: 10,
    buzz: true,               // spec §7: optional low buzz on wrong / too slow
    buzzHz: 150, buzzMs: 200, buzzGain: 0.2,
    averagePerSecond: 0.2,    // fake "Average score" growth (correct answers per second)
    averageLead: 3,           // fake average always at least this far above the participant
  },
  checkpoints: { lateSeconds: 15, hrRange: [40, 200], tempRange: [30, 42] },

  // spec §6.3 Connect checks
  connect: { freshMs: 2000, hrRange: [40, 180], tempRange: [25, 40] },

  displayTickMs: 250,
  validity: {
    minValidPctWarning: 80,
    sensorFreshMs: 1500,      // spec §9: sensor line received in the last 1.5 s
  },
};
