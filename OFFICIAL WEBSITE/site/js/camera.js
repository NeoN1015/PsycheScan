/* Camera, face-api.js detection, expression smoothing and visual-fatigue cues. */

const offscreenCanvas = document.createElement("canvas");
const offscreenCtx = offscreenCanvas.getContext("2d", { willReadFrequently: true });

async function loadModels() {
  if (state.modelsLoaded) return true;
  if (!window.faceapi) {
    setText("modelStatusText", "face-api.js missing");
    return false;
  }
  const base = CONFIG.faceModelsUrl;
  setText("modelStatusText", "Loading…");
  try {
    await faceapi.nets.tinyFaceDetector.loadFromUri(base);
    await faceapi.nets.faceLandmark68Net.loadFromUri(base);
    await faceapi.nets.faceExpressionNet.loadFromUri(base);
    state.modelDetector = "tiny";
    if (state.settings.detectionProfile !== "standard") {
      // The stronger SSD detector is optional; fall back to the tiny detector if it fails.
      state.modelDetector = await faceapi.nets.ssdMobilenetv1.loadFromUri(base).then(() => "ssd", () => "tiny");
    }
    state.modelsLoaded = true;
    setText("modelStatusText", `Loaded (${state.modelDetector.toUpperCase()})`);
    return true;
  } catch (error) {
    setText("modelStatusText", "Load failed");
    alert(`Face models could not be loaded from ${base}.\n\n${error.message}`);
    return false;
  }
}

async function startCamera() {
  if (!getActiveProfile()) {
    alert("Select a patient profile before starting the camera.");
    return;
  }
  if (!(await loadModels())) return;
  if (state.stream) stopCamera(false);
  const video = { width: { ideal: 1280 }, height: { ideal: 720 } };
  if (state.settings.cameraDeviceId && state.settings.cameraDeviceId !== "auto") {
    video.deviceId = { exact: state.settings.cameraDeviceId };
  } else if (state.settings.cameraFacing !== "auto") {
    video.facingMode = { ideal: state.settings.cameraFacing };
  }
  try {
    state.stream = await navigator.mediaDevices.getUserMedia({ video, audio: false });
    $("video").srcObject = state.stream;
    $("liveVideo").srcObject = state.stream;
    await $("video").play();
    await $("liveVideo").play();
    state.cameraActive = true;
    setStatusChip($("cameraBadge"), "success", "LIVE");
    setStatusChip($("liveStatusBadge"), "success", "LIVE");
    setText("cameraStatusText", "Active");
    await populateCameraDevices();
    restartDetectionLoop();
  } catch (error) {
    state.cameraActive = false;
    setStatusChip($("cameraBadge"), "danger", "ERROR");
    setStatusChip($("liveStatusBadge"), "danger", "ERROR");
    setText("cameraStatusText", "Unavailable");
    alert(`Camera unavailable or permission denied.\n\n${error.message}`);
  }
  updateSystemStatus();
}

function stopCamera(reset = true) {
  clearInterval(state.detectTimer);
  state.detectTimer = null;
  state.stream?.getTracks().forEach(track => track.stop());
  state.stream = null;
  $("video").srcObject = null;
  $("liveVideo").srcObject = null;
  state.cameraActive = false;
  setStatusChip($("cameraBadge"), "muted", "READY");
  setStatusChip($("liveStatusBadge"), "muted", "IDLE");
  setText("cameraStatusText", "Inactive");
  if (reset) resetFaceState();
  updateSystemStatus();
}

function restartDetectionLoop() {
  clearInterval(state.detectTimer);
  state.detectTimer = state.cameraActive ? setInterval(runDetectionFrame, Number(state.settings.detectionInterval) || 160) : null;
}

async function populateCameraDevices() {
  const select = $("cameraDeviceSelect");
  if (!navigator.mediaDevices?.enumerateDevices || !select) return;
  const devices = await navigator.mediaDevices.enumerateDevices().catch(() => []);
  select.replaceChildren(new Option("Auto / Default camera", "auto"));
  devices.filter(device => device.kind === "videoinput").forEach((device, index) => {
    select.add(new Option(device.label || `Camera ${index + 1}`, device.deviceId));
  });
  select.value = [...select.options].some(option => option.value === state.settings.cameraDeviceId)
    ? state.settings.cameraDeviceId
    : "auto";
}

function resetFaceState() {
  state.emotionSmoothed = emptyEmotions();
  state.dominantEmotion = "No Face";
  state.dominantConfidence = 0;
  state.visualFatigue = { eyebag: 0, wrinkle: 0, fatigue: 0 };
  setText("faceCountText", "0 face");
  setText("dominantEmotion", "No Face");
  setText("dominantConfidence", "0%");
  clearCanvas($("overlay"));
  clearCanvas($("liveOverlay"));
  renderFace();
}

function clearCanvas(canvas) {
  canvas?.getContext("2d").clearRect(0, 0, canvas.width, canvas.height);
}

async function runDetectionFrame() {
  const video = $("video");
  if (state.detectionBusy || !state.cameraActive || !state.modelsLoaded || !video.videoWidth) return;
  state.detectionBusy = true;
  try {
    const threshold = state.settings.detectionProfile === "standard"
      ? CONFIG.runtime.detectionThresholdStandard
      : CONFIG.runtime.detectionThresholdStrong;
    const options = state.modelDetector === "ssd"
      ? new faceapi.SsdMobilenetv1Options({ minConfidence: threshold, maxResults: 1 })
      : new faceapi.TinyFaceDetectorOptions({ inputSize: Number(state.settings.detectorInputSize), scoreThreshold: threshold });
    const result = await faceapi.detectSingleFace(video, options).withFaceLandmarks().withFaceExpressions();
    drawDetection(result, "overlay", "video");
    drawDetection(result, "liveOverlay", "liveVideo");

    if (!result) {
      setText("faceCountText", "0 face");
      state.dominantEmotion = "No Face";
      state.dominantConfidence = 0;
      state.visualFatigue = { eyebag: 0, wrinkle: 0, fatigue: 0 };
      smoothExpressions(emptyEmotions());
    } else {
      setText("faceCountText", "1 face");
      smoothExpressions(Object.fromEntries(EMOTIONS.map(emotion => [emotion, result.expressions[emotion] || 0])));
      const [dominant, score] = Object.entries(state.emotionSmoothed).sort((a, b) => b[1] - a[1])[0];
      state.dominantEmotion = capitalize(dominant);
      state.dominantConfidence = Math.round(score * 100);
      computeVisualFatigue(video, result.landmarks);
    }
    setText("dominantEmotion", state.dominantEmotion);
    setText("dominantConfidence", `${state.dominantConfidence}%`);
    renderFace();
  } catch (error) {
    setText("modelStatusText", `Detection error: ${error.message}`);
  } finally {
    state.detectionBusy = false;
  }
}

function smoothExpressions(raw) {
  const alpha = clamp(Number(state.settings.smoothingFactor), 0.05, 0.9);
  EMOTIONS.forEach(emotion => {
    state.emotionSmoothed[emotion] = state.emotionSmoothed[emotion] * alpha + raw[emotion] * (1 - alpha);
  });
}

function drawDetection(result, canvasId, videoId) {
  const canvas = $(canvasId);
  const video = $(videoId);
  const context = canvas.getContext("2d");
  const width = video.videoWidth || 640;
  const height = video.videoHeight || 480;
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;
  context.clearRect(0, 0, canvas.width, canvas.height);
  if (!result) return;
  const box = result.detection.box;
  context.strokeStyle = "#22c55e";
  context.lineWidth = 3;
  context.strokeRect(box.x, box.y, box.width, box.height);
  if (state.settings.showLandmarks) faceapi.draw.drawFaceLandmarks(canvas, result);
}

/* ---------- Visual fatigue (eyebag, wrinkle texture) ---------- */

function getBounds(points) {
  const xs = points.map(point => point.x);
  const ys = points.map(point => point.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  return { x: minX, y: minY, width: Math.max(...xs) - minX, height: Math.max(...ys) - minY };
}

function clampRegion(region, minSize) {
  if (!region) return null;
  let x = Math.round(region.x);
  let y = Math.round(region.y);
  let width = Math.round(region.width);
  let height = Math.round(region.height);
  if (![x, y, width, height].every(Number.isFinite)) return null;
  const w = offscreenCanvas.width;
  const h = offscreenCanvas.height;
  x = clamp(x, 0, w - minSize);
  y = clamp(y, 0, h - minSize);
  width = clamp(width, minSize, w - x);
  height = clamp(height, minSize, h - y);
  return width >= minSize && height >= minSize ? { x, y, width, height } : null;
}

function luma(data, index) {
  return 0.299 * data[index] + 0.587 * data[index + 1] + 0.114 * data[index + 2];
}

function sampleRegionLuma(region) {
  const r = clampRegion(region, 1);
  if (!r) return 0;
  const image = offscreenCtx.getImageData(r.x, r.y, r.width, r.height).data;
  let total = 0;
  let count = 0;
  for (let i = 0; i < image.length; i += 16) {
    total += luma(image, i);
    count++;
  }
  return count ? total / count : 0;
}

function sampleTextureScore(region) {
  const r = clampRegion(region, 2);
  if (!r) return 0;
  const image = offscreenCtx.getImageData(r.x, r.y, r.width, r.height).data;
  const stride = r.width * 4;
  let total = 0;
  let count = 0;
  for (let py = 0; py < r.height - 1; py += 2) {
    for (let px = 0; px < r.width - 1; px += 2) {
      const index = py * stride + px * 4;
      const current = luma(image, index);
      total += Math.abs(current - luma(image, index + 4)) + Math.abs(current - luma(image, index + stride));
      count++;
    }
  }
  return count ? total / count : 0;
}

function computeVisualFatigue(videoEl, landmarks) {
  const zero = () => { state.visualFatigue = { eyebag: 0, wrinkle: 0, fatigue: 0 }; };
  if (!videoEl.videoWidth || !landmarks) return;

  offscreenCanvas.width = videoEl.videoWidth;
  offscreenCanvas.height = videoEl.videoHeight;
  offscreenCtx.drawImage(videoEl, 0, 0, offscreenCanvas.width, offscreenCanvas.height);

  const leftEye = landmarks.getLeftEye();
  const rightEye = landmarks.getRightEye();
  const leftBrow = landmarks.getLeftEyeBrow();
  const rightBrow = landmarks.getRightEyeBrow();
  if (!leftEye?.length || !rightEye?.length || !leftBrow?.length || !rightBrow?.length) return zero();

  const left = getBounds(leftEye);
  const right = getBounds(rightEye);
  const brow = getBounds([...leftBrow, ...rightBrow]);
  const faceDetailWidth = (left.width + right.width) / 2;
  if (!Number.isFinite(faceDetailWidth) || faceDetailWidth < CONFIG.runtime.minFaceDetailWidth) return zero();

  const under = b => ({ x: b.x - b.width * 0.15, y: b.y + b.height * 0.45, width: b.width * 1.3, height: b.height * 0.95 });
  const cheek = b => ({ x: b.x - b.width * 0.1, y: b.y + b.height * 1.55, width: b.width * 1.2, height: b.height * 1.1 });
  const forehead = { x: brow.x - brow.width * 0.08, y: brow.y - brow.height * 1.25, width: brow.width * 1.16, height: brow.height * 0.95 };
  const crowLeft = { x: left.x - left.width * 0.65, y: left.y - left.height * 0.1, width: left.width * 0.55, height: left.height * 1.25 };
  const crowRight = { x: right.x + right.width * 1.02, y: right.y - right.height * 0.1, width: right.width * 0.55, height: right.height * 1.25 };

  const underLum = (sampleRegionLuma(under(left)) + sampleRegionLuma(under(right))) / 2;
  const cheekLum = (sampleRegionLuma(cheek(left)) + sampleRegionLuma(cheek(right))) / 2;
  const cheekTexture = (sampleTextureScore(cheek(left)) + sampleTextureScore(cheek(right))) / 2;
  const foreheadTexture = sampleTextureScore(forehead);
  const crowTexture = (sampleTextureScore(crowLeft) + sampleTextureScore(crowRight)) / 2;
  if (![underLum, cheekLum, cheekTexture, foreheadTexture, crowTexture].every(Number.isFinite)) return zero();

  const detailFactor = clamp((faceDetailWidth - 18) / 22, 0.15, 1);
  const eyebagScore = clamp(clamp(cheekLum - underLum, 0, 25) * 4.6 * detailFactor, 0, 100);
  const wrinkleScore = clamp(clamp((foreheadTexture + crowTexture) / 2 - cheekTexture, 0, 14) * 9.2 * detailFactor, 0, 100);
  const fatigueScore = clamp(eyebagScore * 0.58 + wrinkleScore * 0.42, 0, 100);

  const alpha = clamp(Number(state.settings.smoothingFactor), 0.05, 0.9);
  const blend = (previous, next) => clamp(previous * alpha + next * (1 - alpha), 0, 100);
  state.visualFatigue = {
    eyebag: blend(state.visualFatigue.eyebag, eyebagScore),
    wrinkle: blend(state.visualFatigue.wrinkle, wrinkleScore),
    fatigue: blend(state.visualFatigue.fatigue, fatigueScore)
  };
}

/* Called once per second by the app loop while the camera runs. */
function recordFaceSample(now) {
  if (!state.cameraActive) return;
  state.faceLog.push({
    t: now,
    faceDetected: state.dominantEmotion !== "No Face",
    dominantEmotion: state.dominantEmotion,
    emotions: { ...state.emotionSmoothed },
    eyebag: state.visualFatigue.eyebag,
    wrinkle: state.visualFatigue.wrinkle,
    fatigue: state.visualFatigue.fatigue
  });
  const cutoff = now - CONFIG.runtime.sensorLogKeepSec * 1000;
  while (state.faceLog.length && state.faceLog[0].t < cutoff) state.faceLog.shift();
}

/* ---------- Rendering ---------- */

function renderFace() {
  const list = $("probabilityList");
  if (list) {
    list.innerHTML = EMOTIONS.map(emotion => {
      const percent = Math.round(state.emotionSmoothed[emotion] * 100);
      return `
        <div class="prob-row">
          <div class="prob-head"><span>${capitalize(emotion)}</span><strong>${percent}%</strong></div>
          <div class="prob-track"><div class="prob-fill" style="width:${percent}%"></div></div>
        </div>`;
    }).join("");
  }
  setText("dashboardEmotionBadge", state.dominantEmotion.toUpperCase());
  setText("metricFace", `${state.dominantConfidence}%`);
  const { eyebag, wrinkle, fatigue } = state.visualFatigue;
  [["eyebagScore", eyebag], ["wrinkleScore", wrinkle], ["fatigueScore", fatigue],
    ["dashboardEyebagScore", eyebag], ["dashboardWrinkleScore", wrinkle], ["dashboardFatigueScore", fatigue]]
    .forEach(([id, value]) => setText(id, formatPercent(value)));
}

function bindCameraControls() {
  $("loadModelsBtn")?.addEventListener("click", loadModels);
  $("startCameraBtn")?.addEventListener("click", startCamera);
  $("stopCameraBtn")?.addEventListener("click", () => stopCamera(true));
}
