# PsycheScan

**Real-Time Early Detection System for Mental Health Using Vital Signs Sensors Applying Hybrid CNN-LSTM Algorithms for In-Depth Analysis of Stress and Anxiety Parameters**

Colegio de Muntinlupa · Computer Engineering Department · COEN3133

**Created by Gerald Esplana**

PsycheScan is a browser dashboard that shows two evidence streams side by side:

- an **ESP32** that measures heart rate, skin conductance (GSR), peripheral skin temperature and motion, connected over **USB (Web Serial)**;
- a **webcam**, whose facial expressions and visual-fatigue cues are analysed in the browser with face-api.js.

For each patient it records a resting baseline and shows how the current vital signs differ from it (HR %, GSR %, temperature drop in °C). An LSTM model, when one is installed, gives a "Not stressed / Stressed" reading with a confidence percentage.

The site is plain HTML, CSS and JavaScript. It has no build step and no server code, and everything runs in the browser.

> **Decision-support tool only. Not a diagnosis. Does not replace clinical assessment.**

**Live site:** https://neon1015.github.io/PsycheScan/official/ (published from the `Defense` branch together with the data-gathering site at https://neon1015.github.io/PsycheScan/).

---

## Repository layout

```
.
├── site/                    The website. This folder is what GitHub Pages publishes.
│   ├── index.html
│   ├── styles.css
│   ├── js/                  App scripts (config, serial, camera, LSTM, reports, …)
│   ├── vendor/              face-api.js, Chart.js, Lucide icons, TensorFlow.js (no CDN needed)
│   ├── models/face-api/     Face detector, landmark and expression weights
│   ├── models/lstm/         Put the trained LSTM here (model.json, weights, norm_params.json)
│   ├── assets/logo.png
│   └── .nojekyll
├── firmware/                ESP32 / ESP32-S3 Arduino sketches
│   ├── psychescan_usb/      Firmware to flash: USB serial only, one JSON line per second
│   └── test_4sensors/       Bench test for the four sensors
├── training/                Python scripts that prepare data and train/export the LSTM
├── data/                    CSV datasets (not in this repository: they contain patient data and stay on the local PC)
├── docs/                    Manuscript notes, defense report and Q&A, system map, session transcripts
└── archive/                 Old or unused files kept for reference (server, old Wi-Fi firmware, old models, databases)
```

---

## Running the site locally

Web Serial and the camera only work on `https://` or `http://localhost`, so open the site through a local web server rather than by double-clicking `index.html`.

```bash
# from the repository root, with Node.js installed
npx serve site
# then open the address it prints, for example http://localhost:3000
```

Python works too:

```bash
python -m http.server 8000 --directory site
# then open http://localhost:8000
```

Use **Chrome** or **Edge** (desktop). Web Serial is not available in Firefox or Safari.

### Trying it without hardware

Add `?sim=1` to the address (for example `http://localhost:3000/?sim=1`). A **Simulate sensors** button appears on the Sensors page and generates realistic readings so you can test the whole flow. It is hidden without `?sim=1`.

---

## Running a session

1. **Add the patient.** On the Dashboard, open **Manage patients**, enter a name or code and choose **Add patient**.
2. **Connect the ESP32.** Plug it in by USB, open the **Sensors** page and choose **Connect USB**. Pick the ESP32's port in the browser's list. Each sensor card shows *Connected* once readings arrive. If the cable is unplugged, a red **Sensor disconnected** banner appears with a **Reconnect** button.
3. **Start the camera** (optional). Choose **Start Camera**; the face models load from `site/models/face-api/` the first time.
4. **Calibrate.** Choose **Calibrate** on the Dashboard. For at least one minute the panel shows the live readings and a countdown. It shows **Stable ✓** once, over the last 20 seconds, temperature varies by ≤ 0.2 °C, GSR by ≤ 10 % of its mean, and the heart-rate standard deviation is ≤ 5 bpm. If it is not stable after 3 minutes, choose **Continue anyway** or **Restart**.
5. **Capture the baseline** while the participant rests. This is only enabled after calibration. It lasts for the observation window set in the Live Monitoring Hub (3 minutes by default).
6. **Live screening.** The Dashboard shows the live charts, each vital sign's change from baseline, the emotion chart and the LSTM result. With auto-capture on, records are saved automatically.
7. **Review and export.** Use the patient's profile, **Status Summary** and **Reports** to export a CSV or print a PDF report.

Patients, baselines and records are stored in this browser's local storage, on this computer only. Clearing the browser's site data deletes them, so export a CSV after each session.

---

## Device setup (ESP32 / ESP32-S3)

Flash **`firmware/psychescan_usb/psychescan_usb.ino`**. Once per second it prints one JSON line over USB at **115200 baud**:

```json
{"hr":78.4,"gsr":2.15,"temp":34.6,"motion":0.042,"dataValid":true,"max30102":true,"gsrConnected":true,"ds18b20":true,"mpu6050":true}
```

Lines that start with `#` are debug messages, and the site ignores them.

| Sensor | ESP32 pin | ESP32-S3 pin |
|---|---|---|
| Analog pulse sensor (heart rate) | GPIO 35 | GPIO 5 |
| GSR module | GPIO 34 | GPIO 4 |
| DS18B20 temperature (1-Wire) | GPIO 4 | GPIO 15 |
| MPU6050 motion (I²C) | SDA 21, SCL 22 | SDA 8, SCL 9 |
| Status LED | GPIO 2 | none (disabled) |

1. In the Arduino IDE, install the **esp32** board package by Espressif, and the **OneWire** and **DallasTemperature** libraries.
2. Select your board. For an **ESP32-S3** connected through its native USB port, set **Tools → USB CDC On Boot → Enabled**; otherwise nothing appears on the serial port.
3. Upload, then open the Serial Monitor at 115200 baud to check that JSON lines appear. Close the Serial Monitor before connecting from the website, because only one program can use the port at a time.

---

## The LSTM model

The site loads the LSTM from `site/models/lstm/`:

| File | Contents |
|---|---|
| `model.json` + weight files (`*.bin`) | A TensorFlow.js Layers model |
| `norm_params.json` | `{"features":["hr","gsr","temp","motion"],"mean":[…],"std":[…],"sequenceLength":30,"labels":["Not stressed","Stressed"]}` |

The site reads the feature order, sequence length and labels from `norm_params.json`. Every 5 seconds it takes the last `sequenceLength` seconds of readings, normalises each value as `(x − mean) / std`, and runs the model in a background worker. It only predicts when at least 80 % of that window has valid readings. If the files are missing, the dashboard shows **LSTM model not loaded** and everything else keeps working.

The previous four-level LSTM is kept in `archive/lstm_old/` and is not used.

### Training

The scripts in `training/` are the ones used for the **previous** four-level model. They label data from the old integrated score or the Table 1 thresholds and write the old file names (`tfjs_lstm_model/`, `lstm_norm_params.json`, `label_map.json`), so they can't train the new two-label model from the new CSV export as they are. See `NOTES.md`.

```bash
cd training
python -m pip install -r requirements.txt
python train_lstm_synthetic.py --output-dir <out-folder>     # old synthetic bootstrap model
```

Whatever you train the new model with, export it as a TensorFlow.js Layers model (`lstm_tfjs_export.py` works with Keras 2 and 3), copy `model.json` and its `.bin` file(s) into `site/models/lstm/`, and write `norm_params.json` in the format above.

---

## Deploying to GitHub Pages

This folder lives in the `NeoN1015/PsycheScan` repository next to `WEBSITE FOR DATA GATHERING`. The repository's single workflow, `.github/workflows/deploy.yml` at the repository root, builds the data-gathering app and copies this folder's `site/` into it as `official/`. Every push to the `Defense` branch republishes both sites. `site/` has no build step, and all its paths are relative, so it works under `/PsycheScan/official/`.

## Data and privacy

- Patient data stays in the browser on the computer you use. Nothing is uploaded.
- Participants should be 18–65 years old and give informed consent. Handle data according to RA 10173 (Data Privacy Act of 2012).
- Do not commit patient data to a public repository. See `NOTES.md` for files in this repository's history that contain participant data.

## Troubleshooting

| Problem | Fix |
|---|---|
| **Connect USB** does nothing or says it is unsupported | Use desktop Chrome or Edge, and open the site through `localhost` or `https://`. |
| The ESP32 is not in the port list | Use a data-capable USB cable and install the CP210x/CH340 driver. On an ESP32-S3, enable **USB CDC On Boot**. |
| "Failed to open serial port" | Close the Arduino Serial Monitor or any other program using the port. |
| Camera unavailable | Allow camera access for the page, and choose the camera in Settings. |
| "LSTM model not loaded" | Copy the model files into `site/models/lstm/` (see above). |

## Team

Ageas, Axel B. · Carreon, Jannah Leigh M. · Esplana, Gerald C. · Ruina, Shane R.
Adviser: Engr. Ricrey E. Marquez, PCpE
Creator: Esplana, Gerald C.
