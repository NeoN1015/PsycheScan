(function () {
  const original = {
    saveSettings: window.saveSettings,
    loadSettings: window.loadSettings,
    saveAuth: window.saveAuth,
    loadAuth: window.loadAuth,
    logout: window.logout,
    persistCollections: window.persistCollections,
    loadCollections: window.loadCollections,
    updateStatusPanel: window.updateStatusPanel
  };

  const backendState = {
    available: false,
    bootstrapped: false,
    syncing: false,
    pending: false,
    suspended: false,
    lastError: "",
    lastSyncAt: 0
  };

  function readLocalJSON(key, fallback = null) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (error) {
      console.warn("Local cache read failed", key, error);
      return fallback;
    }
  }

  function writeLocalJSON(key, value) {
    try {
      if (value === null || value === undefined) {
        localStorage.removeItem(key);
        return;
      }
      localStorage.setItem(key, JSON.stringify(value));
    } catch (error) {
      console.warn("Local cache write failed", key, error);
    }
  }

  function cacheCurrentStateLocally() {
    writeLocalJSON(STORAGE_KEYS.settings, state.settings);
    writeLocalJSON(STORAGE_KEYS.auth, readAuthFromState());
    writeLocalJSON(STORAGE_KEYS.records, state.records);
    writeLocalJSON(STORAGE_KEYS.reports, state.reports);
    localStorage.setItem(STORAGE_KEYS.participantCounter, String(state.participantCounter || 0));
  }

  function cacheBootstrapLocally(payload) {
    if (payload.settings) writeLocalJSON(STORAGE_KEYS.settings, payload.settings);
    if (payload.auth) writeLocalJSON(STORAGE_KEYS.auth, payload.auth);
    else localStorage.removeItem(STORAGE_KEYS.auth);
    if (Array.isArray(payload.records)) writeLocalJSON(STORAGE_KEYS.records, payload.records);
    if (Array.isArray(payload.reports)) writeLocalJSON(STORAGE_KEYS.reports, payload.reports);
    localStorage.setItem(STORAGE_KEYS.participantCounter, String(payload.participantCounter || 0));
  }

  function readAuthFromState() {
    const cached = readLocalJSON(STORAGE_KEYS.auth, null);
    if (cached && typeof cached === "object") return cached;
    return state.loggedInUser ? { ok: true, user: state.loggedInUser } : null;
  }

  function buildSnapshot() {
    return {
      settings: state.settings,
      auth: readAuthFromState(),
      participantCounter: Number(state.participantCounter || 0),
      records: Array.isArray(state.records) ? state.records : [],
      reports: Array.isArray(state.reports) ? state.reports : []
    };
  }

  async function api(path, options = {}) {
    const response = await fetch(path, {
      headers: { "Content-Type": "application/json", ...(options.headers || {}) },
      cache: "no-store",
      ...options
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => response.statusText);
      throw new Error(detail || `Request failed (${response.status})`);
    }
    const contentType = response.headers.get("content-type") || "";
    return contentType.includes("application/json") ? response.json() : response.text();
  }

  function applyBootstrap(payload) {
    backendState.suspended = true;
    try {
      if (payload && payload.settings && typeof payload.settings === "object") {
        state.settings = { ...state.settings, ...payload.settings };
      }
      if (Array.isArray(payload?.records)) state.records = payload.records;
      if (Array.isArray(payload?.reports)) state.reports = payload.reports;
      state.participantCounter = Number(payload?.participantCounter || 0);
      state.settings.participantId = state.participantCounter ? formatParticipantId(state.participantCounter) : "Awaiting Face";

      if (payload?.auth && payload.auth.ok) {
        state.loggedInUser = payload.auth.user || "Guest";
        if (typeof unlockApp === "function") unlockApp();
      }

      cacheBootstrapLocally(payload || {});
      applyThemeSettings();
      renderAll();
      if (typeof buildCharts === "function") buildCharts();
      if (typeof drawFeatureMap === "function") drawFeatureMap();
    } finally {
      backendState.suspended = false;
      backendState.bootstrapped = true;
      if (typeof updateStatusPanel === "function") updateStatusPanel();
    }
  }

  async function syncToBackend(reason = "auto") {
    if (backendState.suspended) return;
    cacheCurrentStateLocally();

    if (backendState.syncing) {
      backendState.pending = true;
      return;
    }

    backendState.syncing = true;
    try {
      await api("/api/sync", {
        method: "POST",
        body: JSON.stringify({ ...buildSnapshot(), reason })
      });
      backendState.available = true;
      backendState.lastError = "";
      backendState.lastSyncAt = Date.now();
    } catch (error) {
      backendState.available = false;
      backendState.lastError = error?.message || "Sync failed";
      console.warn("Backend sync failed", error);
    } finally {
      backendState.syncing = false;
      if (typeof updateStatusPanel === "function") updateStatusPanel();
      if (backendState.pending) {
        backendState.pending = false;
        syncToBackend("queued");
      }
    }
  }

  async function bootstrapFromBackend() {
    try {
      const payload = await api("/api/bootstrap");
      backendState.available = true;
      backendState.lastError = "";

      const localRecords = readLocalJSON(STORAGE_KEYS.records, []);
      const localReports = readLocalJSON(STORAGE_KEYS.reports, []);
      const localCounter = Number(localStorage.getItem(STORAGE_KEYS.participantCounter) || 0);
      const localHasData = (Array.isArray(localRecords) && localRecords.length > 0) ||
        (Array.isArray(localReports) && localReports.length > 0) ||
        localCounter > 0;

      if (payload && payload.serverHasData) {
        applyBootstrap(payload);
      } else if (localHasData) {
        await syncToBackend("seed-from-cache");
      }
    } catch (error) {
      backendState.available = false;
      backendState.lastError = error?.message || "Backend unavailable";
      console.warn("Backend bootstrap failed", error);
    } finally {
      backendState.bootstrapped = true;
      if (typeof updateStatusPanel === "function") updateStatusPanel();
    }
  }

  window.__backendState = backendState;

  window.loadSettings = function () {
    if (typeof original.loadSettings === "function") original.loadSettings();
  };

  window.loadCollections = function () {
    if (typeof original.loadCollections === "function") original.loadCollections();
  };

  window.saveSettings = function () {
    if (typeof original.saveSettings === "function") original.saveSettings();
    syncToBackend("settings");
  };

  window.persistCollections = function () {
    if (typeof original.persistCollections === "function") original.persistCollections();
    syncToBackend("collections");
  };

  window.saveAuth = function (remember) {
    if (typeof original.saveAuth === "function") original.saveAuth(remember);
    syncToBackend(remember ? "auth-login" : "auth-clear");
  };

  window.logout = function () {
    if (typeof original.logout === "function") original.logout();
    syncToBackend("logout");
  };

  window.updateStatusPanel = function () {
    if (typeof original.updateStatusPanel === "function") original.updateStatusPanel();

    const storageText = backendState.available
      ? `SQLite synced · ${state.records.length} records · ${state.reports.length} reports`
      : `Cache only · ${state.records.length} records · ${state.reports.length} reports`;

    if ($("storageStatusText")) {
      $("storageStatusText").textContent = storageText;
    }

    const statusEl = $("systemStatus");
    if (!statusEl) return;
    const current = statusEl.textContent || "";
    const safeToReplace = ["Ready", "Backend Synced", "Cache Mode", "Syncing", "Settings Saved", "Settings Reset"].includes(current);
    if (!safeToReplace) return;
    if (backendState.syncing) {
      statusEl.textContent = "Syncing";
      return;
    }
    if (backendState.available && backendState.bootstrapped) {
      statusEl.textContent = "Backend Synced";
      return;
    }
    if (!backendState.available && backendState.lastError) {
      statusEl.textContent = "Cache Mode";
    }
  };

  function wireDomSyncHooks() {
    const syncSoon = (reason = "ui") => setTimeout(() => syncToBackend(reason), 50);

    const settingsBtn = $("saveSettingsBtn");
    if (settingsBtn && !settingsBtn.dataset.backendSyncBound) {
      settingsBtn.dataset.backendSyncBound = "1";
      settingsBtn.addEventListener("click", () => syncSoon("settings-click"));
    }

    const resetBtn = $("resetSettingsBtn");
    if (resetBtn && !resetBtn.dataset.backendSyncBound) {
      resetBtn.dataset.backendSyncBound = "1";
      resetBtn.addEventListener("click", () => syncSoon("settings-reset"));
    }

    const loginForm = $("loginForm");
    if (loginForm && !loginForm.dataset.backendSyncBound) {
      loginForm.dataset.backendSyncBound = "1";
      loginForm.addEventListener("submit", () => syncSoon("login-submit"));
    }

    const logoutBtn = $("logoutBtn");
    if (logoutBtn && !logoutBtn.dataset.backendSyncBound) {
      logoutBtn.dataset.backendSyncBound = "1";
      logoutBtn.addEventListener("click", () => syncSoon("logout-click"));
    }

    const clearReportsBtn = $("clearReportsBtn");
    if (clearReportsBtn && !clearReportsBtn.dataset.backendSyncBound) {
      clearReportsBtn.dataset.backendSyncBound = "1";
      clearReportsBtn.addEventListener("click", () => syncSoon("reports-clear"));
    }
  }

  window.addEventListener("DOMContentLoaded", () => {
    setTimeout(() => {
      wireDomSyncHooks();
      bootstrapFromBackend();
      setInterval(() => {
        if (!backendState.syncing) syncToBackend("heartbeat");
      }, 30000);
    }, 0);
  });
})();
