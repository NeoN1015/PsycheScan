const STORAGE_KEYS = {
  auth: "cnn_lstm_auth",
  settings: "cnn_lstm_settings",
  user: "cnn_lstm_user"
};

const state = {
  page: "dashboard",
  mode: "Real-Time",
  loggedInUser: "Guest",

  modelsLoaded: false,
  cameraActive: false,
  stream: null,
  detectLoop: null,

  serialConnected: false,
  serialPort: null,
  serialReader: null,
  serialKeepReading: false,
  lastPacketTimestamp: 0,
  lastPacketRaw: "—",

  settings: {
    theme: "royal-violet",
    appearance: "light",
    mirrorCamera: true,
    showLandmarks: true,
    detectionInterval: 160,
    detectorInputSize: 512,
    smoothingFactor: 0.4,
    autoCapture: true,
    demoSensors: false,
    participantId: "Awaiting Face"
  },

  sensors: createInitialSensors(),

  sensorValues: {
    hr: null,
    gsr: null,
    temp: null,
    motion: null
  },

  emotionRaw: {
    neutral: 0,
    happy: 0,
    sad: 0,
    angry: 0,
    fearful: 0,
    disgusted: 0,
    surprised: 0
  },

  emotionSmoothed: {
    neutral: 0,
    happy: 0,
    sad: 0,
    angry: 0,
    fearful: 0,
    disgusted: 0,
    surprised: 0
  },

  dominantEmotion: "No Face",
  dominantConfidence: 0,

  visualFatigue: {
    eyebag: 0,
    wrinkle: 0,
    fatigue: 0
  },

  records: [],
  reports: [],
  lastCaptureAt: 0,

  history: [],
  charts: {
    dashboard: null,
    live: null,
    temporal: null
  },

  selectedRecord: null
};

const offscreenCanvas = document.createElement("canvas");
const offscreenCtx = offscreenCanvas.getContext("2d", { willReadFrequently: true });

const pageMeta = {
  dashboard: ["Dashboard", "Live camera feed and biometric sensor fusion for stress/anxiety screening"],
  live: ["Live Monitoring", "Synchronized facial expressions and physiological signals (HR, GSR, temp, motion)"],
  cnn: ["CNN Analysis", "Spatial feature extraction from facial frames; emotion probability heatmap"],
  temporal: ["Temporal Engine", "LSTM‑based trend analysis over sequential biometric and facial data windows"],
  sensors: ["Sensors", "Real‑time serial intake from MAX30102, GSR, DS18B20, MPU6050 via ESP32"],
  summary: ["Status Summary", "Classification: Minimal / Mild / Moderate / Severe — integrated decision support"],
  info: ["Mental Health Info", "System purpose, biomarker thresholds, and responsible use guidelines"],
  inputs: ["Data Inputs", "Logged multimodal evidence (timestamped sensor values and facial metrics)"],
  reports: ["Reports", "Exportable session logs for clinical benchmarking and documentation"],
  settings: ["Settings", "UI theme, detection thresholds, and runtime parameter tuning"]
};

const sensorMeta = createSensorMeta();

function $(id) {
  return document.getElementById(id);
}

function qs(selector) {
  return document.querySelector(selector);
}

function clamp(value, min, max) {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

function average(values) {
  const valid = (values || []).filter(value => Number.isFinite(value));
  if (!valid.length) return 0;
  return valid.reduce((a, b) => a + b, 0) / valid.length;
}

function formatNumber(value, decimals = 1) {
  if (value === null || value === undefined || Number.isNaN(value)) return "--";
  return Number(value).toFixed(decimals);
}

function safePercent(value) {
  return `${Number.isFinite(value) ? Math.round(value) : 0}%`;
}

function formatSensorValue(key) {
  const value = state.sensorValues[key];
  if (value === null || value === undefined) return "--";
  if (key === "hr") return `${Math.round(value)}`;
  if (key === "motion") return formatMotionValue(value);
  if (key === "temp") return `${Number(value).toFixed(1)}`;
  return `${Number(value).toFixed(2)}`;
}

function humanTime(ts) {
  if (!ts) return "—";
  return new Date(ts).toLocaleString();
}

function capitalize(text) {
  if (!text) return text;
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function updateClock() {
  const now = new Date();
  $("clockPill").textContent = now.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit"
  });
  $("cameraTime").textContent = now.toLocaleTimeString();
}

function initHistory() {
  state.history = Array.from({ length: 20 }, (_, i) => ({
    label: `${String(9 + Math.floor(i / 2)).padStart(2, "0")}:${i % 2 === 0 ? "00" : "30"}`,
    score: 0,
    hr: null,
    gsr: null,
    temp: null,
    motion: null
  }));
}

function getConnectedSensorCount() {
  return Object.values(state.sensors).filter(sensor => sensor.connected).length;
}

function setStatusChip(el, type, text) {
  if (!el) return;
  el.classList.remove("muted", "warning", "danger");
  if (type === "muted") el.classList.add("muted");
  if (type === "warning") el.classList.add("warning");
  if (type === "danger") el.classList.add("danger");
  el.textContent = text;
}

function applyThemeSettings() {
  document.body.dataset.theme = state.settings.theme;
  document.body.dataset.appearance = state.settings.appearance;

  $("themeSelect").value = state.settings.theme;
  $("appearanceSelect").value = state.settings.appearance;
  if ($("participantIdInput")) $("participantIdInput").value = state.settings.participantId;
  if ($("participantIdDisplay")) $("participantIdDisplay").textContent = state.settings.participantId;
  $("mirrorCameraToggle").checked = state.settings.mirrorCamera;
  $("showLandmarksToggle").checked = state.settings.showLandmarks;
  $("detectionIntervalSelect").value = String(state.settings.detectionInterval);
  $("detectorSizeSelect").value = String(state.settings.detectorInputSize);
  $("smoothingSelect").value = String(state.settings.smoothingFactor);
  $("autoCaptureToggle").checked = state.settings.autoCapture;
  $("demoSensorsToggle").checked = state.settings.demoSensors;

  document.querySelectorAll(".camera-video, .camera-overlay").forEach(el => {
    el.classList.toggle("mirrored", state.settings.mirrorCamera);
  });
}

function saveSettings() {
  localStorage.setItem(STORAGE_KEYS.settings, JSON.stringify(state.settings));
}

function loadSettings() {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.settings);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    state.settings = { ...state.settings, ...parsed };
  } catch (error) {
    console.warn("Failed to load settings", error);
  }
}

function saveAuth(remember) {
  const payload = remember ? { ok: true, user: state.loggedInUser } : { ok: false };
  if (remember) {
    localStorage.setItem(STORAGE_KEYS.auth, JSON.stringify(payload));
  } else {
    localStorage.removeItem(STORAGE_KEYS.auth);
  }
}

function loadAuth() {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.auth);
    if (!raw) return false;
    const parsed = JSON.parse(raw);
    if (parsed && parsed.ok) {
      state.loggedInUser = parsed.user || "Guest";
      return true;
    }
  } catch (error) {
    console.warn("Failed to load auth", error);
  }
  return false;
}

function unlockApp() {
  document.body.classList.remove("auth-locked");
  document.body.classList.add("auth-ready");
  $("loggedInUserText").textContent = state.loggedInUser;
}

function logout() {
  localStorage.removeItem(STORAGE_KEYS.auth);
  document.body.classList.remove("auth-ready");
  document.body.classList.add("auth-locked");
}

function bindLogin() {
  $("loginForm").addEventListener("submit", (event) => {
    event.preventDefault();
    const name = $("loginName").value.trim() || "Guest";
    const password = $("loginPassword").value;
    if (password !== PROJECT_CONFIG.auth.operatorPassword) {
      $("loginError").classList.add("show");
      return;
    }
    $("loginError").classList.remove("show");
    state.loggedInUser = name;
    saveAuth($("rememberLogin").checked);
    unlockApp();
  });

  $("logoutBtn").addEventListener("click", logout);
}

function switchPage(page) {
  state.page = page;
  document.querySelectorAll(".page-section").forEach(section => section.classList.remove("active-section"));
  document.querySelectorAll(".nav-item").forEach(btn => btn.classList.toggle("active", btn.dataset.page === page));
  $(`${page}Page`).classList.add("active-section");
  const [title, subtitle] = pageMeta[page];
  $("pageTitle").textContent = title;
  $("pageSubtitle").textContent = subtitle;
}

function bindSidebar() {
  $("sidebarNav").addEventListener("click", (event) => {
    const button = event.target.closest(".nav-item");
    if (!button) return;
    switchPage(button.dataset.page);
  });
}

function bindModeButtons() {
  document.querySelectorAll(".mode-btn").forEach(button => {
    button.addEventListener("click", () => {
      document.querySelectorAll(".mode-btn").forEach(btn => btn.classList.remove("active"));
      button.classList.add("active");
      state.mode = button.dataset.mode;
      $("modeValueText").textContent = state.mode;
      $("systemStatus").textContent = state.mode;
    });
  });
}

function bindSettings() {
  $("saveSettingsBtn").addEventListener("click", () => {
    state.settings.theme = $("themeSelect").value;
    state.settings.appearance = $("appearanceSelect").value;
    state.settings.mirrorCamera = $("mirrorCameraToggle").checked;
    state.settings.showLandmarks = $("showLandmarksToggle").checked;
    state.settings.detectionInterval = Number($("detectionIntervalSelect").value);
    state.settings.detectorInputSize = Number($("detectorSizeSelect").value);
    state.settings.smoothingFactor = Number($("smoothingSelect").value);
    state.settings.autoCapture = $("autoCaptureToggle").checked;
    state.settings.demoSensors = $("demoSensorsToggle").checked;
    saveSettings();
    applyThemeSettings();
    renderAll();
    buildCharts();
    drawFeatureMap();
    if (state.cameraActive) restartDetectionLoop();
    $("systemStatus").textContent = "Settings Saved";
  });

  $("resetSettingsBtn").addEventListener("click", () => {
    state.settings = {
      theme: "royal-violet",
      appearance: "light",
      mirrorCamera: true,
      showLandmarks: true,
      detectionInterval: 160,
      detectorInputSize: 512,
      smoothingFactor: 0.4,
      autoCapture: true,
      demoSensors: false,
      participantId: "Awaiting Face"
    };
    saveSettings();
    applyThemeSettings();
    renderAll();
    buildCharts();
    drawFeatureMap();
    if (state.cameraActive) restartDetectionLoop();
    $("systemStatus").textContent = "Settings Reset";
  });
}

function buildCharts() {
  const commonOptions = {
    responsive: true,
    maintainAspectRatio: false,
    animation: false,
    plugins: {
      legend: {
        labels: {
          color: getComputedStyle(document.body).getPropertyValue("--text").trim()
        }
      }
    },
    scales: {
      x: {
        ticks: { color: getComputedStyle(document.body).getPropertyValue("--text-soft").trim() },
        grid: { color: getComputedStyle(document.body).getPropertyValue("--line").trim() }
      },
      y: {
        ticks: { color: getComputedStyle(document.body).getPropertyValue("--text-soft").trim() },
        grid: { color: getComputedStyle(document.body).getPropertyValue("--line").trim() }
      }
    }
  };

  if (state.charts.dashboard) {
    Object.values(state.charts).forEach(chart => chart.destroy());
  }

  state.charts.dashboard = new Chart($("dashboardChart"), {
    type: "line",
    data: {
      labels: state.history.map(item => item.label),
      datasets: [{
        label: "Integrated score",
        data: state.history.map(item => item.score),
        borderColor: getComputedStyle(document.body).getPropertyValue("--accent").trim(),
        backgroundColor: `rgba(${getComputedStyle(document.body).getPropertyValue("--accent-rgb").trim()},0.12)`,
        fill: true,
        tension: 0.36,
        pointRadius: 0
      }]
    },
    options: {
      ...commonOptions,
      scales: {
        ...commonOptions.scales,
        y: { ...commonOptions.scales.y, min: 0, max: 100 }
      }
    }
  });

  state.charts.live = new Chart($("liveChart"), {
    type: "line",
    data: {
      labels: state.history.map(item => item.label),
      datasets: [
        { label: "HR", data: state.history.map(item => item.hr), borderColor: getComputedStyle(document.body).getPropertyValue("--accent").trim(), tension: 0.34, pointRadius: 0 },
        { label: "GSR", data: state.history.map(item => item.gsr), borderColor: getComputedStyle(document.body).getPropertyValue("--accent-2").trim(), tension: 0.34, pointRadius: 0 },
        { label: "Temp", data: state.history.map(item => item.temp), borderColor: "#f59e0b", tension: 0.34, pointRadius: 0 },
        { label: "Motion", data: state.history.map(item => item.motion), borderColor: "#22c55e", tension: 0.34, pointRadius: 0 }
      ]
    },
    options: commonOptions
  });

  state.charts.temporal = new Chart($("temporalChart"), {
    type: "line",
    data: {
      labels: state.history.map(item => item.label),
      datasets: [{
        label: "Temporal sequence score",
        data: state.history.map(item => item.score),
        borderColor: getComputedStyle(document.body).getPropertyValue("--accent-2").trim(),
        backgroundColor: `rgba(${getComputedStyle(document.body).getPropertyValue("--accent2-rgb").trim()},0.12)`,
        fill: true,
        tension: 0.36,
        pointRadius: 0
      }]
    },
    options: {
      ...commonOptions,
      scales: {
        ...commonOptions.scales,
        y: { ...commonOptions.scales.y, min: 0, max: 100 }
      }
    }
  });
}

function updateCharts() {
  if (!state.charts.dashboard) return;
  const labels = state.history.map(item => item.label);

  state.charts.dashboard.data.labels = labels;
  state.charts.dashboard.data.datasets[0].data = state.history.map(item => item.score);
  state.charts.dashboard.update();

  state.charts.live.data.labels = labels;
  state.charts.live.data.datasets[0].data = state.history.map(item => item.hr);
  state.charts.live.data.datasets[1].data = state.history.map(item => item.gsr);
  state.charts.live.data.datasets[2].data = state.history.map(item => item.temp);
  state.charts.live.data.datasets[3].data = state.history.map(item => item.motion);
  state.charts.live.update();

  state.charts.temporal.data.labels = labels;
  state.charts.temporal.data.datasets[0].data = state.history.map(item => item.score);
  state.charts.temporal.update();
}

function pushHistory(score) {
  state.history.shift();
  const last = state.history[state.history.length - 1];
  const [h, m] = last.label.split(":").map(Number);
  const nextMinute = m === 0 ? 30 : 0;
  const nextHour = m === 0 ? h : h + 1;
  state.history.push({
    label: `${String(nextHour).padStart(2, "0")}:${nextMinute === 0 ? "00" : "30"}`,
    score,
    hr: state.sensorValues.hr,
    gsr: state.sensorValues.gsr,
    temp: state.sensorValues.temp,
    motion: state.sensorValues.motion
  });
  updateCharts();
}

function markSensorConnected(key, explicitState = "connected") {
  const sensor = state.sensors[key];
  sensor.connected = true;
  sensor.state = explicitState;
  sensor.lastSeen = Date.now();
}

function updateSensorPresence() {
  const now = Date.now();
  Object.entries(state.sensors).forEach(([key, sensor]) => {
    if (!state.serialConnected && !state.settings.demoSensors) {
      sensor.connected = false;
      sensor.state = "disconnected";
      return;
    }
    if (sensor.lastSeen && now - sensor.lastSeen <= 5000) {
      if (sensor.state !== "demo") sensor.state = "connected";
      sensor.connected = true;
    } else if (state.serialConnected) {
      sensor.connected = false;
      sensor.state = "searching";
    } else if (state.settings.demoSensors) {
      sensor.connected = true;
      sensor.state = "demo";
    } else {
      sensor.connected = false;
      sensor.state = "disconnected";
    }
  });
}

function renderSensorGrid(targetId) {
  const target = $(targetId);
  if (!target) return;
  const html = Object.entries(sensorMeta).map(([key, meta]) => {
    const sensor = state.sensors[key];
    const reading = state.sensorValues[meta.key];
    const stateLabel = sensor.state === "connected" ? "CONNECTED"
      : sensor.state === "searching" ? "WAITING"
      : sensor.state === "demo" ? "DEMO"
      : "DISCONNECTED";
    return `
      <div class="sensor-card">
        <div class="sensor-meta">
          <div class="sensor-name">${meta.name}</div>
          <div class="sensor-channel">${meta.channel}</div>
        </div>
        <div class="sensor-reading ${reading === null || reading === undefined ? "empty" : ""}">
          ${reading === null || reading === undefined ? "No data" : `${formatSensorValue(meta.key)} ${meta.unit}`.trim()}
        </div>
        <div class="sensor-state ${sensor.state}">${stateLabel}</div>
      </div>
    `;
  }).join("");
  target.innerHTML = html;
}

function renderProbabilities() {
  const labels = [
    ["Neutral", state.emotionSmoothed.neutral],
    ["Happy", state.emotionSmoothed.happy],
    ["Sad", state.emotionSmoothed.sad],
    ["Angry", state.emotionSmoothed.angry],
    ["Fearful", state.emotionSmoothed.fearful],
    ["Disgusted", state.emotionSmoothed.disgusted],
    ["Surprised", state.emotionSmoothed.surprised]
  ];
  const html = labels.map(([label, value]) => `
    <div class="prob-row">
      <div class="prob-head">
        <span>${label}</span>
        <strong>${Math.round(value * 100)}%</strong>
      </div>
      <div class="prob-track">
        <div class="prob-fill" style="width:${Math.round(value * 100)}%"></div>
      </div>
    </div>
  `).join("");
  $("probabilityList").innerHTML = html;
  $("cnnProbList").innerHTML = html;
  $("cnnTopEmotion").textContent = state.dominantEmotion;
  $("cnnConfidence").textContent = `${state.dominantConfidence}%`;
}

function renderLiveStatCards() {
  $("liveHr").textContent = state.sensorValues.hr !== null ? `${formatSensorValue("hr")} bpm` : "--";
  $("liveGsr").textContent = state.sensorValues.gsr !== null ? `${formatSensorValue("gsr")} µS` : "--";
  $("liveTemp").textContent = state.sensorValues.temp !== null ? `${formatSensorValue("temp")} °C` : "--";
  $("liveMotion").textContent = state.sensorValues.motion !== null ? `${formatSensorValue("motion")}` : "--";

  $("eyebagScore").textContent = safePercent(state.visualFatigue.eyebag);
  $("wrinkleScore").textContent = safePercent(state.visualFatigue.wrinkle);
  $("fatigueScore").textContent = safePercent(state.visualFatigue.fatigue);

  $("cnnEyeIndicator").textContent = safePercent(state.visualFatigue.eyebag);
  $("cnnWrinkleIndicator").textContent = safePercent(state.visualFatigue.wrinkle);
  $("cnnFatigueIndicator").textContent = safePercent(state.visualFatigue.fatigue);
}

function computeAssessment() {
  const connectedSensors = getConnectedSensorCount();
  const hasFace = state.dominantEmotion !== "No Face";
  const negativeEmotionStrength =
    state.emotionSmoothed.sad +
    state.emotionSmoothed.angry +
    state.emotionSmoothed.fearful +
    state.emotionSmoothed.disgusted * 0.8 +
    state.emotionSmoothed.surprised * 0.35;

  let emotionRisk = 0;
  if (hasFace) {
    emotionRisk = clamp(negativeEmotionStrength * 100, 0, 100);
    if (["Sad", "Angry", "Fearful", "Disgusted"].includes(state.dominantEmotion)) {
      emotionRisk += state.dominantConfidence * 0.3;
    }
  }

  const hrRisk = biomarkerRisk("hr", state.sensorValues.hr);
  const gsrRisk = biomarkerRisk("gsr", state.sensorValues.gsr);
  const tempRisk = biomarkerRisk("temp", state.sensorValues.temp);
  const motionRisk = biomarkerRisk("motion", state.sensorValues.motion);

  const sensorScores = [hrRisk, gsrRisk, tempRisk, motionRisk].filter(v => v !== null);
  const sensorRisk = sensorScores.length ? average(sensorScores) : 0;
  const fatigueRisk = state.visualFatigue.fatigue;

  let total = 0;
  let weight = 0;

  const fusion = PROJECT_CONFIG.fusion;
  if (hasFace) {
    total += emotionRisk * fusion.emotionWeight;
    weight += fusion.emotionWeight;
    total += fatigueRisk * fusion.fatigueWeight;
    weight += fusion.fatigueWeight;
  }
  if (sensorScores.length) {
    total += sensorRisk * fusion.sensorWeight;
    weight += fusion.sensorWeight;
  }

  const integratedScore = weight ? clamp(total / weight, 0, 100) : 0;

  let level = "Minimal";
  let temporal = "High";
  let decision = "Minimal"; // will mirror `level` to use severity labels throughout
  let decisionClass = "minimal";
  let risk = "Low";

  const severityScore = PROJECT_CONFIG.severity.score;
  if (integratedScore >= severityScore.severe) {
    level = "Severe";
    temporal = "Low";
    risk = "High";
  } else if (integratedScore >= severityScore.moderate) {
    level = "Moderate";
    temporal = "Medium";
    risk = "Guarded";
  } else if (integratedScore >= severityScore.mild) {
    level = "Mild";
    temporal = "Medium";
    risk = "Watch";
  }

  // Use the severity label as the canonical `decision` value for storage and UI
  decision = level;
  decisionClass = level.toLowerCase();

  const recentScores = state.history.map(item => item.score).filter(value => typeof value === "number");
  const trailing = recentScores.slice(-6);
  const leading = recentScores.slice(-12, -6);
  const recentAvg = trailing.length ? average(trailing) : 0;
  const priorAvg = leading.length ? average(leading) : recentAvg;
  const trendDelta = recentAvg - priorAvg;
  const trend = trendDelta > 4 ? "Rising" : trendDelta < -4 ? "Falling" : "Stable";

  const variance = trailing.length
    ? average(trailing.map(value => Math.pow(value - recentAvg, 2)))
    : 0;
  const sequenceScore = clamp(1 - variance / 900, 0.12, 0.97);

  return {
    integratedScore: Math.round(integratedScore),
    level,
    temporal,
    decision,
    decisionClass,
    risk,
    trend,
    sequenceScore: sequenceScore.toFixed(2),
    connectedSensors,
    fatigueRisk: Math.round(fatigueRisk),
    emotionRisk: Math.round(emotionRisk),
    sensorRisk: Math.round(sensorRisk)
  };
}

function updateMetrics() {
  updateSensorPresence();
  const assessment = computeAssessment();

  $("metricStress").textContent = assessment.level;
  $("metricCnn").textContent = `${state.dominantConfidence}%`;
  $("metricTemporal").textContent = assessment.temporal;
  $("metricTemporalNote").textContent = `${assessment.sequenceScore} stability score`;
  $("metricSync").textContent = `${assessment.connectedSensors} / 4`;

  $("windowSizeValue").textContent = `${state.history.length}`;
  $("trendValue").textContent = assessment.trend;
  $("sequenceScore").textContent = assessment.sequenceScore;
  $("riskOutput").textContent = assessment.risk;

  $("summaryIntegratedScore").textContent = `${assessment.integratedScore} / 100`;
  $("summaryEmotion").textContent = state.dominantEmotion;
  $("summarySensors").textContent = `${assessment.connectedSensors} of 4 sensors active`;
  $("summaryFatigue").textContent = safePercent(assessment.fatigueRisk);
  $("summaryEyebag").textContent = safePercent(state.visualFatigue.eyebag);
  $("summaryWrinkle").textContent = safePercent(state.visualFatigue.wrinkle);

  const badge = $("summaryStatusBadge");
  const summaryPill = $("summaryOkayValue");
  // clear any severity classes
  summaryPill.classList.remove("minimal", "mild", "moderate", "severe");
  summaryPill.classList.add(assessment.decisionClass);
  summaryPill.textContent = assessment.decision;
  // map severity to chip style: Severe->danger, Moderate/Mild->warning, Minimal->muted
  const chipType = assessment.decisionClass === "severe" ? "danger" : (assessment.decisionClass === "moderate" || assessment.decisionClass === "mild") ? "warning" : "muted";
  setStatusChip(badge, chipType, assessment.decision);

  if (!state.cameraActive && assessment.connectedSensors === 0) {
    $("summaryHeadline").textContent = "Insufficient live evidence";
    $("summaryNarrative").textContent = "Start the camera and/or connect sensors to generate a current participant screening summary.";
  } else if (assessment.level === "Severe") {
    $("summaryHeadline").textContent = "Elevated concern requires closer review";
    $("summaryNarrative").textContent = `The integrated evidence is high (${assessment.integratedScore}/100). Negative affect, fatigue, and/or sensor strain are elevated. Review the detailed inputs and consider human escalation.`;
  } else if (assessment.level === "Moderate") {
    $("summaryHeadline").textContent = "Participant should be monitored";
    $("summaryNarrative").textContent = `The integrated evidence is moderate (${assessment.integratedScore}/100). Signals are shifting upward. Continue observation and verify whether the trend persists.`;
  } else if (assessment.level === "Mild") {
    $("summaryHeadline").textContent = "Slight elevation in evidence";
    $("summaryNarrative").textContent = `The integrated evidence is mildly elevated (${assessment.integratedScore}/100). Continue observation for persistent changes.`;
  } else {
    $("summaryHeadline").textContent = "Current evidence suggests the participant is minimal";
    $("summaryNarrative").textContent = `The current integrated evidence is ${assessment.integratedScore}/100. No major sustained concern is visible right now, but continue routine monitoring.`;
  }
}

function renderSummary() {
  updateMetrics();
}

function updateStatusPanel() {
  if ($("participantIdDisplay")) $("participantIdDisplay").textContent = state.settings.participantId;
  $("modelStatusText").textContent = state.modelsLoaded ? "Loaded" : "Not loaded";
  $("cameraStatusText").textContent = state.cameraActive ? "Active" : "Inactive";
  $("serialStatusText").textContent = state.serialConnected ? "Connected" : "Disconnected";
  $("loggedInUserText").textContent = state.loggedInUser;
}

function renderInputRecords() {
  const rows = state.records.map((record, index) => `
    <tr data-record-index="${index}">
      <td>${record.timestamp}</td>
      <td>${record.emotion}</td>
      <td>${record.confidence}%</td>
      <td>${record.hr ?? "--"}</td>
      <td>${record.gsr ?? "--"}</td>
      <td>${record.temp ?? "--"}</td>
      <td>${record.motion ?? "--"}</td>
      <td>${record.eyebag}%</td>
      <td>${record.wrinkle}%</td>
      <td>${record.fatigue}%</td>
      <td><span class="badge ${record.decisionClass}">${record.decision}</span></td>
    </tr>
  `).join("");
  $("inputTableBody").innerHTML = rows;
  $("recordCountBadge").textContent = `${state.records.length} Records`;

  $("inputTableBody").querySelectorAll("tr").forEach(row => {
    row.addEventListener("click", () => {
      openRecordModal(Number(row.dataset.recordIndex));
    });
  });
}

function renderReports() {
  $("reportCountBadge").textContent = `${state.reports.length} Records`;
  $("reportTableBody").innerHTML = state.reports.map(report => `
    <tr>
      <td>${report.timestamp}</td>
      <td>${report.emotion}</td>
      <td>${report.integratedScore}</td>
      <td><span class="badge ${report.decisionClass}">${report.decision}</span></td>
      <td>${report.participantId}</td>
    </tr>
  `).join("");
}

function openRecordModal(index) {
  const record = state.records[index];
  if (!record) return;
  state.selectedRecord = record;
  const entries = {
    Timestamp: record.timestamp,
    Participant: record.participantId,
    Emotion: `${record.emotion} (${record.confidence}%)`,
    "Integrated score": `${record.integratedScore}/100`,
    Decision: record.decision,
    "Heart rate": record.hr ?? "--",
    GSR: record.gsr ?? "--",
    Temperature: record.temp ?? "--",
    Motion: record.motion ?? "--",
    "Eyebag score": `${record.eyebag}%`,
    "Wrinkle score": `${record.wrinkle}%`,
    "Fatigue score": `${record.fatigue}%`,
    "Sensor count": `${record.connectedSensors}/4`,
    Narrative: record.narrative
  };
  $("recordDetailGrid").innerHTML = Object.entries(entries).map(([label, value]) => `
    <div class="record-detail-item">
      <span>${label}</span>
      <strong>${value}</strong>
    </div>
  `).join("");
  $("recordModal").classList.add("show");
  if (window.lucide) lucide.createIcons();
}

function bindModal() {
  $("closeRecordModalBtn").addEventListener("click", () => $("recordModal").classList.remove("show"));
  $("recordModal").addEventListener("click", (event) => {
    if (event.target.id === "recordModal") {
      $("recordModal").classList.remove("show");
    }
  });
}

function captureRecord(force = false) {
  const now = Date.now();
  if (!force && !state.settings.autoCapture) return;
  if (!force && now - state.lastCaptureAt < 3000) return;
  if (!force && state.dominantConfidence < 30 && getConnectedSensorCount() === 0) return;

  const assessment = computeAssessment();
  state.lastCaptureAt = now;

  let narrative = "No significant concern visible from the current snapshot.";
  if (assessment.level === "Severe") {
    narrative = "The current snapshot contains elevated integrated evidence. Review the participant and verify if support or escalation is needed.";
  } else if (assessment.level === "Moderate") {
    narrative = "The participant should be monitored because the current evidence is above the normal baseline.";
  } else if (assessment.level === "Mild") {
    narrative = "Slight elevation detected; continue observation for persistent changes.";
  }

  const record = {
    timestamp: new Date().toLocaleString(),
    participantId: state.settings.participantId,
    emotion: state.dominantEmotion,
    confidence: state.dominantConfidence,
    hr: state.sensorValues.hr !== null ? Number(formatSensorValue("hr")) : null,
    gsr: state.sensorValues.gsr !== null ? Number(formatSensorValue("gsr")) : null,
    temp: state.sensorValues.temp !== null ? Number(formatSensorValue("temp")) : null,
    motion: state.sensorValues.motion !== null ? Number(formatSensorValue("motion")) : null,
    eyebag: Math.round(state.visualFatigue.eyebag),
    wrinkle: Math.round(state.visualFatigue.wrinkle),
    fatigue: Math.round(state.visualFatigue.fatigue),
    integratedScore: assessment.integratedScore,
    decision: assessment.decision,
    decisionClass: assessment.decisionClass,
    connectedSensors: assessment.connectedSensors,
    narrative
  };

  state.records.unshift(record);
  state.reports.unshift({
    timestamp: record.timestamp,
    emotion: record.emotion,
    integratedScore: record.integratedScore,
    decision: record.decision,
    decisionClass: record.decisionClass,
    participantId: record.participantId
  });

  if (state.records.length > 160) state.records.pop();
  if (state.reports.length > 160) state.reports.pop();

  renderInputRecords();
  renderReports();
}

function exportCsv() {
  if (!state.records.length) return;
  const headers = ["timestamp","participantId","emotion","confidence","hr","gsr","temp","motion","eyebag","wrinkle","fatigue","integratedScore","decision"];
  const lines = [
    headers.join(","),
    ...state.records.map(record => headers.map(key => JSON.stringify(record[key] ?? "")).join(","))
  ];
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "cnn-lstm-mental-health-records.csv";
  a.click();
  URL.revokeObjectURL(url);
}

function bindReports() {
  $("exportCsvBtn").addEventListener("click", exportCsv);
  $("clearReportsBtn").addEventListener("click", () => {
    state.records = [];
    state.reports = [];
    renderInputRecords();
    renderReports();
  });
}

async function loadModels() {
  if (!window.faceapi) {
    $("modelStatusText").textContent = "face-api missing";
    $("systemStatus").textContent = "Library Error";
    return;
  }
  try {
    $("systemStatus").textContent = "Loading Models";
    $("modelStatusText").textContent = "Loading...";
    const MODEL_URL = "./models";
    await faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL);
    await faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL);
    await faceapi.nets.faceExpressionNet.loadFromUri(MODEL_URL);
    state.modelsLoaded = true;
    $("modelStatusText").textContent = "Loaded";
    $("systemStatus").textContent = "Models Ready";
  } catch (error) {
    console.error(error);
    state.modelsLoaded = false;
    $("modelStatusText").textContent = "Load Failed";
    $("systemStatus").textContent = "Model Error";
    alert("Model files could not be loaded. Keep the models folder beside index.html.");
  }
}

async function startCamera() {
  try {
    if (!state.modelsLoaded) {
      await loadModels();
      if (!state.modelsLoaded) return;
    }

    if (state.stream) stopCamera(false);

    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: 640, height: 480, facingMode: "user" },
      audio: false
    });

    state.stream = stream;
    $("video").srcObject = stream;
    $("liveVideo").srcObject = stream;
    await $("video").play();
    await $("liveVideo").play();

    state.cameraActive = true;
    setStatusChip($("cameraBadge"), "muted", "LIVE");
    setStatusChip($("liveStatusBadge"), "muted", "LIVE");
    $("cameraStatusText").textContent = "Active";
    $("systemStatus").textContent = "Streaming";

    restartDetectionLoop();
  } catch (error) {
    console.error(error);
    state.cameraActive = false;
    setStatusChip($("cameraBadge"), "danger", "ERROR");
    setStatusChip($("liveStatusBadge"), "danger", "ERROR");
    $("cameraStatusText").textContent = "Unavailable";
    alert("Camera unavailable or permission denied.");
  }
}

function stopCamera(reset = true) {
  if (state.detectLoop) {
    clearInterval(state.detectLoop);
    state.detectLoop = null;
  }
  if (state.stream) {
    state.stream.getTracks().forEach(track => track.stop());
    state.stream = null;
  }
  $("video").srcObject = null;
  $("liveVideo").srcObject = null;
  state.cameraActive = false;
  setStatusChip($("cameraBadge"), "muted", "READY");
  setStatusChip($("liveStatusBadge"), "muted", "IDLE");
  $("cameraStatusText").textContent = "Inactive";
  $("systemStatus").textContent = "Stopped";
  if (reset) resetFaceState();
}

function resetFaceState() {
  state.emotionRaw = { neutral: 0, happy: 0, sad: 0, angry: 0, fearful: 0, disgusted: 0, surprised: 0 };
  state.emotionSmoothed = { neutral: 0, happy: 0, sad: 0, angry: 0, fearful: 0, disgusted: 0, surprised: 0 };
  state.dominantEmotion = "No Face";
  state.dominantConfidence = 0;
  state.visualFatigue = { eyebag: 0, wrinkle: 0, fatigue: 0 };
  $("faceCountText").textContent = "0 face";
  $("dominantEmotion").textContent = "No Face";
  $("dominantConfidence").textContent = "0%";
  clearCanvas($("overlay"));
  clearCanvas($("liveOverlay"));
  renderProbabilities();
  renderLiveStatCards();
  updateMetrics();
}

function clearCanvas(canvas) {
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);
}

function getDominantExpression(expressions) {
  let maxKey = "neutral";
  let maxValue = 0;
  Object.entries(expressions).forEach(([key, value]) => {
    if (value > maxValue) {
      maxValue = value;
      maxKey = key;
    }
  });
  return [maxKey, maxValue];
}

function smoothExpressions(raw) {
  const alpha = clamp(state.settings.smoothingFactor, 0.05, 0.9);
  Object.keys(state.emotionSmoothed).forEach(key => {
    state.emotionSmoothed[key] = state.emotionSmoothed[key] * alpha + raw[key] * (1 - alpha);
  });
}

function regionFromBounds(bounds, scaleX, scaleY, offsetX = 0, offsetY = 0) {
  return {
    x: Math.round(bounds.x + offsetX * bounds.width),
    y: Math.round(bounds.y + offsetY * bounds.height),
    width: Math.round(bounds.width * scaleX),
    height: Math.round(bounds.height * scaleY)
  };
}

function getBounds(points) {
  const xs = points.map(point => point.x);
  const ys = points.map(point => point.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

function sampleRegionLuma(ctx, canvasWidth, canvasHeight, region) {
  if (!region) return 0;

  let x = Math.round(region.x);
  let y = Math.round(region.y);
  let width = Math.round(region.width);
  let height = Math.round(region.height);

  if (![x, y, width, height].every(Number.isFinite)) return 0;

  x = clamp(x, 0, canvasWidth - 1);
  y = clamp(y, 0, canvasHeight - 1);
  width = clamp(width, 1, canvasWidth - x);
  height = clamp(height, 1, canvasHeight - y);

  if (width < 1 || height < 1) return 0;

  const image = ctx.getImageData(x, y, width, height).data;
  let total = 0;
  let count = 0;

  for (let i = 0; i < image.length; i += 16) {
    const r = image[i];
    const g = image[i + 1];
    const b = image[i + 2];
    total += 0.299 * r + 0.587 * g + 0.114 * b;
    count++;
  }

  return count ? total / count : 0;
}

function sampleTextureScore(ctx, canvasWidth, canvasHeight, region) {
  if (!region) return 0;

  let x = Math.round(region.x);
  let y = Math.round(region.y);
  let width = Math.round(region.width);
  let height = Math.round(region.height);

  if (![x, y, width, height].every(Number.isFinite)) return 0;

  x = clamp(x, 0, canvasWidth - 2);
  y = clamp(y, 0, canvasHeight - 2);
  width = clamp(width, 2, canvasWidth - x);
  height = clamp(height, 2, canvasHeight - y);

  if (width < 2 || height < 2) return 0;

  const image = ctx.getImageData(x, y, width, height).data;
  let total = 0;
  let count = 0;
  const stride = width * 4;

  for (let py = 0; py < height - 1; py += 2) {
    for (let px = 0; px < width - 1; px += 2) {
      const index = py * stride + px * 4;
      const current = 0.299 * image[index] + 0.587 * image[index + 1] + 0.114 * image[index + 2];
      const rightIndex = index + 4;
      const downIndex = index + stride;
      const right = 0.299 * image[rightIndex] + 0.587 * image[rightIndex + 1] + 0.114 * image[rightIndex + 2];
      const down = 0.299 * image[downIndex] + 0.587 * image[downIndex + 1] + 0.114 * image[downIndex + 2];
      total += Math.abs(current - right) + Math.abs(current - down);
      count++;
    }
  }

  return count ? total / count : 0;
}

function computeVisualFatigue(videoEl, landmarks) {
  if (!videoEl.videoWidth || !landmarks) return;

  offscreenCanvas.width = videoEl.videoWidth;
  offscreenCanvas.height = videoEl.videoHeight;
  offscreenCtx.drawImage(videoEl, 0, 0, offscreenCanvas.width, offscreenCanvas.height);

  const leftEye = landmarks.getLeftEye();
  const rightEye = landmarks.getRightEye();
  const leftBrow = landmarks.getLeftEyeBrow();
  const rightBrow = landmarks.getRightEyeBrow();

  if (!leftEye?.length || !rightEye?.length || !leftBrow?.length || !rightBrow?.length) {
    state.visualFatigue.eyebag = 0;
    state.visualFatigue.wrinkle = 0;
    state.visualFatigue.fatigue = 0;
    return;
  }

  const leftBounds = getBounds(leftEye);
  const rightBounds = getBounds(rightEye);
  const browBounds = getBounds([...leftBrow, ...rightBrow]);

  const faceDetailWidth = average([leftBounds.width, rightBounds.width]);
  if (!Number.isFinite(faceDetailWidth) || faceDetailWidth < 18) {
    state.visualFatigue.eyebag = 0;
    state.visualFatigue.wrinkle = 0;
    state.visualFatigue.fatigue = 0;
    return;
  }

  const underLeft = {
    x: leftBounds.x - leftBounds.width * 0.15,
    y: leftBounds.y + leftBounds.height * 0.45,
    width: leftBounds.width * 1.3,
    height: leftBounds.height * 0.95
  };
  const underRight = {
    x: rightBounds.x - rightBounds.width * 0.15,
    y: rightBounds.y + rightBounds.height * 0.45,
    width: rightBounds.width * 1.3,
    height: rightBounds.height * 0.95
  };

  const cheekLeft = {
    x: leftBounds.x - leftBounds.width * 0.1,
    y: leftBounds.y + leftBounds.height * 1.55,
    width: leftBounds.width * 1.2,
    height: leftBounds.height * 1.1
  };
  const cheekRight = {
    x: rightBounds.x - rightBounds.width * 0.1,
    y: rightBounds.y + rightBounds.height * 1.55,
    width: rightBounds.width * 1.2,
    height: rightBounds.height * 1.1
  };

  const underLum = average([
    sampleRegionLuma(offscreenCtx, offscreenCanvas.width, offscreenCanvas.height, underLeft),
    sampleRegionLuma(offscreenCtx, offscreenCanvas.width, offscreenCanvas.height, underRight)
  ]);

  const cheekLum = average([
    sampleRegionLuma(offscreenCtx, offscreenCanvas.width, offscreenCanvas.height, cheekLeft),
    sampleRegionLuma(offscreenCtx, offscreenCanvas.width, offscreenCanvas.height, cheekRight)
  ]);

  const foreheadRegion = {
    x: browBounds.x - browBounds.width * 0.08,
    y: browBounds.y - browBounds.height * 1.25,
    width: browBounds.width * 1.16,
    height: browBounds.height * 0.95
  };
  const crowLeft = {
    x: leftBounds.x - leftBounds.width * 0.65,
    y: leftBounds.y - leftBounds.height * 0.1,
    width: leftBounds.width * 0.55,
    height: leftBounds.height * 1.25
  };
  const crowRight = {
    x: rightBounds.x + rightBounds.width * 1.02,
    y: rightBounds.y - rightBounds.height * 0.1,
    width: rightBounds.width * 0.55,
    height: rightBounds.height * 1.25
  };

  const cheekTexture = average([
    sampleTextureScore(offscreenCtx, offscreenCanvas.width, offscreenCanvas.height, cheekLeft),
    sampleTextureScore(offscreenCtx, offscreenCanvas.width, offscreenCanvas.height, cheekRight)
  ]);
  const foreheadTexture = sampleTextureScore(offscreenCtx, offscreenCanvas.width, offscreenCanvas.height, foreheadRegion);
  const crowTexture = average([
    sampleTextureScore(offscreenCtx, offscreenCanvas.width, offscreenCanvas.height, crowLeft),
    sampleTextureScore(offscreenCtx, offscreenCanvas.width, offscreenCanvas.height, crowRight)
  ]);

  if (
    !Number.isFinite(underLum) ||
    !Number.isFinite(cheekLum) ||
    !Number.isFinite(cheekTexture) ||
    !Number.isFinite(foreheadTexture) ||
    !Number.isFinite(crowTexture)
  ) {
    state.visualFatigue.eyebag = 0;
    state.visualFatigue.wrinkle = 0;
    state.visualFatigue.fatigue = 0;
    return;
  }

  const detailFactor = clamp((faceDetailWidth - 18) / 22, 0.15, 1);
  const eyebagDelta = clamp(cheekLum - underLum, 0, 25);
  const wrinkleSignal = clamp(average([foreheadTexture, crowTexture]) - cheekTexture, 0, 14);

  const eyebagScore = clamp(eyebagDelta * 4.6 * detailFactor, 0, 100);
  const wrinkleScore = clamp(wrinkleSignal * 9.2 * detailFactor, 0, 100);
  const fatigueScore = clamp(eyebagScore * 0.58 + wrinkleScore * 0.42, 0, 100);

  if (
    !Number.isFinite(eyebagScore) ||
    !Number.isFinite(wrinkleScore) ||
    !Number.isFinite(fatigueScore)
  ) {
    return;
  }

  const alpha = clamp(state.settings.smoothingFactor, 0.05, 0.9);
  state.visualFatigue.eyebag = clamp(state.visualFatigue.eyebag * alpha + eyebagScore * (1 - alpha), 0, 100);
  state.visualFatigue.wrinkle = clamp(state.visualFatigue.wrinkle * alpha + wrinkleScore * (1 - alpha), 0, 100);
  state.visualFatigue.fatigue = clamp(state.visualFatigue.fatigue * alpha + fatigueScore * (1 - alpha), 0, 100);
}

function drawDetection(result, canvasId, videoId) {
  const canvas = $(canvasId);
  const video = $(videoId);
  const context = canvas.getContext("2d");

  canvas.width = video.videoWidth || 640;
  canvas.height = video.videoHeight || 480;
  context.clearRect(0, 0, canvas.width, canvas.height);

  if (!result) return;

  const box = result.detection.box;
  context.strokeStyle = "#22c55e";
  context.lineWidth = 3;
  context.strokeRect(box.x, box.y, box.width, box.height);

  if (state.settings.showLandmarks) {
    faceapi.draw.drawFaceLandmarks(canvas, result);
  }
}

function drawFeatureMap() {
  const canvas = $("featureCanvas");
  const size = Math.max(320, canvas.parentElement.clientWidth);
  const dpr = window.devicePixelRatio || 1;
  canvas.width = size * dpr;
  canvas.height = size * dpr;
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, size, size);

  const cells = 8;
  const gap = 4;
  const block = (size - gap * (cells - 1)) / cells;
  const base = Math.max(state.dominantConfidence / 100, 0.08);
  const palette = [
    getComputedStyle(document.body).getPropertyValue("--accent").trim(),
    getComputedStyle(document.body).getPropertyValue("--accent-2").trim(),
    "#22c55e",
    "#f59e0b"
  ];

  for (let y = 0; y < cells; y++) {
    for (let x = 0; x < cells; x++) {
      const intensity = clamp(base + Math.random() * 0.45 + state.visualFatigue.fatigue / 200, 0.1, 1);
      ctx.globalAlpha = intensity;
      ctx.fillStyle = palette[(x + y + Math.floor(Math.random() * 3)) % palette.length];
      ctx.fillRect(x * (block + gap), y * (block + gap), block, block);
    }
  }
  ctx.globalAlpha = 1;
}

function restartDetectionLoop() {
  if (state.detectLoop) {
    clearInterval(state.detectLoop);
    state.detectLoop = null;
  }
  state.detectLoop = setInterval(runDetectionFrame, state.settings.detectionInterval);
}

async function runDetectionFrame() {
  if (!state.cameraActive || !state.modelsLoaded || !$("video").videoWidth) return;
  try {
    const options = new faceapi.TinyFaceDetectorOptions({
      inputSize: state.settings.detectorInputSize,
      scoreThreshold: 0.45
    });

    const result = await faceapi
      .detectSingleFace($("video"), options)
      .withFaceLandmarks()
      .withFaceExpressions();

    drawDetection(result, "overlay", "video");
    drawDetection(result, "liveOverlay", "liveVideo");

    if (!result) {
      $("faceCountText").textContent = "0 face";
      $("dominantEmotion").textContent = "No Face";
      $("dominantConfidence").textContent = "0%";
      state.dominantEmotion = "No Face";
      state.dominantConfidence = 0;
      state.emotionRaw = { neutral: 0, happy: 0, sad: 0, angry: 0, fearful: 0, disgusted: 0, surprised: 0 };
      state.visualFatigue.eyebag = 0;
      state.visualFatigue.wrinkle = 0;
      state.visualFatigue.fatigue = 0;
      smoothExpressions(state.emotionRaw);
      renderProbabilities();
      renderLiveStatCards();
      updateMetrics();
      return;
    }

    $("faceCountText").textContent = "1 face";

    state.emotionRaw = {
      neutral: result.expressions.neutral || 0,
      happy: result.expressions.happy || 0,
      sad: result.expressions.sad || 0,
      angry: result.expressions.angry || 0,
      fearful: result.expressions.fearful || 0,
      disgusted: result.expressions.disgusted || 0,
      surprised: result.expressions.surprised || 0
    };
    smoothExpressions(state.emotionRaw);

    const [dominant, score] = getDominantExpression(state.emotionSmoothed);
    state.dominantEmotion = capitalize(dominant);
    state.dominantConfidence = Math.round(score * 100);

    computeVisualFatigue($("video"), result.landmarks);

    $("dominantEmotion").textContent = state.dominantEmotion;
    $("dominantConfidence").textContent = `${state.dominantConfidence}%`;

    const assessment = computeAssessment();
    pushHistory(assessment.integratedScore);
    renderProbabilities();
    renderLiveStatCards();
    updateMetrics();
    drawFeatureMap();
    captureRecord();
  } catch (error) {
    console.error("Detection error", error);
  }
}

async function connectSerial() {
  if (!("serial" in navigator)) {
    alert("Web Serial works in Chromium browsers like Chrome or Edge.");
    return;
  }
  try {
    state.serialPort = await navigator.serial.requestPort();
    await state.serialPort.open({ baudRate: PROJECT_CONFIG.hardware.serialBaudRate });
    state.serialConnected = true;
    state.serialKeepReading = true;
    setStatusChip($("serialBadge"), "muted", "CONNECTED");
    $("serialStatusText").textContent = "Connected";
    $("systemStatus").textContent = "Serial Connected";
    updateSensorPresence();
    renderSensorGrid("sensorGrid");
    renderSensorGrid("sensorPageGrid");
    readSerialLoop();
  } catch (error) {
    console.error(error);
    alert("Serial connection failed.");
  }
}

async function disconnectSerial() {
  state.serialKeepReading = false;
  try {
    if (state.serialReader) {
      await state.serialReader.cancel();
      state.serialReader.releaseLock();
      state.serialReader = null;
    }
    if (state.serialPort) {
      await state.serialPort.close();
      state.serialPort = null;
    }
  } catch (error) {
    console.error(error);
  }
  state.serialConnected = false;
  setStatusChip($("serialBadge"), "muted", "DISCONNECTED");
  $("serialStatusText").textContent = "Disconnected";
  Object.values(state.sensors).forEach(sensor => {
    sensor.connected = false;
    sensor.state = state.settings.demoSensors ? "demo" : "disconnected";
  });
  renderAll();
}

async function readSerialLoop() {
  const decoder = new TextDecoder();
  let buffer = "";

  while (state.serialPort && state.serialPort.readable && state.serialKeepReading) {
    state.serialReader = state.serialPort.readable.getReader();
    try {
      while (true) {
        const { value, done } = await state.serialReader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop();
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          try {
            const data = JSON.parse(trimmed);
            applySerialData(data, trimmed);
          } catch (error) {
            console.warn("Invalid serial JSON:", trimmed, error);
          }
        }
      }
    } catch (error) {
      console.error(error);
    } finally {
      if (state.serialReader) {
        state.serialReader.releaseLock();
        state.serialReader = null;
      }
    }
  }
}

function applySerialData(data, raw) {
  state.lastPacketTimestamp = Date.now();
  state.lastPacketRaw = raw;
  $("lastPacketTime").textContent = humanTime(state.lastPacketTimestamp);
  $("lastPacketRaw").textContent = raw;

  if (typeof data.hr === "number") {
    state.sensorValues.hr = data.hr;
    markSensorConnected("max30102");
  }
  if (typeof data.gsr === "number") {
    state.sensorValues.gsr = data.gsr;
    markSensorConnected("gsr");
  }
  if (typeof data.temp === "number") {
    state.sensorValues.temp = data.temp;
    markSensorConnected("ds18b20");
  }
  if (typeof data.motion === "number") {
    state.sensorValues.motion = data.motion;
    markSensorConnected("mpu6050");
  }

  getSensorIds().forEach(sensorId => {
    if (packetMarksSensorConnected(data, sensorId)) markSensorConnected(sensorId);
  });

  updateSensorPresence();
  const assessment = computeAssessment();
  pushHistory(assessment.integratedScore);
  renderAll();
  captureRecord();
}

function simulateSensors() {
  if (!state.settings.demoSensors || state.serialConnected) return;
  const demo = PROJECT_CONFIG.demo;
  const rand = (min, max) => min + Math.random() * (max - min);
  state.sensorValues.hr = Math.round(rand(demo.hrMin, demo.hrMax));
  state.sensorValues.gsr = Number(rand(demo.gsrMin, demo.gsrMax).toFixed(2));
  state.sensorValues.temp = Number(rand(demo.tempMin, demo.tempMax).toFixed(1));
  state.sensorValues.motion = Number(rand(demo.motionMin, demo.motionMax).toFixed(3));
  Object.values(state.sensors).forEach(sensor => {
    sensor.connected = true;
    sensor.state = "demo";
    sensor.lastSeen = Date.now();
  });
  updateSensorPresence();
  const assessment = computeAssessment();
  pushHistory(assessment.integratedScore);
  renderAll();
  captureRecord();
}

function renderAll() {
  renderSensorGrid("sensorGrid");
  renderSensorGrid("sensorPageGrid");
  renderProbabilities();
  renderLiveStatCards();
  updateMetrics();
  renderSummary();
  renderInputRecords();
  renderReports();
  updateStatusPanel();
}

function bindControls() {
  $("loadModelsBtn").addEventListener("click", loadModels);
  $("startCameraBtn").addEventListener("click", startCamera);
  $("stopCameraBtn").addEventListener("click", () => stopCamera(true));
  $("connectSerialBtn").addEventListener("click", connectSerial);
  $("disconnectSerialBtn").addEventListener("click", disconnectSerial);
}

function bindInputTable() {
  $("inputTableBody").addEventListener("click", (event) => {
    const row = event.target.closest("tr[data-record-index]");
    if (!row) return;
    openRecordModal(Number(row.dataset.recordIndex));
  });
}

function initIcons() {
  if (window.lucide) lucide.createIcons();
}

function init() {
  loadSettings();
  if (typeof loadCollections === "function") loadCollections();
  applyThemeSettings();
  initHistory();
  updateClock();
  renderAll();
  buildCharts();
  drawFeatureMap();

  if ($("defaultPasscodeLabel")) {
    $("defaultPasscodeLabel").textContent = PROJECT_CONFIG.auth.operatorPassword;
  }
  if ($("loginError")) {
    $("loginError").textContent = `Incorrect key. Use ${PROJECT_CONFIG.auth.operatorPassword}.`;
  }
  bindLogin();
  bindSidebar();
  bindModeButtons();
  bindSettings();
  bindControls();
  bindReports();
  bindModal();
  bindInputTable();

  if (loadAuth()) unlockApp();

  setInterval(() => {
    updateClock();
    updateSensorPresence();
    simulateSensors();
    renderSensorGrid("sensorGrid");
    renderSensorGrid("sensorPageGrid");
    if (typeof updateStatusPanel === "function") updateStatusPanel();
  }, 2000);

  window.addEventListener("resize", () => {
    buildCharts();
    drawFeatureMap();
  });

  if (typeof populateCameraDevices === "function") populateCameraDevices();
  initIcons();
  if (typeof updateStatusPanel === "function") updateStatusPanel();
}

window.addEventListener("DOMContentLoaded", init);
