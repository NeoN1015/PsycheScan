(function () {
  const TOKEN_KEY = "psychescan_session_token_v1";
  const QUEUE_KEY = "psychescan_telemetry_queue_v1";
  const backendState = {
    available: false,
    authenticated: false,
    syncing: false,
    lastError: ""
  };
  let telemetryQueue = loadLocalJSON(QUEUE_KEY, []);
  let syncTimer = null;
  let telemetrySyncing = false;
  if (!Array.isArray(telemetryQueue)) telemetryQueue = [];
  const maxQueue = PROJECT_CONFIG.runtime.telemetryQueueLimit;
  if (telemetryQueue.length > maxQueue) {
    telemetryQueue = telemetryQueue.slice(-maxQueue);
    saveLocalJSON(QUEUE_KEY, telemetryQueue);
    console.warn("Oversized persisted telemetry queue was trimmed to its configured limit.");
  }

  function getToken() {
    try {
      return sessionStorage.getItem(TOKEN_KEY);
    } catch (error) {
      console.warn("Could not read the authenticated session", error);
      return null;
    }
  }

  function setToken(token) {
    try {
      if (token) sessionStorage.setItem(TOKEN_KEY, token);
      else sessionStorage.removeItem(TOKEN_KEY);
    } catch (error) {
      console.error("Could not store the authenticated session", error);
      throw error;
    }
  }

  async function request(path, options = {}, allowAnonymous = false) {
    const headers = { "Content-Type": "application/json", ...(options.headers || {}) };
    const token = getToken();
    if (token && !allowAnonymous) headers.Authorization = `Bearer ${token}`;
    const response = await fetch(path, {
      cache: "no-store",
      ...options,
      headers
    });
    if (!response.ok) {
      const error = new Error(`Request failed (${response.status})`);
      error.status = response.status;
      if (response.status === 401 && !allowAnonymous) {
        setToken(null);
        backendState.authenticated = false;
        window.dispatchEvent(new CustomEvent("psychescan-auth-expired"));
      }
      throw error;
    }
    return response.json();
  }

  function localSnapshotHasData() {
    return state.records.length > 0 ||
      state.reports.length > 0 ||
      state.profiles.length > 0 ||
      Object.keys(state.settings).length > 0;
  }

  function cacheState() {
    saveLocalJSON(STORAGE_KEYS.settings, state.settings);
    saveLocalJSON(STORAGE_KEYS.records, state.records);
    saveLocalJSON(STORAGE_KEYS.reports, state.reports);
    saveLocalJSON(STORAGE_KEYS.profiles, state.profiles);
    saveLocalJSON(STORAGE_KEYS.activeProfileId, state.activeProfileId);
    saveLocalJSON("cnn_lstm_session_v1", {
      ...state.session,
      baselineTimer: null,
      history: state.history
    });
  }

  function applyBootstrap(payload) {
    if (payload.settings && typeof payload.settings === "object") {
      state.settings = { ...state.settings, ...payload.settings };
    }
    if (Array.isArray(payload.records)) state.records = payload.records;
    if (Array.isArray(payload.reports)) state.reports = payload.reports;
    if (Array.isArray(payload.profiles)) state.profiles = payload.profiles;
    if (payload.activeProfileId) state.activeProfileId = payload.activeProfileId;
    if (payload.session && typeof payload.session === "object") {
      state.session = { ...state.session, ...payload.session, baselineTimer: null };
      if (Array.isArray(payload.session.history)) state.history = payload.session.history;
    }
    if (!state.profiles.some(profile => profile.profileId === state.activeProfileId)) {
      state.activeProfileId = null;
    }
    state.loggedInUser = payload.user || state.loggedInUser;
    cacheState();
    applyThemeSettings();
    renderAll();
    renderProfiles();
    buildCharts();
  }

  async function syncNow(reason) {
    if (!getToken()) return;
    if (backendState.syncing) return;
    backendState.syncing = true;
    try {
      await request("/api/sync", {
        method: "POST",
        body: JSON.stringify({
          settings: state.settings,
          records: state.records,
          reports: state.reports,
          profiles: state.profiles,
          activeProfileId: state.activeProfileId,
          session: { ...state.session, baselineTimer: null, history: state.history },
          reason
        })
      });
      backendState.available = true;
      backendState.lastError = "";
    } catch (error) {
      backendState.available = false;
      backendState.lastError = error.message;
      console.warn("Backend sync failed; local changes remain cached", error);
    } finally {
      backendState.syncing = false;
    }
  }

  function sync(reason = "change") {
    cacheState();
    clearTimeout(syncTimer);
    syncTimer = setTimeout(() => syncNow(reason), 350);
  }

  async function hydrate() {
    const payload = await request("/api/bootstrap");
    backendState.available = true;
    backendState.lastError = "";
    if (payload.serverHasData) {
      applyBootstrap(payload);
    } else if (localSnapshotHasData()) {
      await syncNow("seed-from-cache");
    }
  }

  async function login(username, password) {
    const response = await request("/api/login", {
      method: "POST",
      body: JSON.stringify({ username, password })
    }, true);
    if (!response.token || typeof response.token !== "string") {
      throw new Error("The server did not issue a session token.");
    }
    setToken(response.token);
    backendState.authenticated = true;
    state.loggedInUser = response.user;
    try {
      await hydrate();
    } catch (error) {
      setToken(null);
      backendState.authenticated = false;
      throw error;
    }
    return response;
  }

  async function logout() {
    clearTimeout(syncTimer);
    try {
      if (getToken()) {
        await request("/api/logout", { method: "POST", body: "{}" });
      }
    } finally {
      setToken(null);
      backendState.authenticated = false;
      backendState.available = false;
    }
  }

  async function createProfile(profile) {
    if (
      !profile ||
      typeof profile.profileId !== "string" ||
      !profile.profileId ||
      typeof profile.name !== "string" ||
      !profile.name.trim()
    ) {
      throw new TypeError("A patient profile ID and name are required.");
    }
    await request("/api/profiles/create", {
      method: "POST",
      body: JSON.stringify({ profile })
    });
  }

  async function deleteProfile(profileId) {
    if (typeof profileId !== "string" || !profileId) {
      throw new TypeError("A patient profile ID is required.");
    }
    await request("/api/profiles/delete", {
      method: "POST",
      body: JSON.stringify({ profileId })
    });
    telemetryQueue = telemetryQueue.filter(event => event.payload?.profileId !== profileId);
    saveLocalJSON(QUEUE_KEY, telemetryQueue);
  }

  async function updateProfile(profileId, name) {
    if (typeof profileId !== "string" || !profileId || typeof name !== "string" || !name.trim()) {
      throw new TypeError("A patient profile ID and name are required.");
    }
    await request("/api/profiles/update", {
      method: "POST",
      body: JSON.stringify({ profileId, name: name.trim() })
    });
    telemetryQueue = telemetryQueue.map(event => event.payload?.profileId === profileId
      ? { ...event, payload: { ...event.payload, profileName: name.trim() } }
      : event);
    saveLocalJSON(QUEUE_KEY, telemetryQueue);
  }

  function persistTelemetry(event) {
    if (
      !event ||
      !["sample", "record"].includes(event.kind) ||
      !event.payload ||
      typeof event.payload.profileId !== "string" ||
      !event.payload.profileId
    ) {
      console.error("Invalid telemetry event; data was not queued", event);
      return;
    }
    const id = window.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    telemetryQueue.push({
      id,
      kind: event.kind,
      payload: event.payload,
      createdAt: new Date().toISOString()
    });
    if (telemetryQueue.length > maxQueue) {
      telemetryQueue.splice(0, telemetryQueue.length - maxQueue);
      console.warn("Telemetry queue reached its limit; oldest queued events were discarded.");
    }
    saveLocalJSON(QUEUE_KEY, telemetryQueue);
    if (telemetryQueue.length >= 20) flushTelemetry();
  }

  async function sendTelemetryBatch(batch) {
    try {
      await request("/api/telemetry", {
        method: "POST",
        body: JSON.stringify({ events: batch })
      });
    } catch (error) {
      if (error.status === 400 && batch.length > 1) {
        for (const event of batch) await sendTelemetryBatch([event]);
        return;
      }
      if (error.status === 413 && batch.length > 1) {
        const midpoint = Math.ceil(batch.length / 2);
        await sendTelemetryBatch(batch.slice(0, midpoint));
        await sendTelemetryBatch(batch.slice(midpoint));
        return;
      }
      if (error.status === 400 || error.status === 413) {
        console.error("Rejected telemetry event was removed from the queue.", error);
        return;
      }
      throw error;
    }
  }

  async function flushTelemetry() {
    if (telemetrySyncing || !telemetryQueue.length || !getToken()) return;
    telemetrySyncing = true;
    const batch = telemetryQueue.slice(0, 100);
    const sentIds = new Set(batch.map(item => item.id));
    try {
      await sendTelemetryBatch(batch);
      telemetryQueue = telemetryQueue.filter(item => !sentIds.has(item.id));
      saveLocalJSON(QUEUE_KEY, telemetryQueue);
    } catch (error) {
      console.warn("Telemetry remains queued until the backend is available.", error);
    } finally {
      telemetrySyncing = false;
    }
  }

  window.PsycheScanBackend = Object.freeze({
    login,
    logout,
    createProfile,
    deleteProfile,
    updateProfile,
    sync,
    persistTelemetry,
    flushTelemetry,
    state: backendState
  });

  window.addEventListener("online", flushTelemetry);
  window.addEventListener("DOMContentLoaded", () => {
    setInterval(flushTelemetry, 5000);
  });
})();
