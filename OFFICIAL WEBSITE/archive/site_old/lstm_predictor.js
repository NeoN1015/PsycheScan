/* LSTM stress-trend predictor (main thread).
 *
 * Builds a 60 x 4 window [hr, gsr, temp, motion] from the live history,
 * resampled to 1 Hz, and asks lstm_worker.js to classify it as
 * Minimal / Mild / Moderate / Severe.
 *
 * Events dispatched on window:
 *   "lstm-prediction"  detail: { class, confidence, probabilities, trainingData } or null
 *   "lstm-status"      detail: { state: "loading" | "collecting" | "ready", collectedSeconds, requiredSeconds }
 *   "lstm-load-error"  detail: { message }
 */

const SEQ_LEN = PROJECT_CONFIG.lstm.sequenceLength;
// The model was trained on 1 Hz windows. History is sampled every 0.5-2 s,
// so it is resampled onto a fixed one-second grid (latest reading carried forward).
const LSTM_MIN_COVERAGE = 0.8;   // share of seconds that must have a fresh reading
const LSTM_MAX_GAP_MS = 3000;    // a reading older than this does not count for a slot

let lstmWorker = null;
let lstmReady = false;
let lstmLoading = false;
let lstmRetryTimer = null;
let lstmPredictionTimer = null;
let lstmPredictionInFlight = false;
let lstmLoadAttempt = 0;
let lstmRequestId = 0;
const lstmPending = new Map();

function emitLstmStatus(detail) {
  window.dispatchEvent(new CustomEvent("lstm-status", { detail }));
}

function getLstmWorker() {
  if (lstmWorker) return lstmWorker;
  lstmWorker = new Worker("lstm_worker.js");
  lstmWorker.onmessage = ({ data }) => {
    const pending = lstmPending.get(data?.id);
    if (!pending) return;
    lstmPending.delete(data.id);
    if (data.ok) pending.resolve(data.result);
    else pending.reject(new Error(data.error));
  };
  lstmWorker.onerror = event => {
    // Script-level failure (e.g. TF.js could not be loaded): fail everything and rebuild later.
    event.preventDefault?.();
    const error = new Error(event.message || "LSTM worker failed to start.");
    lstmPending.forEach(pending => pending.reject(error));
    lstmPending.clear();
    lstmWorker.terminate();
    lstmWorker = null;
    lstmReady = false;
  };
  return lstmWorker;
}

function callLstmWorker(type, payload = {}) {
  const id = ++lstmRequestId;
  return new Promise((resolve, reject) => {
    lstmPending.set(id, { resolve, reject });
    getLstmWorker().postMessage({ id, type, ...payload });
  });
}

async function loadLstmModel() {
  if (lstmReady || lstmLoading) return;
  lstmLoading = true;
  emitLstmStatus({ state: "loading" });
  try {
    const info = await callLstmWorker("load", { baseUrl: document.baseURI });
    if (info.sequenceLength !== SEQ_LEN) {
      throw new Error(`Model expects ${info.sequenceLength}-step sequences; config uses ${SEQ_LEN}.`);
    }
    lstmReady = true;
    lstmLoadAttempt = 0;
    console.info(`[LSTM] Model ready in worker (backend: ${info.backend}, training data: ${info.trainingData})`);
    emitLstmStatus({ state: "collecting", collectedSeconds: 0, requiredSeconds: SEQ_LEN });
    startLstmLoop(PROJECT_CONFIG.lstm.predictionIntervalMs);
  } catch (error) {
    lstmReady = false;
    lstmLoadAttempt += 1;
    console.error("[LSTM] Model load failed; will retry.", error);
    window.dispatchEvent(new CustomEvent("lstm-load-error", { detail: { message: error.message } }));
    const delay = Math.min(60000, 2000 * (2 ** Math.min(lstmLoadAttempt - 1, 5)));
    clearTimeout(lstmRetryTimer);
    lstmRetryTimer = setTimeout(() => {
      lstmRetryTimer = null;
      loadLstmModel();
    }, delay);
  } finally {
    lstmLoading = false;
  }
}

// Samples with readings carried over from a disconnected sensor are shown on the
// graphs but kept out of the model, so it only sees live data.
function hasAllSensorValues(item) {
  if (Array.isArray(item.heldSensors) && item.heldSensors.length) return false;
  return [item.hr, item.gsr, item.temp, item.motion].every(Number.isFinite);
}

function buildLstmSequence(history, now = Date.now()) {
  const samples = history
    .filter(item => Number.isFinite(item.timestamp) && hasAllSensorValues(item))
    .sort((a, b) => a.timestamp - b.timestamp);
  const sequence = [];
  let covered = 0;
  let cursor = 0;
  let latest = null;
  for (let slot = SEQ_LEN - 1; slot >= 0; slot -= 1) {
    const slotEnd = now - slot * 1000;
    while (cursor < samples.length && samples[cursor].timestamp <= slotEnd) {
      latest = samples[cursor];
      cursor += 1;
    }
    const fresh = latest && slotEnd - latest.timestamp <= LSTM_MAX_GAP_MS;
    if (fresh) covered += 1;
    sequence.push(fresh ? [latest.hr, latest.gsr, latest.temp, latest.motion] : null);
  }
  // Short gaps (e.g. a dropped packet) are bridged with the previous reading.
  for (let index = 1; index < sequence.length; index += 1) {
    if (!sequence[index] && sequence[index - 1]) sequence[index] = sequence[index - 1];
  }
  const ready = Boolean(sequence[0]) && sequence.every(Boolean) && covered / SEQ_LEN >= LSTM_MIN_COVERAGE;
  return { sequence: ready ? sequence : null, collectedSeconds: covered };
}

async function runLstmPrediction() {
  if (!lstmReady || lstmPredictionInFlight) return;
  const history = (typeof getWindowHistory === "function" ? getWindowHistory() : null) || [];
  const { sequence, collectedSeconds } = buildLstmSequence(history);
  if (!sequence) {
    // Not enough continuous four-sensor data: clear any stale prediction.
    window.dispatchEvent(new CustomEvent("lstm-prediction", { detail: null }));
    emitLstmStatus({ state: "collecting", collectedSeconds, requiredSeconds: SEQ_LEN });
    return;
  }
  lstmPredictionInFlight = true;
  try {
    const prediction = await callLstmWorker("predict", { sequence });
    window.dispatchEvent(new CustomEvent("lstm-prediction", { detail: prediction }));
    emitLstmStatus({ state: "ready", collectedSeconds, requiredSeconds: SEQ_LEN });
  } catch (error) {
    console.error("[LSTM] Prediction failed", error);
    window.dispatchEvent(new CustomEvent("lstm-prediction", { detail: null }));
    if (!lstmWorker) {
      // Worker crashed: reload the model.
      window.dispatchEvent(new CustomEvent("lstm-load-error", { detail: { message: error.message } }));
      loadLstmModel();
    }
  } finally {
    lstmPredictionInFlight = false;
  }
}

function startLstmLoop(intervalMs = PROJECT_CONFIG.lstm.predictionIntervalMs) {
  if (lstmPredictionTimer) return;
  runLstmPrediction();
  lstmPredictionTimer = setInterval(runLstmPrediction, intervalMs);
}

window.addEventListener("load", loadLstmModel);
// Restored from the back/forward cache: the worker was terminated on pagehide.
window.addEventListener("pageshow", event => {
  if (event.persisted) loadLstmModel();
});
window.addEventListener("pagehide", () => {
  clearInterval(lstmPredictionTimer);
  lstmPredictionTimer = null;
  lstmWorker?.terminate();
  lstmWorker = null;
  lstmReady = false;
});
