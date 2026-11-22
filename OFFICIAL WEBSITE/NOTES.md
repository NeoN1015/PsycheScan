# Cleanup notes (branch `cleanup_v3`)

Decisions made during the cleanup that you may want to check, and things that could not be verified here.

## Do these before pushing to a public repository

1. **Wi-Fi password in git history.** The old sketches had `ssid = "NeoN"` and the real password. They are redacted in the current files, but they are still in commits `be3fff2` and `cf09168`, and pushing publishes those commits. Change that Wi-Fi password, or rewrite the history (for example with `git filter-repo`) before you push.
2. **Patient data is tracked in git.** These files contain patient-profile names (for example `gerald2`, `axel`, `Patient 1`) and their readings:
   - `data/patient-baselines.csv`, `data/patient-readings.csv`, `data/patient-baseline-readings*.csv`, `data/cnn-lstm-mental-health-records.csv`
   - `archive/db/dashboard_backup.sqlite3`, `archive/db/dashboard.sqlite3.before-baseline-csv.bak`, `archive/db/psychescan_data.db`

   If any of these are real participants, keep the repository private, or remove the files from history before making it public (RA 10173). `archive/db/dashboard.sqlite3` (the old live database) is git-ignored and was never committed.

## Commits

Sections 2, 3 and 5 change the same functions (score, levels, backend calls, BLE/Wi-Fi, LSTM, baseline), so they are one commit (`985d437`) instead of three. Sections 1, 4 and 6 each have their own commit. Your uncommitted `README.md` and `public/main.js` changes were committed first as a snapshot (`f020743`).

## Site behaviour that changed

- **No sign-in.** The sign-in screen needed `server.py`, so it was removed. Anyone who opens the page can use it.
- **Storage is browser-only.** Patients, baselines and records are stored in `localStorage` on that computer and that browser. Records and profiles saved by the old version in this browser still load, with the score and decision fields removed. Data that existed only in the old SQLite database was not imported.
- **One records list.** The old "reports" list was a duplicate subset of the records, so the Reports page now shows the records. The record limit went from 240 to 1000.
- **Settings save automatically.** The Save button is gone.
- **Removed settings and controls:** Connection mode, Wi-Fi URL, BLE UUIDs, "Model source" (face models now load only from `site/models/face-api/`), "History sampling" (packets arrive once per second anyway), the Real-Time/Review switch (it only changed a label), and the "Demo sensors" toggle (replaced by `?sim=1`).
- **Hidden credits / Snake modal removed** together with `easter_egg.js`. The team credits are still in the README.
- **Profile tabs only switch which profile you view.** Before, clicking a tab also changed the active patient, which cleared the live readings.
- **"Clear Records" now asks for confirmation.**
- **Fatigue, eyebag and wrinkle scores show as percentages.** Before, they showed Minimal/Mild/Moderate/Severe words, which were removed along with the classification.
- **Fonts.** Google Fonts was removed so nothing loads from a CDN. Inter and Manrope are used only if they are installed on the computer; otherwise the system font is used. To bundle them, add the `.woff2` files to `site/vendor/` with an `@font-face` rule.

## Things I was unsure about

- **The expected 404.** With the LSTM slot empty, the browser console shows one 404 for `models/lstm/norm_params.json`. It can't be avoided without a placeholder file, and it goes away once the model is installed. Apart from that, the console showed no errors in any test.
- **Calibration details** (the spec didn't say):
  - Each of temperature, GSR and HR needs readings in at least 80 % of the last 20 s (16 readings) before its check can pass. A missing sensor counts as not stable.
  - Only readings since Calibrate was pressed are used.
  - It finishes automatically at the first moment after 60 s when all three checks pass.
  - Closing the dialog during the run cancels it.
  - A finished calibration stays valid for that patient until you change patient or reload the page, so the baseline can be recaptured without recalibrating.
  - If you choose **Continue anyway**, the baseline records `calibration: "accepted"`, and the dashboard and profile say "not fully stable".
- **Change-from-baseline values:** HR % and GSR % are `(current − baseline) / baseline × 100`. The temperature value is `baseline − current`, so a positive number is a drop; the screen shows "Drop 0.40 °C" or "Rise 0.10 °C". Motion has no baseline indicator, because none was asked for.
- **LSTM window:** the last `sequenceLength` one-second slots. A slot is valid when a packet in that second had a valid value for every feature in `features`. With at least 80 % valid slots, the missing slots are filled from the nearest valid reading. The model may output either one unit per label (softmax) or, with two labels, one sigmoid unit giving P(`labels[1]`). If `norm_params.json` and the model disagree on steps, features or outputs, the dashboard shows "LSTM model not loaded (reason)". I tested this with a randomly initialised test model that was never committed.
- **Validity of a reading:** a value counts when its packet flag (`max30102`, `gsrConnected`, `ds18b20`, `mpu6050`) is `true` and the value is within the valid range in `site/js/config.js`. `dataValid:false` invalidates HR, GSR and temperature but not motion. Any `stress` field is ignored.
- **Disconnect banner:** it appears when the USB port is lost (unplug), not when the ESP32 merely stops sending. Replugging the same board reconnects automatically; the Reconnect button also works, and asks for the port again if needed.
- **Training scripts were not changed** (only the CSV path now points to `../data`). They still train the old 4-level model from `integratedScore`/Table 1 labels, and the new CSV export has no such column. Choosing labels for the new "Not stressed / Stressed" model (for example from a questionnaire such as PHQ-9 or GAD-7) is a research decision, so I left it to you.
- **Docs were not rewritten.** `docs/SYSTEM_ARCHITECTURE.md`, `docs/PsycheScan_Defense_Report.html`, `docs/PsycheScan_System_Map.html`, `docs/PsycheScan_Defense_QA.md` and the plan and spec documents still describe the old system (integrated score, Wi-Fi/WebSocket, server). I treated them as records of the defense. Only the Wi-Fi password quoted in `docs/manuscriptPart2revision.md` was masked. The README used to link to the Defense Report and System Map on GitHub Pages; Pages now publishes only `site/`, so copy them into `site/` if you want them online.
- **Chart.js** is the official `dist/chart.umd.js` from the npm package 4.4.1. jsDelivr's `chart.umd.min.js` is the same code minified again, so its SRI hash differs. face-api.js and Lucide match the old CDN SRI hashes exactly.

## Firmware

- `firmware/psychescan_usb/psychescan_usb.ino` **compiles** for `esp32:esp32:esp32` and `esp32:esp32:esp32s3` (USB CDC On Boot enabled) with esp32 core 3.3.11, but **it was not run on hardware**, because no ESP32 was connected.
- **ESP32-S3 pins are my choice:** pulse GPIO 5, GSR GPIO 4, DS18B20 GPIO 15, I²C SDA 8 / SCL 9, LED disabled. The original pins 34, 35 and 22 don't exist as ADC/I²C pins on the S3. Change the `#if CONFIG_IDF_TARGET_ESP32S3` block to match your wiring.
- The DS18B20 is now read without blocking. The old code waited about 750 ms every second, which paused pulse sampling.
- `max30102` is `true` only when a finger is detected **and** a valid beat has been measured. The old code sent `true` with `hr:0` while it was still waiting for beats; the site treated both cases the same.
- The pulse-detection algorithm, finger detection, GSR conversion (linear, not calibrated in µS) and motion formula are unchanged. The JSON field is still called `max30102` (as you specified), although the sensor is an analog pulse sensor.

## Moved, not deleted

Everything archived is in `archive/`: `server/` (server.py, launchers, check_db.py, create_database.py, .env.example), `site_old/` (main.js, main_extension.js, main_backend.js, easter_egg.js, project_config.js, lstm_predictor.js, old worker), `lstm_old/` (old LSTM models, norm params, label maps, parity check), `face_api_unused/`, `emotion_model_tflite/`, `db/`, `firmware/` (old Wi-Fi sketches, redacted), `docs_old/` (server run instructions, backend notes), `notes/` (pasted content), `sensor_examples/` (BLE/Wi-Fi packet examples).
