let lstmModel = null;
let normMean = [];
let normStd = [];
let labelMap = {};
let lstmReady = false;
let lstmLoading = false;
let lstmRetryTimer = null;
let lstmPredictionTimer = null;
let lstmLoadAttempt = 0;
const SEQ_LEN = PROJECT_CONFIG.lstm.sequenceLength;
const CLASS_NAMES = ["Minimal", "Mild", "Moderate", "Severe"];

function validateLstmArtifacts(mean, std, labels, outputSize) {
  if (!Array.isArray(mean) || !Array.isArray(std) || mean.length !== 4 || std.length !== 4) {
    throw new Error("Normalization data must contain four sensor values.");
  }
  if (!mean.every(Number.isFinite) || !std.every(value => Number.isFinite(value) && value >= 0)) {
    throw new Error("Normalization data contains invalid values.");
  }
  if (!labels || typeof labels !== "object" || Array.isArray(labels)) {
    throw new Error("The LSTM label map is invalid.");
  }
  const indexes = CLASS_NAMES.map(name => labels[name]);
  if (indexes.some((index, expected) => index !== expected) || outputSize !== CLASS_NAMES.length) {
    throw new Error("The LSTM model and label map must use Minimal/Mild/Moderate/Severe indexes 0-3.");
  }
}

async function loadLstmModel() {
  if (lstmReady || lstmLoading) return;
  lstmLoading = true;
  let loadedModel = null;
  try {
    if (!window.tf) throw new Error("TensorFlow.js is unavailable.");
    loadedModel = await tf.loadLayersModel("tfjs_lstm_model/model.json");
    const [normResponse, labelResponse] = await Promise.all([
      fetch("lstm_norm_params.json", { cache: "no-store" }),
      fetch("label_map.json", { cache: "no-store" })
    ]);
    if (!normResponse.ok || !labelResponse.ok) {
      throw new Error("LSTM normalization or label-map file could not be loaded.");
    }
    const [normData, labels] = await Promise.all([normResponse.json(), labelResponse.json()]);
    const outputShape = loadedModel.outputs[0].shape;
    const outputSize = outputShape[outputShape.length - 1];
    validateLstmArtifacts(normData.mean, normData.std, labels, outputSize);
    if (lstmModel) lstmModel.dispose();
    lstmModel = loadedModel;
    loadedModel = null;
    normMean = normData.mean;
    normStd = normData.std.map(value => value === 0 ? 1 : value);
    labelMap = labels;
    lstmReady = true;
    lstmLoadAttempt = 0;
    console.info("[LSTM] Model ready");
    if (!lstmPredictionTimer) startLstmLoop(PROJECT_CONFIG.lstm.predictionIntervalMs);
  } catch (error) {
    if (loadedModel) loadedModel.dispose();
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

function predictStress(sequence) {
  if (!lstmReady || !lstmModel || sequence.length !== SEQ_LEN) return null;
  if (sequence.some(row => !Array.isArray(row) || row.length !== normMean.length || !row.every(Number.isFinite))) {
    return null;
  }

  const normalized = sequence.map(row =>
    row.map((value, index) => (value - normMean[index]) / normStd[index])
  );
  return tf.tidy(() => {
    const inputTensor = tf.tensor3d([normalized]);
    const output = lstmModel.predict(inputTensor);
    const probabilityTensor = Array.isArray(output) ? output[0] : output;
    const values = probabilityTensor.dataSync();
    let classIdx = 0;
    for (let index = 1; index < values.length; index += 1) {
      if (values[index] > values[classIdx]) classIdx = index;
    }
    return {
      class: CLASS_NAMES[classIdx],
      confidence: values[classIdx]
    };
  });
}

function startLstmLoop(intervalMs = PROJECT_CONFIG.lstm.predictionIntervalMs) {
  if (lstmPredictionTimer) return;
  lstmPredictionTimer = setInterval(() => {
    if (!lstmReady) return;
    const recent = state.history.slice(-SEQ_LEN);
    if (recent.length < SEQ_LEN) return;
    const sequence = recent.map(item => [item.hr, item.gsr, item.temp, item.motion]);
    if (sequence.some(row => !row.every(Number.isFinite))) return;
    const prediction = predictStress(sequence);
    if (prediction) {
      window.dispatchEvent(new CustomEvent("lstm-prediction", { detail: prediction }));
    }
  }, intervalMs);
}

window.addEventListener("load", loadLstmModel);
