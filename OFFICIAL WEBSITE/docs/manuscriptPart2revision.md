# PsycheScan Manuscript — Revision Notes (Part 2)

Review of the final manuscript *CpE26 – COEN4202 FOD IMRaD Manuscript (1).pdf*, checked against the training outputs (`lstm_patients_output_multimodal_tuned/`), `train_lstm_patients.py`, `train_emotion_model.py` and the website code.

Page numbers are the **printed** page numbers at the bottom of each page.

**Already fixed in this version:** the duplicate LSTM paragraph is gone, the 70/15/15 split is replaced on pp. 51 and 54, Table 5's header now reads "LSTM (Multimodal Temporal Analysis)", the p. 71 summary says "combined physiological sensor and facial data", and the Recommendation section now covers the label source, the uneven data and missing faces.

---

## 1. Must fix

### 1.1 CNN training details contradict each other (pp. 41–42 vs p. 66)

- **p. 41–42 says:** TensorFlow, 100 epochs per run, repeated 4 times, learning rate 0.001, 80/20 split.
- **p. 66 (Figure 19) says:** "Over 35 epochs".
- **What `train_emotion_model.py` actually does:** PyTorch, pretrained **EfficientNet-B0**, 112×112 images, **35 epochs**, **AdamW** (learning rate **0.0005**, weight decay 0.01), cosine learning-rate schedule, batch size 32, separate training and validation folders (validation set: 1,533 images).

**Action:** rewrite the CNN training paragraph on pp. 41–42 to match the script.

Also on p. 42, **replace:**

> "…while the LSTM component processed time-series physiological data, including heart rate, skin conductance, temperature, and motion signals. Feature fusion was performed in the later layers of the network to generate a combined representation before classification."

**with:**

> "The CNN's emotion probabilities, together with the fatigue and eyebag scores, were passed to the LSTM as inputs at each second alongside the four sensor readings."

### 1.2 Figures 11 and 12 show the old model (pp. 42–43)

Figure 12's log says "Loaded 8 sequences of shape (8, 60, 4)", and Figure 11's validation accuracy jumps between 50% and 100%. That is the old synthetic model with "eight sixty-second sequences", while the text below describes the new one.

**Action:** remove both figures, or replace them with `training_curves.png` from `lstm_patients_output_multimodal_tuned/results/`.

### 1.3 Cost total is wrong (p. 36)

The items in Table 3 add up to **₱12,569**:

| Item | ₱ |
|---|---|
| Lenovo ThinkCentre M710Q | 5,000 |
| ViewSonic Monitor | 5,000 |
| Zeus Keyboard and Mouse | 358 |
| MPU6050 | 175 |
| DS18B20 | 96 |
| HW-827 | 144 |
| GSR | 871 |
| ESP32 | 350 |
| Power Supply Module | 75 |
| Miscellaneous | 500 |
| **Total** | **12,569** |

The text says **₱11,069**, which is ₱1,500 off. Either one of the prices or the total is wrong.

### 1.4 Table references are off by one after renumbering

| Page | Currently says | Should say |
|---|---|---|
| 36 | "Table 2 presents the detailed list of components" | **Table 3** |
| 70 | "Table 4 presents the performance metrics" | **Table 5** |
| 71 | "Table 5 summarizes the overall performance" | **Table 6** |

### 1.5 Appendix K publishes your Wi-Fi name and password (p. 106)

The ESP32 code includes:

```cpp
const char* ssid = "<your real SSID>";          // masked in this note
const char* password = "<your real password>";  // masked in this note
```

**Action:** replace them with `"YOUR_WIFI"` / `"YOUR_PASSWORD"` before submitting, and change the actual Wi-Fi password if it's one you still use.

### 1.6 Appendices I and J are not training code

- **Appendix I, "CNN Training Source Code" (p. 104):** this is actually the browser detection code (`runDetectionFrame`), and it uses `faceapi.detectSingleFace(...).withFaceExpressions()`. That shows the live system runs face-api.js's expression model, not your trained CNN or OpenCV (see the Q&A file, Section 0).
  **Action:** replace it with code from `train_emotion_model.py` (the model definition and the training loop).
- **Appendix J, "LSTM Training Source Code" (p. 105):** this is still the old 4-feature prediction code (`predictStress`, `item.hr, item.gsr, item.temp, item.motion`).
  **Action:** replace it with `make_windows` and `build_model` from `train_lstm_patients.py`.

---

## 2. Left over from the last review

| Page | Currently says | Change to |
|---|---|---|
| 54 (Data Preprocessing, Labeling, and Validation) | Labels "derived from validated psychological instruments such as the PHQ-9 questionnaire. These labels will serve as the 'ground truth'…" | "Each window was labeled from the system's integrated stress score; validation against PHQ-9 is recommended for future work." *(Currently contradicts p. 44 and the Recommendation on p. 78.)* |
| 75 (Discussion) | "…F1-score of 54.60% using physiological measurements" | "…using combined physiological and facial inputs" |
| 70 (Table 6, LSTM row) | "…classifying stress severity levels using physiological sensor data" | "…using combined physiological sensor and facial data" |
| 68 (LSTM confusion matrix paragraph, last sentence) | "…temporal features from the heart rate, GSR, temperature, and motion sensor data" | add "together with the facial emotion and fatigue indicators" |
| 45 and 72 | "test accuracy of 84.80%" | "validation accuracy of 84.80%" *(the screenshot says "Validation accuracy: 0.8480")* |
| 66 (Figure 19) and 41 (Figure 10) | Images show the `FutureWarning` and `Traceback (most recent call last):` lines | Crop just below "Loading best checkpoint" |

---

## 3. Smaller issues worth fixing

- **Abstract (p. vi):** it's still in future tense ("Data will be benchmarked… Key findings will include…"). A final manuscript should state the results, for example: CNN 84.80% validation accuracy, LSTM 54.40% under five-fold patient-wise cross-validation, and sensor correlations of r = 0.90–0.97 against reference devices.
- **Table 2, peripheral skin temperature (p. 25):** the table uses absolute ranges (36.1–37.2 °C, 37.3–38.0 / 32.0–35.0 °C, …). The version Dr. Echavez validated in Appendix A (p. 92) uses drops from baseline (~0.0 to −0.2 °C, −0.3 to −0.8 °C, −0.9 to −1.5 °C, ≤ −1.6 °C). By Table 2 as printed, your measured 34.55–36.10 °C would count as Mild or out of range, yet Table 7 says "Within threshold".
  **Action:** use the validated relative version in Table 2.
- **Appendix F (p. 98):** participants' first names and ages can still be read. Under the Data Privacy Act (RA 10173), blur the names completely.
- **Promised but not reported:** either report these, or state plainly that they are future work, because the panel will ask about each one.
  - **Objective 1:** usability, user satisfaction, and agreement with practitioner assessments.
  - **Objective 2:** processing latency and responsiveness. p. 65 admits these weren't measured.
  - **pp. 52 and 58:** agreement with PHQ-9 using Pearson's r and Cohen's κ.

---

## 4. Related follow-ups

- **Website offline setting:** `main_extension.js` defaults to `modelSource: "remote"`, so the face models load from the internet first. Set it to `"local"` and test with Wi-Fi off before the demo.
- **Defense Q&A file:** `PsycheScan_Defense_QA.md` needs updating to match this version: the cost total, and the table numbers (sensor accuracy is now Table 8, the performance table is Table 5).

---

## 5. Conflicts the fixes above would create

Checked against the manuscript and the current code in `E:\PsycheScan\PD2 website\rebuild_v2`. Each item says which fix causes it and what else has to change with it.

### 5.1 The CNN fix (1.1) exposes that the LSTM was fed by a different CNN — **most important**

Once p. 41 and Appendix I describe your **EfficientNet-B0** (84.80%), p. 44 still says the LSTM's seven emotion probabilities were "produced by the CNN". In fact, the website, and therefore all 30 patients' training data, used **face-api.js's pretrained FaceExpressionNet**. Your EfficientNet has never run in the website.

- **Option A (honest wording, no code change):** on p. 44 and p. 65, say the emotion probabilities come from "the deployed facial-expression CNN (face-api.js FaceExpressionNet, a pretrained CNN running in the browser)". Present the EfficientNet-B0 as the team-trained CNN, evaluated separately (84.80%) as the replacement candidate.
- **Option B (swap the CNN in the website):** this would make the manuscript true, but the **LSTM would then have to be retrained**. It learned from face-api's probability patterns, so feeding it EfficientNet outputs would make its 54.4% result invalid.

Whichever you choose, every "CNN accuracy 84.80%" statement must make clear which model it refers to.

### 5.2 The CNN fix (1.1) also contradicts other "OpenCV / TensorFlow" passages

The script uses PyTorch and torchvision. It converts images to grayscale and applies random flip, rotation and brightness/contrast jitter, with ImageNet normalisation. It doesn't use OpenCV. Update these as well, or they will contradict the new p. 41:

| Page | Says | Change to |
|---|---|---|
| 39 (B. Data Preparation) | "Facial images are processed using OpenCV through lighting adjustment, contrast enhancement, noise reduction, and background segmentation" | grayscale conversion, resizing to 112×112, random horizontal flip, rotation (±10°), brightness/contrast jitter, ImageNet normalisation (torchvision) |
| 41 | "OpenCV for facial feature extraction and TensorFlow for deep learning" | PyTorch for the CNN; TensorFlow/Keras for the LSTM; TensorFlow.js and face-api.js in the browser |
| 46 | model "exported in an optimized format (e.g., .h5 or .tflite)" | LSTM exported to TensorFlow.js (`model.json`); CNN exported to ONNX/TFLite |
| 47 | "integrated into a Python-based application" | a browser-based dashboard served by a local Python server; inference runs in the browser |
| 57, 64 | library lists without PyTorch / face-api.js | add PyTorch (CNN training) and face-api.js / TensorFlow.js (runtime) |
| 8, 13, 19, 21, 22, 34, 47, 51, 65 | "OpenCV" for live facial analysis | "face-api.js" or "browser-based computer vision" |

### 5.3 "Test" → "validation" (Section 2) leaves two sentences behind

- **p. 44–45:** "assessed using a separate test dataset". The CNN used a validation set and the LSTM used cross-validation, so neither had a separate test set. Change to: "assessed using the CNN's validation set and five-fold patient-wise cross-validation for the LSTM".
- **p. 57:** "computed using a test dataset". Make the same change.

### 5.4 Fixing p. 54 (labels from the integrated score) raises two code conflicts

1. **The cut-offs don't match.** The LSTM was trained with **<25 / 25–44 / 45–69 / ≥70** (`score_to_label` in `train_lstm_patients.py`, as stated on p. 44). The dashboard labels the integrated score with **0–25 / 26–50 / 51–75 / 76–100** (`PROJECT_CONFIG.severity.score`). For example, a score of 47 is "Moderate" for the LSTM but "Mild" on the dashboard. Either explain the difference in one sentence on p. 44, or retrain the LSTM with 25/50/75.
2. **The fusion formula on p. 23 doesn't match the code.** p. 23 describes a weight per *sensor* per *subject* (w_ip = F1_ip / ΣF1). The code fuses only two modalities, face (CNN) and biometric (LSTM), with one global weight each. Also, `PROJECT_CONFIG.fusion.f1.cnn` is `null`, so the site currently uses **equal 50/50 provisional weights**, not F1 weights.
   - Reword p. 23 to: "two modalities (facial and biometric), weight = modality macro-F1 / sum of macro-F1s".
   - Set `fusion.f1.cnn` (e.g. to 0.7766) **if** the panel accepts that F1 for the deployed face model (see 5.1).
   - Note: the current integrated score now **includes the LSTM's own prediction**. The labels the LSTM was trained on were the score as computed at data collection, so say "the integrated score recorded during data collection".

### 5.5 The Table 2 temperature fix (Section 3) conflicts with the website code

The site implements Table 2's **absolute** bands exactly (`PROJECT_CONFIG.thresholds.temp.bands`: 36.1–37.2 Minimal, 32.0–35.0 Mild, …). If only the manuscript is switched to Dr. Echavez's **relative** version, the manuscript and the website disagree. Choose one:

- **Switch both:** change the manuscript and the website code to temperature drop from baseline (the firmware already sends `tempDrop`).
- **Keep absolute in both:** then explain on p. 25 why it differs from the validated sheet in Appendix A. Also change Table 7's "Within threshold" for temperature: under absolute bands, readings of 32.0–35.0 °C count as **Mild**, and several participants fall there (34.55–35.0 °C).

### 5.6 Figure 15 GSR data conflicts with the Appendix K firmware — check before the defense

In `patients-1-30-all-readings.csv`, several participants (Patients 1–9 in Figure 15) have GSR fixed at **0.13 µS for the entire session**: 115, 144 and 570 readings, all exactly 0.13. A constant value like that means the electrodes weren't reading skin. The Appendix K firmware would report **0** for anything under 0.5 µS (`gsrOnSkin`), so these values came from an earlier firmware version.

- **The panel may ask:** "Why do nine patients have identical GSR?" and "How was GSR r = 0.97 (Table 8) measured if nine sessions had no GSR signal?"
- **Action:** state in the Results that GSR was not captured for those sessions, for example because of loose electrodes or an earlier firmware. Check which sessions the Table 8 GSR comparison used.

### 5.7 Replacing Figures 11–12 (1.2): use one replacement, not removal

`lstm_patients_output_multimodal_tuned/results/training_curves.png` shows the **final model's** training loss (1.14 → 0.64) and training accuracy (41% → 70%) over 8 epochs. It has no validation curve, because that run uses all 30 participants.

- **Use it for Figure 11**, captioned "Final LSTM model training loss and accuracy (all 30 participants)".
- **For Figure 12**, use a screenshot of the new model's architecture summary (two LSTM layers, 64 and 32 units), or delete it.
- **Deleting both figures instead** would renumber Figures 13–22 and their in-text references, so replacing them is less work.

### 5.8 The offline fix (Section 4) is not enough on its own

`index.html` loads **face-api.js, Chart.js and Lucide from cdn.jsdelivr.net**, plus Google Fonts. With no internet, face-api.js doesn't load, so emotion detection and the LSTM's facial inputs stop working, even after `modelSource` is set to `"local"`.

- **Action:** save those three scripts into `vendor/` (as was already done for `tf.min.js`), point `index.html` at the local copies, then test with Wi-Fi off. Until then, the "offline-capable" claims on pp. 64–65 and 75 are not true for the website.

### 5.9 No conflicts found

- **Cost (1.3):** ₱11,069 appears only on p. 36 and in the Q&A file, not in the website.
- **Table references (1.4):** the List of Tables already uses the new numbers.
- **Discussion, Table 6 and p. 68 wording (Section 2):** consistent with p. 44 and p. 71 once changed.
- **Appendix J replacement (1.6):** matches the description on p. 44.
