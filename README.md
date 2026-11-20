# PsycheScan

**Real-Time Early Detection System for Mental Health Using Vital Signs Sensors Applying Hybrid CNN-LSTM Algorithms for In-Depth Analysis of Stress and Anxiety Parameters**

Colegio de Muntinlupa · Computer Engineering Department · CpE Batch 26 · COEN3133

**Created by Gerald Esplana**

PsycheScan screens a participant for stress and anxiety by combining two evidence streams:
- an ESP32 device that measures heart rate, skin conductance (GSR), peripheral skin temperature and motion;
- a webcam, whose facial expressions and visual fatigue are analysed by convolutional neural networks (CNN).

The dashboard combines both streams into one Integrated score on a four-level scale: **Minimal, Mild, Moderate, Severe**. An LSTM network reports the sustained trend of the vital signs over the last minute. Everything runs locally on one computer; no cloud service is needed.

> Screening and decision support only. PsycheScan is not a clinical diagnosis tool. Final interpretation must involve a qualified professional.

For a full explanation of how every part works, with diagrams, see [docs/SYSTEM_ARCHITECTURE.md](docs/SYSTEM_ARCHITECTURE.md).

---

## Requirements

| What | Version / notes |
|---|---|
| Computer | Windows (tested), Linux or macOS. Designed for a Lenovo ThinkCentre M700 mini PC. |
| Python | 3.10 or newer, to run the server (standard library only) |
| Browser | Chrome or Edge. These are needed for USB (Web Serial) and Bluetooth (Web Bluetooth). |
| Webcam | Any USB webcam |
| Device | ESP32 with an analog pulse sensor, GSR module, DS18B20 and MPU6050 (see [Device setup](#device-setup)) |

---

## Quick start

1. **Start the server.** On Windows, double-click `start_server.bat`. On Linux or macOS, run `./start_server.sh`, which starts secure mode; for local test mode, run `PSYCHESCAN_LOCAL_TEST_MODE=1 ./start_server.sh` instead.
2. **Choose a mode** when `start_server.bat` asks:
   - **N, secure sign-in (use this for real sessions).** Type an operator password; the screen doesn't show what you type. Anyone signing in uses this password, with any operator ID.
   - **Y, local test mode.** Skips sign-in, and only accepts connections from the same computer.
3. **Open the address the server prints**, for example `http://localhost:8000`. Keep the server window open while you use the dashboard.

   The server also prints a network address, such as `http://192.168.1.41:8000`, for other devices. The camera only works when the page is opened through `localhost` or HTTPS.
4. **Sign in**, if you chose secure mode.

> `0.0.0.0` is not a page address and won't open in a browser. Always use the `localhost` link.

To start the server without the launcher:

```powershell
# Windows PowerShell
$env:PSYCHESCAN_OPERATOR_PASSWORD = Read-Host "Set operator password"
python server.py
```

```bash
# Linux / macOS
export PSYCHESCAN_OPERATOR_PASSWORD="$(python3 -c 'import getpass; print(getpass.getpass("Set operator password: "))')"
python3 server.py
```

| Environment variable | Default | Purpose |
|---|---|---|
| `PSYCHESCAN_OPERATOR_PASSWORD` | (none) | Sign-in password. Required in secure mode. |
| `PSYCHESCAN_LOCAL_TEST_MODE` | `0` | `1` skips sign-in. It must be used together with `PSYCHESCAN_HOST=127.0.0.1`. |
| `PSYCHESCAN_HOST` | `0.0.0.0` | Network interface the server listens on. Use `127.0.0.1` for this computer only. |
| `PSYCHESCAN_PORT` | `8000` | Port the server listens on |

The server does not read `.env` files; `.env.example` only lists the variable names.

---

## Running a session

1. **Add the patient.** On the Dashboard, open **Manage patients** and add the participant's name or code, then select them as the active patient.
2. **Connect the device.** On the **Sensors** page, choose **Wi-Fi Socket**, **Bluetooth LE** or **USB / Serial**. Each sensor card turns *Connected* once readings arrive.

   For practice without hardware, turn on **Demo sensors** in Settings or in the Live Monitoring Hub.
3. **Start the camera.** Choose **Load Models**, then **Start Camera**.
4. **Capture the baseline** while the participant is at rest. This takes the observation window set in the Live Monitoring Hub (3 minutes by default). The baseline is used for the temperature drop and for the heart-rate and GSR percentage rules.
5. **Monitor.** The Dashboard shows the live charts for the last 2 minutes, a level badge for each sensor, the **Threshold** level, the **LSTM 60 s** trend, and the emotion chart. With auto-capture on, records are saved automatically.
6. **Review and export.** Use **Status Summary**, the patient's profile, and **Reports**. From there you can export a CSV of all records, a CSV for one patient, or a printable PDF report.

---

## Device setup

The firmware to flash is **`ESP32/ESP32_81porsyento/ESP32_81porsyento.ino`**. It sends the same JSON packet every 500 ms over USB serial (115200 baud), Bluetooth LE (`ESP32_StressMon`), and a Wi-Fi WebSocket on port 81.

| Sensor | ESP32 pin |
|---|---|
| Analog pulse sensor (heart rate) | GPIO 35 |
| GSR module | GPIO 34 |
| DS18B20 temperature | GPIO 4 (1-Wire) |
| MPU6050 motion | SDA 21, SCL 22 (I²C) |
| Status LED | GPIO 2 |

1. In the Arduino IDE, install:
   - the **ESP32 board package**, which includes Bluetooth LE;
   - **WebSockets** by Markus Sattler;
   - **OneWire**;
   - **DallasTemperature**.
2. In the sketch, set `ssid` and `password` to your Wi-Fi network, then upload.
3. Open the Serial Monitor at 115200 baud to read the device's IP address.
4. Enter `ws://<device-ip>:81` in the dashboard under **Sensors → Wi-Fi / WebSocket URL**.

`ESP32/test_4sensors/` is a bench test for the sensors. `ESP32_81porsyento.ino` in the project root is an earlier Wi-Fi-only version.

---

## Severity thresholds (Table 1)

| Biomarker | Minimal | Mild | Moderate | Severe |
|---|---|---|---|---|
| Heart rate (bpm) | 60–85 (baseline) | 86–95 or +10% | 96–105 or +15–20% | > 105 or > +20% |
| GSR (µS) | 0.9–1.1 | 1.2–2.4 (+20–40%) | 2.5–4.0 (+50–100%) | > 4.0 (+100–400%) |
| Peripheral skin temperature (°C) | 0.0 to −0.2 | −0.3 to −0.8 | −0.9 to −1.5 | ≤ −1.6 |
| Motion (RMS, g) | 0.00–0.05 | 0.06–0.10 | 0.11–0.20 | > 0.20 |

How the thresholds are applied:
- For heart rate and GSR, a reading inside the Minimal range (60–85 bpm, 0.9–1.1 µS) is Minimal. Above that range, the more severe of the absolute level and the percentage-over-baseline level is used.
- Temperature is a drop from the baseline.
- All thresholds, the fusion weights (emotion 0.42, fatigue 0.18, sensors 0.40) and the timings are in [`project_config.js`](project_config.js).

---

## Models

| Model | Purpose | Location |
|---|---|---|
| SSD MobileNet V1 / Tiny Face Detector | Find the face | `models/` (face-api.js) |
| Face Landmark 68 Net | 68 facial points, used for alignment and the fatigue regions | `models/` |
| Face Expression Net | 7 emotion probabilities | `models/` |
| Sensor LSTM | Sustained level over the last 60 s of the four vital signs | `tfjs_lstm_model/`, `lstm_norm_params.json`, `label_map.json` |

The LSTM runs in a background browser worker (`lstm_worker.js`) with its own copy of TensorFlow.js (`vendor/tf.min.js`).

The current LSTM is a **bootstrap model trained on synthetic data** labelled by the Table 1 thresholds. It is not clinically validated. Its result is shown next to the Integrated score and is not part of it.

### Retraining the LSTM

```bash
python -m pip install -r requirements.txt

# Synthetic bootstrap model (what ships now; about 2 minutes on CPU)
python train_lstm_synthetic.py

# Model trained on real participant data, once you have enough sessions
python train_lstm.py --csv <exported-records>.csv
```

`train_lstm.py` needs at least three independent participants or sessions for each of the four levels. Use the CSV the dashboard exports from **Reports → Export CSV**.

Both trainers write the browser model through `lstm_tfjs_export.py`. That exporter works with Keras 2 and Keras 3; the stock `tensorflowjs` converter produces files that TensorFlow.js can't load with Keras 3. Restart the server after retraining.

---

## Project structure

```
rebuild_v2/
├── index.html, styles.css          Dashboard pages and design
├── project_config.js               Thresholds, weights, timings, hardware settings
├── main.js                         Core logic: charts, classification, fusion, visual fatigue, baseline
├── main_extension.js               Patients, records, face detection loop, Bluetooth / Wi-Fi, settings
├── main_backend.js                 Sign-in, saving and loading data from the server
├── lstm_predictor.js, lstm_worker.js   LSTM input preparation and inference
├── vendor/tf.min.js                TensorFlow.js 4.22 for the LSTM worker
├── tfjs_lstm_model/                LSTM weights (+ lstm_norm_params.json, label_map.json)
├── models/                         face-api.js model weights
├── server.py                       Local web server, API and SQLite storage
├── start_server.bat / .sh          Launchers
├── public/                         Served copy of the dashboard (refreshed at every server start)
├── data/dashboard.sqlite3          Database (patients, records, reports, readings)
├── ESP32/                          Device firmware and sensor test sketch
├── train_lstm*.py, lstm_tfjs_export.py   LSTM training and export
└── docs/                           System architecture, run guide, references
```

Edit the files in the project root, not in `public/`. The server copies the root files into `public/` every time it starts.

---

## Data and privacy

- All data stays on this computer, in `data/dashboard.sqlite3` and in the browser's local cache.
- Stored sensor readings are deleted after 30 days.
- Deleting a patient removes their records, reports and stored readings.
- The database is excluded from git (see `.gitignore`), so don't commit patient data.
- Participants should be 18–65 years old and give informed consent. Handle the data according to RA 10173 (Data Privacy Act of 2012).

## Troubleshooting

| Problem | Fix |
|---|---|
| Browser shows `ERR_ADDRESS_INVALID` | Open `http://localhost:8000`, not `0.0.0.0:8000`. |
| Sign-in fails | Use the password you set when starting the server. After 5 failed attempts in a minute, wait briefly before trying again. |
| Camera unavailable | Open the dashboard through `localhost`, allow camera access, and choose the camera in Settings. |
| LSTM badge stays on "…/60 S" | It needs 60 seconds of readings from all four sensors with skin contact. |
| Wi-Fi device won't connect | Check that the PC and the ESP32 are on the same network, and that the URL matches the IP address shown in the Serial Monitor. |
| Changes don't appear | Restart the server, then hard-refresh the browser (Ctrl+F5). |

## Team

Ageas, Axel B. · Carreon, Jannah Leigh M. · Esplana, Gerald C. · Ruina, Shane R.
Adviser: Engr. Ricrey E. Marquez, PCpE
Creator: Esplana, Gerald C.