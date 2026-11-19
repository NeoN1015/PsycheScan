/* LSTM inference worker.
 *
 * TensorFlow.js 4 runs here, isolated from the page. face-api.js bundles its
 * own TensorFlow core (1.7), and both versions share one global engine when
 * loaded on the same page, which made every LSTM operation fail with
 * "n is not a function". A worker has its own global scope, so no conflict.
 */
/* global tf */
importScripts("vendor/tf.min.js"); // TF.js 4.22.0, SHA-384 matches the CDN SRI hash

const CLASS_NAMES = ["Minimal", "Mild", "Moderate", "Severe"];
let model = null;
let normMean = [];
let normStd = [];
let trainingData = "unspecified";
let sequenceLength = 0;

function validateArtifacts(mean, std, labels, outputSize) {
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

async function load(baseUrl) {
  await tf.ready();
  const loaded = await tf.loadLayersModel(new URL("tfjs_lstm_model/model.json", baseUrl).href);
  try {
    const [normResponse, labelResponse] = await Promise.all([
      fetch(new URL("lstm_norm_params.json", baseUrl), { cache: "no-store" }),
      fetch(new URL("label_map.json", baseUrl), { cache: "no-store" })
    ]);
    if (!normResponse.ok || !labelResponse.ok) {
      throw new Error("LSTM normalization or label-map file could not be loaded.");
    }
    const [normData, labels] = await Promise.all([normResponse.json(), labelResponse.json()]);
    const inputShape = loaded.inputs[0].shape;
    const outputShape = loaded.outputs[0].shape;
    validateArtifacts(normData.mean, normData.std, labels, outputShape[outputShape.length - 1]);
    if (model) model.dispose();
    model = loaded;
    normMean = normData.mean;
    normStd = normData.std.map(value => value === 0 ? 1 : value);
    trainingData = normData.trainingData || "unspecified";
    sequenceLength = inputShape[1];
    return { sequenceLength, trainingData, backend: tf.getBackend() };
  } catch (error) {
    loaded.dispose();
    throw error;
  }
}

function predict(sequence) {
  if (!model) throw new Error("Model is not loaded.");
  if (!Array.isArray(sequence) || sequence.length !== sequenceLength ||
      sequence.some(row => !Array.isArray(row) || row.length !== 4 || !row.every(Number.isFinite))) {
    throw new Error(`Expected a ${sequenceLength}x4 sequence of finite numbers.`);
  }
  const normalized = sequence.map(row => row.map((value, index) => (value - normMean[index]) / normStd[index]));
  const values = tf.tidy(() => model.predict(tf.tensor3d([normalized])).dataSync());
  let best = 0;
  for (let index = 1; index < values.length; index += 1) {
    if (values[index] > values[best]) best = index;
  }
  return {
    class: CLASS_NAMES[best],
    confidence: values[best],
    probabilities: Object.fromEntries(CLASS_NAMES.map((name, index) => [name, values[index]])),
    trainingData
  };
}

self.onmessage = async ({ data }) => {
  const { id, type } = data || {};
  try {
    const result = type === "load" ? await load(data.baseUrl)
      : type === "predict" ? predict(data.sequence)
      : (() => { throw new Error(`Unknown message type: ${type}`); })();
    self.postMessage({ id, ok: true, result });
  } catch (error) {
    self.postMessage({ id, ok: false, error: error?.message || String(error) });
  }
};
