/* Small shared helpers. */

function $(id) {
  return document.getElementById(id);
}

function setText(id, text) {
  const element = $(id);
  if (element) element.textContent = text;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, character => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;"
  })[character]);
}

function clamp(value, min, max) {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

function mean(values) {
  const valid = values.filter(Number.isFinite);
  return valid.length ? valid.reduce((sum, value) => sum + value, 0) / valid.length : null;
}

function standardDeviation(values) {
  const m = mean(values);
  if (m === null) return null;
  const valid = values.filter(Number.isFinite);
  return Math.sqrt(valid.reduce((sum, value) => sum + (value - m) ** 2, 0) / valid.length);
}

function capitalize(text) {
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : text;
}

function formatSensor(key, value) {
  if (!Number.isFinite(value)) return "--";
  const meta = CONFIG.sensors[key];
  return `${Number(value).toFixed(meta.decimals)} ${meta.unit}`;
}

function formatPercent(value) {
  return `${Number.isFinite(value) ? Math.round(value) : 0}%`;
}

function formatClock(seconds) {
  const safe = Math.max(0, Math.ceil(seconds));
  return `${String(Math.floor(safe / 60)).padStart(2, "0")}:${String(safe % 60).padStart(2, "0")}`;
}

function formatSignedPercent(value) {
  if (!Number.isFinite(value)) return "--";
  return `${value >= 0 ? "+" : "−"}${Math.abs(value).toFixed(1)}%`;
}

// Temperature change from baseline, expressed as a drop (positive = cooler than baseline).
function formatTempDrop(dropC) {
  if (!Number.isFinite(dropC)) return "--";
  return dropC >= 0 ? `Drop ${dropC.toFixed(2)} °C` : `Rise ${Math.abs(dropC).toFixed(2)} °C`;
}

function createId() {
  return window.crypto?.randomUUID?.() || `id-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function loadJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function saveJSON(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (error) {
    if (error.name === "QuotaExceededError") {
      alert("Browser storage is full. Export the records to CSV, then clear old records.");
    }
    return false;
  }
}

function downloadCsv(filename, headers, rows) {
  const cell = value => {
    let text = String(value ?? "");
    // Stop spreadsheet apps from treating text cells as formulas.
    if (typeof value === "string" && /^[\t\r\n ]*[=+\-@]/.test(value)) text = `'${text}`;
    return `"${text.replace(/"/g, '""')}"`;
  };
  const lines = [headers.map(cell).join(","), ...rows.map(row => headers.map(key => cell(row[key])).join(","))];
  const blob = new Blob([`﻿${lines.join("\r\n")}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function setStatusChip(element, type, text) {
  if (!element) return;
  element.classList.remove("muted", "warning", "danger", "success");
  if (type) element.classList.add(type);
  element.textContent = text;
}

function refreshIcons(root) {
  if (window.lucide) lucide.createIcons(root ? { root } : undefined);
}

/* Generic modal open/close with focus return and Escape to close. */
const modalReturnFocus = new Map();

function openModal(id, focusId) {
  const modal = $(id);
  if (!modal) return;
  modalReturnFocus.set(id, document.activeElement);
  modal.classList.add("show");
  modal.setAttribute("aria-hidden", "false");
  (focusId ? $(focusId) : modal.querySelector("button"))?.focus();
}

function closeModal(id) {
  const modal = $(id);
  if (!modal || !modal.classList.contains("show")) return;
  modal.classList.remove("show");
  modal.setAttribute("aria-hidden", "true");
  const previous = modalReturnFocus.get(id);
  if (previous instanceof HTMLElement && document.contains(previous)) previous.focus();
  modalReturnFocus.delete(id);
}

function bindModalDismiss(id, closeButtonId, onClose = () => closeModal(id)) {
  const modal = $(id);
  $(closeButtonId)?.addEventListener("click", onClose);
  modal?.addEventListener("click", event => {
    if (event.target === modal) onClose();
  });
  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && modal?.classList.contains("show")) onClose();
  });
}
