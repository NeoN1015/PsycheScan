// DEV ONLY. Generates fake ESP32 JSON lines (spec Section 4 format) so a full
// session can be tested without hardware. Imported dynamically behind
// import.meta.env.DEV, so it is not part of the production build.
// Values drift slowly with small noise, so the calibration stability check passes.

const round = (v, d) => Math.round(v * 10 ** d) / 10 ** d;

export function createSimSensor() {
  let hr = 74;
  let gsr = 2.1;
  const t0 = Date.now();

  return function nextLine() {
    const t = (Date.now() - t0) / 1000;
    hr = Math.min(82, Math.max(68, hr + (Math.random() - 0.5) * 1.5));
    gsr = Math.min(2.2, Math.max(2.0, gsr + (Math.random() - 0.5) * 0.02));
    const temp = 34.4 + 0.05 * Math.sin(t / 40) + (Math.random() - 0.5) * 0.04;
    const motion = 0.02 + Math.random() * 0.02;
    return JSON.stringify({
      hr: round(hr, 1),
      gsr: round(gsr, 2),
      temp: round(temp, 1),
      motion: round(motion, 3),
      dataValid: true,
      max30102: true,
      gsrConnected: true,
      ds18b20: true,
      mpu6050: true,
    });
  };
}
