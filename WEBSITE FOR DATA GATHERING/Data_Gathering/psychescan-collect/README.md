# PsycheScan Collect

Browser-only data collection site for PsycheScan (React 18 + Vite). It records **ESP32 sensor data only**, to train the stress-detection LSTM. It runs one participant session from Setup to CSV download: sensors over USB (Web Serial), calibration → rest → stress task → recovery, 4 reference-device checkpoints, GAD-7 and PSS-10.

- Full specification: `../PsycheScan_Collect_Spec.md`. The camera parts no longer apply; see the scope change in `NOTES.md`.
- Decisions the spec did not cover: [`NOTES.md`](NOTES.md)

## Run locally

```bash
npm install
npm run dev
```

Open `http://localhost:5173/DATA-GATHERING/` in **Chrome or Edge**. Web Serial does not work in Firefox or Safari.

### Testing without the ESP32

In `npm run dev`, the operator panel has a **Simulate sensors** switch (DEV tag). It feeds one fake JSON line per second through the normal parser. It does not exist in the production build.

## Before real data collection

**Firmware.** The ESP32 must print one JSON line per second over USB Serial (spec Section 4).

## Build and deploy

```bash
npm run build     # output in dist/
npm run lint
```

Every push to `main` of `NeoN1015/DATA-GATHERING` builds and deploys to GitHub Pages at `https://neon1015.github.io/DATA-GATHERING/` (`.github/workflows/deploy.yml`). One-time repo setting: **Settings → Pages → Source: GitHub Actions**.

`vite.config.js` sets `base: "/DATA-GATHERING/"`, which must match the repository name exactly (case-sensitive).
