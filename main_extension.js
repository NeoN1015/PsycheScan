Object.assign(STORAGE_KEYS, {
    records: "cnn_lstm_records_v3",
    reports: "cnn_lstm_reports_v3",
    profiles: "psychescan_profiles_v1",
    activeProfileId: "psychescan_active_profile_v1"
});

Object.assign(state.settings, {
    detectionProfile: "phone-strong",
    modelSource: "remote",
    cameraDeviceId: "auto",
    cameraFacing: "auto",
    wsUrl: getWebSocketUrl(),
    bleServiceUuid: PROJECT_CONFIG.hardware.bleServiceUuid,
    bleCharacteristicUuid: PROJECT_CONFIG.hardware.bleCharacteristicUuid
});

Object.assign(state, {
    bleConnected: false,
    bleConnecting: false,
    bleDevice: null,
    bleServer: null,
    bleCharacteristic: null,
    bleNotificationHandler: null,
    bleDisconnectHandler: null,
    wsConnected: false,
    ws: null,
    wsReconnectTimer: null,
    wsReconnectAttempt: 0,
    wsManualDisconnect: false,
    bleBuffer: "",
    serialConnecting: false,
    serialReadPromise: null,
    serialDisconnectHandler: null,
    profiles: [],
    activeProfileId: null,
    activeProfileTabId: null,
    modelDetector: "tiny",
    appearanceWatcherBound: false
});

let patientProfileReturnFocus = null;

function anyTransportConnected() {
    return !!(state.serialConnected || state.bleConnected || state.wsConnected);
}

// keepLastReadings: true when a transport drops, so the dashboard, graphs, and records
// keep showing the latest reading. Only explicit resets (Clear Readings, changing or
// deleting the patient) discard the last readings.
function clearSensorReadings({ keepLastReadings = false } = {}) {
    state.sensorValues = { hr: null, gsr: null, temp: null, tempDrop: null, motion: null };
    state.sensorContact = { hr: false, gsr: false, temp: false, motion: false };
    if (!keepLastReadings) state.displaySensorValues = { hr: null, gsr: null, temp: null, motion: null };
    clearMotionSamples();
    Object.values(state.sensors).forEach(sensor => {
        sensor.connected = false;
        sensor.lastSeen = 0;
        sensor.state = state.settings.demoSensors ? "demo" : "disconnected";
    });
}

function persistCollections() {
    saveLocalJSON(STORAGE_KEYS.records, state.records);
    saveLocalJSON(STORAGE_KEYS.reports, state.reports);
    saveLocalJSON(STORAGE_KEYS.profiles, state.profiles);
    saveLocalJSON(STORAGE_KEYS.activeProfileId, state.activeProfileId);
    if (window.PsycheScanBackend) window.PsycheScanBackend.sync("collections");
}

function loadCollections() {
    try {
        state.records = loadLocalJSON(STORAGE_KEYS.records, []);
        state.reports = loadLocalJSON(STORAGE_KEYS.reports, []);
        state.profiles = loadLocalJSON(STORAGE_KEYS.profiles, []);
        state.activeProfileId = loadLocalJSON(STORAGE_KEYS.activeProfileId, null);
        const session = localStorage.getItem("cnn_lstm_session_v1");
        if (session) {
            const parsedSession = JSON.parse(session);
            state.session = { ...state.session, ...parsedSession };
            state.session.baselineTimer = null;
            if (state.session.baselineCaptureActive) {
                state.session.baselineCaptureActive = false;
                state.session.baselineCompletedAt = Date.now();
                state.session.baselineError = "Previous baseline capture was interrupted. Start a new capture to record a normal baseline.";
                if (typeof persistBaselineSession === "function") persistBaselineSession();
            }
            if (Array.isArray(parsedSession.history)) state.history = parsedSession.history;
        }
        migrateLegacyProfiles();
    } catch (e) {
        console.warn("Failed to load local collections", e);
    }
}

function createProfileId() {
    const uuid = window.crypto?.randomUUID?.();
    return uuid || `profile-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function migrateLegacyProfiles() {
    if (!Array.isArray(state.profiles)) state.profiles = [];
    if (!Array.isArray(state.records)) state.records = [];
    if (!Array.isArray(state.reports)) state.reports = [];
    const byName = new Map(state.profiles.map(profile => [String(profile.name).trim().toLowerCase(), profile]));
    const findOrCreateLegacy = name => {
        const key = String(name || "").trim().toLowerCase();
        if (!key) return null;
        if (byName.has(key)) return byName.get(key);
        const profile = {
            profileId: `legacy-${key.replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "patient"}`,
            name: String(name).trim(),
            createdAt: new Date().toISOString(),
            baseline: null
        };
        byName.set(key, profile);
        state.profiles.push(profile);
        return profile;
    };

    [...state.records, ...state.reports].forEach(item => {
        if (!item.profileId && item.participantId) {
            const profile = findOrCreateLegacy(item.participantId);
            if (profile) {
                item.profileId = profile.profileId;
                item.profileName = profile.name;
            }
        }
    });
    const legacyName = String(state.session.profileName || state.settings.participantId || "").trim();
    const legacyBaseline = state.session.baselineSummary;
    if (legacyName && legacyBaseline) {
        const profile = findOrCreateLegacy(legacyName);
        if (profile && !profile.baseline) {
            profile.baseline = {
                hr: legacyBaseline.hr ?? null,
                gsr: legacyBaseline.gsr ?? null,
                temp: legacyBaseline.temp ?? null,
                motion: legacyBaseline.motion ?? null,
                sampleCount: legacyBaseline.samples ?? 0,
                durationSec: legacyBaseline.durationSec ?? 0,
                completedAt: legacyBaseline.completedAt ?? null
            };
        }
    }
    if (!Array.isArray(state.history)) state.history = [];
    state.history.forEach(sample => {
        if (!sample || sample.profileId) return;
        const name = String(sample.profileName || sample.participantId || legacyName).trim();
        const profile = findOrCreateLegacy(name);
        if (profile) sample.profileId = profile.profileId;
    });
    if (!state.session.profileId && legacyName) {
        const profile = findOrCreateLegacy(legacyName);
        if (profile) {
            state.session.profileId = profile.profileId;
            state.session.profileName = profile.name;
        }
    }
    if (!state.profiles.some(profile => profile.profileId === state.activeProfileId)) {
        state.activeProfileId = null;
    }
}

function completeBaselineProfile(summary) {
    const profileId = state.session.profileId;
    if (!profileId) return;
    let profile = state.profiles.find(item => item.profileId === profileId);
    if (!profile) {
        profile = {
            profileId,
            name: state.session.profileName,
            createdAt: new Date().toISOString(),
            baseline: null
        };
        state.profiles.unshift(profile);
    }
    profile.name = String(state.session.profileName || profile.name).trim();
    profile.baseline = {
        hr: summary.hr,
        gsr: summary.gsr,
        temp: summary.temp,
        motion: summary.motion,
        sampleCount: summary.samples,
        durationSec: summary.durationSec,
        completedAt: summary.completedAt,
        score: summary.score,
        faceSampleCount: summary.faceSampleCount,
        faceDetectionRate: summary.faceDetectionRate,
        dominantEmotion: summary.dominantEmotion,
        fatigue: summary.fatigue,
        wrinkle: summary.wrinkle,
        eyebag: summary.eyebag
    };
    state.activeProfileId = profile.profileId;
    state.activeProfileTabId = profile.profileId;
    persistCollections();
    renderProfiles();
    renderAll();
    switchPage("dashboard");
}

function setActiveProfile(profileId) {
    const profile = state.profiles.find(item => item.profileId === profileId);
    if (!profile) return;
    const changed = state.activeProfileId !== profileId;
    state.activeProfileId = profileId;
    state.activeProfileTabId = profileId;
    state.session.profileId = profileId;
    state.session.profileName = profile.name;
    state.session.baselineSummary = profile.baseline
        ? { ...profile.baseline, samples: profile.baseline.sampleCount }
        : null;
    if (changed) {
        const now = Date.now();
        state.session.id = `session-${now}`;
        state.session.startedAt = now;
        state.session.firstReadingAt = now + Number(state.settings.firstReadingDelaySec || 0) * 1000;
        state.session.phase = "questionnaire";
        state.session.baselineError = "";
        clearSensorReadings();
        resetFaceState();
        state.lastPacketTimestamp = 0;
        state.lastPacketRaw = "—";
        if ($("lastPacketTime")) $("lastPacketTime").textContent = "—";
        if ($("lastPacketRaw")) $("lastPacketRaw").textContent = "—";
    }
    saveLocalJSON(STORAGE_KEYS.activeProfileId, profileId);
    if (window.PsycheScanBackend) window.PsycheScanBackend.sync("active-profile");
    renderProfiles();
    renderAll();
    updateCharts();
    renderBaselineWorkflow();
}

function renderProfiles() {
    const select = $("activeProfileSelect");
    if (select) {
        const current = state.activeProfileId || "";
        select.replaceChildren(new Option("Select a patient", ""));
        state.profiles.forEach(profile => {
            const option = new Option(profile.name, profile.profileId);
            select.add(option);
        });
        select.value = current;
    }
    const deleteButton = $("deletePatientBtn");
    const hasActiveProfile = state.profiles.some(profile => profile.profileId === state.activeProfileId);
    if (deleteButton) deleteButton.disabled = !hasActiveProfile;
    if ($("updatePatientBtn")) $("updatePatientBtn").disabled = !hasActiveProfile;
    if ($("viewPatientBtn")) $("viewPatientBtn").disabled = !hasActiveProfile;
    const badge = $("activeProfileBadge");
    const activeProfile = state.profiles.find(profile => profile.profileId === state.activeProfileId);
    if (badge) badge.textContent = activeProfile ? `ACTIVE: ${activeProfile.name}` : "NO ACTIVE PROFILE";

    const getProfileFacePreview = profile => {
        const baseline = profile.baseline;
        const hasBaselineFaceData = hasFaceMeasurements(baseline);
        const faceSummary = hasBaselineFaceData
            ? baseline
            : getProfileFaceSummary(profile.profileId, profile.name);
        if (!faceSummary) {
            return baseline?.faceSampleCount === 0
                ? "Face: no face detected in baseline"
                : "Face: no saved readings";
        }
        const metric = value => Number.isFinite(value) ? `${Math.round(value)}%` : "not recorded";
        const source = hasBaselineFaceData
            ? "baseline"
            : faceSummary.source === "Live baseline telemetry"
                ? `live baseline, ${faceSummary.faceSampleCount} samples`
                : `saved avg, ${faceSummary.faceSampleCount} records`;
        return `Face: fatigue ${metric(faceSummary.fatigue)} · wrinkle ${metric(faceSummary.wrinkle)} · eyebag ${metric(faceSummary.eyebag)} (${source})`;
    };

    const directory = $("profileDirectory");
    if (directory) {
        directory.innerHTML = state.profiles.length
            ? state.profiles.map(profile => `
                <article class="profile-directory-card${profile.profileId === state.activeProfileId ? " active" : ""}">
                  <div>
                    <strong>${escapeHtml(profile.name)}</strong>
                    <span>${profile.baseline?.completedAt ? `Baseline captured ${escapeHtml(new Date(profile.baseline.completedAt).toLocaleDateString())}` : "Baseline not captured"}</span>
                    <span class="profile-directory-face-summary">${escapeHtml(getProfileFacePreview(profile))}</span>
                  </div>
                  <button class="action-btn secondary" type="button" data-profile-id="${escapeHtml(profile.profileId)}">
                    <i data-lucide="eye"></i><span>View profile</span>
                  </button>
                </article>
              `).join("")
            : '<p class="subtext">No patient profiles yet. Add one from Manage patients on the Dashboard.</p>';
        directory.querySelectorAll("button[data-profile-id]").forEach(button => {
            button.addEventListener("click", () => {
                setActiveProfile(button.dataset.profileId);
                openPatientProfileModal();
            });
        });
        if (window.lucide) lucide.createIcons({ root: directory });
    }

    const tabs = $("profileTabs");
    if (!tabs) return;
    tabs.replaceChildren();
    state.profiles.forEach(profile => {
        const tab = document.createElement("button");
        tab.type = "button";
        tab.className = `profile-tab${profile.profileId === (state.activeProfileTabId || state.activeProfileId) ? " active" : ""}`;
        tab.setAttribute("role", "tab");
        tab.setAttribute("aria-selected", String(profile.profileId === (state.activeProfileTabId || state.activeProfileId)));
        tab.textContent = profile.name;
        tab.addEventListener("click", () => {
            setActiveProfile(profile.profileId);
        });
        tabs.appendChild(tab);
    });

    const detail = $("profileDetail");
    if (!detail) return;
    const profile = state.profiles.find(item => item.profileId === (state.activeProfileTabId || state.activeProfileId));
    if (!profile) {
        detail.innerHTML = '<p class="subtext">Add a patient from the Dashboard to create a profile.</p>';
        return;
    }
    const baseline = profile.baseline;
    const percentValue = value => Number.isFinite(value)
        ? `${Math.round(value)}% · ${getSeverityLabelFromPercent(value)}`
        : "Not recorded";
    const hasBaselineFaceData = hasFaceMeasurements(baseline);
    const fallbackFaceSummary = hasBaselineFaceData
        ? null
        : getProfileFaceSummary(profile.profileId, profile.name);
    const faceSummary = hasBaselineFaceData ? baseline : fallbackFaceSummary;
    const faceDataSource = hasBaselineFaceData
        ? "Captured baseline"
        : fallbackFaceSummary?.source === "Live baseline telemetry"
            ? `Live baseline telemetry (${fallbackFaceSummary.faceSampleCount} samples)`
            : fallbackFaceSummary
                ? `Saved-record average (${fallbackFaceSummary.faceSampleCount} face records)`
                : baseline?.faceSampleCount === 0
                    ? "No face detected in baseline"
                    : "No face data";
    const faceCountUnit = hasBaselineFaceData || faceSummary?.source === "Live baseline telemetry"
        ? "samples"
        : "records";
    const baselineItems = [
        ["Screening level", Number.isFinite(baseline?.score) ? `${getIntegratedSeverityLabel(baseline.score)} (${Math.round(baseline.score)} / 100)` : "Not recorded"],
        ["Heart rate", Number.isFinite(baseline?.hr) ? `${baseline.hr.toFixed(1)} bpm` : "--"],
        ["GSR / EDA", Number.isFinite(baseline?.gsr) ? `${baseline.gsr.toFixed(2)} µS` : "--"],
        ["Temperature", Number.isFinite(baseline?.temp) ? `${baseline.temp.toFixed(1)} °C` : "--"],
        ["Motion", Number.isFinite(baseline?.motion) ? `${baseline.motion.toFixed(3)} g` : "--"],
        ["Sensor samples", Number.isFinite(baseline?.sampleCount) ? `${baseline.sampleCount}` : "--"],
        ["Capture duration", Number.isFinite(baseline?.durationSec) ? `${baseline.durationSec} sec` : "--"],
        ["Face data source", faceDataSource],
        ["Face coverage", Number.isFinite(faceSummary?.faceDetectionRate) ? `${Math.round(faceSummary.faceDetectionRate)}% (${faceSummary.faceSampleCount || 0} ${faceCountUnit})` : "Not recorded"],
        ["Dominant expression", faceSummary?.dominantEmotion || (baseline?.faceSampleCount === 0 ? "No face detected" : "Not recorded")],
        ["Visual fatigue", percentValue(faceSummary?.fatigue)],
        ["Wrinkle score", percentValue(faceSummary?.wrinkle)],
        ["Eyebag score", percentValue(faceSummary?.eyebag)]
    ];
    const recordIndices = state.records
        .map((record, index) => ({ record, index }))
        .filter(item => item.record.profileId === profile.profileId);
    const reports = state.reports.filter(report => report.profileId === profile.profileId);
    detail.innerHTML = `
      <div class="card-title-row"><h3>${escapeHtml(profile.name)}</h3><span class="subtext">Created ${escapeHtml(new Date(profile.createdAt).toLocaleString())}</span></div>
      <h4 class="top-gap">Baseline</h4>
      <div class="profile-summary-grid">${baselineItems.map(([label, value]) => `
        <div class="info-block"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>
      `).join("")}</div>
      <p class="subtext">Baseline captured ${baseline?.completedAt ? escapeHtml(new Date(baseline.completedAt).toLocaleString()) : "not recorded"}.</p>
      <div class="profile-records">
        <div class="card-title-row">
          <h4>Patient records (${recordIndices.length})</h4>
          ${recordIndices.length > 0 ? `
          <button class="action-btn secondary compact" type="button" id="patientDetailExportCsvBtn" title="Download CSV for this patient">
            <i data-lucide="download"></i><span>Export CSV (${recordIndices.length})</span>
          </button>` : ''}
        </div>
        <div class="table-wrap"><table><thead><tr><th>Timestamp</th><th>Emotion</th><th>HR</th><th>GSR</th><th>Temp</th><th>Motion</th><th>Decision</th></tr></thead>
        <tbody>${recordIndices.map(({ record, index }) => `<tr data-record-index="${index}">
          <td>${escapeHtml(record.timestamp)}</td><td>${escapeHtml(record.emotion)}</td>
          <td>${escapeHtml(record.hr ?? "--")}</td><td>${escapeHtml(record.gsr ?? "--")}</td>
          <td>${escapeHtml(record.temp ?? "--")}</td><td>${escapeHtml(record.motion ?? "--")}</td>
          <td>${escapeHtml(record.decision)}</td></tr>`).join("")}</tbody></table></div>
      </div>
      <div class="profile-records"><h4>Patient reports (${reports.length})</h4>
        <div class="table-wrap"><table><thead><tr><th>Timestamp</th><th>Emotion</th><th>Score</th><th>Decision</th></tr></thead>
        <tbody>${reports.map(report => `<tr><td>${escapeHtml(report.timestamp)}</td><td>${escapeHtml(report.emotion)}</td>
          <td>${escapeHtml(report.integratedScore)}</td><td>${escapeHtml(report.decision)}</td></tr>`).join("")}</tbody></table></div>
      </div>`;
    detail.querySelectorAll("tr[data-record-index]").forEach(row => {
        row.addEventListener("click", () => {
            closePatientProfileModal();
            openRecordModal(Number(row.dataset.recordIndex));
        });
    });
    const detailExportBtn = $("patientDetailExportCsvBtn");
    if (detailExportBtn) {
        detailExportBtn.addEventListener("click", exportPatientCsv);
    }
    if (window.lucide) lucide.createIcons({ root: detail });
}

async function addPatientProfile() {
    if (state.session.baselineCaptureActive) {
        alert("Cancel the current baseline capture before adding another patient.");
        return;
    }
    const input = $("profileNameInput");
    const name = input?.value.trim() || "";
    if (!name) {
        alert("Enter a patient name or code first.");
        input?.focus();
        return;
    }
    const existing = state.profiles.find(profile => profile.name.trim().toLowerCase() === name.toLowerCase());
    if (existing) {
        alert("A patient with that name or code already exists. The existing profile is now selected.");
        input.value = "";
        setActiveProfile(existing.profileId);
        return;
    }
    const profile = {
        profileId: createProfileId(),
        name,
        createdAt: new Date().toISOString(),
        baseline: null
    };
    const button = $("addPatientBtn");
    if (button) button.disabled = true;
    try {
        if (!window.PsycheScanBackend?.createProfile) {
            throw new Error("Patient creation is unavailable until the authenticated server is ready.");
        }
        await window.PsycheScanBackend.createProfile(profile);
        state.profiles.unshift(profile);
        state.activeProfileTabId = profile.profileId;
        input.value = "";
        setActiveProfile(profile.profileId);
        switchPage("dashboard");
        closePatientManagementModal();
    } catch (error) {
        console.error("Could not create patient profile", error);
        alert(`Could not add this patient: ${error.message}`);
    } finally {
        if (button) button.disabled = false;
    }
}

function viewActivePatient() {
    if (!state.profiles.some(profile => profile.profileId === state.activeProfileId)) {
        alert("Select a patient to view.");
        return;
    }
    closePatientManagementModal();
    state.activeProfileTabId = state.activeProfileId;
    openPatientProfileModal();
}

async function updateActivePatient() {
    const profile = state.profiles.find(item => item.profileId === state.activeProfileId);
    if (!profile) {
        alert("Select a patient to update.");
        return;
    }
    if (state.session.baselineCaptureActive) {
        alert("Cancel the current baseline capture before updating a patient.");
        return;
    }
    const input = $("profileNameInput");
    const name = input?.value.trim() || "";
    if (!name) {
        alert("Enter the replacement patient name or code first.");
        input?.focus();
        return;
    }
    const duplicate = state.profiles.find(item =>
        item.profileId !== profile.profileId &&
        item.name.trim().toLowerCase() === name.toLowerCase()
    );
    if (duplicate) {
        alert("A different patient already uses that name or code.");
        return;
    }
    if (name === profile.name) {
        alert("The patient name or code is unchanged.");
        return;
    }
    const previousName = profile.name;

    const button = $("updatePatientBtn");
    if (button) button.disabled = true;
    try {
        if (!window.PsycheScanBackend?.updateProfile) {
            throw new Error("Patient updates are unavailable until the authenticated server is ready.");
        }
        await window.PsycheScanBackend.updateProfile(profile.profileId, name);
        profile.name = name;
        state.records.forEach(record => {
            if (record.profileId === profile.profileId) record.profileName = name;
        });
        state.reports.forEach(report => {
            if (report.profileId === profile.profileId) report.profileName = name;
        });
        state.history.forEach(sample => {
            if (sample.profileId === profile.profileId) sample.profileName = name;
        });
        if (state.session.profileId === profile.profileId) state.session.profileName = name;
        if (state.settings.participantId === previousName) state.settings.participantId = name;
        if (input) input.value = "";
        persistCollections();
        persistBaselineSession();
        renderProfiles();
        renderAll();
        updateCharts();
        alert(`${name} was updated.`);
    } catch (error) {
        console.error("Could not update patient profile", error);
        alert(`Could not update this patient: ${error.message}`);
    } finally {
        if (button) button.disabled = !state.activeProfileId;
    }
}

async function deleteActivePatient() {
    const profile = state.profiles.find(item => item.profileId === state.activeProfileId);
    if (!profile) {
        alert("Select a patient to delete.");
        return;
    }
    const confirmed = confirm(
        `Permanently delete ${profile.name} and this patient's baseline, records, reports, history, and telemetry? This cannot be undone.`
    );
    if (!confirmed) return;

    const button = $("deletePatientBtn");
    if (button) button.disabled = true;
    try {
        if (!window.PsycheScanBackend?.deleteProfile) {
            throw new Error("Patient deletion is unavailable until the authenticated server is ready.");
        }
        await window.PsycheScanBackend.deleteProfile(profile.profileId);

        const deletedProfileId = profile.profileId;
        state.profiles = state.profiles.filter(item => item.profileId !== deletedProfileId);
        state.records = state.records.filter(item => item.profileId !== deletedProfileId);
        state.reports = state.reports.filter(item => item.profileId !== deletedProfileId);
        state.history = state.history.filter(item => item.profileId !== deletedProfileId);
        if (state.session.baselineTimer) clearTimeout(state.session.baselineTimer);
        state.session.baselineTimer = null;
        state.session.baselineCaptureActive = false;
        state.session.baselineEndsAt = 0;
        state.session.baselineError = "";
        state.session.baselineSummary = null;
        state.session.baselineCompletedAt = 0;
        state.session.profileId = null;
        state.session.profileName = "";
        state.session.id = null;
        state.session.startedAt = 0;
        state.session.firstReadingAt = 0;
        state.session.phase = "baseline";
        state.session.lstmPrediction = null;
        state.activeProfileId = null;
        state.activeProfileTabId = null;
        if (state.settings.participantId === profile.name) delete state.settings.participantId;
        if ($("profileNameInput")) $("profileNameInput").value = "";
        clearSensorReadings();
        resetFaceState();
        persistCollections();
        persistBaselineSession();
        renderProfiles();
        renderAll();
        updateCharts();
        renderBaselineWorkflow();
        alert(`${profile.name} and its linked data were deleted.`);
    } catch (error) {
        console.error("Could not delete patient profile", error);
        alert(`Could not delete this patient: ${error.message}`);
    } finally {
        if (button) button.disabled = !state.activeProfileId;
    }
}

/** Show the LSTM level (Minimal/Mild/Moderate/Severe) or why it is not available yet. */
function renderLstmStatus() {
    const prediction = state.session.lstmPrediction;
    const status = state.lstmStatus || { state: "loading" };
    let badgeText;
    let badgeClass;
    let detailText;
    if (prediction) {
        const percent = Math.round(prediction.confidence * 100);
        badgeText = prediction.class.toUpperCase();
        badgeClass = `severity-badge ${getSeverityBadgeClass(prediction.class)}`;
        detailText = `${prediction.class} (${percent}% confidence)`;
    } else if (status.state === "error") {
        badgeText = "UNAVAILABLE";
        badgeClass = "status-badge danger";
        detailText = "Model unavailable; retrying";
    } else if (status.state === "collecting") {
        const required = status.requiredSeconds || PROJECT_CONFIG.lstm.sequenceLength;
        const collected = Math.min(status.collectedSeconds || 0, required);
        badgeText = `${collected}/${required} S`;
        badgeClass = "status-badge muted";
        detailText = `Collecting sensor data (${collected}/${required} s with all four sensors)`;
    } else {
        badgeText = "LOADING";
        badgeClass = "status-badge muted";
        detailText = "Loading model";
    }
    const badge = $("dashboardLstmLevel");
    if (badge) {
        badge.textContent = badgeText;
        badge.className = badgeClass;
    }
    if ($("summaryLstm")) $("summaryLstm").textContent = detailText;
    if ($("lstmStatusText")) {
        const source = prediction?.trainingData === "synthetic" ? " · synthetic-trained model" : "";
        $("lstmStatusText").textContent = detailText + source;
    }
}

function clearLiveReadings() {
    const confirmed = confirm(
        "Clear the current sensor and face readings and the selected patient's visible trend history? A running baseline will be canceled. Saved baselines, records, and reports will remain; new live readings will appear as they arrive."
    );
    if (!confirmed) return;

    if (state.session.baselineTimer) clearTimeout(state.session.baselineTimer);
    if (state.session.baselineCaptureActive) {
        state.session.baselineCaptureActive = false;
        state.session.baselineCompletedAt = Date.now();
        state.session.baselineError = "Baseline capture canceled because live readings were cleared.";
    }
    state.session.baselineTimer = null;
    state.session.baselineEndsAt = 0;
    state.session.lstmPrediction = null;
    state.history = state.activeProfileId
        ? state.history.filter(item => item.profileId !== state.activeProfileId)
        : [];
    state.lastHistorySampleAt = 0;
    state.lastPacketTimestamp = 0;
    state.lastPacketRaw = "—";
    clearSensorReadings();
    resetFaceState();
    if ($("lastPacketTime")) $("lastPacketTime").textContent = "—";
    if ($("lastPacketRaw")) $("lastPacketRaw").textContent = "—";
    state.lstmStatus = { state: "collecting", collectedSeconds: 0, requiredSeconds: PROJECT_CONFIG.lstm.sequenceLength };
    renderLstmStatus();
    renderAll();
    updateCharts();
    renderBaselineWorkflow();
    persistBaselineSession();
}

function formatSensorValue(key, value = getDisplaySensorValue(key)) {
    if (value === null || value === undefined || Number.isNaN(value)) return "--";
    if (key === "hr") return `${Math.round(value)}`;           // Heart rate: whole number
    if (key === "motion") return `${Number(value).toFixed(3)}`; // Motion: 3 decimal places
    if (key === "temp") return `${Number(value).toFixed(1)}`;   // Temperature: 1 decimal
    return `${Number(value).toFixed(2)}`;                       // GSR: 2 decimals
}

function updateSensorPresence() {
    const now = Date.now();
    const online = anyTransportConnected();
    Object.entries(state.sensors).forEach(([sensorId, sensor]) => {
        if (sensor.lastSeen && now - sensor.lastSeen <= PROJECT_CONFIG.runtime.sensorFreshnessMs) {
            if (sensor.state !== "demo") sensor.state = "connected";
            sensor.connected = true;
            return;
        }
        const valueKey = PROJECT_CONFIG.sensors[sensorId].key;
        state.sensorValues[valueKey] = null;
        state.sensorContact[valueKey] = false;
        if (sensorId === "ds18b20") state.sensorValues.tempDrop = null;
        if (state.settings.demoSensors && !online) {
            sensor.connected = true;
            sensor.state = "demo";
            return;
        }
        if (online) {
            sensor.connected = false;
            sensor.state = "searching";
            return;
        }
        sensor.connected = false;
        sensor.state = "disconnected";
    });
}

function getResolvedAppearance() {
    if (state.settings.appearance === "auto" && window.matchMedia) {
        return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    }
    return state.settings.appearance || "light";
}

function bindAppearanceWatcher() {
    if (state.appearanceWatcherBound || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
        if (state.settings.appearance === "auto") {
            applyThemeSettings();
            if (typeof buildCharts === "function") buildCharts();
        }
    };
    if (mq.addEventListener) mq.addEventListener("change", onChange);
    else if (mq.addListener) mq.addListener(onChange);
    state.appearanceWatcherBound = true;
}

function applyThemeSettings() {
    bindAppearanceWatcher();
    document.body.dataset.theme = state.settings.theme;
    document.body.dataset.appearance = getResolvedAppearance();
    const pairs = [
        ["themeSelect", state.settings.theme],
        ["appearanceSelect", state.settings.appearance || "light"],
        ["detectionIntervalSelect", String(state.settings.detectionInterval)],
        ["detectorSizeSelect", String(state.settings.detectorInputSize)],
        ["smoothingSelect", String(state.settings.smoothingFactor)],
        ["detectionProfileSelect", state.settings.detectionProfile || "phone-strong"],
        ["modelSourceSelect", state.settings.modelSource || "remote"],
        ["cameraFacingSelect", state.settings.cameraFacing || "auto"],
        ["settingsObservationDurationSelect", String(state.settings.observationDurationSec || 180)],
        ["settingsFirstReadingDelaySelect", String(state.settings.firstReadingDelaySec || 0)],
        ["settingsCustomObservationMinutes", String(Math.round((Number(state.settings.customDurationSec) || 180) / 60))],
        ["dashboardDetectionInterval", String(state.settings.detectionInterval || 160)],
        ["dashboardDetectorSize", String(state.settings.detectorInputSize || 512)],
        ["dashboardDetectionProfile", state.settings.detectionProfile || "phone-strong"],
        ["dashboardSmoothing", String(state.settings.smoothingFactor || 0.4)],
        ["dashboardObservationDuration", String(state.settings.observationDurationSec || 180)],
        ["dashboardFirstReadingDelay", String(state.settings.firstReadingDelaySec || 0)],
        ["dashboardConnectionMode", state.settings.connectionMode && state.settings.connectionMode !== "demo" ? state.settings.connectionMode : "serial"],
        ["connectionModeSelect", state.settings.connectionMode && state.settings.connectionMode !== "demo" ? state.settings.connectionMode : "serial"],
        ["samplingIntervalSelect", String(state.settings.samplingIntervalMs || 1000)],
        ["wsUrlInput", state.settings.wsUrl || getWebSocketUrl()],
        ["bleServiceUuidInput", (state.settings.bleServiceUuid || PROJECT_CONFIG.hardware.bleServiceUuid).toLowerCase()],
        ["bleCharacteristicUuidInput", (state.settings.bleCharacteristicUuid || PROJECT_CONFIG.hardware.bleCharacteristicUuid).toLowerCase()]
    ];
    pairs.forEach(([id, val]) => {
        $(id) && ($(id).value = val);
    });
    if ($("mirrorCameraToggle")) $("mirrorCameraToggle").checked = !!state.settings.mirrorCamera;
    if ($("showLandmarksToggle")) $("showLandmarksToggle").checked = !!state.settings.showLandmarks;
    if ($("autoCaptureToggle")) $("autoCaptureToggle").checked = !!state.settings.autoCapture;
    if ($("demoSensorsToggle")) $("demoSensorsToggle").checked = !!state.settings.demoSensors;
    if ($("dashboardAutoCapture")) $("dashboardAutoCapture").checked = !!state.settings.autoCapture;
    if ($("dashboardDemoSensors")) $("dashboardDemoSensors").checked = !!state.settings.demoSensors;
    document.querySelectorAll(".camera-video, .camera-overlay").forEach(el => el.classList.toggle("mirrored", !!state.settings.mirrorCamera));
}

function updateStatusPanel() {
    if ($("modelStatusText")) $("modelStatusText").textContent = state.modelsLoaded ? `Loaded (${state.modelDetector.toUpperCase()})` : "Not loaded";
    if ($("cameraStatusText")) $("cameraStatusText").textContent = state.cameraActive ? "Active" : "Inactive";
    if ($("serialStatusText")) $("serialStatusText").textContent = state.serialConnected ? "Connected" : "Disconnected";
    if ($("bleStatusText")) $("bleStatusText").textContent = state.bleConnected ? "Connected" : "Disconnected";
    if ($("wsStatusText")) $("wsStatusText").textContent = state.wsConnected ? "Connected" : "Disconnected";
    if ($("storageStatusText")) $("storageStatusText").textContent = `${state.records.length} records · ${state.reports.length} reports`;
    if ($("loggedInUserText")) $("loggedInUserText").textContent = state.loggedInUser;
    if ($("dashboardWindowBadge")) $("dashboardWindowBadge").textContent = `${Math.round(getObservationDurationSec() / 60)} MIN WINDOW`;
}

function renderLiveStatCards() {
    const baseline = state.session.baselineSummary || {};
    // Display values hold the last valid reading so cards don't blank out between packets.
    const shown = {
        hr: getDisplaySensorValue("hr"),
        gsr: getDisplaySensorValue("gsr"),
        temp: getDisplaySensorValue("temp"),
        motion: getDisplaySensorValue("motion")
    };
    const hr = formatSeverityValue("hr", shown.hr, baseline.hr);
    const gsr = formatSeverityValue("gsr", shown.gsr, baseline.gsr);
    const temp = formatSeverityValue("temp", shown.temp, baseline.temp);
    const motion = formatSeverityValue("motion", shown.motion, baseline.motion);

    if ($("liveHr")) $("liveHr").innerHTML = shown.hr !== null ? `${hr.text}${getSeverityBadgeMarkup(hr.label, "compact")}` : "--";
    if ($("liveGsr")) $("liveGsr").innerHTML = shown.gsr !== null ? `${gsr.text}${getSeverityBadgeMarkup(gsr.label, "compact")}` : "--";
    if ($("liveTemp")) $("liveTemp").innerHTML = shown.temp !== null ? `${temp.text}${getSeverityBadgeMarkup(temp.label, "compact")}` : "--";
    if ($("liveMotion")) $("liveMotion").innerHTML = shown.motion !== null ? `${motion.text}${getSeverityBadgeMarkup(motion.label, "compact")}` : "--";
    if ($("eyebagScore")) $("eyebagScore").textContent = getSeverityLabelFromPercent(state.visualFatigue.eyebag);
    if ($("wrinkleScore")) $("wrinkleScore").textContent = getSeverityLabelFromPercent(state.visualFatigue.wrinkle);
    if ($("fatigueScore")) $("fatigueScore").textContent = getSeverityLabelFromPercent(state.visualFatigue.fatigue);
    if ($("dashboardFatigueScore")) $("dashboardFatigueScore").textContent = getSeverityLabelFromPercent(state.visualFatigue.fatigue);
    if ($("dashboardWrinkleScore")) $("dashboardWrinkleScore").textContent = getSeverityLabelFromPercent(state.visualFatigue.wrinkle);
    if ($("dashboardEyebagScore")) $("dashboardEyebagScore").textContent = getSeverityLabelFromPercent(state.visualFatigue.eyebag);

    if ($("dashboardHrValue")) $("dashboardHrValue").textContent = shown.hr !== null ? `${formatSensorValue("hr", shown.hr)} bpm` : "--";
    if ($("dashboardGsrValue")) $("dashboardGsrValue").textContent = shown.gsr !== null ? `${formatSensorValue("gsr", shown.gsr)} µS` : "--";
    if ($("dashboardTempValue")) $("dashboardTempValue").textContent = shown.temp !== null ? `${formatSensorValue("temp", shown.temp)} °C` : "--";
    if ($("dashboardMotionValue")) $("dashboardMotionValue").textContent = shown.motion !== null ? `${formatSensorValue("motion", shown.motion)} g` : "--";

    [
      ["dashboardHrSeverity", hr.label],
      ["dashboardGsrSeverity", gsr.label],
      ["dashboardTempSeverity", temp.label],
      ["dashboardMotionSeverity", motion.label]
    ].forEach(([id, label]) => {
      const el = $(id);
      if (!el) return;
      el.textContent = label;
      el.className = `severity-badge ${getSeverityBadgeClass(label)}`;
    });
}

function captureRecord(force = false) {
    const now = Date.now();
    const profile = state.profiles.find(item => item.profileId === state.activeProfileId);
    if (!profile || isWithinFirstReadingDelay()) return;
    if (!force && !state.settings.autoCapture) return;
    if (!force && now - state.lastCaptureAt < PROJECT_CONFIG.runtime.autoCaptureCooldownMs) return;
    if (!force && state.dominantConfidence < PROJECT_CONFIG.runtime.autoCaptureConfidenceMin && getConnectedSensorCount() === 0) return;
    const assessment = computeAssessment();
    state.lastCaptureAt = now;
    const readings = getHeldSensorSnapshot();
    const record = {
        recordId: createProfileId(),
        sessionId: state.session.id,
        profileId: profile.profileId,
        profileName: profile.name,
        source: state.settings.demoSensors ? "demo" : "live",
        quality: assessment.connectedSensors === 4 ? "complete" : "partial",
        timestamp: new Date().toLocaleString(),
        emotion: state.dominantEmotion,
        confidence: state.dominantConfidence,
        hr: readings.values.hr,
        gsr: readings.values.gsr,
        temp: readings.values.temp,
        motion: readings.values.motion,
        heldSensors: readings.heldSensors,
        eyebag: Math.round(state.visualFatigue.eyebag),
        wrinkle: Math.round(state.visualFatigue.wrinkle),
        fatigue: Math.round(state.visualFatigue.fatigue),
        integratedScore: assessment.integratedScore,
        decision: assessment.decision,
        decisionClass: assessment.decisionClass,
        connectedSensors: assessment.connectedSensors,
        narrative: assessment.level === "Severe" ? "Elevated integrated evidence detected." : assessment.level === "Moderate" ? "Monitor the participant because current evidence is above baseline." : assessment.level === "Mild" ? "Slight elevation; continue observation." : "No significant concern visible from the current snapshot."
    };
    if (window.PsycheScanBackend) window.PsycheScanBackend.persistTelemetry({ kind: "record", payload: record });
    state.records.unshift(record);
    state.reports.unshift({
        reportId: createProfileId(),
        profileId: profile.profileId,
        profileName: profile.name,
        timestamp: record.timestamp,
        emotion: record.emotion,
        integratedScore: record.integratedScore,
        decision: record.decision,
        decisionClass: record.decisionClass,
    });
    if (state.records.length > 240) state.records.pop();
    if (state.reports.length > 240) state.reports.pop();
    persistCollections();
    renderInputRecords();
    renderReports();
    // Rows in the patient profile modal link to records by array index, and the
    // unshift above shifts every index, so re-render it whenever it is open too.
    if (state.page === "profiles" || $("patientProfileModal")?.classList.contains("show")) renderProfiles();
    updateStatusPanel();
}

function renderInputRecords() {
    const rows = state.records.map((r, i) => `<tr data-record-index="${i}">
        <td>${escapeHtml(r.timestamp)}</td>
        <td>${escapeHtml(r.emotion)}</td>
        <td>${escapeHtml(r.confidence)}%</td>
        <td>${escapeHtml(r.hr ?? "--")}</td>
        <td>${escapeHtml(r.gsr ?? "--")}</td>
        <td>${escapeHtml(r.temp ?? "--")}</td>
        <td>${escapeHtml(r.motion ?? "--")}</td>
        <td>${escapeHtml(r.eyebag)}%</td>
        <td>${escapeHtml(r.wrinkle)}%</td>
        <td>${escapeHtml(r.fatigue)}%</td>
        <td><span class="badge ${getSeverityBadgeClass(r.decision)}">${escapeHtml(r.decision)}</span></td>
    </tr>`).join("");
    if ($("inputTableBody")) $("inputTableBody").innerHTML = rows;
    if ($("recordCountBadge")) $("recordCountBadge").textContent = `${state.records.length} Records`;
}

function renderReports() {
    if ($("reportCountBadge")) $("reportCountBadge").textContent = `${state.reports.length} Records`;
    if ($("reportTableBody")) $("reportTableBody").innerHTML = state.reports.map(r => `<tr>
        <td>${escapeHtml(r.timestamp)}</td>
        <td>${escapeHtml(r.emotion)}</td>
        <td>${escapeHtml(r.integratedScore)}</td>
        <td><span class="badge ${getSeverityBadgeClass(r.decision)}">${escapeHtml(r.decision)}</span></td>
        <td>${escapeHtml(r.profileName || r.participantId || "—")}</td>
    </tr>`).join("");

    const reportInputs = $("reportInputTableBody");
    if (reportInputs) {
        reportInputs.innerHTML = state.records.map((record, index) => `
            <tr data-record-index="${index}">
                <td>${escapeHtml(record.timestamp)}</td>
                <td>${escapeHtml(record.emotion)}</td>
                <td>${escapeHtml(record.confidence)}%</td>
                <td>${escapeHtml(record.hr ?? "--")}</td>
                <td>${escapeHtml(record.gsr ?? "--")}</td>
                <td>${escapeHtml(record.temp ?? "--")}</td>
                <td>${escapeHtml(record.motion ?? "--")}</td>
                <td>${escapeHtml(record.eyebag ?? "--")}</td>
                <td>${escapeHtml(record.wrinkle ?? "--")}</td>
                <td>${escapeHtml(record.fatigue ?? "--")}</td>
                <td><span class="badge ${getSeverityBadgeClass(record.decision)}">${escapeHtml(record.decision)}</span></td>
            </tr>
        `).join("");
    }
}

function openRecordModal(index) {
    const r = state.records[index];
    if (!r || !$("recordDetailGrid")) return;
    $("recordDetailGrid").innerHTML = Object.entries({
        Timestamp: r.timestamp,
        "Patient profile": r.profileName || state.profiles.find(profile => profile.profileId === r.profileId)?.name || r.participantId || "—",
        Emotion: `${r.emotion} (${r.confidence}%)`,
        "Integrated score": `${r.integratedScore}/100`,
        Decision: r.decision,
        "Heart rate": r.hr ?? "--",
        GSR: r.gsr ?? "--",
        Temperature: r.temp ?? "--",
        Motion: r.motion ?? "--",
        "Eyebag score": `${r.eyebag}%`,
        "Wrinkle score": `${r.wrinkle}%`,
        "Fatigue score": `${r.fatigue}%`,
        Narrative: r.narrative
    }).map(([k, v]) => `<div class="record-detail-item"><span>${escapeHtml(k)}</span><strong>${escapeHtml(v)}</strong></div>`).join("");
    if ($("recordModal")) {
        $("recordModal").classList.add("show");
        $("recordModal").setAttribute("aria-hidden", "false");
    }
}

function bindReports() {
    if ($("exportCsvBtn")) $("exportCsvBtn").addEventListener("click", exportCsv);
    if ($("savePdfBtn")) $("savePdfBtn").addEventListener("click", savePdf);
    if ($("clearReportsBtn")) $("clearReportsBtn").addEventListener("click", () => {
        state.records = [];
        state.reports = [];
        persistCollections();
        renderInputRecords();
        renderReports();
        updateStatusPanel();
    });

    const toggleButton = $("toggleDataInputsBtn");
    const modal = $("reportInputsModal");
    const closeButton = $("closeReportInputsModalBtn");
    if (toggleButton && modal && closeButton) {
        const closeDataInputs = () => {
            modal.classList.remove("show");
            modal.setAttribute("aria-hidden", "true");
            toggleButton.focus();
        };
        const openDataInputs = () => {
            modal.classList.add("show");
            modal.setAttribute("aria-hidden", "false");
            closeButton.focus();
        };
        toggleButton.addEventListener("click", openDataInputs);
        closeButton.addEventListener("click", closeDataInputs);
        modal.addEventListener("click", event => {
            if (event.target === modal) closeDataInputs();
        });
        document.addEventListener("keydown", event => {
            if (event.key === "Escape" && modal.classList.contains("show")) closeDataInputs();
        });
        modal.addEventListener("click", event => {
            const row = event.target.closest("tr[data-record-index]");
            if (!row) return;
            closeDataInputs();
            openRecordModal(Number(row.dataset.recordIndex));
        });
    }
}

function closePatientManagementModal() {
    const modal = $("patientManagementModal");
    const openButton = $("openPatientManagementBtn");
    if (!modal) return;
    modal.classList.remove("show");
    modal.setAttribute("aria-hidden", "true");
    openButton?.focus();
}

function openPatientProfileModal() {
    const modal = $("patientProfileModal");
    const closeButton = $("closePatientProfileModalBtn");
    if (!modal) return;
    patientProfileReturnFocus = document.activeElement;
    renderProfiles();
    modal.classList.add("show");
    modal.setAttribute("aria-hidden", "false");
    closeButton?.focus();
}

function closePatientProfileModal() {
    const modal = $("patientProfileModal");
    if (!modal) return;
    modal.classList.remove("show");
    modal.setAttribute("aria-hidden", "true");
    if (patientProfileReturnFocus instanceof HTMLElement && document.contains(patientProfileReturnFocus)) {
        patientProfileReturnFocus.focus();
    } else {
        $("sidebarNav")?.querySelector('[data-page="profiles"]')?.focus();
    }
    patientProfileReturnFocus = null;
}

function bindPatientManagementModal() {
    const openButton = $("openPatientManagementBtn");
    const modal = $("patientManagementModal");
    const closeButton = $("closePatientManagementModalBtn");
    if (!openButton || !modal || !closeButton) return;

    const closeModal = closePatientManagementModal;
    openButton.addEventListener("click", () => {
        modal.classList.add("show");
        modal.setAttribute("aria-hidden", "false");
        closeButton.focus();
    });
    closeButton.addEventListener("click", closeModal);
    modal.addEventListener("click", event => {
        if (event.target === modal) closeModal();
    });
    document.addEventListener("keydown", event => {
        if (event.key === "Escape" && modal.classList.contains("show")) closeModal();
    });
}

function exportPatientCsv() {
    const profile = state.profiles.find(item => item.profileId === (state.activeProfileTabId || state.activeProfileId));
    if (!profile) {
        alert("Please select a patient profile to download.");
        return;
    }
    const patientRecords = state.records.filter(record => record.profileId === profile.profileId);
    if (!patientRecords.length) {
        alert(`No captured records found for patient "${profile.name}".`);
        return;
    }

    const headers = [
        "timestamp",
        "patientName",
        "profileId",
        "emotion",
        "confidence",
        "hr",
        "gsr",
        "temp",
        "motion",
        "eyebag",
        "wrinkle",
        "fatigue",
        "integratedScore",
        "decision"
    ];

    const csvCell = value => {
        let text = String(value ?? "");
        if (typeof value === "string" && /^[\t\r\n ]*[=+\-@]/.test(value)) text = `'${text}`;
        return `"${text.replace(/"/g, '""')}"`;
    };

    const lines = [
        headers.map(csvCell).join(","),
        ...patientRecords.map(record => [
            csvCell(record.timestamp),
            csvCell(profile.name),
            csvCell(profile.profileId),
            csvCell(record.emotion),
            csvCell(record.confidence ?? ""),
            csvCell(record.hr ?? ""),
            csvCell(record.gsr ?? ""),
            csvCell(record.temp ?? ""),
            csvCell(record.motion ?? ""),
            csvCell(record.eyebag ?? ""),
            csvCell(record.wrinkle ?? ""),
            csvCell(record.fatigue ?? ""),
            csvCell(record.integratedScore ?? ""),
            csvCell(record.decision ?? "")
        ].join(","))
    ];

    const blob = new Blob([`\uFEFF${lines.join("\r\n")}`], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const safeName = profile.name.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "_");
    a.href = url;
    a.download = `patient_${safeName}_records.csv`;
    a.click();
    URL.revokeObjectURL(url);
}
window.exportPatientCsv = exportPatientCsv;

function bindBaselineToggle() {
    const btn = $("toggleBaselineCardBtn");
    const card = document.querySelector(".dashboard-baseline-card");
    if (!btn || !card) return;

    const setCollapsed = (collapsed) => {
        card.classList.toggle("collapsed", collapsed);
        const text = $("baselineToggleText");
        const icon = $("baselineToggleIcon");
        if (text) text.textContent = collapsed ? "Show Baseline" : "Hide Baseline";
        if (icon) {
            icon.setAttribute("data-lucide", collapsed ? "chevron-down" : "chevron-up");
            if (window.lucide) lucide.createIcons({ root: btn });
        }
        try {
            localStorage.setItem("psychescan_baseline_collapsed", collapsed ? "1" : "0");
        } catch (e) {
            console.warn("Could not save baseline preference", e);
        }
    };

    try {
        const saved = localStorage.getItem("psychescan_baseline_collapsed");
        if (saved === "1") setCollapsed(true);
    } catch (e) {
        // ignore
    }

    btn.addEventListener("click", () => {
        const isCollapsed = card.classList.contains("collapsed");
        setCollapsed(!isCollapsed);
    });
}
window.bindBaselineToggle = bindBaselineToggle;

function bindPatientProfileModal() {
    const modal = $("patientProfileModal");
    const closeButton = $("closePatientProfileModalBtn");
    const exportButton = $("exportPatientCsvBtn");
    if (!modal || !closeButton) return;
    closeButton.addEventListener("click", closePatientProfileModal);
    if (exportButton) {
        exportButton.addEventListener("click", exportPatientCsv);
    }
    modal.addEventListener("click", event => {
        if (event.target === modal) closePatientProfileModal();
    });
    document.addEventListener("keydown", event => {
        if (event.key === "Escape" && modal.classList.contains("show")) closePatientProfileModal();
    });
}

async function populateCameraDevices() {
    if (!navigator.mediaDevices?.enumerateDevices || !$("cameraDeviceSelect")) return;
    try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const cams = devices.filter(d => d.kind === "videoinput");
        const select = $("cameraDeviceSelect");
        select.replaceChildren(new Option("Auto / Default camera", "auto"));
        cams.forEach((device, index) => {
            const option = new Option(device.label || `Camera ${index + 1}`, device.deviceId);
            select.add(option);
        });
        if (state.settings.cameraDeviceId && state.settings.cameraDeviceId !== "auto") select.value = state.settings.cameraDeviceId;
    } catch (e) {
        console.warn(e);
    }
}

function bindSettings() {
    if ($("saveSettingsBtn")) $("saveSettingsBtn").addEventListener("click", async () => {
        state.settings.theme = $("themeSelect")?.value || state.settings.theme;
        state.settings.appearance = $("appearanceSelect")?.value || state.settings.appearance || "light";
        state.settings.cameraDeviceId = $("cameraDeviceSelect")?.value || "auto";
        state.settings.cameraFacing = $("cameraFacingSelect")?.value || "auto";
        state.settings.mirrorCamera = !!$("mirrorCameraToggle")?.checked;
        state.settings.showLandmarks = !!$("showLandmarksToggle")?.checked;
        state.settings.detectionInterval = Number($("detectionIntervalSelect")?.value || 160);
        state.settings.detectorInputSize = Number($("detectorSizeSelect")?.value || 512);
        state.settings.detectionProfile = $("detectionProfileSelect")?.value || "phone-strong";
        state.settings.modelSource = $("modelSourceSelect")?.value || "remote";
        state.settings.smoothingFactor = Number($("smoothingSelect")?.value || 0.4);
        state.settings.observationDurationSec = $("settingsObservationDurationSelect")?.value || "180";
        state.settings.customDurationSec = Math.round(Number($("settingsCustomObservationMinutes")?.value || 3) * 60);
        state.settings.firstReadingDelaySec = Number($("settingsFirstReadingDelaySelect")?.value || 0);
        state.settings.connectionMode = $("connectionModeSelect")?.value || "serial";
        state.settings.samplingIntervalMs = Number($("samplingIntervalSelect")?.value || 1000);
        state.settings.autoCapture = !!$("autoCaptureToggle")?.checked;
        state.settings.wsUrl = $("wsUrlInput")?.value?.trim() || getWebSocketUrl();
        state.settings.bleServiceUuid = ($("bleServiceUuidInput")?.value?.trim() || "6e400001-b5a3-f393-e0a9-e50e24dcca9e").toLowerCase();
        state.settings.bleCharacteristicUuid = ($("bleCharacteristicUuidInput")?.value?.trim() || "6e400003-b5a3-f393-e0a9-e50e24dcca9e").toLowerCase();
        saveSettings();
        persistCollections();
        applyThemeSettings();
        renderAll();
        buildCharts();
        updateStatusPanel();
        if (state.cameraActive) restartDetectionLoop();
        if ($("systemStatus")) $("systemStatus").textContent = "Settings Saved";
        await populateCameraDevices();
    });
    
    if ($("resetSettingsBtn")) $("resetSettingsBtn").addEventListener("click", async () => {
        state.settings = {
            ...state.settings,
            theme: "royal-violet",
            appearance: "light",
            mirrorCamera: true,
            showLandmarks: true,
            detectionInterval: 160,
            detectorInputSize: 512,
            smoothingFactor: 0.4,
            firstReadingDelaySec: 0,
            observationDurationSec: 180,
            customDurationSec: 180,
            connectionMode: "serial",
            samplingIntervalMs: 1000,
            autoCapture: true,
            demoSensors: false,
            detectionProfile: "phone-strong",
            modelSource: "remote",
            cameraDeviceId: "auto",
            cameraFacing: "auto",
            wsUrl: getWebSocketUrl(),
            bleServiceUuid: PROJECT_CONFIG.hardware.bleServiceUuid,
            bleCharacteristicUuid: PROJECT_CONFIG.hardware.bleCharacteristicUuid
        };
        saveSettings();
        applyThemeSettings();
        renderAll();
        buildCharts();
        updateStatusPanel();
        if (state.cameraActive) restartDetectionLoop();
        if ($("systemStatus")) $("systemStatus").textContent = "Settings Reset";
        await populateCameraDevices();
    });

    ["wsUrlInput", "bleServiceUuidInput", "bleCharacteristicUuidInput"].forEach(id => {
        const control = $(id);
        if (!control || control.dataset.transportSettingBound) return;
        control.dataset.transportSettingBound = "1";
        control.addEventListener("change", () => {
            if (id === "wsUrlInput") {
                state.settings.wsUrl = control.value.trim() || getWebSocketUrl();
            } else if (id === "bleServiceUuidInput") {
                state.settings.bleServiceUuid = control.value.trim().toLowerCase();
            } else {
                state.settings.bleCharacteristicUuid = control.value.trim().toLowerCase();
            }
            saveSettings();
        });
    });

    ["settingsObservationDurationSelect", "settingsFirstReadingDelaySelect", "settingsCustomObservationMinutes"].forEach(id => {
        const control = $(id);
        if (!control || control.dataset.sessionBound) return;
        control.dataset.sessionBound = "1";
        control.addEventListener("change", () => {
            if (id === "settingsObservationDurationSelect") {
                state.settings.observationDurationSec = control.value;
            } else if (id === "settingsCustomObservationMinutes") {
                state.settings.customDurationSec = Math.round(Number(control.value || 3) * 60);
            } else {
                state.settings.firstReadingDelaySec = Number(control.value || 0);
            }
            saveSettings();
            buildCharts();
            updateStatusPanel();
        });
    });

    const dashboardBindings = [
        ["dashboardDetectionInterval", "detectionInterval", value => Number(value)],
        ["dashboardDetectorSize", "detectorInputSize", value => Number(value)],
        ["dashboardDetectionProfile", "detectionProfile", value => value],
        ["dashboardSmoothing", "smoothingFactor", value => Number(value)],
        ["dashboardObservationDuration", "observationDurationSec", value => value],
        ["dashboardFirstReadingDelay", "firstReadingDelaySec", value => Number(value)],
        ["dashboardConnectionMode", "connectionMode", value => value]
    ];
    dashboardBindings.forEach(([id, key, convert]) => {
        const control = $(id);
        if (!control || control.dataset.dashboardBound) return;
        control.dataset.dashboardBound = "1";
        control.addEventListener("change", () => {
            state.settings[key] = convert(control.value);
            saveSettings();
            applyThemeSettings();
            if (key === "detectionInterval" || key === "detectorInputSize" || key === "detectionProfile" || key === "smoothingFactor") {
                if (state.cameraActive) restartDetectionLoop();
            }
            if (key === "observationDurationSec") buildCharts();
            updateStatusPanel();
        });
    });

    [["dashboardAutoCapture", "autoCapture"], ["dashboardDemoSensors", "demoSensors"]].forEach(([id, key]) => {
        const control = $(id);
        if (!control || control.dataset.dashboardBound) return;
        control.dataset.dashboardBound = "1";
        control.addEventListener("change", () => {
            state.settings[key] = control.checked;
            saveSettings();
            applyThemeSettings();
            renderAll();
        });
    });
}

async function loadModels() {
    if (!window.faceapi) {
        if ($("modelStatusText")) $("modelStatusText").textContent = "face-api missing";
        return;
    }
    const remote = "https://justadudewhohacks.github.io/face-api.js/models";
    const bases = state.settings.modelSource === "local" ? ["./models", remote] : [remote, "./models"];
    state.modelsLoaded = false;
    state.modelDetector = "tiny";
    for (const base of bases) {
        try {
            if ($("modelStatusText")) $("modelStatusText").textContent = `Loading from ${base === "./models" ? "local" : "remote"}...`;
            await faceapi.nets.tinyFaceDetector.loadFromUri(base);
            await faceapi.nets.faceLandmark68Net.loadFromUri(base);
            await faceapi.nets.faceExpressionNet.loadFromUri(base);
            if (["strong", "phone-strong"].includes(state.settings.detectionProfile || "")) {
                try {
                    await faceapi.nets.ssdMobilenetv1.loadFromUri(base);
                    state.modelDetector = "ssd";
                } catch (e) {
                    state.modelDetector = "tiny";
                }
            }
            state.modelsLoaded = true;
            if ($("modelStatusText")) $("modelStatusText").textContent = `Loaded (${state.modelDetector.toUpperCase()})`;
            if ($("systemStatus")) $("systemStatus").textContent = "Models Ready";
            return;
        } catch (e) {
            console.warn(e);
        }
    }
    if ($("modelStatusText")) $("modelStatusText").textContent = "Load Failed";
    alert("Model files could not be loaded. Keep a models folder beside index.html or use internet for remote loading.");
}

async function startCamera() {
    if (!state.activeProfileId) {
        alert("Select a patient profile before starting monitoring.");
        return;
    }
    try {
        if (!state.modelsLoaded) {
            await loadModels();
            if (!state.modelsLoaded) return;
        }
        if (state.stream) stopCamera(false);
        const video = { width: { ideal: 1280 }, height: { ideal: 720 } };
        if (state.settings.cameraDeviceId && state.settings.cameraDeviceId !== "auto") {
            video.deviceId = { exact: state.settings.cameraDeviceId };
        } else if (state.settings.cameraFacing && state.settings.cameraFacing !== "auto") {
            video.facingMode = { ideal: state.settings.cameraFacing };
        }
        const stream = await navigator.mediaDevices.getUserMedia({ video, audio: false });
        state.stream = stream;
        if ($("video")) $("video").srcObject = stream;
        if ($("liveVideo")) $("liveVideo").srcObject = stream;
        await $("video").play();
        await $("liveVideo").play();
        state.cameraActive = true;
        setStatusChip($("cameraBadge"), "muted", "LIVE");
        setStatusChip($("liveStatusBadge"), "muted", "LIVE");
        if ($("cameraStatusText")) $("cameraStatusText").textContent = "Active";
        if ($("systemStatus")) $("systemStatus").textContent = "Streaming";
        await populateCameraDevices();
        restartDetectionLoop();
    } catch (e) {
        console.error(e);
        state.cameraActive = false;
        setStatusChip($("cameraBadge"), "danger", "ERROR");
        setStatusChip($("liveStatusBadge"), "danger", "ERROR");
        if ($("cameraStatusText")) $("cameraStatusText").textContent = "Unavailable";
        alert("Camera unavailable or permission denied.");
    }
}

async function runDetectionFrame() {
    if (state.detectionFrameActive || !state.cameraActive || !state.modelsLoaded || !$("video").videoWidth) return;
    state.detectionFrameActive = true;
    try {
        const threshold = state.settings.detectionProfile === "standard"
            ? PROJECT_CONFIG.runtime.detectionThresholdStandard
            : PROJECT_CONFIG.runtime.detectionThresholdStrong;
        const options = state.modelDetector === "ssd" 
            ? new faceapi.SsdMobilenetv1Options({ minConfidence: threshold, maxResults: 1 })
            : new faceapi.TinyFaceDetectorOptions({ inputSize: state.settings.detectorInputSize, scoreThreshold: threshold });
        const result = await faceapi.detectSingleFace($("video"), options).withFaceLandmarks().withFaceExpressions();
        drawDetection(result, "overlay", "video");
        drawDetection(result, "liveOverlay", "liveVideo");
        if (!result) {
            if ($("faceCountText")) $("faceCountText").textContent = "0 face";
            if ($("dominantEmotion")) $("dominantEmotion").textContent = "No Face";
            if ($("dominantConfidence")) $("dominantConfidence").textContent = "0%";
            state.dominantEmotion = "No Face";
            state.dominantConfidence = 0;
            state.emotionRaw = { neutral: 0, happy: 0, sad: 0, angry: 0, fearful: 0, disgusted: 0, surprised: 0 };
            state.visualFatigue = { eyebag: 0, wrinkle: 0, fatigue: 0 };
            smoothExpressions(state.emotionRaw);
            renderProbabilities();
            renderLiveStatCards();
            updateMetrics();
            return;
        }
        if ($("faceCountText")) $("faceCountText").textContent = "1 face";
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
        if ($("dominantEmotion")) $("dominantEmotion").textContent = state.dominantEmotion;
        if ($("dominantConfidence")) $("dominantConfidence").textContent = `${state.dominantConfidence}%`;
        const assessment = computeAssessment();
        pushHistory(assessment.integratedScore);
        renderProbabilities();
        renderLiveStatCards();
        updateMetrics();
        captureRecord();
    } catch (e) {
        console.error(e);
    } finally {
        state.detectionFrameActive = false;
    }
}

function normalizePacket(data) {
    if (!data || typeof data !== "object") return {};
    const x = { ...data };
    if (x.eda !== undefined && x.gsr === undefined) x.gsr = x.eda;
    if (x.temperature !== undefined && x.temp === undefined) x.temp = x.temperature;
    if (x.acc !== undefined && x.motion === undefined) x.motion = x.acc;
    if (x.accMag !== undefined && x.motion === undefined) x.motion = x.accMag;
    if (x.pulse !== undefined && x.hr === undefined) x.hr = x.pulse;
    ["hr", "gsr", "temp", "tempDrop", "motion"].forEach(key => {
        if (Object.prototype.hasOwnProperty.call(x, key)) x[key] = normalizeTelemetryNumber(x[key]);
    });
    if (!Object.prototype.hasOwnProperty.call(x, "finger") && x.max30102 === true) x.finger = true;
    if (!Object.prototype.hasOwnProperty.call(x, "gsrSkin") && x.gsrConnected === true) x.gsrSkin = true;
    if (!Object.prototype.hasOwnProperty.call(x, "tempSkin") && x.ds18b20 === true) x.tempSkin = true;
    return x;
}

function isValidSensorValue(key, value) {
    const thresholds = PROJECT_CONFIG.biomarkers[key];
    return Number.isFinite(value) &&
        value >= thresholds.validMin &&
        value <= thresholds.validMax;
}

function applyIncomingPacket(data, raw, source = "serial") {
    if (!data || typeof data !== "object" || Array.isArray(data)) {
        console.warn("Ignored non-object sensor packet");
        return;
    }
    const p = normalizePacket(data);
    state.lastPacketTimestamp = Date.now();
    state.lastPacketRaw = raw;
    if ($("lastPacketTime")) $("lastPacketTime").textContent = humanTime(state.lastPacketTimestamp);
    if ($("lastPacketRaw")) $("lastPacketRaw").textContent = raw;
    const channels = [
        ["hr", "max30102", "finger"],
        ["gsr", "gsr", "gsrSkin"],
        ["temp", "ds18b20", "tempSkin"],
        ["motion", "mpu6050", null]
    ];
    channels.forEach(([key, sensorId, contactKey]) => {
        const contact = contactKey ? p[contactKey] !== false : true;
        if (Object.prototype.hasOwnProperty.call(p, key)) {
            if (isValidSensorValue(key, p[key]) && contact) {
                state.sensorValues[key] = p[key];
                state.sensorContact[key] = true;
                if (key === "motion") recordMotionSample(p[key]);
                markSensorConnected(sensorId);
            } else {
                if (typeof p[key] === "number") console.warn(`Ignored out-of-range ${key} sensor value.`);
                state.sensorValues[key] = null;
                state.sensorContact[key] = false;
            }
        } else if (contactKey && p[contactKey] === false) {
            state.sensorValues[key] = null;
            state.sensorContact[key] = false;
        }
    });
    if (Object.prototype.hasOwnProperty.call(p, "tempDrop")) {
        state.sensorValues.tempDrop = Number.isFinite(p.tempDrop) &&
            p.tempDrop >= 0 &&
            p.tempDrop <= PROJECT_CONFIG.runtime.maxTemperatureDrop
            ? p.tempDrop
            : null;
    } else state.sensorValues.tempDrop = null;
    updateSensorPresence();
    const assessment = computeAssessment();
    pushHistory(assessment.integratedScore);
    renderAll({ tables: false });
    captureRecord();
    if ($("systemStatus")) $("systemStatus").textContent = `${source.toUpperCase()} Packet`;
}

function processPacketChunk(chunk, source = "serial") {
    if (source === "ws") {
        const packet = String(chunk).trim();
        if (!packet) return;
        if (packet.length > PROJECT_CONFIG.runtime.maxSensorLineBytes) {
            console.warn("Discarding an oversized Wi-Fi packet.");
            return;
        }
        try {
            applyIncomingPacket(JSON.parse(packet), packet, source);
        } catch (e) {
            console.warn("Invalid JSON packet", packet, e);
        }
        return;
    }

    const key = source === "ble" ? "bleBuffer" : null;
    let merged = chunk;
    if (key) merged = (state[key] || "") + chunk;
    const maxLineBytes = PROJECT_CONFIG.runtime.maxSensorLineBytes;
    if (key && merged.length > maxLineBytes) {
        console.warn("Discarding an oversized incomplete BLE line.");
        const lastNewline = merged.lastIndexOf("\n");
        merged = lastNewline >= 0 ? merged.slice(lastNewline + 1) : merged.slice(-maxLineBytes);
    }
    const lines = String(merged).split(/\r?\n/);
    const tail = lines.pop();
    if (key) state[key] = tail;
    lines.forEach(line => {
        const t = line.trim();
        if (!t) return;
        try {
            applyIncomingPacket(JSON.parse(t), t, source);
        } catch (e) {
            console.warn("Invalid JSON packet", t, e);
        }
    });
}

function applySerialData(data, raw) {
    applyIncomingPacket(data, raw, "serial");
}

async function connectBle() {
    if (!navigator.bluetooth) {
        alert("Web Bluetooth is not available in this browser.");
        return;
    }
    if (state.bleConnecting || state.bleConnected) return;
    state.bleConnecting = true;
    state.bleBuffer = "";
    try {
        const service = ($("bleServiceUuidInput")?.value?.trim() || state.settings.bleServiceUuid || "6e400001-b5a3-f393-e0a9-e50e24dcca9e").toLowerCase();
        const characteristic = ($("bleCharacteristicUuidInput")?.value?.trim() || state.settings.bleCharacteristicUuid || "6e400003-b5a3-f393-e0a9-e50e24dcca9e").toLowerCase();
        const device = await navigator.bluetooth.requestDevice({ filters: [{ services: [service] }] });
        state.bleDevice = device;
        state.bleDisconnectHandler = () => handleBleDisconnected(device);
        device.addEventListener("gattserverdisconnected", state.bleDisconnectHandler);
        const server = await device.gatt.connect();
        const svc = await server.getPrimaryService(service);
        const chr = await svc.getCharacteristic(characteristic);
        await chr.startNotifications();
        const decoder = new TextDecoder();
        state.bleNotificationHandler = event => {
            processPacketChunk(decoder.decode(event.target.value, { stream: true }), "ble");
        };
        chr.addEventListener("characteristicvaluechanged", state.bleNotificationHandler);
        state.bleServer = server;
        state.bleCharacteristic = chr;
        state.bleConnected = true;
        if ($("bleStatusText")) $("bleStatusText").textContent = "Connected";
        if ($("systemStatus")) $("systemStatus").textContent = "BLE Connected";
        renderAll();
    } catch (e) {
        if (e.name !== "NotFoundError") {
            console.error("Bluetooth connection failed", e);
            alert("Bluetooth connection failed.");
        }
        await disconnectBle();
    } finally {
        state.bleConnecting = false;
    }
}

function handleBleDisconnected(device) {
    if (state.bleDevice !== device) return;
    state.bleBuffer = "";
    if (state.bleCharacteristic && state.bleNotificationHandler) {
        state.bleCharacteristic.removeEventListener("characteristicvaluechanged", state.bleNotificationHandler);
    }
    device.removeEventListener("gattserverdisconnected", state.bleDisconnectHandler);
    state.bleConnected = false;
    state.bleDevice = null;
    state.bleServer = null;
    state.bleCharacteristic = null;
    state.bleNotificationHandler = null;
    state.bleDisconnectHandler = null;
    if (!anyTransportConnected()) clearSensorReadings({ keepLastReadings: true });
    renderAll();
}

async function disconnectBle() {
    const device = state.bleDevice;
    const characteristic = state.bleCharacteristic;
    if (characteristic && state.bleNotificationHandler) {
        characteristic.removeEventListener("characteristicvaluechanged", state.bleNotificationHandler);
    }
    if (device && state.bleDisconnectHandler) {
        device.removeEventListener("gattserverdisconnected", state.bleDisconnectHandler);
    }
    state.bleBuffer = "";
    state.bleConnected = false;
    state.bleDevice = null;
    state.bleServer = null;
    state.bleCharacteristic = null;
    state.bleNotificationHandler = null;
    state.bleDisconnectHandler = null;
    if (device?.gatt?.connected) device.gatt.disconnect();
    if (!anyTransportConnected()) clearSensorReadings({ keepLastReadings: true });
}

function scheduleWsReconnect() {
    if (state.wsManualDisconnect || state.wsReconnectTimer) return;
    const delay = Math.min(30000, 1000 * (2 ** state.wsReconnectAttempt));
    state.wsReconnectAttempt += 1;
    if ($("wsStatusText")) $("wsStatusText").textContent = `Reconnecting in ${Math.ceil(delay / 1000)}s`;
    state.wsReconnectTimer = setTimeout(() => {
        state.wsReconnectTimer = null;
        connectWs(true);
    }, delay);
}

function connectWs(isReconnect = false) {
    try {
        const rawUrl = $("wsUrlInput")?.value?.trim() || state.settings.wsUrl || getWebSocketUrl();
        const urlWithScheme = /^[a-z][a-z\d+.-]*:\/\//i.test(rawUrl) ? rawUrl : `ws://${rawUrl}`;
        let parsedUrl;
        try {
            parsedUrl = new URL(urlWithScheme);
        } catch {
            throw new Error("Enter a valid WebSocket URL, such as ws://192.168.1.100:81.");
        }
        if (!["ws:", "wss:"].includes(parsedUrl.protocol)) {
            throw new Error("WebSocket URL must use ws:// or wss://.");
        }
        const url = parsedUrl.href;
        if (window.location.protocol === "https:" && parsedUrl.protocol === "ws:") {
            if ($("wsStatusText")) $("wsStatusText").textContent = "Blocked: use wss:// on HTTPS";
            if (!isReconnect) alert("This page uses HTTPS, which blocks ws:// connections. Configure a wss:// endpoint.");
            return;
        }
        state.settings.wsUrl = url;
        saveSettings();
        clearTimeout(state.wsReconnectTimer);
        state.wsReconnectTimer = null;
        state.wsManualDisconnect = false;
        if (state.ws) state.ws.close();
        const ws = new WebSocket(url);
        state.ws = ws;
        ws.addEventListener("open", () => {
            if (state.ws !== ws) return;
            state.wsReconnectAttempt = 0;
            state.wsConnected = true;
            if ($("wsStatusText")) $("wsStatusText").textContent = "Connected";
            if ($("systemStatus")) $("systemStatus").textContent = "Wi-Fi Connected";
            renderAll();
        });
        ws.addEventListener("message", event => {
            if (state.ws !== ws) return;
            if (typeof event.data === "string") processPacketChunk(event.data, "ws");
        });
        ws.addEventListener("close", () => {
            if (state.ws !== ws) return;
            state.wsConnected = false;
            if (!anyTransportConnected()) clearSensorReadings({ keepLastReadings: true });
            if ($("wsStatusText")) $("wsStatusText").textContent = "Disconnected";
            renderAll();
            if (!state.wsManualDisconnect) scheduleWsReconnect();
        });
        ws.addEventListener("error", () => {
            if (state.ws !== ws) return;
            state.wsConnected = false;
            if ($("wsStatusText")) $("wsStatusText").textContent = "Connection error";
        });
    } catch (e) {
        console.error("Wi-Fi socket connection failed", e);
        if ($("wsStatusText")) $("wsStatusText").textContent = "Invalid connection URL";
        if (!isReconnect) alert(e.message || "Wi-Fi socket connection failed.");
    }
}

async function disconnectAllTransports() {
    await disconnectSerial();
    await disconnectBle();
    state.wsManualDisconnect = true;
    clearTimeout(state.wsReconnectTimer);
    state.wsReconnectTimer = null;
    const ws = state.ws;
    state.ws = null;
    state.wsConnected = false;
    if (ws) ws.close();
    clearSensorReadings({ keepLastReadings: true });
    renderAll();
}

async function disconnectSerial(portAlreadyDisconnected = false) {
    state.serialKeepReading = false;
    const port = state.serialPort;
    if (state.serialReader) {
        try {
            await state.serialReader.cancel();
        } catch (error) {
            if (!portAlreadyDisconnected) console.warn("Could not cancel the serial read", error);
        }
    }
    if (state.serialReadPromise) {
        await state.serialReadPromise;
        state.serialReadPromise = null;
    }
    if (port) {
        try {
            await port.close();
        } catch (error) {
            if (!portAlreadyDisconnected) console.warn("Could not close the serial port", error);
        }
    }
    state.serialPort = null;
    state.serialConnected = false;
    if (!anyTransportConnected()) clearSensorReadings({ keepLastReadings: true });
    setStatusChip($("serialBadge"), "muted", "DISCONNECTED");
    if ($("serialStatusText")) $("serialStatusText").textContent = "Disconnected";
    Object.values(state.sensors).forEach(sensor => {
        sensor.connected = false;
        sensor.state = state.settings.demoSensors ? "demo" : "disconnected";
    });
    renderAll();
}

// Keeps the graphs and records moving when packets stop (sensor unplugged, no
// contact, or the transport dropped) by adding a sample with the last readings.
// Live packets, face frames, and demo mode add their own samples, so this only
// fills the gaps between them.
function recordHeldSensorSample() {
    if (state.settings.demoSensors && !anyTransportConnected()) return;
    const now = Date.now();
    const interval = Number(state.settings.samplingIntervalMs) || 1000;
    if (state.lastPacketTimestamp && now - state.lastPacketTimestamp < interval * 1.5) return;
    if (state.lastHistorySampleAt && now - state.lastHistorySampleAt < interval) return;
    if (!hasAnyHeldSensorValue()) return;
    updateSensorPresence();
    const assessment = computeAssessment();
    pushHistory(assessment.integratedScore);
    captureRecord();
}

function simulateSensors() {
    if (!state.settings.demoSensors || anyTransportConnected()) return;
    const demo = PROJECT_CONFIG.demo;
    const rand = (min, max) => min + Math.random() * (max - min);
    state.sensorValues.hr = Math.round(rand(demo.hrMin, demo.hrMax));
    state.sensorValues.gsr = Number(rand(demo.gsrMin, demo.gsrMax).toFixed(2));
    state.sensorValues.temp = Number(rand(demo.tempMin, demo.tempMax).toFixed(1));
    const baselineTemp = state.session.baselineSummary?.temp;
    state.sensorValues.tempDrop = Number.isFinite(baselineTemp)
        ? Math.max(0, baselineTemp - state.sensorValues.temp)
        : 0;
    state.sensorValues.motion = Number(rand(demo.motionMin, demo.motionMax).toFixed(3));
    recordMotionSample(state.sensorValues.motion);
    state.sensorContact = { hr: true, gsr: true, temp: true };
    Object.values(state.sensors).forEach(sensor => {
        sensor.connected = true;
        sensor.state = "demo";
        sensor.lastSeen = Date.now();
    });
    state.sensorContact = { hr: true, gsr: true, temp: true, motion: true };
    updateSensorPresence();
    const assessment = computeAssessment();
    pushHistory(assessment.integratedScore);
    renderAll({ tables: false });
    captureRecord();
}

function bindControls() {
    if ($("loadModelsBtn")) $("loadModelsBtn").addEventListener("click", loadModels);
    if ($("startCameraBtn")) $("startCameraBtn").addEventListener("click", startCamera);
    if ($("stopCameraBtn")) $("stopCameraBtn").addEventListener("click", () => stopCamera(true));
    if ($("captureBaselineBtn")) $("captureBaselineBtn").addEventListener("click", startBaselineCapture);
    if ($("addPatientBtn")) $("addPatientBtn").addEventListener("click", addPatientProfile);
    if ($("viewPatientBtn")) $("viewPatientBtn").addEventListener("click", viewActivePatient);
    if ($("updatePatientBtn")) $("updatePatientBtn").addEventListener("click", updateActivePatient);
    if ($("deletePatientBtn")) $("deletePatientBtn").addEventListener("click", deleteActivePatient);
    if ($("clearReadingsBtn")) $("clearReadingsBtn").addEventListener("click", clearLiveReadings);
    if ($("connectSerialBtn")) $("connectSerialBtn").addEventListener("click", connectSerial);
    if ($("connectBleBtn")) $("connectBleBtn").addEventListener("click", connectBle);
    if ($("connectBlePageBtn")) $("connectBlePageBtn").addEventListener("click", connectBle);
    if ($("connectWsBtn")) $("connectWsBtn").addEventListener("click", connectWs);
    if ($("connectWsPageBtn")) $("connectWsPageBtn").addEventListener("click", connectWs);
    if ($("disconnectAllBtn")) $("disconnectAllBtn").addEventListener("click", disconnectAllTransports);
    if ($("disconnectPageBtn")) $("disconnectPageBtn").addEventListener("click", disconnectAllTransports);
    if ($("activeProfileSelect")) {
        $("activeProfileSelect").addEventListener("change", event => {
            if (state.session.baselineCaptureActive) {
                alert("Cancel the current baseline capture before changing patients.");
                event.target.value = state.activeProfileId || "";
                return;
            }
            if (event.target.value) setActiveProfile(event.target.value);
        });
    }
}

function init() {
    loadSettings();
    loadCollections();
    renderProfiles();
    applyThemeSettings();
    initHistory();
    updateClock();
    renderAll();
    buildCharts();
    bindLogin();
    const backend = window.PsycheScanBackend;
    if (backend?.startLocalTestMode) {
        backend.startLocalTestMode().then(localTestMode => {
            if (!localTestMode) return;
            $("loginName").value = "Local Test";
            unlockApp();
        }).catch(error => {
            console.error("Could not start local test mode", error);
            $("loginError").textContent = "Could not check local test mode. Confirm the local server is running, then try again.";
            $("loginError").classList.add("show");
        });
    }
    bindSidebar();
    bindModeButtons();
    bindSettings();
    bindControls();
    if (navigator.serial && !state.serialDisconnectHandler) {
        state.serialDisconnectHandler = event => {
            if (event.target === state.serialPort) disconnectSerial(true);
        };
        navigator.serial.addEventListener("disconnect", state.serialDisconnectHandler);
    }
    bindReports();
    bindPatientManagementModal();
    bindPatientProfileModal();
    bindBaselineToggle();
    window.addEventListener("lstm-prediction", event => {
        state.session.lstmPrediction = event.detail || null;
        renderLstmStatus();
        updateStatusPanel();
    });
    window.addEventListener("lstm-status", event => {
        state.lstmStatus = event.detail || null;
        renderLstmStatus();
    });
    window.addEventListener("lstm-load-error", () => {
        state.lstmStatus = { state: "error" };
        state.session.lstmPrediction = null;
        renderLstmStatus();
    });
    renderLstmStatus();
    bindModal();
    bindInputTable();
    const mainLoopId = setInterval(() => {
        updateClock();
        updateSensorPresence();
        simulateSensors();
        renderSensorGrid("sensorGrid");
        renderLiveStatCards();
        updateMetrics();
        if (typeof renderBaselineWorkflow === "function") renderBaselineWorkflow();
        updateStatusPanel();
    }, 2000);
    const heldSampleLoopId = setInterval(recordHeldSensorSample, 1000);
    // Cleanup on page unload to prevent memory leaks
    window.addEventListener("pagehide", () => {
        clearInterval(mainLoopId);
        clearInterval(heldSampleLoopId);
        if (window.PsycheScanBackend?.state?.telemetryFlushId) {
            clearInterval(window.PsycheScanBackend.state.telemetryFlushId);
        }
    });
    let resizeTimer = null;
    window.addEventListener("resize", () => {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => {
        buildCharts();
        }, 150);
    });
    populateCameraDevices();
    initIcons();
    updateStatusPanel();
}

document.addEventListener("DOMContentLoaded", init, { once: true });