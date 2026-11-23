/* Calibration, baseline capture, and change-from-baseline indicators.
 *
 * Calibration runs for at least 1 minute while showing live readings. It is "Stable ✓" when,
 * over the last 20 s, temperature range ≤ 0.2 °C, GSR range ≤ 10 % of its mean, and the
 * heart-rate SD ≤ 5 bpm. After 3 minutes without stability the operator can continue anyway
 * or restart. Baseline capture is only enabled once calibration has finished for the patient.
 */

/* ---------- Calibration ---------- */

function calibrationDone() {
  const c = state.calibration;
  return ["stable", "accepted"].includes(c.status) && c.profileId === state.activeProfileId;
}

function resetCalibration() {
  state.calibration = { status: "idle", profileId: null, startedAt: 0, checks: null };
}

function startCalibration() {
  const profile = getActiveProfile();
  if (!profile) {
    alert("Select a patient before calibrating.");
    return;
  }
  if (!sourceOnline()) {
    alert("Connect the ESP32 on the Sensors page before calibrating.");
    return;
  }
  if (state.baselineCapture.active) {
    alert("Cancel the running baseline capture before calibrating again.");
    return;
  }
  state.calibration = { status: "running", profileId: profile.profileId, startedAt: Date.now(), checks: null };
  updateCalibration(Date.now());
  openModal("calibrationModal", "calibrationRestartBtn");
}

function closeCalibration() {
  // Closing during the run cancels it; a finished calibration stays valid.
  if (state.calibration.status === "running" || state.calibration.status === "timeout") resetCalibration();
  closeModal("calibrationModal");
  renderBaseline();
}

function evaluateStability(now) {
  const cfg = CONFIG.calibration;
  const since = Math.max(state.calibration.startedAt, now - cfg.windowSec * 1000);
  const entries = sensorLogSince(since);
  const needed = Math.ceil(cfg.windowSec * cfg.minWindowCoverage);
  const check = (key, measure, limit, describe) => {
    const values = entries.map(entry => entry[key]).filter(Number.isFinite);
    if (values.length < needed) return { ok: false, text: `Need more readings (${values.length}/${needed})` };
    const value = measure(values);
    return { ok: value <= limit + 1e-9, text: describe(value) };
  };
  const range = values => Math.max(...values) - Math.min(...values);
  const temp = check("temp", range, cfg.tempMaxRangeC, value => `${value.toFixed(2)} °C`);
  const gsr = check("gsr", values => range(values) / Math.max(mean(values), 1e-6), cfg.gsrMaxRangeFraction, value => `${(value * 100).toFixed(1)}% of mean`);
  const hr = check("hr", standardDeviation, cfg.hrMaxSd, value => `${value.toFixed(1)} bpm`);
  return { temp, gsr, hr, stable: temp.ok && gsr.ok && hr.ok };
}

function updateCalibration(now) {
  const c = state.calibration;
  if (c.status !== "running") return;
  c.checks = evaluateStability(now);
  const elapsed = (now - c.startedAt) / 1000;
  if (elapsed >= CONFIG.calibration.minDurationSec && c.checks.stable) c.status = "stable";
  else if (elapsed >= CONFIG.calibration.maxDurationSec) c.status = "timeout";
  renderCalibration(now);
  if (c.status !== "running") renderBaseline();
}

function renderCalibration(now = Date.now()) {
  const c = state.calibration;
  if (!$("calibrationModal")?.classList.contains("show") && c.status !== "running") return;
  const cfg = CONFIG.calibration;
  const elapsed = c.startedAt ? (now - c.startedAt) / 1000 : 0;

  [["calHr", "hr"], ["calGsr", "gsr"], ["calTemp", "temp"], ["calMotion", "motion"]].forEach(([id, key]) => {
    setText(id, formatSensor(key, getLiveValue(key)));
  });

  let countdown;
  let hint;
  if (c.status === "running" && elapsed < cfg.minDurationSec) {
    countdown = formatClock(cfg.minDurationSec - elapsed);
    hint = "Minimum calibration time remaining. Keep the participant still.";
  } else if (c.status === "running") {
    countdown = formatClock(cfg.maxDurationSec - elapsed);
    hint = `Waiting for stable readings. Calibration stops after ${cfg.maxDurationSec / 60} minutes.`;
  } else if (c.status === "timeout") {
    countdown = "00:00";
    hint = "Readings did not stabilise within 3 minutes. Check the sensors, then restart or continue anyway.";
  } else {
    countdown = formatClock(0);
    hint = c.status === "accepted"
      ? "Calibration accepted without full stability. You can now capture the baseline."
      : "Readings are stable. You can now capture the baseline.";
  }
  setText("calibrationCountdown", countdown);
  setText("calibrationHint", hint);

  const checks = c.checks;
  const verdict = $("calibrationVerdict");
  if (verdict) {
    const stable = checks?.stable;
    verdict.textContent = stable ? "Stable ✓" : c.status === "accepted" ? "Continued without stability" : "Stabilising…";
    verdict.classList.toggle("stable", Boolean(stable));
  }
  [["calCheckTemp", "temp"], ["calCheckGsr", "gsr"], ["calCheckHr", "hr"]].forEach(([id, key]) => {
    const item = $(id);
    if (!item) return;
    const result = checks?.[key];
    item.querySelector("strong").textContent = result ? `${result.text} ${result.ok ? "✓" : "✗"}` : "--";
    item.classList.toggle("ok", Boolean(result?.ok));
  });

  $("calibrationContinueBtn").hidden = c.status !== "timeout";
  $("calibrationDoneBtn").hidden = !["stable", "accepted"].includes(c.status);
}

function bindCalibrationControls() {
  $("calibrateBtn")?.addEventListener("click", startCalibration);
  bindModalDismiss("calibrationModal", "closeCalibrationBtn", closeCalibration);
  $("calibrationRestartBtn")?.addEventListener("click", () => {
    state.calibration = { status: "running", profileId: state.activeProfileId, startedAt: Date.now(), checks: null };
    updateCalibration(Date.now());
    renderBaseline();
  });
  $("calibrationContinueBtn")?.addEventListener("click", () => {
    state.calibration.status = "accepted";
    renderCalibration();
    renderBaseline();
  });
  $("calibrationDoneBtn")?.addEventListener("click", () => {
    closeModal("calibrationModal");
    renderBaseline();
  });
}

/* ---------- Baseline capture ---------- */

function startBaselineCapture() {
  const capture = state.baselineCapture;
  if (capture.active) {
    state.baselineCapture = { active: false, startedAt: 0, endsAt: 0, error: "Baseline capture canceled." };
    renderBaseline();
    return;
  }
  if (!calibrationDone()) {
    alert("Run calibration for this patient before capturing the baseline.");
    return;
  }
  if (!sourceOnline()) {
    alert("The sensors are not connected. Reconnect the ESP32 before capturing the baseline.");
    return;
  }
  const now = Date.now();
  state.baselineCapture = {
    active: true,
    profileId: state.activeProfileId,
    startedAt: now,
    endsAt: now + getBaselineDurationSec() * 1000,
    error: "",
    sensor: Object.fromEntries(SENSOR_KEYS.map(key => [key, []])),
    packetsWithData: 0,
    face: []
  };
  renderBaseline();
}

function addBaselineSensorEntry(entry) {
  const capture = state.baselineCapture;
  if (!capture.active) return;
  let any = false;
  SENSOR_KEYS.forEach(key => {
    if (Number.isFinite(entry[key])) {
      capture.sensor[key].push(entry[key]);
      any = true;
    }
  });
  if (any) capture.packetsWithData += 1;
}

function addBaselineFaceSample(sample) {
  if (state.baselineCapture.active && sample) state.baselineCapture.face.push(sample);
}

function updateBaselineCapture(now) {
  if (state.baselineCapture.active && now >= state.baselineCapture.endsAt) finalizeBaseline(now);
}

function finalizeBaseline(now) {
  const capture = state.baselineCapture;
  const profile = state.profiles.find(item => item.profileId === capture.profileId);
  state.baselineCapture = { active: false, startedAt: 0, endsAt: 0, error: "" };
  if (!profile) return;
  if (!capture.packetsWithData) {
    state.baselineCapture.error = "No sensor readings were received. Check the connection and capture again.";
    renderBaseline();
    return;
  }
  const faceSamples = capture.face.filter(sample => sample.faceDetected);
  const faceMean = key => (faceSamples.length ? mean(faceSamples.map(sample => sample[key])) : null);
  const emotionCounts = new Map();
  faceSamples.forEach(sample => emotionCounts.set(sample.dominantEmotion, (emotionCounts.get(sample.dominantEmotion) || 0) + 1));
  profile.baseline = {
    hr: mean(capture.sensor.hr),
    gsr: mean(capture.sensor.gsr),
    temp: mean(capture.sensor.temp),
    motion: mean(capture.sensor.motion),
    sampleCount: capture.packetsWithData,
    durationSec: Math.round((now - capture.startedAt) / 1000),
    completedAt: now,
    calibration: state.calibration.status,   // "stable" or "accepted" (continued without stability)
    faceSampleCount: faceSamples.length,
    faceDetectionRate: capture.face.length ? (faceSamples.length / capture.face.length) * 100 : null,
    dominantEmotion: [...emotionCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || null,
    fatigue: faceMean("fatigue"),
    wrinkle: faceMean("wrinkle"),
    eyebag: faceMean("eyebag")
  };
  persistCollections();
  renderBaseline();
  renderProfiles();
}

function currentPhase() {
  if (state.calibration.status === "running") return "calibration";
  if (state.baselineCapture.active) return "baseline";
  return "screening";
}

/* ---------- Change from baseline (plain indicators, not levels) ---------- */

function getBaselineChanges() {
  const baseline = getActiveBaseline();
  const hr = getLiveValue("hr");
  const gsr = getLiveValue("gsr");
  const temp = getLiveValue("temp");
  const pct = (value, ref) => (Number.isFinite(value) && Number.isFinite(ref) && ref > 0 ? ((value - ref) / ref) * 100 : null);
  return {
    hrChangePct: pct(hr, baseline?.hr),
    gsrChangePct: pct(gsr, baseline?.gsr),
    tempDropC: Number.isFinite(temp) && Number.isFinite(baseline?.temp) ? baseline.temp - temp : null
  };
}

/* ---------- Rendering ---------- */

function renderBaseline() {
  const profile = getActiveProfile();
  const baseline = profile?.baseline || null;
  const capture = state.baselineCapture;
  const now = Date.now();

  // Capture button and progress text
  const captureButton = $("captureBaselineBtn");
  const progress = $("baselineCaptureProgress");
  const label = $("baselineCaptureButtonLabel");
  if (captureButton) captureButton.disabled = !capture.active && !calibrationDone();
  if (label) label.textContent = capture.active ? "Cancel capture" : baseline ? "Capture baseline again" : "Capture baseline";
  if (progress) {
    progress.textContent = capture.active
      ? `Capturing baseline · ${formatClock((capture.endsAt - now) / 1000)} remaining`
      : capture.error
        ? capture.error
        : !profile
          ? "Select a patient to begin."
          : calibrationDone()
            ? `Calibrated. Baseline lasts ${Math.round(getBaselineDurationSec() / 60)} min.`
            : state.calibration.status === "running"
              ? "Calibration in progress…"
              : "Calibrate first to enable baseline capture.";
  }

  // Dashboard summary card
  const status = $("dashboardBaselineStatus");
  if (capture.active) setStatusChip(status, "warning", "Capturing");
  else if (baseline) setStatusChip(status, "success", "Recorded");
  else setStatusChip(status, "muted", "Not recorded");
  setText("dashboardBaselineCaption", !profile
    ? "Select a patient, calibrate, then capture a baseline."
    : baseline
      ? `${profile.name} · captured ${new Date(baseline.completedAt).toLocaleString()} · ${baseline.sampleCount} sensor sample(s)${baseline.calibration === "accepted" ? " · calibration was not fully stable" : ""}`
      : `${profile.name} has no baseline yet.`);
  const values = [["Hr", "hr"], ["Gsr", "gsr"], ["Temp", "temp"], ["Motion", "motion"]];
  values.forEach(([suffix, key]) => {
    setText(`dashboardBaseline${suffix}`, formatSensor(key, baseline?.[key]));
    setText(`baseline${suffix}Value`, formatSensor(key, baseline?.[key]));
  });
  const faceRecorded = baseline && Number.isFinite(baseline.faceSampleCount);
  setText("dashboardBaselineFace", faceRecorded ? `${Math.round(baseline.faceDetectionRate || 0)}% · ${baseline.faceSampleCount} sample(s)` : "--");
  setText("dashboardBaselineEmotion", baseline?.dominantEmotion || (faceRecorded ? "No face detected" : "--"));
  [["dashboardBaselineFatigue", "fatigue"], ["dashboardBaselineWrinkle", "wrinkle"], ["dashboardBaselineEyebag", "eyebag"]]
    .forEach(([id, key]) => setText(id, Number.isFinite(baseline?.[key]) ? formatPercent(baseline[key]) : "--"));

  // Live hub baseline card
  const liveBadge = $("baselineStatusBadge");
  if (capture.active) {
    setStatusChip(liveBadge, "warning", "CAPTURING");
    setText("baselineStatusText", `Collecting resting readings for ${Math.round(getBaselineDurationSec() / 60)} minute(s). Keep the participant still.`);
  } else if (baseline) {
    setStatusChip(liveBadge, "success", "RECORDED");
    setText("baselineStatusText", `Baseline recorded from ${baseline.sampleCount} sensor sample(s). New readings are compared with it.`);
  } else if (capture.error) {
    setStatusChip(liveBadge, "danger", "NO DATA");
    setText("baselineStatusText", capture.error);
  } else {
    setStatusChip(liveBadge, "muted", "READY");
    setText("baselineStatusText", "Calibrate, then capture a baseline from the Dashboard.");
  }

  const changes = getBaselineChanges();
  setText("baselineComparisonText", !baseline
    ? "No baseline recorded for this patient."
    : `Compared with baseline: HR ${formatSignedPercent(changes.hrChangePct)} · GSR ${formatSignedPercent(changes.gsrChangePct)} · Temperature ${formatTempDrop(changes.tempDropC)}`);

  // Change indicators on the dashboard sensor cards and summary page
  const noBaseline = baseline ? "--" : "No baseline";
  setText("dashboardHrChange", baseline ? `${formatSignedPercent(changes.hrChangePct)} vs baseline` : noBaseline);
  setText("dashboardGsrChange", baseline ? `${formatSignedPercent(changes.gsrChangePct)} vs baseline` : noBaseline);
  setText("dashboardTempChange", baseline ? formatTempDrop(changes.tempDropC) : noBaseline);
  setText("summaryHrChange", baseline ? formatSignedPercent(changes.hrChangePct) : "No baseline");
  setText("summaryGsrChange", baseline ? formatSignedPercent(changes.gsrChangePct) : "No baseline");
  setText("summaryTempChange", baseline ? formatTempDrop(changes.tempDropC) : "No baseline");

  const calibrationLabel = {
    idle: "Not done", running: "Running", stable: "Stable ✓", timeout: "Not stable", accepted: "Continued"
  }[state.calibration.status];
  setText("metricCalibration", state.calibration.profileId && state.calibration.profileId !== state.activeProfileId ? "Not done" : calibrationLabel);
  setText("metricBaselineNote", capture.active ? "Capturing baseline" : baseline ? "Baseline recorded" : "Baseline not recorded");
}
