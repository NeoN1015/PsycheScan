# Implementation notes

Decisions made where `PsycheScan_Collect_Spec.md` does not say exactly what to do.
Each one is the simplest option consistent with the spec. Section numbers (§) refer to the spec.

## Scope change: sensor data only (22 Nov 2026)

The site now collects **ESP32 sensor data only**, to train the LSTM. The camera was removed completely. These parts of the spec no longer apply:

| Spec part | What changed |
| --- | --- |
| §2 ML libraries, §3.1 install | `@tensorflow/tfjs` and `@vladmandic/face-api` are not installed. Dependencies are React 18, `idb-keyval` and two bundled font packages (see UI). |
| §2 paths, §3 `public/models/` | No `public/models/` folder. |
| §2.1, §3.3 refs | No `latestFaceRef` or `videoRef`. The remaining refs are `latestSensorRef`, `rowsRef`, `taskLevelRef`, `portRef`. |
| §2.1 rule 6, §3.4 App sketch | No `useModels()` and no "Loading models…" screen. The app opens directly on Setup. |
| §3 structure | `useCamera`, `useModels`, `emotionCnn`, `visualFatigue` and `CameraPreview` are not built. |
| §5 Camera pipeline, Appendix A | Not implemented: no webcam, face detection, emotion CNN, fatigue or eyebag. |
| §6.3 Connect | No "Start camera" button and no Camera check row. Start Calibration needs USB, pulse, GSR, temperature, motion and smartwatch. |
| §9 Row validity | `valid = 1` when a sensor line was received in the last 1.5 s **and** firmware `dataValid` is true. There is no face condition. |
| §11 Errors | No "Face not visible" banner and no `face_lost` events. |
| §12.1 `_samples.csv` | `face_detected`, the 7 `emotion_*` columns, `fatigue` and `eyebag` are dropped. **20 columns:** `participant_id, timestamp_iso, t_session_s, phase, t_phase_s, hr, gsr, temp, motion, hr_delta_pct, gsr_delta_pct, temp_delta, sensor_data_valid, finger_ok, gsr_ok, temp_ok, mpu_ok, sensor_age_ms, valid, task_level` |
| §13 training features | Only hr, gsr, temp and motion per row (plus the deltas and flags). There are no camera features. |
| §14 operator panel | No camera preview. |
| §15 config | The `camera`, `cnn` and `faceApiModelsUrl` settings are removed. |
| §17 acceptance test | The model / CNN items (no 404s on `/models/...`, "emotion values come from our CNN") no longer apply. |
| §18 | "Video frames are never saved" is moot: there is no video. |

The camera code existed in the history (build step 8, commit `9a211c3`). It was removed by the commit after step 9.

## Phase durations (changed 22 Nov 2026)

Rest, stress and recovery are **60 s each** (`CONFIG.phases`), not the 180 s of §6.5–§6.7 and §15.
- **Unchanged:**
  - Calibration: minimum 60 s, maximum 180 s, 20 s stability window.
  - The 10 s stress instructions.
  - The > 60 s pause-restart rule.
- **Stress task:** still adaptive and timed exactly as in §7 (4.0 s start, 2.5–4.0 s limits, harder after 3 correct, easier after 2 wrong), just for 60 s.
- **Rows per session:** about 60 rest, 60 stress and 60 recovery rows (plus calibration and checkpoint rows). The `_session.csv` columns are the same.

## Hosting on GitHub Pages (22 Nov 2026)

- The app has its own repo, `NeoN1015/DATA-GATHERING`, with this folder as the repo root and `main` as the branch. The site is `https://neon1015.github.io/DATA-GATHERING/`, so `vite.config.js` uses `base: "/DATA-GATHERING/"`.
- An earlier attempt hosted it from `NeoN1015/PsycheScan` (branch `Defense`, three folders deep). That needed a workflow at that repo's root and a branch rule on the github-pages environment, so it was dropped for a separate repo.
- localStorage and IndexedDB keys keep the `psychescan-collect` prefix. They are storage names, not URLs, and changing them would hide saved sessions.

## Setup and dependencies

- **React 18.** `npm create vite@latest` now installs React 19; it was pinned back to 18.3 to match §2.
- **Workflow on Node 22** (spec showed 20, which is past end-of-life).

## Serial (step 2)

- **Missing or non-numeric fields.** `hr`, `gsr`, `temp`, `motion` that are missing or not numbers are stored as empty. A missing `dataValid` (or any missing sensor flag) counts as `false`.
- **Non-JSON lines** are skipped with a `console.warn`, as §4 says. Lines starting with `#` are skipped silently.
- **Reconnect** first tries the USB port this site was already allowed to use (no chooser), then falls back to the port chooser.
- **Connect checks need fresh data.** Every sensor row on the Connect screen (not only "USB connected") needs a line received in the last 2 s, so a stale reading can't show green.
- **Extra event names.** Besides the §12.5 examples, the events log also records `serial_connected`, `serial_closed` and `serial_error` (with the browser's error text), to help diagnose USB problems.

## Recording and CSV (step 3)

- **Sensor values in rows** come from the latest reading, however old. `sensor_age_ms` shows its age and `valid = 0` once it is older than 1.5 s. Sensor columns are empty only if no line has arrived yet.
- **Rounding.** `%` deltas are rounded to 2 decimals, `temp_delta` and baselines to 3. Sensor values are kept exactly as received.
- **CSV format.** UTF-8 without BOM, `\n` line endings, `""`-quoted text when it contains a comma, quote or newline.
- **Downloads** are spaced 300 ms apart. Chrome asks once to "allow multiple downloads" for the site; click Allow.
- **`t_session_s` starts at 1**, because the first row is written 1 s after calibration starts.

## Phases, timers and calibration (step 4)

- **Two extra `phase` values in `_samples.csv`.** The sampler runs without a break from calibration to the end of recovery (§9), so some rows fall outside the four named phases:
  - `stress_intro`: the 10 s instruction screen before the math task. §7 says it is "not recorded as stress".
  - `checkpoint`: rows recorded while a checkpoint modal is open (§10: "recording continues in the background during entry"). Their `t_phase_s` counts from the moment the modal opened.

  With these tags, a training script that keeps `phase == "rest"` / `"stress"` never picks up the instruction screen or the minutes spent typing reference readings.
- **Restarted phases** (Restart calibration, or a pause > 60 s) keep the rows already recorded. The new attempt starts again at `t_phase_s` = 0, and a `phase_restarted` event marks the moment.
- **Stability window.** The 20 s window is the last 20 sample rows of the current calibration attempt. A row counts for a signal when its sensor line is fresh (≤ 1.5 s) and that sensor's flag is OK (HR also needs `hr > 0`). Each signal needs usable values in at least 80% of the window (16 of 20). Ranges are compared with a tiny tolerance, so 34.5 − 34.3 = 0.2 °C counts as stable despite floating-point error.
- **"Stable ✓" always advances.** Once shown, the session advances 3 s later even if a reading flickers in between (§6.4: "advance automatically 3 s after Stable ✓").
- **Not stable by 180 s.** The prompt stays on screen until the operator picks Continue anyway or Restart calibration.
- **`calibration_seconds`** = number of calibration rows recorded, across all attempts, i.e. seconds spent calibrating (pauses not counted). It is counted when the CSV is built, so it is also correct for a session aborted during calibration.
- **Badge countdown and detail line.** The badge counts down to 0:00, then shows "Stabilizing…" without a time. A small grey line under it shows the three stability values (temp range, GSR range %, HR SD), so the operator can see which sensor is unsettled.
- **Rest/recovery instruction** is shown, then fades out after 8 s, leaving only the breathing circle (§6.5: "no text to read").
- **Space** is blocked on every button (keydown and keyup), not only Next (§14).
- **Timer source.** Phase times use `performance.now()` minus paused time. Each phase screen remounts on a phase start or restart.

## Checkpoints (step 5)

- **Snapshot.** When the modal opens, `our_hr/gsr/temp/motion` take the latest sensor reading if it is at most 3 s old. Otherwise they are left empty, so a lost sensor can't produce a fake pair.
- **Our values are not shown in the modal**, so they can't influence what the operator reads off the reference devices.
- **GSR reference field** appears when Setup's "GSR reference device" is anything other than empty or "None". It is optional (§10 marks only HR and temperature as required).
- **Out of range** (HR outside 40–200, temperature outside 30–42) opens "Are you sure?" listing the problem. "Yes, save" keeps the value; "No, fix it" returns to the form.
- **Late flag.** The modal shows the seconds since the snapshot and turns red after 15 s. `late` is computed when Save is pressed.
- **Operator panel stays usable.** The modal's backdrop covers only the participant area, so Abort (and the live values) stay reachable while a checkpoint is open (§11: Pause/Abort always visible). Pause itself is disabled during a checkpoint, because the next phase only starts after Save.
- **Recording stops after checkpoint 4 is saved**, when the session moves to questionnaires.

## Stress task (step 6)

- **Score** = number of correct answers.
- **Fake "Average score"** = the larger of (0.2 × seconds elapsed, rounded up) and (score + 3). It grows with time, ends near 12 (60 s stress phase), and is always above the participant (`stressTask.averagePerSecond`, `averageLead`).
- **No-repeat rule.** 7 × 8 and 8 × 7 count as the same problem.
- **Answer box** accepts digits only (max 4). Enter with an empty box does nothing.
- **Timeouts** are logged with `result = timeout` and empty `given_answer` and `response_ms`.
- **Problems that are never answered are not logged**: the one on screen when the stress phase runs out (§7: "ends mid-question"), and one interrupted by Pause. After Resume a new problem is shown.
- **Restart after a long pause.** If the stress phase restarts (pause > 60 s), the task starts again at level 1, 4.0 s, score 0. `n` keeps counting, so problem numbers stay unique.
- **Buzz**: 150 Hz square wave, 200 ms, fixed gain 0.2 (`stressTask.buzz*` in config; set `buzz: false` to turn it off).
- **Feedback** is a full-width band across the middle of the screen, not a full-screen flash, to keep overall screen brightness steady (§14).
- **`task_level`** in samples is the level of the problem on screen at that second (between problems: the last shown level).

## Setup, screening, consent, questionnaires (step 7)

- **Required Setup fields.** Every field is required except "GSR reference device", which defaults to `None`. The ID is upper-cased automatically (`p031` → `P031`).
- **Remembered across sessions:** only the three device names (§6.0), not the operator name.
- **Session log** (`localStorage` key `psychescan-collect.sessionLog`) is "this browser's session list" (§6.0) and "the session log" (§6.1).
  - An ID is added when Setup's Next is pressed, with status `started`. The status later becomes `excluded`, `completed`, `aborted`, `recovered` or `discarded`.
  - Any ID in the log, including excluded ones, can't be reused.
  - The suggested ID is the highest `P###` in the log + 1.
- **Excluded participant.** The red banner shows the reason. "End session" writes the reason to the session log line and resets the app to Setup. No CSV or autosave is created.
- **Screening Next** is enabled only when every question is answered. Age must be a whole number 0–120 and sleep 0–24 h. Caffeine/smoking shows an amber warning but does not block.
- **Glasses question kept.** It is still asked and saved (`glasses` column), as §6.1 lists it. Its stated purpose (eyebag score) no longer applies.
- **Yes/No answers** are written as `1`/`0` in `_session.csv`. Sex is written as chosen; dominant hand as `left`/`right`.
- **Questionnaires.** GAD-7 is one page and PSS-10 the next. There is no Back button between them, and answers on the visible page can be changed until Next.
- **GAD-7 safety note.** When GAD-7 is complete and ≥ 15, a red note appears in the operator panel and stays until the session ends.
- **Filipino language toggle not built.** §8.3 makes it optional and only with a cited validated translation.

## Step 8 (models, camera) — removed

Built as specified, then removed by the scope change above. No camera, model or face code remains.

## Autosave, pause/abort, banners, End screen (step 9)

- **Autosave** starts at Consent (after eligibility is confirmed, so excluded participants leave nothing).
  - Every 10 s, state + rows go to IndexedDB (`idb-keyval`) under `psychescan-collect:session:<ID>`.
  - It stops once the CSVs are downloaded, and the copy is then deleted (§18).
  - A crash can lose at most the last ~10 s.
- **Recovery prompt** sits at the top of the Setup screen, one line per unfinished session.
  - **Recover session** downloads the 5 CSVs built from the saved copy (with an extra `recovered` event), deletes the copy, and sets the session-log status to `recovered`.
  - **Discard** asks for confirmation, deletes the copy, and sets the status to `discarded`.
- **Pause** is available from calibration to the end of recovery, but not while a checkpoint modal is open. A "Paused" screen covers the participant area.
  - The > 60 s restart rule applies to rest, stress and recovery only (§11). A long pause in calibration or the stress instructions just continues.
  - **No rows are recorded while paused.** `t_session_s` (wall time since calibration started) jumps over the paused seconds, while `t_phase_s` continues without a gap. A training script should treat a `t_session_s` step > 1 as a break in the sequence.
- **Abort** is available from Screening to Questionnaires.
  - The confirm dialog has an optional reason (§11: "record reason in note"), which goes into the `abort` event's `detail`.
  - After an abort, `_session.csv` has `aborted = 1` and blanks for anything not yet collected.
- **"Sensor signal lost" banner** (red) is shown only while recording (calibration → recovery), after 3 s without a valid line.
  - **Reconnect** closes the port if it is still open, then reopens the already-permitted port, or else shows the chooser.
  - `serial_lost` is logged when the banner appears and `serial_reconnected` when data comes back.
- **End screen** shows rows and % valid for all four recorded phases (`_session.csv` keeps only the three `valid_pct_*` columns from §12.3).
  - "Low data quality" is shown for any of the four with < 80% valid rows. Phases with 0 rows, e.g. after an abort, are skipped.
- **Download all CSVs** saves the 5 files. The `download` event is included in the events file being downloaded, and the session-log status becomes `completed` or `aborted`. **New session** is disabled until then (§6.9).
- **`_session.csv` details.** `clinic_supervised` is `0` when the participant is not in treatment. `task_max_level` is the highest level among logged problems.
- **New session keeps the USB connection** (or the simulator) open.

## Simulate sensors (dev only)

- A **"Simulate sensors" switch with a DEV tag** sits in the operator panel. It exists only in `npm run dev`. It is wrapped in `import.meta.env.DEV`, so the production build contains neither the switch nor the generator (`src/lib/simSensor.js`).
- When on, it feeds one fake JSON line per second through the same parser as the USB stream. Values are stable (HR ~74, GSR ~2.1 µS, temp ~34.4 °C) so calibration can pass.
- It can't be switched on while a real USB device is connected, and vice versa.
- Switching it on/off is logged as `sim_sensors_on` / `sim_sensors_off`. A session that used it has `SIMULATED` added to `firmware_note` in `_session.csv`.
- Turning it off mid-session is how to test the "Sensor signal lost" banner without hardware.

## UI

- **Font sizes.** Participant-facing text (instructions, math task, questionnaires) is ≥ 28 px (§14). Operator-only forms (Setup, Screening, Consent, Connect) use 18 px so they fit on one screen.
  - The small stability line under the calibration badge is operator information, so it is 14 px.
- **One dark theme everywhere**, so screen brightness never changes between phases (§14). Colours are defined once as tokens at the top of `src/index.css`.
- **Typeface.** Atkinson Hyperlegible Next for text and Atkinson Hyperlegible Mono for operator numbers (timer, live values, ID). It was designed by the Braille Institute for legibility: 1 / l / I and 0 / O look different, and zero is slashed.
  - The fonts are bundled with the site (`@fontsource-variable/*` packages), so no font is loaded from another server.
- **Status is not shown by colour alone.**
  - Live-value dots are filled when OK and a hollow ring when not.
  - Connect rows show a tick when OK.
- **Layout fixes:**
  - The math problem keeps its height while the feedback band shows, so the answer box doesn't jump.
  - Questionnaire answers sit in one row of equal-width buttons.
  - On Connect, the smartwatch tick box comes before Start Calibration.
  - Abort is a quieter red button in the operator panel. Its confirm dialog keeps the solid red button.
