/* Captured records, reports table, CSV export and the printable report. */

const CSV_HEADERS = [
  "timestamp", "profileId", "profileName", "phase", "source", "emotion", "confidence",
  "hr", "gsr", "temp", "motion", "hrChangePct", "gsrChangePct", "tempDropC",
  "eyebag", "wrinkle", "fatigue", "lstmLabel", "lstmConfidence", "sensorsLive"
];

function round(value, decimals) {
  return Number.isFinite(value) ? Number(value.toFixed(decimals)) : null;
}

function formatRecordTime(record) {
  const date = new Date(record.timestamp);
  return Number.isNaN(date.getTime()) ? String(record.timestamp ?? "--") : date.toLocaleString();
}

function formatRecordLstm(record) {
  return record.lstmLabel ? `${record.lstmLabel} · ${Math.round(record.lstmConfidence * 100)}%` : "--";
}

function isWithinFirstReadingDelay(now) {
  return now < state.sessionStartedAt + Number(state.settings.firstReadingDelaySec || 0) * 1000;
}

/* Called once per second. Saves a snapshot when auto-capture is on and there is something to record. */
function captureRecord(now) {
  const profile = getActiveProfile();
  if (!profile || !state.settings.autoCapture || isWithinFirstReadingDelay(now)) return;
  if (now - state.lastCaptureAt < CONFIG.runtime.autoCaptureCooldownMs) return;
  const sensorsLive = liveSensorCount();
  if (state.dominantConfidence < CONFIG.runtime.autoCaptureConfidenceMin && sensorsLive === 0) return;
  state.lastCaptureAt = now;

  const changes = getBaselineChanges();
  const prediction = state.lstm.status === "ready" ? state.lstm.prediction : null;
  state.records.unshift({
    recordId: createId(),
    sessionId: state.sessionId,
    profileId: profile.profileId,
    profileName: profile.name,
    timestamp: new Date(now).toISOString(),
    phase: currentPhase(),
    source: state.simActive ? "simulated" : "usb",
    emotion: state.dominantEmotion,
    confidence: state.dominantConfidence,
    hr: getLiveValue("hr"),
    gsr: getLiveValue("gsr"),
    temp: getLiveValue("temp"),
    motion: getLiveValue("motion"),
    hrChangePct: round(changes.hrChangePct, 1),
    gsrChangePct: round(changes.gsrChangePct, 1),
    tempDropC: round(changes.tempDropC, 2),
    eyebag: Math.round(state.visualFatigue.eyebag),
    wrinkle: Math.round(state.visualFatigue.wrinkle),
    fatigue: Math.round(state.visualFatigue.fatigue),
    lstmLabel: prediction?.label ?? null,
    lstmConfidence: prediction ? round(prediction.confidence, 3) : null,
    sensorsLive
  });
  if (state.records.length > CONFIG.runtime.maxRecords) state.records.length = CONFIG.runtime.maxRecords;
  persistCollections();
  renderRecords();
}

function renderRecords() {
  setText("reportCountBadge", `${state.records.length} Records`);
  setText("liveRecordCount", String(state.records.length));
  setText("storageStatusText", `${state.records.length} records · ${state.profiles.length} patients (this browser)`);
  const reportBody = $("reportTableBody");
  if (reportBody) {
    reportBody.innerHTML = state.records.map((record, index) => `<tr data-record-index="${index}">
      <td>${escapeHtml(formatRecordTime(record))}</td>
      <td>${escapeHtml(record.profileName || "—")}</td>
      <td>${escapeHtml(record.phase || "--")}</td>
      <td>${escapeHtml(record.emotion)}</td>
      <td>${escapeHtml(formatSignedPercent(record.hrChangePct))}</td>
      <td>${escapeHtml(formatSignedPercent(record.gsrChangePct))}</td>
      <td>${escapeHtml(formatTempDrop(record.tempDropC))}</td>
      <td>${escapeHtml(formatRecordLstm(record))}</td>
    </tr>`).join("");
  }
  const inputBody = $("reportInputTableBody");
  if (inputBody) {
    inputBody.innerHTML = state.records.map((record, index) => `<tr data-record-index="${index}">
      <td>${escapeHtml(formatRecordTime(record))}</td>
      <td>${escapeHtml(record.emotion)}</td>
      <td>${escapeHtml(record.confidence)}%</td>
      <td>${escapeHtml(formatSensor("hr", record.hr))}</td>
      <td>${escapeHtml(formatSensor("gsr", record.gsr))}</td>
      <td>${escapeHtml(formatSensor("temp", record.temp))}</td>
      <td>${escapeHtml(formatSensor("motion", record.motion))}</td>
      <td>${escapeHtml(record.eyebag ?? "--")}%</td>
      <td>${escapeHtml(record.wrinkle ?? "--")}%</td>
      <td>${escapeHtml(record.fatigue ?? "--")}%</td>
      <td>${escapeHtml(formatRecordLstm(record))}</td>
    </tr>`).join("");
  }
  if ($("patientProfileModal")?.classList.contains("show")) renderProfileModal();
}

function openRecordModal(index) {
  const r = state.records[index];
  if (!r) return;
  const fields = {
    Timestamp: formatRecordTime(r),
    Patient: r.profileName || "—",
    Phase: r.phase || "--",
    Source: r.source || "--",
    Emotion: `${r.emotion} (${r.confidence}%)`,
    "Heart rate": formatSensor("hr", r.hr),
    GSR: formatSensor("gsr", r.gsr),
    Temperature: formatSensor("temp", r.temp),
    Motion: formatSensor("motion", r.motion),
    "HR vs baseline": formatSignedPercent(r.hrChangePct),
    "GSR vs baseline": formatSignedPercent(r.gsrChangePct),
    "Temperature vs baseline": formatTempDrop(r.tempDropC),
    LSTM: formatRecordLstm(r),
    "Eyebag score": `${r.eyebag ?? "--"}%`,
    "Wrinkle score": `${r.wrinkle ?? "--"}%`,
    "Fatigue score": `${r.fatigue ?? "--"}%`
  };
  $("recordDetailGrid").innerHTML = Object.entries(fields)
    .map(([label, value]) => `<div class="record-detail-item"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`)
    .join("");
  openModal("recordModal", "closeRecordModalBtn");
}

function exportCsv() {
  if (!state.records.length) {
    alert("There are no records to export yet.");
    return;
  }
  downloadCsv("psychescan-records.csv", CSV_HEADERS, [...state.records].reverse());
}

function exportPatientCsv(profileId) {
  const profile = state.profiles.find(item => item.profileId === profileId);
  if (!profile) {
    alert("Select a patient profile to download.");
    return;
  }
  const rows = state.records.filter(record => record.profileId === profile.profileId).reverse();
  if (!rows.length) {
    alert(`No records found for ${profile.name}.`);
    return;
  }
  const safeName = profile.name.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "_");
  downloadCsv(`patient_${safeName}_records.csv`, CSV_HEADERS, rows);
}

function savePdf() {
  const profile = getActiveProfile();
  const baseline = profile?.baseline;
  const changes = getBaselineChanges();
  const chartImages = SENSOR_KEYS.map(key => [CONFIG.sensors[key].channel, $(SENSOR_CHART_IDS[key])?.toDataURL("image/png") || ""]);
  const emotionImage = $("emotionChart")?.toDataURL("image/png") || "";
  const reportWindow = window.open("", "_blank", "width=1100,height=800");
  if (!reportWindow) {
    alert("Allow pop-ups for this page to open the printable report.");
    return;
  }
  const metric = (label, value) => `<div class="metric"><small>${escapeHtml(label)}</small><strong>${escapeHtml(value)}</strong></div>`;
  reportWindow.document.write(`<!doctype html><html><head><title>PsycheScan Report</title><style>
    body{font-family:Arial,sans-serif;color:#172033;margin:32px}h1{margin-bottom:4px}h2{margin-top:28px;border-bottom:1px solid #d8dee9;padding-bottom:6px}.meta{color:#526174}.metric{display:inline-block;margin:8px 18px 8px 0;padding:10px 14px;background:#f1f5f9;border-radius:6px}.metric strong{display:block;font-size:18px}img{max-width:100%;margin-top:12px}.disclaimer{margin-top:28px;padding:10px 14px;border:1px solid #d8dee9;border-radius:6px;font-weight:bold}
  </style></head><body><h1>PsycheScan Monitoring Report</h1>
  <p class="meta">Generated ${escapeHtml(new Date().toLocaleString())} · Patient ${escapeHtml(profile?.name || "No active profile")}</p>
  <h2>Baseline</h2>
  ${baseline
    ? [metric("Heart rate", formatSensor("hr", baseline.hr)), metric("GSR", formatSensor("gsr", baseline.gsr)), metric("Temperature", formatSensor("temp", baseline.temp)),
      metric("Motion", formatSensor("motion", baseline.motion)), metric("Captured", new Date(baseline.completedAt).toLocaleString())].join("")
    : "<p>No baseline recorded.</p>"}
  <h2>Current readings</h2>
  ${[metric("Heart rate", formatSensor("hr", getLiveValue("hr"))), metric("GSR", formatSensor("gsr", getLiveValue("gsr"))),
    metric("Temperature", formatSensor("temp", getLiveValue("temp"))), metric("Motion", formatSensor("motion", getLiveValue("motion")))].join("")}
  <h2>Change from baseline</h2>
  ${[metric("Heart rate", formatSignedPercent(changes.hrChangePct)), metric("GSR", formatSignedPercent(changes.gsrChangePct)),
    metric("Temperature", formatTempDrop(changes.tempDropC)), metric("LSTM", lstmTexts().long)].join("")}
  <h2>Vital-sign trends (last ${CONFIG.runtime.chartWindowSec} s)</h2>${chartImages.map(([label, image]) => image ? `<h3>${escapeHtml(label)}</h3><img src="${image}" alt="${escapeHtml(label)} trend">` : "").join("")}
  <h2>Emotion trend</h2>${emotionImage ? `<img src="${emotionImage}" alt="Emotion trend">` : "<p>No emotion chart data.</p>"}
  <h2>Facial fatigue cues</h2><p>Eyebag ${formatPercent(state.visualFatigue.eyebag)} · Wrinkle ${formatPercent(state.visualFatigue.wrinkle)} · Visual fatigue ${formatPercent(state.visualFatigue.fatigue)}</p>
  <p class="disclaimer">${escapeHtml(CONFIG.disclaimer)}</p></body></html>`);
  reportWindow.document.close();
  reportWindow.focus();
  setTimeout(() => reportWindow.print(), 250);
}

function bindRecordControls() {
  $("exportCsvBtn")?.addEventListener("click", exportCsv);
  $("savePdfBtn")?.addEventListener("click", savePdf);
  $("clearReportsBtn")?.addEventListener("click", () => {
    if (!state.records.length || !confirm("Delete all saved records for every patient? Export a CSV first if you need them.")) return;
    state.records = [];
    persistCollections();
    renderRecords();
    renderProfiles();
  });
  $("toggleDataInputsBtn")?.addEventListener("click", () => openModal("reportInputsModal", "closeReportInputsModalBtn"));
  bindModalDismiss("reportInputsModal", "closeReportInputsModalBtn");
  bindModalDismiss("recordModal", "closeRecordModalBtn");
  ["reportTableBody", "reportInputTableBody"].forEach(id => {
    $(id)?.addEventListener("click", event => {
      const row = event.target.closest("tr[data-record-index]");
      if (!row) return;
      closeModal("reportInputsModal");
      openRecordModal(Number(row.dataset.recordIndex));
    });
  });
}
