// Line splitting + JSON parsing for the ESP32 serial stream (spec Section 4).
// Pure functions: no React, no browser APIs.

/**
 * Append a decoded chunk to the pending buffer and split off complete lines.
 * If the unfinished remainder grows past maxLineBytes without a newline,
 * it is discarded (everything after the last newline is dropped).
 */
export function splitLines(buffer, chunk, maxLineBytes) {
  const parts = (buffer + chunk).split("\n");
  let rest = parts.pop();
  if (rest.length > maxLineBytes) rest = "";
  return { lines: parts, rest };
}

const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);

/**
 * Parse one line. Returns a reading object, or null for empty lines,
 * "#" comment lines and anything that is not a JSON object.
 * The firmware's "stress" field is ignored.
 */
export function parseSensorLine(raw) {
  const line = String(raw ?? "").trim();
  if (!line || line.startsWith("#")) return null;
  let obj;
  try {
    obj = JSON.parse(line);
  } catch {
    console.warn("[serial] skipped non-JSON line:", line.slice(0, 120));
    return null;
  }
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) {
    console.warn("[serial] skipped line that is not a JSON object:", line.slice(0, 120));
    return null;
  }
  return {
    hr: num(obj.hr),
    gsr: num(obj.gsr),
    temp: num(obj.temp),
    motion: num(obj.motion),
    dataValid: obj.dataValid === true,
    max30102: obj.max30102 === true,
    gsrConnected: obj.gsrConnected === true,
    ds18b20: obj.ds18b20 === true,
    mpu6050: obj.mpu6050 === true,
  };
}

/** Age of the latest reading in ms (Infinity if there is none). */
export function sensorAge(reading, now) {
  return reading ? now - reading.receivedAt : Infinity;
}
