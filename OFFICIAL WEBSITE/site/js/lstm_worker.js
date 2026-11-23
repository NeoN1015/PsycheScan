/* LSTM inference worker.
 *
 * TensorFlow.js 4 runs here, isolated from the page: face-api.js bundles its own older
 * TensorFlow core, and the two clash when loaded in the same global scope.
 */
/* global tf */
importScripts("../vendor/tf.min.js");

let model = null;
let params = null;
let outputMode = "softmax";   // "softmax": one output per label; "sigmoid": one output = P(labels[1])

async function load(modelUrl, normParams) {
  await tf.ready();
  const loaded = await tf.loadLayersModel(modelUrl);
  const [, steps, featureCount] = loaded.inputs[0].shape;
  const units = loaded.outputs[0].shape[loaded.outputs[0].shape.length - 1];
  const fail = message => {
    loaded.dispose();
    throw new Error(message);
  };
  if (steps !== null && steps !== normParams.sequenceLength) {
    fail(`model expects ${steps} time steps but norm_params.json says sequenceLength ${normParams.sequenceLength}`);
  }
  if (featureCount !== normParams.features.length) {
    fail(`model expects ${featureCount} features but norm_params.json lists ${normParams.features.length}`);
  }
  if (units === normParams.labels.length) outputMode = "softmax";
  else if (units === 1 && normParams.labels.length === 2) outputMode = "sigmoid";
  else fail(`model has ${units} outputs but norm_params.json lists ${normParams.labels.length} labels`);

  model?.dispose();
  model = loaded;
  params = { ...normParams, std: normParams.std.map(value => (value === 0 ? 1 : value)) };
  // Warm-up run so the first real prediction is not slow.
  tf.tidy(() => model.predict(tf.zeros([1, params.sequenceLength, params.features.length])));
  return { outputMode, backend: tf.getBackend() };
}

function predict(sequence) {
  if (!model) throw new Error("model is not loaded");
  const n = params.features.length;
  if (!Array.isArray(sequence) || sequence.length !== params.sequenceLength ||
      sequence.some(row => !Array.isArray(row) || row.length !== n || !row.every(Number.isFinite))) {
    throw new Error(`expected a ${params.sequenceLength}x${n} sequence of numbers`);
  }
  const normalized = sequence.map(row => row.map((value, i) => (value - params.mean[i]) / params.std[i]));
  const output = Array.from(tf.tidy(() => model.predict(tf.tensor3d([normalized])).dataSync()));
  const probabilities = outputMode === "sigmoid" ? [1 - output[0], output[0]] : output;
  let best = 0;
  probabilities.forEach((value, i) => { if (value > probabilities[best]) best = i; });
  return {
    label: params.labels[best],
    confidence: probabilities[best],
    probabilities: Object.fromEntries(params.labels.map((label, i) => [label, probabilities[i]]))
  };
}

self.onmessage = async ({ data }) => {
  const { id, type } = data || {};
  try {
    let result;
    if (type === "load") result = await load(data.modelUrl, data.params);
    else if (type === "predict") result = predict(data.sequence);
    else throw new Error(`unknown message type: ${type}`);
    self.postMessage({ id, ok: true, result });
  } catch (error) {
    self.postMessage({ id, ok: false, error: error?.message || String(error) });
  }
};
