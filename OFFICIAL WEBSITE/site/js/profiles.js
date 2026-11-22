/* Patient profiles: add, rename, delete, select, and the per-patient profile modal with tabs. */

function setActiveProfile(profileId) {
  const profile = state.profiles.find(item => item.profileId === profileId);
  if (!profile) return;
  const changed = state.activeProfileId !== profileId;
  state.activeProfileId = profileId;
  state.profileTabId = profileId;
  if (changed) {
    const now = Date.now();
    state.sessionId = `session-${now}`;
    state.sessionStartedAt = now;
    resetCalibration();
    state.baselineCapture = { active: false, startedAt: 0, endsAt: 0, error: "" };
    clearSensorReadings();
    state.faceLog = [];
    resetFaceState();
    resetLstmPrediction();
  }
  persistCollections();
  renderProfiles();
  renderAll();
}

function findProfileByName(name, exceptId = null) {
  const key = name.trim().toLowerCase();
  return state.profiles.find(profile => profile.profileId !== exceptId && profile.name.trim().toLowerCase() === key);
}

function addPatientProfile() {
  if (state.baselineCapture.active) {
    alert("Cancel the current baseline capture before adding another patient.");
    return;
  }
  const input = $("profileNameInput");
  const name = input.value.trim();
  if (!name) {
    alert("Enter a patient name or code first.");
    input.focus();
    return;
  }
  const existing = findProfileByName(name);
  if (existing) {
    alert("A patient with that name or code already exists. The existing profile is now selected.");
    input.value = "";
    setActiveProfile(existing.profileId);
    return;
  }
  const profile = { profileId: createId(), name, createdAt: new Date().toISOString(), baseline: null };
  state.profiles.unshift(profile);
  input.value = "";
  setActiveProfile(profile.profileId);
  switchPage("dashboard");
  closeModal("patientManagementModal");
}

function renameActivePatient() {
  const profile = getActiveProfile();
  if (!profile) return;
  const input = $("profileNameInput");
  const name = input.value.trim();
  if (!name) {
    alert("Enter the new patient name or code first.");
    input.focus();
    return;
  }
  if (name === profile.name) {
    alert("The patient name or code is unchanged.");
    return;
  }
  if (findProfileByName(name, profile.profileId)) {
    alert("A different patient already uses that name or code.");
    return;
  }
  profile.name = name;
  state.records.forEach(record => {
    if (record.profileId === profile.profileId) record.profileName = name;
  });
  input.value = "";
  persistCollections();
  renderProfiles();
  renderAll();
  alert(`The patient was renamed to ${name}.`);
}

function deleteActivePatient() {
  const profile = getActiveProfile();
  if (!profile) return;
  if (!confirm(`Permanently delete ${profile.name} and this patient's baseline and records? This cannot be undone.`)) return;
  state.profiles = state.profiles.filter(item => item.profileId !== profile.profileId);
  state.records = state.records.filter(item => item.profileId !== profile.profileId);
  state.activeProfileId = null;
  state.profileTabId = null;
  resetCalibration();
  state.baselineCapture = { active: false, startedAt: 0, endsAt: 0, error: "" };
  clearSensorReadings();
  state.faceLog = [];
  resetFaceState();
  persistCollections();
  renderProfiles();
  renderAll();
  alert(`${profile.name} and their records were deleted.`);
}

function viewActivePatient() {
  if (!getActiveProfile()) return;
  closeModal("patientManagementModal");
  state.profileTabId = state.activeProfileId;
  openPatientProfileModal();
}

function openPatientProfileModal() {
  renderProfiles();
  openModal("patientProfileModal", "closePatientProfileModalBtn");
}

/* ---------- Rendering ---------- */

function renderProfiles() {
  const active = getActiveProfile();

  const select = $("activeProfileSelect");
  if (select) {
    select.replaceChildren(new Option("Select a patient", ""), ...state.profiles.map(profile => new Option(profile.name, profile.profileId)));
    select.value = state.activeProfileId || "";
  }
  ["viewPatientBtn", "updatePatientBtn", "deletePatientBtn"].forEach(id => {
    if ($(id)) $(id).disabled = !active;
  });
  setText("activeProfileBadge", active ? `ACTIVE: ${active.name}` : "NO ACTIVE PROFILE");
  setText("summaryPatient", active ? active.name : "None selected");

  const directory = $("profileDirectory");
  if (directory) {
    directory.innerHTML = state.profiles.length
      ? state.profiles.map(profile => {
        const count = state.records.filter(record => record.profileId === profile.profileId).length;
        return `
          <article class="profile-directory-card${profile.profileId === state.activeProfileId ? " active" : ""}">
            <div>
              <strong>${escapeHtml(profile.name)}</strong>
              <span>${profile.baseline?.completedAt ? `Baseline captured ${escapeHtml(new Date(profile.baseline.completedAt).toLocaleDateString())}` : "Baseline not captured"}</span>
              <span class="profile-directory-face-summary">${count} record(s)</span>
            </div>
            <button class="action-btn secondary" type="button" data-profile-id="${escapeHtml(profile.profileId)}">
              <i data-lucide="eye"></i><span>View profile</span>
            </button>
          </article>`;
      }).join("")
      : '<p class="subtext">No patient profiles yet. Add one from Manage patients on the Dashboard.</p>';
    refreshIcons(directory);
  }

  renderProfileModal();
}

function renderProfileModal() {
  const tabs = $("profileTabs");
  const detail = $("profileDetail");
  if (!tabs || !detail) return;
  const selectedId = state.profileTabId || state.activeProfileId;
  tabs.replaceChildren(...state.profiles.map(profile => {
    const tab = document.createElement("button");
    tab.type = "button";
    tab.className = `profile-tab${profile.profileId === selectedId ? " active" : ""}`;
    tab.setAttribute("role", "tab");
    tab.setAttribute("aria-selected", String(profile.profileId === selectedId));
    tab.dataset.profileId = profile.profileId;
    tab.textContent = profile.name;
    return tab;
  }));

  const profile = state.profiles.find(item => item.profileId === selectedId);
  if (!profile) {
    detail.innerHTML = '<p class="subtext">Add a patient from the Dashboard to create a profile.</p>';
    return;
  }
  const b = profile.baseline;
  const percent = value => (Number.isFinite(value) ? formatPercent(value) : "Not recorded");
  const items = [
    ["Heart rate", formatSensor("hr", b?.hr)],
    ["GSR / EDA", formatSensor("gsr", b?.gsr)],
    ["Temperature", formatSensor("temp", b?.temp)],
    ["Motion", formatSensor("motion", b?.motion)],
    ["Sensor samples", Number.isFinite(b?.sampleCount) ? String(b.sampleCount) : "--"],
    ["Capture duration", Number.isFinite(b?.durationSec) ? `${b.durationSec} s` : "--"],
    ["Calibration", b?.calibration === "accepted" ? "Continued without full stability" : b?.calibration === "stable" ? "Stable" : "--"],
    ["Face coverage", Number.isFinite(b?.faceDetectionRate) ? `${Math.round(b.faceDetectionRate)}% (${b.faceSampleCount} samples)` : "Not recorded"],
    ["Dominant expression", b?.dominantEmotion || "Not recorded"],
    ["Visual fatigue", percent(b?.fatigue)],
    ["Wrinkle score", percent(b?.wrinkle)],
    ["Eyebag score", percent(b?.eyebag)]
  ];
  const rows = state.records
    .map((record, index) => ({ record, index }))
    .filter(item => item.record.profileId === profile.profileId);
  detail.innerHTML = `
    <div class="card-title-row"><h3>${escapeHtml(profile.name)}</h3><span class="subtext">Created ${escapeHtml(new Date(profile.createdAt).toLocaleString())}</span></div>
    <h4 class="top-gap">Baseline</h4>
    <div class="profile-summary-grid">${items.map(([label, value]) => `
      <div class="info-block"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`).join("")}</div>
    <p class="subtext">Baseline captured ${b?.completedAt ? escapeHtml(new Date(b.completedAt).toLocaleString()) : "not recorded"}.</p>
    <div class="profile-records">
      <h4>Patient records (${rows.length})</h4>
      <div class="table-wrap"><table><thead><tr><th>Timestamp</th><th>Phase</th><th>Emotion</th><th>HR</th><th>GSR</th><th>Temp</th><th>HR Δ</th><th>GSR Δ</th><th>Temp drop</th><th>LSTM</th></tr></thead>
      <tbody>${rows.map(({ record, index }) => `<tr data-record-index="${index}">
        <td>${escapeHtml(formatRecordTime(record))}</td><td>${escapeHtml(record.phase || "--")}</td><td>${escapeHtml(record.emotion)}</td>
        <td>${escapeHtml(formatSensor("hr", record.hr))}</td><td>${escapeHtml(formatSensor("gsr", record.gsr))}</td><td>${escapeHtml(formatSensor("temp", record.temp))}</td>
        <td>${escapeHtml(formatSignedPercent(record.hrChangePct))}</td><td>${escapeHtml(formatSignedPercent(record.gsrChangePct))}</td>
        <td>${escapeHtml(formatTempDrop(record.tempDropC))}</td><td>${escapeHtml(formatRecordLstm(record))}</td></tr>`).join("")}</tbody></table></div>
    </div>`;
}

function bindProfileControls() {
  $("activeProfileSelect")?.addEventListener("change", event => {
    if (state.baselineCapture.active || state.calibration.status === "running") {
      alert("Finish or cancel calibration and baseline capture before changing patients.");
      event.target.value = state.activeProfileId || "";
      return;
    }
    if (event.target.value) setActiveProfile(event.target.value);
  });
  $("openPatientManagementBtn")?.addEventListener("click", () => openModal("patientManagementModal", "profileNameInput"));
  bindModalDismiss("patientManagementModal", "closePatientManagementModalBtn");
  bindModalDismiss("patientProfileModal", "closePatientProfileModalBtn");
  $("addPatientBtn")?.addEventListener("click", addPatientProfile);
  $("profileNameInput")?.addEventListener("keydown", event => {
    if (event.key === "Enter") addPatientProfile();
  });
  $("viewPatientBtn")?.addEventListener("click", viewActivePatient);
  $("updatePatientBtn")?.addEventListener("click", renameActivePatient);
  $("deletePatientBtn")?.addEventListener("click", deleteActivePatient);
  $("exportPatientCsvBtn")?.addEventListener("click", () => exportPatientCsv(state.profileTabId || state.activeProfileId));

  $("profileDirectory")?.addEventListener("click", event => {
    const button = event.target.closest("button[data-profile-id]");
    if (!button) return;
    if (button.dataset.profileId !== state.activeProfileId && (state.baselineCapture.active || state.calibration.status === "running")) {
      state.profileTabId = button.dataset.profileId;
    } else {
      setActiveProfile(button.dataset.profileId);
    }
    openPatientProfileModal();
  });
  // Tabs only switch which profile is shown; they do not change the active patient.
  $("profileTabs")?.addEventListener("click", event => {
    const tab = event.target.closest("button[data-profile-id]");
    if (!tab) return;
    state.profileTabId = tab.dataset.profileId;
    renderProfileModal();
  });
  $("profileDetail")?.addEventListener("click", event => {
    const row = event.target.closest("tr[data-record-index]");
    if (!row) return;
    closeModal("patientProfileModal");
    openRecordModal(Number(row.dataset.recordIndex));
  });
}
