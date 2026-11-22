/* LSTM slot (main thread).
 *
 * Loads ./models/lstm/norm_params.json:
 *   {"features":["hr","gsr","temp","motion"],"mean":[...],"std":[...],"sequenceLength":30,"labels":["Not stressed","Stressed"]}
 * and ./models/lstm/model.json (TensorFlow.js Layers model). Every 5 s it takes the last
 * `sequenceLength` seconds of sensor readings, and if at least 80 % of those seconds have a
 * valid reading for every feature, the worker normalises them and runs the model.
 * If the files are missing, the dashboard shows "LSTM model not loaded" and nothing else changes.
 */

const lstmRuntime = { worker: null, timer: null, nextId: 0, pending: new Map(), busy: false };

function validateNormParams(params) {
  const problems = [];
  if (!params || typeof params !== "object") return ["norm_params.json is not a JSON object"];
  const { features, mean: means, std, sequenceLength, labels } = params;
  if (!Array.isArray(features) || !features.length) problems.push('"features" must be a non-empty array');
  else {
    const unknown = features.filter(feature => !SENSOR_KEYS.includes(feature));
    if (unknown.length) problems.push(`unknown feature(s): ${unknown.join(", ")} (expected ${SENSOR_KEYS.join(", ")})`);
  }
  const n = Array.isArray(features) ? features.length : 0;
  if (!Array.isArray(means) || means.length !== n || !means.every(Number.isFinite)) problems.push(`"mean" must be ${n} numbers`);
  if (!Array.isArray(std) || std.length !== n || !std.every(value => Number.isFinite(value) && value >= 0)) problems.push(`"std" must be ${n} non-negative numbers`);
  if (!Number.isInteger(sequenceLength) || sequenceLength < 1) problems.push('"sequenceLength" must be a positive integer');
  if (!Array.isArray(labels) || labels.length < 2 || !labels.every(label => typeof label === "string")) problems.push('"labels" must be at least two strings');
  return problems;
}

function callLstmWorker(type, payload) {
  const id = ++lstmRuntime.nextId;
  return new Promise((resolve, reject) => {
    lstmRuntime.pending.set(id, { resolve, reject });
    lstmRuntime.worker.postMessage({ id, type, ...payload });
  });
}

function setLstmStatus(status, extra = {}) {
  Object.assign(state.lstm, { status, ...extra });
  renderLstm();
}

async function loadLstm() {
  setLstmStatus("loading");
  let params;
  try {
    const response = await fetch(CONFIG.lstm.normParamsUrl, { cache: "no-cache" });
    if (!response.ok) {
      setLstmStatus("missing");
      return;
    }
    params = await response.json();
  } catch {
    setLstmStatus("missing");
    return;
  }
  const problems = validateNormParams(params);
  if (problems.length) {
    setLstmStatus("error", { error: `norm_params.json: ${problems.join("; ")}` });
    return;
  }

  try {
    lstmRuntime.worker = new Worker(CONFIG.lstm.workerUrl);
    lstmRuntime.worker.onmessage = ({ data }) => {
      const pending = lstmRuntime.pending.get(data?.id);
      if (!pending) return;
      lstmRuntime.pending.delete(data.id);
      data.ok ? pending.resolve(data.result) : pending.reject(new Error(data.error));
    };
    lstmRuntime.worker.onerror = event => {
      event.preventDefault();
      const error = new Error(event.message || "LSTM worker failed");
      lstmRuntime.pending.forEach(pending => pending.reject(error));
      lstmRuntime.pending.clear();
    };
    const modelUrl = new URL(CONFIG.lstm.modelUrl, document.baseURI).href;
    const info = await callLstmWorker("load", { modelUrl, params });
    state.lstm.info = { ...params, outputMode: info.outputMode };
    setLstmStatus("collecting", { validFraction: 0 });
    lstmRuntime.timer = setInterval(runLstmPrediction, CONFIG.lstm.intervalMs);
  } catch (error) {
    lstmRuntime.worker?.terminate();
    lstmRuntime.worker = null;
    setLstmStatus("error", { error: error.message });
  }
}

/* The last `sequenceLength` one-second slots of readings for the model's features.
 * A slot is valid when a packet in that second had every feature valid. */
function buildLstmWindow(now = Date.now()) {
  const { features, sequenceLength } = state.lstm.info;
  const start = now - sequenceLength * 1000;
  const slots = new Array(sequenceLength).fill(null);
  state.sensorLog.forEach(entry => {
    if (entry.t <= start || entry.t > now) return;
    const row = features.map(feature => entry[feature]);
    if (!row.every(Number.isFinite)) return;
    slots[Math.min(sequenceLength - 1, Math.floor((entry.t - start - 1) / 1000))] = row;
  });
  const validCount = slots.filter(Boolean).length;
  const validFraction = validCount / sequenceLength;
  if (validFraction < CONFIG.lstm.minValidFraction) return { sequence: null, validFraction, validCount };
  // Fill the few missing seconds from the nearest valid reading (forward, then backward).
  for (let i = 1; i < slots.length; i++) if (!slots[i]) slots[i] = slots[i - 1];
  for (let i = slots.length - 2; i >= 0; i--) if (!slots[i]) slots[i] = slots[i + 1];
  return { sequence: slots, validFraction, validCount };
}

async function runLstmPrediction() {
  if (!lstmRuntime.worker || lstmRuntime.busy) return;
  const { sequence, validFraction } = buildLstmWindow();
  if (!sequence) {
    setLstmStatus("collecting", { prediction: null, validFraction });
    return;
  }
  lstmRuntime.busy = true;
  try {
    const prediction = await callLstmWorker("predict", { sequence });
    setLstmStatus("ready", { prediction: { ...prediction, at: Date.now() }, validFraction });
  } catch (error) {
    setLstmStatus("error", { prediction: null, error: error.message });
    clearInterval(lstmRuntime.timer);
    lstmRuntime.worker?.terminate();
    lstmRuntime.worker = null;
  } finally {
    lstmRuntime.busy = false;
  }
}

function resetLstmPrediction() {
  if (state.lstm.status === "ready") setLstmStatus("collecting", { prediction: null, validFraction: 0 });
}

/* Short text for badges and the full sentence for status rows. */
function lstmTexts() {
  const lstm = state.lstm;
  const seconds = lstm.info?.sequenceLength;
  switch (lstm.status) {
    case "ready": {
      const percent = Math.round(lstm.prediction.confidence * 100);
      return { short: `${lstm.prediction.label} · ${percent}%`, long: `${lstm.prediction.label} (${percent}% confidence, last ${seconds} s)` };
    }
    case "collecting":
      return {
        short: "Collecting…",
        long: `Collecting data: ${Math.round(lstm.validFraction * 100)}% of the last ${seconds} s valid (needs ${Math.round(CONFIG.lstm.minValidFraction * 100)}%)`
      };
    case "loading":
      return { short: "Loading…", long: "Loading LSTM model…" };
    case "error":
      return { short: "Not loaded", long: `LSTM model not loaded (${lstm.error})` };
    default:
      return { short: "Not loaded", long: "LSTM model not loaded" };
  }
}

function renderLstm() {
  const { short, long } = lstmTexts();
  const badge = $("dashboardLstmBadge");
  if (badge) {
    setStatusChip(badge, state.lstm.status === "ready" ? "success" : "muted", `LSTM: ${short}`);
    badge.title = long;
  }
  setText("metricLstm", state.lstm.status === "ready" ? state.lstm.prediction.label : short);
  setText("metricLstmNote", state.lstm.status === "ready" ? `${Math.round(state.lstm.prediction.confidence * 100)}% confidence` : long);
  setText("summaryLstm", long);
  setText("lstmStatusText", long);
}
