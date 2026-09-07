// lstm_predictor.js – LSTM sensor sequence predictor

let lstmModel = null;
let normMean = [];
let normStd = [];
let labelMap = {};
let lstmReady = false;
const SEQ_LEN = PROJECT_CONFIG.lstm.sequenceLength;

async function loadLstmModel() {
  try {
    console.log('[LSTM] Loading model...');
    lstmModel = await tf.loadLayersModel('tfjs_lstm_model/model.json');
    
    const normResp = await fetch('lstm_norm_params.json');
    const normData = await normResp.json();
    normMean = normData.mean;
    normStd = normData.std;
    
    const labelResp = await fetch('label_map.json');
    labelMap = await labelResp.json();
    
    lstmReady = true;
    console.log('[LSTM] Model ready');
  } catch (err) {
    console.error('[LSTM] Failed to load:', err);
  }
}

function predictStress(sequence) {
  if (!lstmReady) return null;
  
  const normalized = sequence.map(row =>
    row.map((val, i) => (val - normMean[i]) / normStd[i])
  );
  
  const inputTensor = tf.tensor3d([normalized]);
  const probs = lstmModel.predict(inputTensor);
  const classIdx = probs.argMax(-1).dataSync()[0];
  const confidence = probs.max().dataSync()[0];
  
  const className = Object.keys(labelMap).find(key => labelMap[key] === classIdx) || 'Minimal';
  
  return {
    class: className,
    confidence: confidence
  };
}

function startLstmLoop(intervalMs = PROJECT_CONFIG.lstm.predictionIntervalMs) {
  setInterval(() => {
    if (!lstmReady) return;
    
    const recent = state.history.slice(-SEQ_LEN);
    if (recent.length < SEQ_LEN) return;
    
    const sequence = recent.map(h => [
      h.hr ?? 0,
      h.gsr ?? 0,
      h.temp ?? 0,
      h.motion ?? 0
    ]);
    
    const pred = predictStress(sequence);
    if (pred) {
      console.log(`[LSTM] ${pred.class} (${(pred.confidence*100).toFixed(1)}%)`);
      window.dispatchEvent(new CustomEvent('lstm-prediction', { detail: pred }));
    }
  }, intervalMs);
}

window.addEventListener('load', () => {
  loadLstmModel().then(() => startLstmLoop(PROJECT_CONFIG.lstm.predictionIntervalMs));
});