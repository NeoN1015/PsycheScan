import { CONFIG } from "../config.js";

// Session flow (spec §6): one screen per phase, in this order.
export const PHASES = [
  "setup", "screening", "consent", "connect", "calibration",
  "rest", "stressIntro", "stress", "recovery", "questionnaires", "end",
];

export const PHASE_LABEL = {
  setup: "Setup",
  screening: "Screening",
  consent: "Consent",
  connect: "Connect",
  calibration: "Calibration",
  rest: "Rest",
  stressIntro: "Stress task instructions",
  stress: "Stress task",
  recovery: "Recovery",
  questionnaires: "Questionnaires",
  end: "End",
};

// The 1 Hz sampler runs from calibration start to the end of recovery (spec §9).
export const RECORDING_PHASES = new Set(["calibration", "rest", "stressIntro", "stress", "recovery"]);

// Value written to the samples CSV "phase" column (NOTES.md: stress_intro, checkpoint).
export const ROW_TAG = {
  calibration: "calibration",
  rest: "rest",
  stressIntro: "stress_intro",
  stress: "stress",
  recovery: "recovery",
};

// Fixed-length phases, in seconds. Calibration has its own rule (spec §6.4).
export const PHASE_SECONDS = {
  rest: CONFIG.phases.restSeconds,
  stressIntro: CONFIG.phases.stressInstructionSeconds,
  stress: CONFIG.phases.stressSeconds,
  recovery: CONFIG.phases.recoverySeconds,
};

// A checkpoint follows each of these phases (spec §10).
export const CHECKPOINT_AFTER = { calibration: 1, rest: 2, stress: 3, recovery: 4 };

/** true when Setup named a GSR reference device (anything except empty or "None"). */
export function hasGsrReference(setup) {
  const d = (setup.refGsrDevice || "").trim().toLowerCase();
  return d !== "" && d !== "none";
}

export function createInitialState() {
  return {
    phase: "setup",
    phaseStartedAt: null, // performance.now()
    phaseRun: 0, // +1 on every phase start or restart (internal)
    paused: false,
    pausedAt: null,
    pausedTotalMs: 0,
    aborted: false,
    sessionDate: null, // local YYYY-MM-DD, set at Setup
    setup: {
      participantId: "", operator: "", location: "",
      refHrDevice: "", refTempDevice: "", refGsrDevice: "",
    },
    screening: {
      age: "", sex: "", heartCondition: null, mhTreatment: null, clinicSupervised: false,
      caffeine2h: null, smoked1h: null, sleepHours: "", dominantHand: "", glasses: null,
      eligible: null,
    },
    consent: { signed: false, canStop: false, anonymous: false },
    calibration: { seconds: 0, forced: false },
    pendingCheckpoint: null, // open checkpoint modal, with its sensor snapshot
    checkpoints: [],
    stressTaskLog: [],
    gad7: Array(7).fill(null),
    pss10: Array(10).fill(null),
    events: [],
    downloaded: false,
    simulated: false, // dev "Simulate sensors" was used in this session
  };
}
