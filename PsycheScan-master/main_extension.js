Object.assign(STORAGE_KEYS, {
    records: "cnn_lstm_records_v3",
    reports: "cnn_lstm_reports_v3",
    participantCounter: "cnn_lstm_participant_counter_v3"
});

Object.assign(state.settings, {
    detectionProfile: "phone-strong",
    modelSource: "remote",
    cameraDeviceId: "auto",
    cameraFacing: "auto",
    wsUrl: PROJECT_CONFIG.hardware.wsUrl,
    bleServiceUuid: PROJECT_CONFIG.hardware.bleServiceUuid,
    bleCharacteristicUuid: PROJECT_CONFIG.hardware.bleCharacteristicUuid
});

Object.assign(state, {
    bleConnected: false,
    bleDevice: null,
    bleServer: null,
    bleCharacteristic: null,
    wsConnected: false,
    ws: null,
    wsBuffer: "",
    bleBuffer: "",
    espStress: null,
    espDataValid: false,
    participantCounter: 0,
    faceSessionActive: false,
    faceLostAt: 0,
    currentParticipantAssigned: false,
    modelDetector: "tiny",
    cameraDevices: [],
    appearanceWatcherBound: false
});

function anyTransportConnected() {
    return !!(state.serialConnected || state.bleConnected || state.wsConnected);
}

function parseParticipantNumber(text) {
    const m = String(text || "").match(/(\d+)/);
    return m ? Math.max(0, Number(m[1]) || 0) : 0;
}

function formatParticipantId(n) {
    return `Participant ID-${String(Math.max(1, Number(n) || 1)).padStart(2, "0")}`;
}

function setParticipantIdFromNumber(n, persist = true) {
    state.participantCounter = Math.max(0, Number(n) || 0);
    state.settings.participantId = state.participantCounter ? formatParticipantId(state.participantCounter) : "Awaiting Face";
    if (persist) {
        saveSettings();
        localStorage.setItem(STORAGE_KEYS.participantCounter, String(state.participantCounter));
    }
}

function maybeAdvanceParticipantForNewSession() {
    if (state.currentParticipantAssigned) return;
    setParticipantIdFromNumber(state.participantCounter + 1);
    state.currentParticipantAssigned = true;
}

function persistCollections() {
    localStorage.setItem(STORAGE_KEYS.records, JSON.stringify(state.records));
    localStorage.setItem(STORAGE_KEYS.reports, JSON.stringify(state.reports));
    localStorage.setItem(STORAGE_KEYS.participantCounter, String(state.participantCounter));
}

function loadCollections() {
    try {
        const rec = localStorage.getItem(STORAGE_KEYS.records);
        const rep = localStorage.getItem(STORAGE_KEYS.reports);
        const ctr = localStorage.getItem(STORAGE_KEYS.participantCounter);
        if (rec) state.records = JSON.parse(rec) || [];
        if (rep) state.reports = JSON.parse(rep) || [];
        state.participantCounter = parseParticipantNumber(ctr);
        state.settings.participantId = state.participantCounter ? formatParticipantId(state.participantCounter) : "Awaiting Face";
    } catch (e) {
        console.warn(e);
    }
}

function formatSensorValue(key) {
    const value = state.sensorValues[key];
    if (value === null || value === undefined || Number.isNaN(value)) return "--";
    if (key === "hr") return `${Math.round(value)}`;           // Heart rate: whole number
    if (key === "motion") return `${Number(value).toFixed(3)}`; // Motion: 3 decimal places
    if (key === "temp") return `${Number(value).toFixed(1)}`;   // Temperature: 1 decimal
    return `${Number(value).toFixed(2)}`;                       // GSR: 2 decimals
}

function updateSensorPresence() {
    const now = Date.now();
    const online = anyTransportConnected();
    Object.values(state.sensors).forEach(sensor => {
        if (sensor.lastSeen && now - sensor.lastSeen <= 6000) {
            if (sensor.state !== "demo") sensor.state = "connected";
            sensor.connected = true;
            return;
        }
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
            if (typeof drawFeatureMap === "function") drawFeatureMap();
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
        ["wsUrlInput", state.settings.wsUrl || PROJECT_CONFIG.hardware.wsUrl],
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
}

function renderLiveStatCards() {
    if ($("liveHr")) $("liveHr").textContent = state.sensorValues.hr !== null ? `${formatSensorValue("hr")} bpm` : "--";
    if ($("liveGsr")) $("liveGsr").textContent = state.sensorValues.gsr !== null ? `${formatSensorValue("gsr")} µS` : "--";
    if ($("liveTemp")) $("liveTemp").textContent = state.sensorValues.temp !== null ? `${formatSensorValue("temp")} °C` : "--";
    if ($("liveMotion")) $("liveMotion").textContent = state.sensorValues.motion !== null ? `${formatSensorValue("motion")}` : "--";
    if ($("eyebagScore")) $("eyebagScore").textContent = safePercent(state.visualFatigue.eyebag);
    if ($("wrinkleScore")) $("wrinkleScore").textContent = safePercent(state.visualFatigue.wrinkle);
    if ($("fatigueScore")) $("fatigueScore").textContent = safePercent(state.visualFatigue.fatigue);
    if ($("cnnEyeIndicator")) $("cnnEyeIndicator").textContent = safePercent(state.visualFatigue.eyebag);
    if ($("cnnWrinkleIndicator")) $("cnnWrinkleIndicator").textContent = safePercent(state.visualFatigue.wrinkle);
    if ($("cnnFatigueIndicator")) $("cnnFatigueIndicator").textContent = safePercent(state.visualFatigue.fatigue);
}

function captureRecord(force = false) {
    const now = Date.now();
    if (!force && !state.settings.autoCapture) return;
    if (!force && now - state.lastCaptureAt < 3000) return;
    if (!force && state.dominantConfidence < 30 && getConnectedSensorCount() === 0) return;
    const assessment = computeAssessment();
    state.lastCaptureAt = now;
    const participantId = state.settings.participantId || "Awaiting Face";
    const record = {
        timestamp: new Date().toLocaleString(),
        participantId,
        emotion: state.dominantEmotion,
        confidence: state.dominantConfidence,
        hr: state.sensorValues.hr,
        gsr: state.sensorValues.gsr,
        temp: state.sensorValues.temp,
        motion: state.sensorValues.motion,
        eyebag: Math.round(state.visualFatigue.eyebag),
        wrinkle: Math.round(state.visualFatigue.wrinkle),
        fatigue: Math.round(state.visualFatigue.fatigue),
        integratedScore: assessment.integratedScore,
        decision: assessment.decision,
        decisionClass: assessment.decisionClass,
        connectedSensors: assessment.connectedSensors,
        narrative: assessment.level === "Severe" ? "Elevated integrated evidence detected." : assessment.level === "Moderate" ? "Monitor the participant because current evidence is above baseline." : assessment.level === "Mild" ? "Slight elevation; continue observation." : "No significant concern visible from the current snapshot."
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
    if (state.records.length > 240) state.records.pop();
    if (state.reports.length > 240) state.reports.pop();
    persistCollections();
    renderInputRecords();
    renderReports();
    updateStatusPanel();
}

function renderInputRecords() {
    const rows = state.records.map((r, i) => `<tr data-record-index="${i}">
        <td>${r.timestamp}</td>
        <td>${r.emotion}</td>
        <td>${r.confidence}%</td>
        <td>${r.hr ?? "--"}</td>
        <td>${r.gsr ?? "--"}</td>
        <td>${r.temp ?? "--"}</td>
        <td>${r.motion ?? "--"}</td>
        <td>${r.eyebag}%</td>
        <td>${r.wrinkle}%</td>
        <td>${r.fatigue}%</td>
        <td><span class="badge ${r.decisionClass}">${r.decision}</span></td>
    </tr>`).join("");
    if ($("inputTableBody")) $("inputTableBody").innerHTML = rows;
    if ($("recordCountBadge")) $("recordCountBadge").textContent = `${state.records.length} Records`;
}

function renderReports() {
    if ($("reportCountBadge")) $("reportCountBadge").textContent = `${state.reports.length} Records`;
    if ($("reportTableBody")) $("reportTableBody").innerHTML = state.reports.map(r => `<tr>
        <td>${r.timestamp}</td>
        <td>${r.emotion}</td>
        <td>${r.integratedScore}</td>
        <td><span class="badge ${r.decisionClass}">${r.decision}</span></td>
        <td>${r.participantId}</td>
    </tr>`).join("");
}

function openRecordModal(index) {
    const r = state.records[index];
    if (!r || !$("recordDetailGrid")) return;
    $("recordDetailGrid").innerHTML = Object.entries({
        Timestamp: r.timestamp,
        Participant: r.participantId,
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
    }).map(([k, v]) => `<div class="record-detail-item"><span>${k}</span><strong>${v}</strong></div>`).join("");
    if ($("recordModal")) $("recordModal").classList.add("show");
}

function bindReports() {
    if ($("exportCsvBtn")) $("exportCsvBtn").addEventListener("click", exportCsv);
    if ($("clearReportsBtn")) $("clearReportsBtn").addEventListener("click", () => {
        state.records = [];
        state.reports = [];
        state.participantCounter = 0;
        state.settings.participantId = "Awaiting Face";
        persistCollections();
        saveSettings();
        renderInputRecords();
        renderReports();
        updateStatusPanel();
    });
}

async function populateCameraDevices() {
    if (!navigator.mediaDevices?.enumerateDevices || !$("cameraDeviceSelect")) return;
    try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const cams = devices.filter(d => d.kind === "videoinput");
        $("cameraDeviceSelect").innerHTML = `<option value="auto">Auto / Default camera</option>` + cams.map((d, i) => `<option value="${d.deviceId}">${d.label || `Camera ${i + 1}`}</option>`).join("");
        if (state.settings.cameraDeviceId && state.settings.cameraDeviceId !== "auto") $("cameraDeviceSelect").value = state.settings.cameraDeviceId;
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
        state.settings.autoCapture = !!$("autoCaptureToggle")?.checked;
        state.settings.demoSensors = !!$("demoSensorsToggle")?.checked;
        state.settings.wsUrl = $("wsUrlInput")?.value?.trim() || PROJECT_CONFIG.hardware.wsUrl;
        state.settings.bleServiceUuid = ($("bleServiceUuidInput")?.value?.trim() || "6e400001-b5a3-f393-e0a9-e50e24dcca9e").toLowerCase();
        state.settings.bleCharacteristicUuid = ($("bleCharacteristicUuidInput")?.value?.trim() || "6e400003-b5a3-f393-e0a9-e50e24dcca9e").toLowerCase();
        saveSettings();
        persistCollections();
        applyThemeSettings();
        renderAll();
        buildCharts();
        drawFeatureMap();
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
            autoCapture: true,
            demoSensors: false,
            detectionProfile: "phone-strong",
            modelSource: "remote",
            cameraDeviceId: "auto",
            cameraFacing: "auto",
            wsUrl: PROJECT_CONFIG.hardware.wsUrl,
            bleServiceUuid: PROJECT_CONFIG.hardware.bleServiceUuid,
            bleCharacteristicUuid: PROJECT_CONFIG.hardware.bleCharacteristicUuid
        };
        saveSettings();
        applyThemeSettings();
        renderAll();
        buildCharts();
        drawFeatureMap();
        updateStatusPanel();
        if (state.cameraActive) restartDetectionLoop();
        if ($("systemStatus")) $("systemStatus").textContent = "Settings Reset";
        await populateCameraDevices();
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

function handleMissingFace() {
    if (!state.faceSessionActive) return;
    if (!state.faceLostAt) state.faceLostAt = Date.now();
    if (Date.now() - state.faceLostAt > 1800) {
        state.faceSessionActive = false;
        state.faceLostAt = 0;
        state.currentParticipantAssigned = false;
    }
}

function handlePresentFace() {
    if (!state.faceSessionActive) {
        maybeAdvanceParticipantForNewSession();
        state.faceSessionActive = true;
        state.faceLostAt = 0;
        updateStatusPanel();
    } else {
        state.faceLostAt = 0;
    }
}

async function runDetectionFrame() {
    if (!state.cameraActive || !state.modelsLoaded || !$("video").videoWidth) return;
    try {
        const threshold = state.settings.detectionProfile === "standard" ? 0.45 : 0.35;
        const options = state.modelDetector === "ssd" 
            ? new faceapi.SsdMobilenetv1Options({ minConfidence: threshold, maxResults: 1 })
            : new faceapi.TinyFaceDetectorOptions({ inputSize: state.settings.detectorInputSize, scoreThreshold: threshold });
        const result = await faceapi.detectSingleFace($("video"), options).withFaceLandmarks().withFaceExpressions();
        drawDetection(result, "overlay", "video");
        drawDetection(result, "liveOverlay", "liveVideo");
        if (!result) {
            handleMissingFace();
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
        handlePresentFace();
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
        drawFeatureMap();
        captureRecord();
    } catch (e) {
        console.error(e);
    }
}

function normalizePacket(data) {
    if (!data || typeof data !== "object") return {};
    const x = { ...data };
    if (typeof x.eda === "number" && typeof x.gsr !== "number") x.gsr = x.eda;
    if (typeof x.temperature === "number" && typeof x.temp !== "number") x.temp = x.temperature;
    if (typeof x.acc === "number" && typeof x.motion !== "number") x.motion = x.acc;
    if (typeof x.accMag === "number" && typeof x.motion !== "number") x.motion = x.accMag;
    if (typeof x.pulse === "number" && typeof x.hr !== "number") x.hr = x.pulse;
    return x;
}

function applyIncomingPacket(data, raw, source = "serial") {
    const p = normalizePacket(data);
    state.lastPacketTimestamp = Date.now();
    state.lastPacketRaw = raw;
    if ($("lastPacketTime")) $("lastPacketTime").textContent = humanTime(state.lastPacketTimestamp);
    if ($("lastPacketRaw")) $("lastPacketRaw").textContent = raw;
    if (typeof p.stress === "string") state.espStress = p.stress;
    if (typeof p.dataValid === "boolean") state.espDataValid = p.dataValid;
    if (typeof p.hr === "number") {
        state.sensorValues.hr = p.hr;
        markSensorConnected("max30102");
    }
    if (typeof p.gsr === "number") {
        state.sensorValues.gsr = p.gsr;
        markSensorConnected("gsr");
    }
    if (typeof p.temp === "number") {
        state.sensorValues.temp = p.temp;
        markSensorConnected("ds18b20");
    }
    if (typeof p.motion === "number") {
        state.sensorValues.motion = p.motion;
        markSensorConnected("mpu6050");
    }
    getSensorIds().forEach(sensorId => {
        if (packetMarksSensorConnected(p, sensorId)) markSensorConnected(sensorId);
    });
    updateSensorPresence();
    const assessment = computeAssessment();
    pushHistory(assessment.integratedScore);
    renderAll();
    captureRecord();
    if ($("systemStatus")) $("systemStatus").textContent = `${source.toUpperCase()} Packet`;
}

function processPacketChunk(chunk, source = "serial") {
    const key = source === "ble" ? "bleBuffer" : source === "ws" ? "wsBuffer" : null;
    let merged = chunk;
    if (key) merged = (state[key] || "") + chunk;
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
    try {
        const service = ($("bleServiceUuidInput")?.value?.trim() || state.settings.bleServiceUuid || "6e400001-b5a3-f393-e0a9-e50e24dcca9e").toLowerCase();
        const characteristic = ($("bleCharacteristicUuidInput")?.value?.trim() || state.settings.bleCharacteristicUuid || "6e400003-b5a3-f393-e0a9-e50e24dcca9e").toLowerCase();
        const device = await navigator.bluetooth.requestDevice({ acceptAllDevices: true, optionalServices: [service] });
        const server = await device.gatt.connect();
        const svc = await server.getPrimaryService(service);
        const chr = await svc.getCharacteristic(characteristic);
        await chr.startNotifications();
        const decoder = new TextDecoder();
        chr.addEventListener("characteristicvaluechanged", event => {
            processPacketChunk(decoder.decode(event.target.value.buffer), "ble");
        });
        state.bleDevice = device;
        state.bleServer = server;
        state.bleCharacteristic = chr;
        state.bleConnected = true;
        if ($("bleStatusText")) $("bleStatusText").textContent = "Connected";
        if ($("systemStatus")) $("systemStatus").textContent = "BLE Connected";
        renderAll();
    } catch (e) {
        console.error(e);
        alert("Bluetooth connection failed.");
    }
}

function connectWs() {
    try {
        const url = $("wsUrlInput")?.value?.trim() || state.settings.wsUrl || PROJECT_CONFIG.hardware.wsUrl;
        if (state.ws) {
            try {
                state.ws.close();
            } catch (e) {}
        }
        const ws = new WebSocket(url);
        ws.addEventListener("open", () => {
            state.wsConnected = true;
            if ($("wsStatusText")) $("wsStatusText").textContent = "Connected";
            if ($("systemStatus")) $("systemStatus").textContent = "Wi-Fi Connected";
            renderAll();
        });
        ws.addEventListener("message", event => {
            if (typeof event.data === "string") processPacketChunk(event.data, "ws");
        });
        ws.addEventListener("close", () => {
            state.wsConnected = false;
            if ($("wsStatusText")) $("wsStatusText").textContent = "Disconnected";
            renderAll();
        });
        ws.addEventListener("error", () => {
            state.wsConnected = false;
            if ($("wsStatusText")) $("wsStatusText").textContent = "Disconnected";
        });
        state.ws = ws;
    } catch (e) {
        console.error(e);
        alert("Wi-Fi socket connection failed.");
    }
}

async function disconnectAllTransports() {
    await disconnectSerial();
    try {
        if (state.bleServer && state.bleServer.connected) state.bleServer.disconnect();
    } catch (e) {}
    state.bleConnected = false;
    state.bleDevice = null;
    state.bleServer = null;
    state.bleCharacteristic = null;
    try {
        if (state.ws) state.ws.close();
    } catch (e) {}
    state.wsConnected = false;
    state.ws = null;
    renderAll();
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
    } catch (e) {
        console.error(e);
    }
    state.serialConnected = false;
    setStatusChip($("serialBadge"), "muted", "DISCONNECTED");
    if ($("serialStatusText")) $("serialStatusText").textContent = "Disconnected";
    Object.values(state.sensors).forEach(sensor => {
        sensor.connected = false;
        sensor.state = state.settings.demoSensors ? "demo" : "disconnected";
    });
    renderAll();
}

function simulateSensors() {
    if (!state.settings.demoSensors || anyTransportConnected()) return;
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

function bindControls() {
    if ($("loadModelsBtn")) $("loadModelsBtn").addEventListener("click", loadModels);
    if ($("startCameraBtn")) $("startCameraBtn").addEventListener("click", startCamera);
    if ($("stopCameraBtn")) $("stopCameraBtn").addEventListener("click", () => stopCamera(true));
    if ($("connectSerialBtn")) $("connectSerialBtn").addEventListener("click", connectSerial);
    if ($("connectBleBtn")) $("connectBleBtn").addEventListener("click", connectBle);
    if ($("connectBlePageBtn")) $("connectBlePageBtn").addEventListener("click", connectBle);
    if ($("connectWsBtn")) $("connectWsBtn").addEventListener("click", connectWs);
    if ($("connectWsPageBtn")) $("connectWsPageBtn").addEventListener("click", connectWs);
    if ($("disconnectAllBtn")) $("disconnectAllBtn").addEventListener("click", disconnectAllTransports);
    if ($("disconnectPageBtn")) $("disconnectPageBtn").addEventListener("click", disconnectAllTransports);
}

function init() {
    loadSettings();
    loadCollections();
    applyThemeSettings();
    initHistory();
    updateClock();
    renderAll();
    buildCharts();
    drawFeatureMap();
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
        updateStatusPanel();
    }, 2000);
    window.addEventListener("resize", () => {
        buildCharts();
        drawFeatureMap();
    });
    populateCameraDevices();
    initIcons();
    updateStatusPanel();
    if (state.settings.wsUrl) connectWs();
}