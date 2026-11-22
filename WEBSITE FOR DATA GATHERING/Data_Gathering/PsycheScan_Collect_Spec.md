# PsycheScan Collect — Data Collection Website Specification

Version 1.1 (React/JSX) · 22 Nov 2026 · Owner: software lead (Gerald C. Esplana)

A browser-only React (JSX) website, built with Vite and hosted on GitHub Pages, that runs one participant session from start to finish: it reads the ESP32 sensors over USB, runs the face models on the laptop webcam, guides the participant through calibration, rest, a timed math stress task and recovery, collects reference-device readings and the GAD-7 / PSS-10 questionnaires, and downloads everything as CSV files.

> **For whoever builds this (person or AI):** this spec is self-contained. Build in an empty folder and do not search for or read any older PsycheScan files. Everything needed is in this document.

This site is **only for collecting data**. It does not show stress predictions, does not run the LSTM, and does not compute the old 0–100 integrated score.

---

## 1. Goals and non-goals

### Goals
1. Record per-second sensor and camera features for every phase of the session, each row tagged with its phase.
2. Produce phase labels (`rest` = not stressed, `stress` = stressed) for training a binary stress-detection LSTM, following the WESAD design (Schmidt et al., 2018).
3. Collect paired readings (our sensor vs reference device) at 4 checkpoints per session for the Objective 2 accuracy table (MAE, % error, Pearson r).
4. Collect GAD-7 and PSS-10 scores per participant as the external reference.
5. Be stable enough to run 15+ sessions without crashes or data loss.

### Non-goals (do not build)
- Live stress classification or LSTM inference
- The integrated 0–100 score or the 48:12:40 weights
- Touchscreen layout, cloud database, login, Wi-Fi/WebSocket or Bluetooth connection
- Offline PWA (optional later)

---

## 2. Platform and constraints

| Item | Decision |
| --- | --- |
| Hosting | GitHub Pages (static build output, HTTPS) |
| Browser | Chrome or Edge on a Windows laptop (Web Serial is not supported in Firefox/Safari, nor on iPhone/iPad) |
| Sensor link | USB cable to ESP32, read with the Web Serial API at 115200 baud |
| Camera | Laptop webcam via `getUserMedia` |
| Framework | **React 18 + JSX**, built with **Vite** (JavaScript, no TypeScript) |
| State | `useReducer` + React Context for the session; `useRef` for high-frequency data (see Section 2.1) |
| ML libraries | `@tensorflow/tfjs` (our CNN), `@vladmandic/face-api` (face detection + 68 landmarks only) |
| Storage during session | In memory, with an autosave copy in IndexedDB every 10 s (`idb-keyval`) |
| Output | CSV downloads (one set of files per session) |
| Styling | Plain CSS modules or one global `index.css` (no UI library needed) |
| Paths | Models in `public/models/`, loaded with `import.meta.env.BASE_URL + "models/..."`, because the site is served from `/<repo-name>/` |

### 2.1 React rules for this app (important for stability)

1. **Sensor and camera data never go into React state on every update.** The serial reader and the camera loop write to `useRef` objects (`latestSensorRef`, `latestFaceRef`). Re-rendering 5–10 times a second would make the timers drift and the page lag.
2. **The 1 Hz sampler lives in a ref-based hook** (`useRecorder`) using `setInterval` + `performance.now()`. It pushes rows into `rowsRef.current` (an array), not into state.
3. **The UI reads live values on a 4 Hz "display tick"**: one `useState` counter updated every 250 ms by `useDisplayTick()`, which makes the operator panel re-read the refs. Only the panel re-renders, not the whole app.
4. **Phase changes go through the reducer** (`dispatch({ type: "NEXT_PHASE" })`), so every screen switch is logged and predictable.
5. **Every effect cleans up**: close the serial reader, stop camera tracks, clear intervals. React 18 StrictMode runs effects twice in development, so all start functions must be safe to call twice.
6. **No `async` work in render.** Model loading happens once in `useModels()` with a loading screen until ready.

---

## 3. Project structure

```
psychescan-collect/
├── index.html
├── package.json
├── vite.config.js            # base: "/psychescan-collect/"
├── .github/workflows/deploy.yml
├── public/
│   └── models/
│       ├── face-api/         # tiny_face_detector + face_landmark_68 weights
│       └── emotion_cnn/      # our CNN converted to TF.js (model.json + shards)
└── src/
    ├── main.jsx              # ReactDOM.createRoot, <SessionProvider><App/></SessionProvider>
    ├── App.jsx               # layout: <ParticipantArea/> + <OperatorPanel/>, picks screen by phase
    ├── index.css
    ├── config.js             # all timings and thresholds (Section 15)
    ├── state/
    │   ├── SessionContext.jsx   # context + provider, exposes state, dispatch, refs
    │   ├── sessionReducer.js    # phases, setup, screening, checkpoints, questionnaires
    │   └── initialState.js
    ├── hooks/
    │   ├── useSerial.js         # connect, read loop, parse → latestSensorRef
    │   ├── useCamera.js         # getUserMedia, detection loop → latestFaceRef
    │   ├── useModels.js         # load face-api + CNN once, returns { ready, error }
    │   ├── useRecorder.js       # 1 Hz sampler → rowsRef, start/stop/pause
    │   ├── usePhaseTimer.js     # countdown for the current phase, fires onDone
    │   ├── useCalibration.js    # stability check over last 20 s
    │   ├── useAutosave.js       # IndexedDB save every 10 s, recovery on load
    │   └── useDisplayTick.js    # 4 Hz re-render trigger for live values
    ├── lib/
    │   ├── serialParser.js      # line splitting + JSON parse (pure functions)
    │   ├── emotionCnn.js        # preprocess face crop, run CNN, return 7 probs
    │   ├── visualFatigue.js     # copy from Appendix A
    │   ├── scoring.js           # GAD-7, PSS-10 totals and levels
    │   ├── mathTask.js          # problem generator + adaptive difficulty
    │   ├── baseline.js          # baseline means + delta columns
    │   └── csv.js               # build the 5 CSVs + download
    ├── screens/
    │   ├── SetupScreen.jsx
    │   ├── ScreeningScreen.jsx
    │   ├── ConsentScreen.jsx
    │   ├── ConnectScreen.jsx
    │   ├── CalibrationScreen.jsx
    │   ├── RestScreen.jsx           # also used for Recovery (prop: phase)
    │   ├── StressTaskScreen.jsx
    │   ├── QuestionnaireScreen.jsx  # GAD-7 then PSS-10
    │   └── EndScreen.jsx
    └── components/
        ├── OperatorPanel.jsx        # ID, phase, timer, live values, preview, Pause/Abort
        ├── LiveValues.jsx
        ├── StatusRow.jsx            # green/red check row
        ├── CameraPreview.jsx        # <video> + face box canvas
        ├── CheckpointModal.jsx
        ├── TimerBar.jsx
        ├── BreathingCircle.jsx
        ├── LikertQuestion.jsx
        ├── Banner.jsx               # red/amber warnings
        └── ConfirmDialog.jsx
```

All configurable numbers live in `src/config.js` (see Section 15).

### 3.1 Install

```bash
npm create vite@latest psychescan-collect -- --template react
cd psychescan-collect
npm install @tensorflow/tfjs @vladmandic/face-api idb-keyval
npm run dev
```

Web Serial and the camera work on `http://localhost` during development and on the HTTPS GitHub Pages URL in production.

### 3.2 Deploy to GitHub Pages

`vite.config.js`:
```js
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  plugins: [react()],
  base: "/psychescan-collect/", // must match the repo name
});
```

`.github/workflows/deploy.yml`:
```yaml
name: Deploy
on:
  push:
    branches: [main]
permissions:
  contents: read
  pages: write
  id-token: write
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: npm }
      - run: npm ci
      - run: npm run build
      - uses: actions/upload-pages-artifact@v3
        with: { path: dist }
  deploy:
    needs: build
    runs-on: ubuntu-latest
    environment: { name: github-pages, url: "${{ steps.deployment.outputs.page_url }}" }
    steps:
      - id: deployment
        uses: actions/deploy-pages@v4
```

In the repo: **Settings → Pages → Source: GitHub Actions**. Every push to `main` rebuilds and redeploys.

### 3.3 Session state shape (reducer)

```js
{
  phase: "setup", // setup | screening | consent | connect | calibration | rest |
                  // stressIntro | stress | recovery | questionnaires | end
  phaseStartedAt: null,        // performance.now()
  paused: false,
  aborted: false,
  setup: { participantId, operator, location, refHrDevice, refTempDevice, refGsrDevice },
  screening: { age, sex, heartCondition, mhTreatment, clinicSupervised,
               caffeine2h, smoked1h, sleepHours, dominantHand, glasses, eligible },
  consent: { signed: false, canStop: false, anonymous: false },
  calibration: { seconds: 0, forced: false },
  checkpoints: [],             // 4 objects (Section 12.2)
  stressTaskLog: [],           // one object per problem (Section 12.4)
  gad7: Array(7).fill(null),
  pss10: Array(10).fill(null),
  events: [],                  // Section 12.5
  downloaded: false,
}
```

Actions: `SET_SETUP`, `SET_SCREENING`, `SET_CONSENT`, `NEXT_PHASE`, `PAUSE`, `RESUME`, `RESTART_PHASE`, `ABORT`, `SAVE_CHECKPOINT`, `LOG_PROBLEM`, `SET_GAD7_ITEM`, `SET_PSS10_ITEM`, `LOG_EVENT`, `MARK_DOWNLOADED`, `RESET`.

Refs held in `SessionContext` (not state): `latestSensorRef`, `latestFaceRef`, `rowsRef`, `taskLevelRef`, `portRef`, `videoRef`.

### 3.4 Key hook sketches

```jsx
// hooks/useSerial.js
export function useSerial(latestSensorRef, onEvent) {
  const portRef = useRef(null);
  const readerRef = useRef(null);
  const [connected, setConnected] = useState(false);

  const connect = useCallback(async () => {
    if (!("serial" in navigator)) throw new Error("Use Chrome or Edge");
    const port = await navigator.serial.requestPort();
    await port.open({ baudRate: CONFIG.serial.baudRate });
    portRef.current = port;
    setConnected(true);
    readLoop(port);
  }, []);

  async function readLoop(port) {
    const decoder = new TextDecoderStream();
    port.readable.pipeTo(decoder.writable).catch(() => {});
    const reader = decoder.readable.getReader();
    readerRef.current = reader;
    let buffer = "";
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += value;
        const lines = buffer.split("\n");
        buffer = lines.pop();
        for (const line of lines) {
          const data = parseSensorLine(line); // lib/serialParser.js, returns null if bad
          if (data) latestSensorRef.current = { ...data, receivedAt: performance.now() };
        }
        if (buffer.length > CONFIG.serial.maxLineBytes) buffer = "";
      }
    } catch (e) {
      onEvent("serial_lost", String(e));
    } finally {
      setConnected(false);
    }
  }

  useEffect(() => () => { readerRef.current?.cancel(); portRef.current?.close(); }, []);
  return { connect, connected };
}
```

```jsx
// hooks/useRecorder.js
export function useRecorder({ latestSensorRef, latestFaceRef, rowsRef, phaseRef, phaseStartRef, taskLevelRef, participantId }) {
  const timerRef = useRef(null);
  const startRef = useRef(null);

  const start = useCallback(() => {
    if (timerRef.current) return;           // safe if called twice (StrictMode)
    startRef.current ??= performance.now();
    timerRef.current = setInterval(() => {
      const now = performance.now();
      rowsRef.current.push(buildRow({       // lib function, Section 12.1 columns
        participantId, now,
        tSession: Math.round((now - startRef.current) / 1000),
        phase: phaseRef.current,
        tPhase: Math.round((now - phaseStartRef.current) / 1000),
        sensor: latestSensorRef.current,
        face: latestFaceRef.current,
        taskLevel: taskLevelRef.current,
      }));
    }, CONFIG.sampleIntervalMs);
  }, [participantId]);

  const stop = useCallback(() => { clearInterval(timerRef.current); timerRef.current = null; }, []);
  useEffect(() => stop, [stop]);
  return { start, stop };
}
```

```jsx
// App.jsx — screen switch
const SCREENS = {
  setup: SetupScreen, screening: ScreeningScreen, consent: ConsentScreen,
  connect: ConnectScreen, calibration: CalibrationScreen,
  rest: RestScreen, stressIntro: StressTaskScreen, stress: StressTaskScreen,
  recovery: RestScreen, questionnaires: QuestionnaireScreen, end: EndScreen,
};
export default function App() {
  const { state } = useSession();
  const { ready, error } = useModels();
  if (error) return <Banner kind="red">Model failed to load: {error}</Banner>;
  if (!ready) return <p className="loading">Loading models…</p>;
  const Screen = SCREENS[state.phase];
  return (
    <div className="layout">
      <main className="participant-area"><Screen phase={state.phase} /></main>
      <OperatorPanel />
    </div>
  );
}
```

---

## 4. Firmware requirement (ESP32)

The current ESP32 firmware sends JSON only over WebSocket and prints a human-readable block over Serial. (The firmware is changed separately by the hardware side; the website only needs the line format below.) For this site it must **print one JSON line per second over USB Serial**.

### Required change
- At the end of each 1-second loop, call `Serial.println(json);` with the same JSON already built in `broadcastSensorData()`.
- Remove or disable the human-readable `printStatus` block and `[ALERT]` lines, **or** prefix them with `#` so the site ignores them.
- Wi-Fi and WebSocket can be disabled for data collection.

### Line format (one line per second, ending in `\n`)
```json
{"hr":78.4,"gsr":2.15,"temp":34.6,"motion":0.042,"dataValid":true,"max30102":true,"gsrConnected":true,"ds18b20":true,"mpu6050":true}
```

| Field | Unit | Meaning |
| --- | --- | --- |
| `hr` | bpm | Heart rate; 0 when no finger |
| `gsr` | µS | Skin conductance |
| `temp` | °C | Skin temperature |
| `motion` | g | Motion magnitude (RMS) |
| `dataValid` | bool | All readings valid this second |
| `max30102` | bool | Finger detected on pulse sensor (HW-827 / MAX30102) |
| `gsrConnected` | bool | GSR electrodes on skin |
| `ds18b20` | bool | Temperature probe on skin and reading |
| `mpu6050` | bool | Motion sensor OK |

The `stress` field from the old firmware is ignored if present (it came from the unvalidated thresholds).

### Parsing rules (site side)
- Split the stream on `\n`; trim; skip empty lines and lines starting with `#`.
- `JSON.parse` each line; on failure, log to console and skip.
- Keep only the **latest** parsed reading in memory (`latestSensor`), with its receive time.
- If a line is longer than 1,024 bytes without a newline, discard the buffer up to the last newline.
- If no valid line arrives for 3 s, show **"Sensor signal lost"** (red) on screen and mark rows as invalid (Section 9).

---

## 5. Camera pipeline

Runs continuously from the moment the camera is started until the session ends.

1. **Webcam:** `getUserMedia({ video: { width: 640, height: 480 } })`.
2. **Face detection:** face-api.js `TinyFaceDetector` (input size 320, score threshold 0.5) + `faceLandmark68Net`. Use the largest face only.
3. **Emotion (our CNN):** crop the detected face box, preprocess to the CNN's input format, run the TF.js model, and get 7 probabilities in this order: `neutral, happy, sad, angry, fearful, disgusted, surprised`.
   - The converted model files are placed in `public/models/emotion_cnn/` by the team. Convert the team's `emotion_model_float16.tflite` to TF.js format (via the original Keras/ONNX model), or load it with `tfjs-tflite`.
   - **Confirm before coding:** input size, grayscale vs RGB, normalisation, and class order used in training. Record these in `config.js`.
   - **Do not** use face-api.js's built-in `faceExpressionNet`. The panel must see the CNN reported in the paper (84.80%) running here.
4. **Fatigue and eyebag scores (0–100):** use `computeVisualFatigue()` exactly as given in **Appendix A**, so the features match the old dataset.
5. **Smoothing:** exponential moving average on emotions (α = 0.3) to reduce flicker. Save the **smoothed** values only, matching the old training pipeline.
6. **Rate:** run detection about every 200 ms; the 1 Hz sampler takes the latest result.
7. **No face:** set `face_detected = 0` and all emotion/fatigue/eyebag columns to empty (not 0). Zero-filling is done later, in the training script, so the decision stays visible.

A small live preview (320 × 240) with the face box is shown on the operator screen only.

---

## 6. Session flow (state machine)

```
SETUP → SCREENING → CONSENT → CONNECT → CALIBRATION → REST → STRESS → RECOVERY → QUESTIONNAIRES → END
```

Each state has one screen. The operator advances with a large **Next** button, except where the timer advances automatically. A **Pause / Abort** button is always visible (Section 11).

| # | State | Duration | Recorded? | Phase tag | Advances |
| --- | --- | --- | --- | --- | --- |
| 0 | Setup | — | No | — | Operator |
| 1 | Screening | ~2 min | No (saved to session file) | — | Operator |
| 2 | Consent | ~2 min | No | — | Operator ticks "Consent signed" |
| 3 | Connect | ~1 min | No | — | All checks green |
| 4 | Calibration | 60 s minimum | Yes | `calibration` | Auto, when 60 s passed **and** stable (max 180 s) |
| 5 | Rest | 180 s | Yes | `rest` | Auto at 0:00 |
| 6 | Stress task | 180 s | Yes | `stress` | Auto at 0:00 |
| 7 | Recovery | 180 s | Yes | `recovery` | Auto at 0:00 |
| 8 | Questionnaires | ~4 min | No (saved to session file) | — | Operator |
| 9 | End | — | — | — | Download |

Checkpoints (reference readings) are taken at the end of states 4, 5, 6 and 7 (Section 10).

### 6.0 Setup
- Fields: **Participant ID** (auto-suggest next, format `P###`, e.g. `P031`), **Operator name**, **Location** (dropdown: Clinic / School / Other), **Smartwatch model**, **Thermometer model**, **GSR reference device** (text, or "None").
- The device fields are remembered between sessions (localStorage).
- Validation: ID must match `^P\d{3}$` and must not already exist in this browser's session list.

### 6.1 Screening
Asked by the operator, answered verbally, entered on screen.

| Question | Input | Rule |
| --- | --- | --- |
| Age | number | **Must be ≥ 18**, otherwise stop |
| Sex | Male / Female / Prefer not to say | — |
| Heart condition or heart/blood-pressure medication? | Yes / No | **Yes → exclude** |
| Currently in treatment for severe anxiety or another mental health condition? | Yes / No | **Yes → exclude unless clinic-supervised** (operator ticks "Clinic supervised") |
| Coffee, tea or energy drink in the last 2 hours? | Yes / No | Yes → warning, record it |
| Smoked in the last hour? | Yes / No | Yes → warning, record it |
| Hours of sleep last night | number | record |
| Dominant hand | Left / Right | Smartwatch goes on this wrist; sensors on the other |
| Wearing glasses? | Yes / No | record (affects eyebag score) |

Excluded participants: show "Participant not eligible — thank them and end the session." Save nothing except a line in the session log.

### 6.2 Consent
- Show a checklist: consent form signed, participant knows they can stop anytime, data is anonymous.
- **Next** enabled only when all are ticked.

### 6.3 Connect
- **Connect USB** button → `navigator.serial.requestPort()` → open at 115200.
- **Start camera** button.
- Live status panel, one row per check:

| Check | Green when |
| --- | --- |
| USB connected | port open and a valid line received in the last 2 s |
| Pulse sensor | `max30102 == true` and `hr` between 40 and 180 |
| GSR | `gsrConnected == true` |
| Temperature | `ds18b20 == true` and `temp` between 25 and 40 °C |
| Motion | `mpu6050 == true` |
| Camera | face detected in the last 2 s |
| Smartwatch | operator ticks "Smartwatch on and reading" |

- **Start Calibration** enabled only when every row is green.

### 6.4 Calibration
- Purpose: let the sensors settle. Readings are **shown live, not zeroed**.
- Screen: large live values for HR, GSR, temperature, motion; a countdown from 1:00; a status badge.
- Participant instruction (large text): **"Please sit still and breathe normally."**
- Rows are recorded with `phase = calibration` (kept in the CSV, not used for training).
- **Stability check** (every second, over the last 20 s):

| Signal | Stable when |
| --- | --- |
| Temperature | max − min ≤ 0.2 °C |
| GSR | max − min ≤ 10% of its mean |
| Heart rate | standard deviation ≤ 5 bpm |

- Badge: amber **"Stabilizing… 0:42"** while unstable or timer running; green **"Stable ✓"** when the timer has reached 0 **and** all three are stable.
- Advance automatically 3 s after "Stable ✓".
- If not stable by 180 s: show "Sensors not stable — check placement," and let the operator choose **Continue anyway** (flag `calibration_forced = 1` in the session file) or **Restart calibration**.
- Then **Checkpoint 1** (Section 10).

### 6.5 Rest (180 s)
- Participant instruction: **"Relax. Sit still and look at the screen."**
- Screen shows a calm, neutral display (soft colour, slow breathing circle, no text to read). Optional: calm music, same track for every participant (record which in config).
- Rows recorded with `phase = rest`.
- Countdown visible to the operator only (small, corner).
- At 0:00 → **Checkpoint 2** → stress task.

### 6.6 Stress task (180 s) — see Section 7
- Rows recorded with `phase = stress`.
- At 0:00 → **Checkpoint 3** → recovery.

### 6.7 Recovery (180 s)
- Same screen and instruction as Rest.
- Rows recorded with `phase = recovery`.
- At 0:00 → **Checkpoint 4** → questionnaires. Recording stops here.

### 6.8 Questionnaires — see Section 8
- Participant may read and tap answers themselves, or the operator reads them aloud.
- Sensors may be removed before this step.

### 6.9 End
- Summary: rows per phase, % valid rows per phase, number of checkpoints, GAD-7 and PSS-10 totals and levels.
- Warning if any phase has < 80% valid rows: "Low data quality in <phase> — consider repeating the session."
- Buttons: **Download all CSVs** (Section 12), **New session**.
- **New session** is disabled until the download button has been clicked once.

---

## 7. Stress task: timed mental arithmetic

Based on the Montreal Imaging Stress Task (Dedovic et al., 2005): mental arithmetic under time pressure with negative feedback.

### Screen
- Centre: the problem in very large text, e.g. **7 × 8 = ?**
- Below it: an input box (auto-focused) and a **shrinking timer bar** (green → red).
- Top: **Score: 12** and a fake "Average score: 18" bar that always sits above the participant's score (social-evaluative pressure, as in MIST).
- Feedback flash (0.6 s, full width): green **"Correct"**, red **"Wrong!"**, red **"Too slow!"**.

### Rules
- Answer with number keys, submit with **Enter**. Backspace allowed.
- Time per question starts at **4.0 s**.
- Difficulty levels:

| Level | Problem type | Example |
| --- | --- | --- |
| 1 | single digit × single digit (2–9) | 7 × 8 |
| 2 | two digit (11–19) × single digit (2–9) | 14 × 6 |
| 3 | two digit (11–29) × single digit (3–9) | 27 × 7 |

- **Adaptive:**
  - 3 correct in a row → level up (max 3) **and** time limit −0.5 s (min 2.5 s).
  - 2 wrong or too slow in a row → level down (min 1) and time limit +0.5 s (max 4.0 s).
  - Goal: participant gets roughly 40–60% wrong, which keeps the pressure on.
- No repeated problem within the last 10.
- Wrong or too-slow answer: short low buzz sound (optional, same volume for all).
- Runs for exactly 180 s, then ends mid-question if needed.

### Logged (stress_task CSV, Section 12)
One row per problem: time shown, problem, level, time limit, answer given, correct / wrong / timeout, response time (ms).

### Instruction screen (shown for 10 s before the timer starts, not recorded as stress)
"Solve each problem as fast as you can. Type your answer and press Enter. Try to beat the average score."

---

## 8. Questionnaires

### 8.1 GAD-7 (Spitzer et al., 2006)
Prompt: "Over the **last 2 weeks**, how often have you been bothered by the following problems?"

Options per item: Not at all (0), Several days (1), More than half the days (2), Nearly every day (3).

1. Feeling nervous, anxious, or on edge
2. Not being able to stop or control worrying
3. Worrying too much about different things
4. Trouble relaxing
5. Being so restless that it is hard to sit still
6. Becoming easily annoyed or irritable
7. Feeling afraid, as if something awful might happen

Total 0–21.

| Total | Level |
| --- | --- |
| 0–4 | Minimal |
| 5–9 | Mild |
| 10–14 | Moderate |
| 15–21 | Severe |

**Safety rule:** if GAD-7 ≥ 15, show the operator (not the participant) a note: "High score — give the participant the clinic's referral / support information." The study must have this information ready.

### 8.2 PSS-10 (Cohen & Williamson, 1988)
Prompt: "In the **last month**, how often have you…"

Options: Never (0), Almost never (1), Sometimes (2), Fairly often (3), Very often (4).

1. been upset because of something that happened unexpectedly?
2. felt that you were unable to control the important things in your life?
3. felt nervous and stressed?
4. felt confident about your ability to handle your personal problems? **(reverse)**
5. felt that things were going your way? **(reverse)**
6. found that you could not cope with all the things that you had to do?
7. been able to control irritations in your life? **(reverse)**
8. felt that you were on top of things? **(reverse)**
9. been angered because of things that happened that were outside of your control?
10. felt difficulties were piling up so high that you could not overcome them?

Reverse items 4, 5, 7, 8: score = 4 − answer. Total 0–40.

| Total | Level |
| --- | --- |
| 0–13 | Low |
| 14–26 | Moderate |
| 27–40 | High |

Note: these three bands are a widely used convention, not official cut-offs from Cohen. Cite them as a convention, or report PSS-10 as a continuous score.

### 8.3 Rules
- Every item is required; **Next** is disabled until all are answered.
- Save each item's raw answer and the computed totals and levels.
- Optional language toggle (English / Filipino) — only if a validated Filipino translation is cited.

---

## 9. Per-second recording (sampler)

A single timer fires every **1,000 ms** from the start of Calibration to the end of Recovery. On each tick it builds one row from the latest sensor reading and the latest camera result.

### Row validity
`valid = 1` only when **all** of these are true:
- a sensor line was received in the last 1.5 s
- `dataValid == true` from the firmware
- `face_detected == 1`

Invalid rows are **still saved** (with `valid = 0`), never dropped. The training script decides what to do with them.

### Timing
- Use `performance.now()` for elapsed time and `new Date().toISOString()` for wall-clock time.
- If a tick fires late (> 1,500 ms since last), still write one row; record the actual time. Do not back-fill.

### Autosave
Every 10 s, write the whole session object to IndexedDB under the participant ID. On page load, if an unfinished session exists, offer **Recover session** (download what was saved) or **Discard**.

---

## 10. Reference-device checkpoints (Objective 2)

Four checkpoints per session, at the end of Calibration, Rest, Stress and Recovery. Recording continues in the background during entry.

### Flow
1. A modal appears: **"Checkpoint 2 of 4 — read the reference devices NOW."**
2. At the moment the modal opens, the site **freezes a snapshot** of our sensors (hr, gsr, temp, motion) and the time. This is what the reference reading is paired with.
3. Operator types:
   - Smartwatch heart rate (bpm) — required
   - Thermometer temperature (°C) — required
   - GSR reference (µS) — only if a GSR reference device was entered in Setup
   - Note (optional)
4. **Save**. The modal shows how many seconds passed since the snapshot. If > 15 s, flag `late = 1`.
5. The next phase starts after Save (the timer does not run while the modal is open, except during the stress→recovery transition where the recovery timer starts after Save).

### Input validation
- HR 40–200, temperature 30–42 °C. Out of range → confirm dialog "Are you sure?"

### Output
15 participants × 4 checkpoints = **60 paired readings per sensor**, enough for MAE, percentage error and Pearson r. Checkpoints span calm and stressed states, so the comparison covers a range of values.

---

## 11. Errors, pause and abort

| Event | Behaviour |
| --- | --- |
| USB unplugged / no data for 3 s | Red banner "Sensor signal lost"; rows continue with `valid = 0`; operator can **Reconnect** without stopping |
| No face for 5 s | Amber banner "Face not visible — ask participant to face the camera" |
| Operator presses **Pause** | Timer and sampler stop; a `pause` event is logged; **Resume** continues the same phase. If paused > 60 s during Rest/Stress/Recovery, that phase restarts from 0 (log `phase_restarted`) |
| **Abort** | Confirm dialog → session marked `aborted = 1` → go to End screen; data can still be downloaded |
| Browser tab closed / crash | Autosave recovery on next load (Section 9) |
| Participant wants to stop | Use Abort; record reason in note |

All events go to the **events** CSV.

---

## 12. Output files

On **Download all CSVs**, the site saves 5 files (UTF-8, comma-separated, header row, `.` as decimal point):

```
P031_2026-11-23_samples.csv
P031_2026-11-23_checkpoints.csv
P031_2026-11-23_session.csv
P031_2026-11-23_stress_task.csv
P031_2026-11-23_events.csv
```

### 12.1 `_samples.csv` — one row per second (≈ 600–700 rows)

| Column | Type | Description |
| --- | --- | --- |
| `participant_id` | text | e.g. P031 |
| `timestamp_iso` | text | wall-clock time, ISO 8601 |
| `t_session_s` | int | seconds since calibration start |
| `phase` | text | `calibration` / `rest` / `stress` / `recovery` |
| `t_phase_s` | int | seconds since this phase started |
| `hr` | float | bpm |
| `gsr` | float | µS |
| `temp` | float | °C |
| `motion` | float | g |
| `hr_delta_pct` | float | % change vs baseline HR* |
| `gsr_delta_pct` | float | % change vs baseline GSR |
| `temp_delta` | float | °C change vs baseline temperature |
| `sensor_data_valid` | 0/1 | firmware `dataValid` |
| `finger_ok` | 0/1 | `max30102` |
| `gsr_ok` | 0/1 | `gsrConnected` |
| `temp_ok` | 0/1 | `ds18b20` |
| `mpu_ok` | 0/1 | `mpu6050` |
| `sensor_age_ms` | int | age of the latest sensor line at sampling time |
| `face_detected` | 0/1 | |
| `emotion_neutral` … `emotion_surprised` | float | 7 columns, 0–1, smoothed; empty when no face |
| `fatigue` | float | 0–100; empty when no face |
| `eyebag` | float | 0–100; empty when no face |
| `valid` | 0/1 | see Section 9 |
| `task_level` | int | stress task level at this second (stress phase only) |

\*Baseline = mean of the **rest** phase valid rows. Because the baseline is only known after rest ends, delta columns are computed for all rows **at download time** (including rest itself). Raw values are always saved, so deltas can be recomputed.

### 12.2 `_checkpoints.csv` — 4 rows

| Column | Description |
| --- | --- |
| `participant_id` | |
| `checkpoint` | 1–4 |
| `after_phase` | calibration / rest / stress / recovery |
| `snapshot_time_iso` | when our sensor values were frozen |
| `entry_time_iso` | when the operator pressed Save |
| `late` | 1 if > 15 s between snapshot and save |
| `our_hr`, `our_gsr`, `our_temp`, `our_motion` | our sensor values at the snapshot |
| `ref_hr` | smartwatch heart rate |
| `ref_temp` | thermometer temperature |
| `ref_gsr` | reference GSR (empty if none) |
| `ref_hr_device`, `ref_temp_device`, `ref_gsr_device` | model names from Setup |
| `note` | |

### 12.3 `_session.csv` — 1 row

`participant_id, date, operator, location, age, sex, heart_condition, mental_health_treatment, clinic_supervised, caffeine_2h, smoked_1h, sleep_hours, dominant_hand, glasses, calibration_seconds, calibration_forced, baseline_hr, baseline_gsr, baseline_temp, rows_calibration, rows_rest, rows_stress, rows_recovery, valid_pct_rest, valid_pct_stress, valid_pct_recovery, gad7_q1 … gad7_q7, gad7_total, gad7_level, pss10_q1 … pss10_q10 (raw answers), pss10_total, pss10_level, task_problems, task_correct, task_wrong, task_timeout, task_max_level, aborted, app_version, firmware_note`

### 12.4 `_stress_task.csv` — one row per problem

`participant_id, n, shown_time_iso, t_phase_s, level, time_limit_s, a, b, correct_answer, given_answer, result (correct/wrong/timeout), response_ms`

### 12.5 `_events.csv` — log

`participant_id, timestamp_iso, event, detail` — e.g. `phase_start`, `phase_end`, `checkpoint_saved`, `serial_lost`, `serial_reconnected`, `face_lost`, `pause`, `resume`, `phase_restarted`, `abort`, `download`.

---

## 13. How the data will be used (for the paper)

| Data | Used for |
| --- | --- |
| `rest` rows | Training/testing label **0 = not stressed** |
| `stress` rows | Training/testing label **1 = stressed** |
| `recovery` rows | Not trained on; the trained model is run on them to show stress decreasing (check) |
| `calibration` rows | Not used |
| Checkpoints | Objective 2: MAE, % error, Pearson r (and Bland–Altman if time allows), per sensor |
| GAD-7 | External reference: compare each person's GAD-7 level with their stress reaction (e.g. HR and GSR increase from rest to stress) |
| PSS-10 | Secondary reference (3 levels) |
| Stress task log | Shows the task worked (error rate, levels reached) |

Training plan (separate Python script, not part of the site):
- Cut 30-second sliding windows (step 5 s) from rest and stress rows; drop windows with < 80% valid rows.
- Features per row (13): hr, gsr, temp, motion, 7 emotions, fatigue, eyebag (fill missing camera values with 0, as before).
- **Leave-one-participant-out** cross-validation: train on 14, test on the 1 left out, repeat 15 times, report mean ± SD of accuracy, precision, recall, F1.
- Compare against a simple baseline (logistic regression on window means) and the Table 1–2 threshold rules.

---

## 14. Screens and layout

- Two zones: **participant area** (large, centre) and **operator panel** (right side, 320 px).
- Operator panel always shows: participant ID, current phase, phase timer, live sensor values with green/red dots, camera preview, Pause, Abort.
- Participant area shows only what the participant needs (instruction, breathing circle, math problem, questionnaire).
- Fonts: participant text ≥ 28 px; math problem ≥ 96 px.
- Dark background during rest/recovery to keep lighting on the face constant; **do not change screen brightness between phases** (it affects the camera).
- Keyboard: Enter submits math answers; Space never advances phases (prevents accidental skips).

---

## 15. `src/config.js` — all tunable values

```js
export const CONFIG = {
  appVersion: "collect-1.1-react",
  serial: { baudRate: 115200, staleMs: 3000, maxLineBytes: 1024 },
  sampleIntervalMs: 1000,
  autosaveMs: 10000,
  calibration: { minSeconds: 60, maxSeconds: 180, windowSeconds: 20,
                 tempRangeC: 0.2, gsrRangePct: 10, hrStdBpm: 5 },
  phases: { restSeconds: 180, stressSeconds: 180, recoverySeconds: 180,
            stressInstructionSeconds: 10 },
  stressTask: { startLimitS: 4.0, minLimitS: 2.5, maxLimitS: 4.0, stepS: 0.5,
                upAfterCorrect: 3, downAfterWrong: 2, feedbackMs: 600, noRepeat: 10 },
  checkpoints: { lateSeconds: 15, hrRange: [40, 200], tempRange: [30, 42] },
  camera: { width: 640, height: 480, detectEveryMs: 200, detectorInputSize: 320,
            scoreThreshold: 0.5, emotionEmaAlpha: 0.3, noFaceWarnSeconds: 5 },
  cnn: { modelUrl: import.meta.env.BASE_URL + "models/emotion_cnn/model.json",
         inputSize: null,        // FILL IN from training (e.g. 48 or 224)
         grayscale: null,        // FILL IN
         normalize: null,        // FILL IN, e.g. "0-1" or "imagenet"
         classOrder: ["neutral","happy","sad","angry","fearful","disgusted","surprised"] },
  faceApiModelsUrl: import.meta.env.BASE_URL + "models/face-api",
  displayTickMs: 250,
  validity: { minValidPctWarning: 80 },
};
```

---

## 16. Build order (fits Day 1)

1. Scaffold with Vite (Section 3.1), add `vite.config.js` base path and the deploy workflow; push once to confirm the empty app is live on GitHub Pages.
2. `lib/serialParser.js` + `hooks/useSerial.js` + `ConnectScreen.jsx` — connect and show live values. Test with the ESP32 (after the firmware change in Section 4).
3. `hooks/useRecorder.js` + `lib/csv.js` — 1 Hz rows into `rowsRef`, download the samples CSV. **First working milestone.**
4. `state/sessionReducer.js` + `App.jsx` + `hooks/usePhaseTimer.js` — screens and timers for calibration, rest, stress, recovery.
5. `CheckpointModal.jsx` — snapshot from refs + checkpoints CSV.
6. `StressTaskScreen.jsx` + `lib/mathTask.js`.
7. `SetupScreen`, `ScreeningScreen`, `ConsentScreen`, `QuestionnaireScreen` + `lib/scoring.js`.
8. `hooks/useModels.js` + `hooks/useCamera.js` + `lib/emotionCnn.js` + `lib/visualFatigue.js` (from Appendix A).
9. `hooks/useAutosave.js`, Pause/Abort, banners, `EndScreen.jsx`.
10. Push to `main`; test the full session in Chrome from the live URL.

---

## 17. Acceptance test (pilot on a team member before Day 2)

- [ ] `npm run build` succeeds; the GitHub Actions deploy passes; the site opens from the Pages URL in Chrome; models load with no console errors (no 404s on `/models/...`)
- [ ] No lag: the operator panel updates about 4 times per second and the React DevTools profiler shows the participant screen is not re-rendering every second
- [ ] USB connects; values update every second; unplugging shows the red banner; reconnect works
- [ ] Calibration shows live values (not zeros) and turns green when stable
- [ ] Full session runs: rest 3:00, stress 3:00, recovery 3:00, with 4 checkpoint modals
- [ ] Stress task gets harder after correct answers and easier after mistakes; feedback flashes
- [ ] GAD-7 and PSS-10 totals and levels are correct (test: all "Nearly every day" → GAD-7 = 21, Severe; PSS-10 reverse items checked by hand)
- [ ] Samples CSV has ≈ 600–700 rows, correct phase tags, 13 feature columns, no rows missing in a run of seconds
- [ ] Checkpoints CSV has 4 rows with both our values and reference values
- [ ] Closing the tab mid-session and reopening offers recovery
- [ ] Emotion values come from our CNN (check the console log of the model URL), not face-api expressions
- [ ] A full session takes ≤ 25 minutes

---

## 18. Ethics and data handling

- Adults 18+ only; signed consent before any recording.
- No names in any file — participant IDs only. Keep the ID-to-name list on paper, separate from the data.
- Video frames are **never saved**; only computed numbers.
- Download CSVs immediately after each session; back them up to the team Google Drive the same day.
- Clear the browser's autosave (IndexedDB) after each successful download.
- Data handled under the Data Privacy Act of 2012 (RA 10173).

---

## Appendix A — `src/lib/visualFatigue.js` (complete code, ported from the old system)

Copy this file as-is. It reproduces the old fatigue and eyebag scores exactly (same regions, weights and smoothing, alpha 0.4), so new data matches the old features. Do not look for the old project files.

```js
// src/lib/visualFatigue.js
const canvas = document.createElement("canvas");
const ctx = canvas.getContext("2d", { willReadFrequently: true });
const MIN_FACE_DETAIL_WIDTH = 18;
const SMOOTHING = 0.4; // weight of the previous value

export function clamp(v, min, max) {
  if (!Number.isFinite(v)) return min;
  return Math.max(min, Math.min(max, v));
}
function average(values) {
  const ok = (values || []).filter(Number.isFinite);
  return ok.length ? ok.reduce((a, b) => a + b, 0) / ok.length : 0;
}
function getBounds(points) {
  const xs = points.map(p => p.x), ys = points.map(p => p.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}
function regionRect(region, w, h, minSize) {
  let x = Math.round(region.x), y = Math.round(region.y);
  let width = Math.round(region.width), height = Math.round(region.height);
  if (![x, y, width, height].every(Number.isFinite)) return null;
  x = clamp(x, 0, w - minSize); y = clamp(y, 0, h - minSize);
  width = clamp(width, minSize, w - x); height = clamp(height, minSize, h - y);
  if (width < minSize || height < minSize) return null;
  return { x, y, width, height };
}
const luma = (d, i) => 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];

function sampleRegionLuma(region) {
  const r = regionRect(region, canvas.width, canvas.height, 1);
  if (!r) return 0;
  const d = ctx.getImageData(r.x, r.y, r.width, r.height).data;
  let total = 0, count = 0;
  for (let i = 0; i < d.length; i += 16) { total += luma(d, i); count++; }
  return count ? total / count : 0;
}
function sampleTextureScore(region) {
  const r = regionRect(region, canvas.width, canvas.height, 2);
  if (!r) return 0;
  const d = ctx.getImageData(r.x, r.y, r.width, r.height).data;
  const stride = r.width * 4;
  let total = 0, count = 0;
  for (let py = 0; py < r.height - 1; py += 2) {
    for (let px = 0; px < r.width - 1; px += 2) {
      const i = py * stride + px * 4;
      const c = luma(d, i);
      total += Math.abs(c - luma(d, i + 4)) + Math.abs(c - luma(d, i + stride));
      count++;
    }
  }
  return count ? total / count : 0;
}

const ZERO = { eyebag: 0, wrinkle: 0, fatigue: 0 };

/**
 * @param {HTMLVideoElement} video
 * @param {object} landmarks  face-api FaceLandmarks68 for the detected face
 * @param {{eyebag:number, wrinkle:number, fatigue:number}} prev  last smoothed values
 * @returns {{eyebag:number, wrinkle:number, fatigue:number}}  0–100, smoothed
 */
export function computeVisualFatigue(video, landmarks, prev = ZERO) {
  if (!video.videoWidth || !landmarks) return prev;
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

  const leftEye = landmarks.getLeftEye(), rightEye = landmarks.getRightEye();
  const leftBrow = landmarks.getLeftEyeBrow(), rightBrow = landmarks.getRightEyeBrow();
  if (!leftEye?.length || !rightEye?.length || !leftBrow?.length || !rightBrow?.length) return { ...ZERO };

  const L = getBounds(leftEye), R = getBounds(rightEye);
  const B = getBounds([...leftBrow, ...rightBrow]);
  const faceDetailWidth = average([L.width, R.width]);
  if (!Number.isFinite(faceDetailWidth) || faceDetailWidth < MIN_FACE_DETAIL_WIDTH) return { ...ZERO };

  const under = e => ({ x: e.x - e.width * 0.15, y: e.y + e.height * 0.45, width: e.width * 1.3, height: e.height * 0.95 });
  const cheek = e => ({ x: e.x - e.width * 0.1, y: e.y + e.height * 1.55, width: e.width * 1.2, height: e.height * 1.1 });
  const forehead = { x: B.x - B.width * 0.08, y: B.y - B.height * 1.25, width: B.width * 1.16, height: B.height * 0.95 };
  const crowL = { x: L.x - L.width * 0.65, y: L.y - L.height * 0.1, width: L.width * 0.55, height: L.height * 1.25 };
  const crowR = { x: R.x + R.width * 1.02, y: R.y - R.height * 0.1, width: R.width * 0.55, height: R.height * 1.25 };

  const underLum = average([sampleRegionLuma(under(L)), sampleRegionLuma(under(R))]);
  const cheekLum = average([sampleRegionLuma(cheek(L)), sampleRegionLuma(cheek(R))]);
  const cheekTex = average([sampleTextureScore(cheek(L)), sampleTextureScore(cheek(R))]);
  const foreheadTex = sampleTextureScore(forehead);
  const crowTex = average([sampleTextureScore(crowL), sampleTextureScore(crowR)]);
  if (![underLum, cheekLum, cheekTex, foreheadTex, crowTex].every(Number.isFinite)) return { ...ZERO };

  const detailFactor = clamp((faceDetailWidth - 18) / 22, 0.15, 1);
  const eyebagDelta = clamp(cheekLum - underLum, 0, 25);
  const wrinkleSignal = clamp(average([foreheadTex, crowTex]) - cheekTex, 0, 14);

  const eyebag = clamp(eyebagDelta * 4.6 * detailFactor, 0, 100);
  const wrinkle = clamp(wrinkleSignal * 9.2 * detailFactor, 0, 100);
  const fatigue = clamp(eyebag * 0.58 + wrinkle * 0.42, 0, 100);
  if (![eyebag, wrinkle, fatigue].every(Number.isFinite)) return prev;

  const a = SMOOTHING;
  return {
    eyebag: clamp(prev.eyebag * a + eyebag * (1 - a), 0, 100),
    wrinkle: clamp(prev.wrinkle * a + wrinkle * (1 - a), 0, 100),
    fatigue: clamp(prev.fatigue * a + fatigue * (1 - a), 0, 100),
  };
}
```

Usage in `useCamera.js`: keep the last result in a ref and pass it back as `prev` on each detection.

---

## References

- Cohen, S., & Williamson, G. (1988). Perceived stress in a probability sample of the United States. In S. Spacapan & S. Oskamp (Eds.), *The social psychology of health* (pp. 31–67). Sage.
- Dedovic, K., Renwick, R., Mahani, N. K., Engert, V., Lupien, S. J., & Pruessner, J. C. (2005). The Montreal Imaging Stress Task: Using functional imaging to investigate the effects of perceiving and processing psychosocial stress in the human brain. *Journal of Psychiatry & Neuroscience, 30*(5), 319–325.
- Schmidt, P., Reiss, A., Duerichen, R., Marberger, C., & Van Laerhoven, K. (2018). Introducing WESAD, a multimodal dataset for wearable stress and affect detection. *Proceedings of the 20th ACM International Conference on Multimodal Interaction*, 400–408.
- Spitzer, R. L., Kroenke, K., Williams, J. B. W., & Löwe, B. (2006). A brief measure for assessing generalized anxiety disorder: The GAD-7. *Archives of Internal Medicine, 166*(10), 1092–1097.
