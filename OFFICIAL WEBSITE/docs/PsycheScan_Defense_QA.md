# PsycheScan — Panel Defense Q&A

Likely panel questions with suggested answers, based on the revised manuscript
(CpE26 – COEN4202 FOD IMRaD), the training outputs and the website code.
Answers are written to be said out loud: short, honest, with the numbers.
Text in **[brackets]** is something only your team can fill in.

---

## 0. Fix or prepare these BEFORE the defense

These are the weak spots a careful panelist can find. Each one either needs a fix or a ready answer.

| # | Issue | What the manuscript says | What is actually true | Suggested action |
|---|---|---|---|---|
| 1 | **Emotion model used by the website** | The system uses your trained CNN (84.80%) | The website runs **face-api.js's pretrained FaceExpressionNet** (`models/face_expression_model-shard1`). Your trained CNN (`emotion_model_float32.tflite`, EfficientNet-B0) is in the `models/` folder but **nothing loads it** | Either integrate your CNN into the website, or state clearly that the deployed system uses face-api's expression model and that your CNN was trained and evaluated as a separate component. See Q-D6 |
| 2 | **OpenCV** | Facial analysis is "OpenCV-based" | The website uses **face-api.js** (TensorFlow.js) for face detection, landmarks and expressions; fatigue/eyebag are computed from pixel brightness in the browser. No OpenCV in the running system | Change "OpenCV" to "face-api.js" or "browser-based computer vision" wherever it describes the deployed system |
| 3 | **Offline claim** | Offline-capable, no cloud dependency | `modelSource` defaults to `"remote"`: face models load **from the internet first** (`justadudewhohacks.github.io`) and only fall back to the local `./models` copy | Switch the default to `"local"` before the demo (one-line change in `main_extension.js`), and test with Wi-Fi off |
| 4 | **CNN training details** | TensorFlow, 100 epochs × 4 runs, learning rate 0.001, 80/20 split | `train_emotion_model.py`: **PyTorch**, pretrained **EfficientNet-B0**, 112×112 images, **35 epochs**, AdamW (lr 0.0005, weight decay 0.01), cosine schedule, separate train/validation folders | Update the Methodology to match the script |
| 5 | **"Test" vs "validation"** | CNN "test accuracy" 84.80% | The 84.80% is **validation** accuracy (1,533 images), also used to pick the best checkpoint | Call it validation accuracy, or report a separate held-out test result |
| 6 | **Leftover manuscript errors** | — | Duplicate LSTM paragraph (pp. 65–66), one 70/15/15 sentence (p. 54), Discussion p. 75, Table 4 header, Table 5 LSTM row, Appendix J old code | Apply the fixes from the manuscript review |

---

## A. Problem, objectives and scope

**A1. What problem does PsycheScan solve?**
Mental-health screening in barangays relies on self-report questionnaires such as the PHQ-9, which depend on honest, accurate answers and give a single snapshot. PsycheScan adds objective, continuous indicators — vital signs and facial expression — to support health workers in spotting possible stress and anxiety early. It is a **decision-support tool, not a diagnostic tool**.

**A2. Is your system diagnosing depression or anxiety?**
No. It estimates a stress level (Minimal, Mild, Moderate, Severe) from physiological and facial indicators. Any diagnosis must come from a qualified professional. The output is meant to prompt a closer look or a referral.

**A3. Why stress levels instead of a yes/no "stressed / not stressed"?**
Four ordinal levels match how PHQ-9-style tools grade severity and are more useful to a health worker deciding what to do next. The trade-off is that adjacent levels are harder to separate, which shows in our results (most LSTM errors are between neighbouring levels).

**A4. Who is the intended user?**
Barangay health workers and community mental-health clinics: low-cost (₱11,069 total), runs on a mini PC, no cloud subscription.

**A5. What are the limits of your scope?**
30 participants from one clinic; adults without diagnosed psychiatric conditions or psychotropic medication; short sessions; stress *indicators*, not clinical diagnosis.

---

## B. Hardware and sensors

**B1. What sensors did you use and why?**
HW-827 pulse sensor (heart rate), GSR sensor (skin conductance), DS18B20 (skin temperature), MPU6050 (motion). Heart rate and skin conductance rise with sympathetic arousal; peripheral temperature tends to drop under stress; motion captures restlessness and helps flag movement artifacts.

**B2. How accurate are your sensors?** (Table 7)

| Sensor | Reference | MAE | % error | Pearson r |
|---|---|---|---|---|
| HW-827 pulse | Smartwatch | 1.80 bpm | 2.30% | 0.96 |
| GSR | GSR reference probe | 0.22 µS | 8.50% | 0.97 |
| DS18B20 | Clinical thermometer | 0.18 °C | 0.51% | 0.94 |
| MPU6050 | Smartwatch | 0.004 g | 12.00% | 0.90 |

All correlations are 0.90 or higher, which is strong agreement.

**B3. Why is the motion sensor's percentage error (12%) so high when r = 0.90?**
Motion values while seated are very small (hundredths of a g), so even a 0.004 g absolute error is a large *percentage*. The correlation shows it still tracks movement changes well.

**B4. A smartwatch is not a medical device. Why use it as the reference for heart rate?**
It was the reference available to us. Consumer smartwatches are generally close to ECG at rest, but a medical-grade pulse oximeter or ECG would be a stronger reference; we list this as a limitation.

**B5. Why ESP32?**
Built-in Wi-Fi for wireless transfer to the mini PC, enough ADC channels for the sensors, low cost, and good library support.

**B6. How do you handle a loose finger sensor or bad readings?**
The firmware checks signal amplitude to detect whether a finger is present, rejects values outside valid ranges, and averages heart rate over the last 10 beat intervals so a single bad beat does not swing the BPM. The LSTM only runs when it has at least 80% fresh readings from all four sensors in the 30-second window.

**B7. How much does it cost?**
₱11,069 in total (Table 2), far below commercial multi-sensor research systems.

---

## C. Data collection and participants

**C1. How many participants, and how were they selected?**
30 participants from the community mental-health clinic. Inclusion: adults able to give informed consent and follow the protocol; exclusion: diagnosed psychiatric conditions, psychotropic medication **[add the recruitment method]**.

**C2. Is 30 participants enough?**
It is enough to show feasibility and to evaluate fairly with patient-wise cross-validation, but not enough for a model ready for clinical use. Our results (54.4%, with ±9.2% variation between folds) reflect that, and we recommend a larger, more diverse dataset.

**C3. Your participants have very different amounts of data. Is that a problem?**
Yes, and we addressed it. Participants 16–30 have about 55 readings each, while one participant has 2,497. We capped each participant at 200 windows so a few long recordings could not dominate training, and used class weights to balance the stress levels.

**C4. How were the sessions run?**
**[Describe: baseline phase, questionnaire phase, session length, room setup.]** Readings were recorded at one per second.

**C5. Did you get ethical clearance and consent?**
Every participant signed the informed consent and waiver form (Appendix). **[Add the ethics review / clinic approval you obtained.]** No stress beyond mild emotional states was induced.

---

## D. CNN (facial emotion recognition)

**D1. What is the CNN architecture?**
A pretrained **EfficientNet-B0** backbone (transfer learning from ImageNet) with a custom classification head for 7 emotions: angry, disgust, fear, happy, neutral, sad, surprise. Input images are 112×112.

**D2. How was it trained?**
PyTorch, 35 epochs, batch size 32, AdamW optimizer (learning rate 0.0005, weight decay 0.01) with a cosine learning-rate schedule; the checkpoint with the best validation accuracy was kept. *(Make sure the manuscript says the same — see Section 0.)*

**D3. What dataset did you use?**
A unified dataset of facial images in seven emotion folders, split into training and validation sets **[name the source datasets in Table 3, e.g. FER-2013 / others, and the number of images]**. The validation set has 1,533 images.

**D4. What were the results?**
Validation accuracy 84.80%; macro-average precision 75.8%, recall 80.2%, F1 77.7%; weighted F1 85.1%. Best class: Happy (F1 93.8%). Weakest: Fear (60.7%) and Disgust (65.1%).

**D5. Why are Fear and Disgust so much worse?**
They are the smallest classes (37 and 80 validation images, versus 592 for Happy), and their facial features overlap with other emotions: 14% of Disgust was predicted as Sad, and 11% of Fear as Neutral. More balanced data or augmentation would help.

**D6. Is the CNN in the live system the same one you evaluated?** ⚠️ *Prepare this one carefully.*
Honest answer for the current code: the website uses face-api.js's pretrained expression network for real-time emotion probabilities, because it runs fast in the browser, offline. Our EfficientNet-B0 CNN was trained and evaluated separately (84.8%) and exported to TFLite, but it is not yet integrated into the web interface. *If you integrate it before the defense, answer instead: "Yes, the exported model is loaded in the browser."*

**D7. Training accuracy is 97.8% but validation is 84.8%. Is it overfitting?**
There is a gap of about 13 points, so mild overfitting. Validation accuracy stayed stable (84.3–84.8%) over the last epochs rather than falling, and we kept the best validation checkpoint, so the model still generalizes reasonably.

**D8. Why accuracy and macro F1 both?**
Accuracy is dominated by large classes like Happy. Macro F1 treats every emotion equally, so it reveals weak classes like Fear. That is why macro F1 (77.7%) is lower than accuracy (84.8%).

---

## E. LSTM (stress-level classification)

**E1. What does the LSTM take as input?**
A 30-second window, one reading per second, with 13 features per second: heart rate, GSR, temperature, motion; the seven emotion probabilities from the facial model; and the fatigue and eyebag scores (0–100). Facial features are set to 0 when no face is detected.

**E2. What is the architecture?**
Two stacked LSTM layers (64 and 32 units), each followed by dropout (0.2), and a 4-unit softmax output (Minimal, Mild, Moderate, Severe). Adam optimizer (learning rate 0.0005), batch size 16, class weights, up to 100 epochs with early stopping (patience 20, restoring the best weights).

**E3. Why an LSTM and not a simple classifier on averages?**
Stress shows up as *changes over time* — heart rate climbing, skin conductance rising, expression shifting. An LSTM reads the sequence in order and can use those trends, which an average of the window would lose.

**E4. Why 30 seconds?**
Long enough to capture a trend in heart rate and skin conductance, short enough to give updates during a short session and to produce enough training windows from 30 participants. The model gives a new prediction every 5 seconds.

**E5. How were the windows labelled?**
Each window was labelled from the system's integrated stress score at its last second: below 25 Minimal, 25–44 Mild, 45–69 Moderate, 70 and above Severe.

**E6. What was the LSTM's performance?**
Five-fold patient-wise cross-validation: 54.4% accuracy, macro F1 54.6% (precision 54.7%, recall 55.9%) over 1,966 windows. Per fold it ranged from 40.3% to 69.1%. For comparison, random guessing between four levels is 25%, and always answering the most common level (Mild) would give 34.6%; the macro F1 of 54.6% shows the model does better than that on every level, not just the common one.

**E7. 54.4% is low. Why should we trust it?**
Three points. It is measured the strict way: every patient is tested by a model that never saw them, so it is not inflated. Most errors are *near misses*: 78.7% of misclassifications were an adjacent level, and only 2% confused Minimal with Severe. And adding facial features raised accuracy from 37.5% (sensors only) to 54.4%, which supports the hybrid design. It is a feasibility result, and more data is the clear next step.

**E8. Why is Moderate the worst class (recall 36.2%)?**
It sits between two other levels, so it is confused in both directions: 33.4% of Moderate windows were predicted as Mild and 23.9% as Severe. Middle categories are the hardest in any ordinal problem.

**E9. Why did folds vary so much (40% to 69%)?**
Each fold tests a different 5–7 people. With so few people per fold, a few participants whose signals are unusual can pull a fold down. That is why we report the combined result over all 30 rather than one lucky split.

**E10. Why did the final model train for only 8 epochs?**
During cross-validation, early stopping found the best number of epochs in each fold. The final model, trained on all 30 participants for deployment, used the median of those values, because there is no data left to early-stop on.

**E11. The final model shows 70% accuracy. Why not report that?**
That is training accuracy on data the model has seen. The honest measure of performance on new people is the cross-validation result, 54.4%.

**E12. Sensors-only model vs multimodal?**
Sensors only: 37.49% accuracy (macro F1 38.58%). With facial features: 54.4% (54.6%). Same data, same evaluation method.

---

## F. Evaluation method

**F1. What is patient-wise cross-validation, in simple terms?**
We split the 30 participants into 5 groups. We train on 4 groups and test on the 5th, which the model has never seen, and repeat until every group has been tested once. This tells us how the model does on *new people*, which is how it will be used.

**F2. Why not a random 70/15/15 split?**
Our windows overlap heavily — consecutive windows share 28 of their 30 seconds. A random split would put nearly identical windows in both training and testing, so the model would be tested on people it already knows and the accuracy would look better than it really is.

**F3. You planned PHQ-9 correlation and Cohen's kappa. Where are those results?**
**[If you have PHQ-9 scores for participants, report the agreement here.]** If not: "The current labels come from the integrated score; validating against PHQ-9 and clinician ratings is our main recommendation." Remove the "will be assessed with PHQ-9" promise from Methodology if it was not done.

**F4. Did you compare with commercial wearables?**
Yes, for sensor accuracy (Table 7: MAE, percentage error, Pearson r against a smartwatch, GSR probe and clinical thermometer).

---

## G. Validity of the labels (the hardest question)

**G1. Your LSTM labels come from your own integrated score, which is calculated from the same sensors and facial values. Isn't the model just copying your formula?**
Partly, yes, and we state it as a limitation. The integrated score is a rule-based fusion of the same indicators, so the LSTM learns to *anticipate* that score from the recent 30-second trend rather than a clinical ground truth. It adds value by working from the sequence over time rather than a single moment. The real test is agreement with an independent reference such as PHQ-9 or clinician ratings, which is our main recommendation.

**G2. Doesn't that also explain why adding facial features improved accuracy?**
It contributes, because the integrated score itself uses emotion and fatigue values. So the 37% → 54% jump shows the facial features carry information the score depends on, not necessarily that they are better clinical markers. We are careful not to overclaim this.

**G3. What are the thresholds of the integrated score based on?**
Baseline-relative changes in the literature: heart rate increases of 10–15% for moderate and >20% for severe stress, GSR percentage change from baseline, skin temperature drop, motion RMS, and arousal-based grouping of emotions (Tables 1–2). **[Be ready to explain the weights.]**

---

## H. System design, real-time and offline operation

**H1. Walk us through the data flow.**
Sensors → ESP32 → Wi-Fi → mini PC server → browser dashboard. The webcam feeds the face models in the browser. Every second, sensor values, emotion probabilities and fatigue scores are stored; every 5 seconds the LSTM classifies the last 30 seconds.

**H2. Where does the AI run?**
Locally, on the Lenovo ThinkCentre M710Q mini PC: face models via face-api.js, the LSTM via TensorFlow.js in a background web worker. No cloud.

**H3. Does it really work without internet?** ⚠️
It can, because all model files are stored locally. But the current default setting loads the face models from the internet first. **Set the model source to local and test with Wi-Fi off before the defense.** *(Note: the ESP32 still needs a local Wi-Fi network to the mini PC, just not internet.)*

**H4. Why does the LSTM run in a web worker?**
The face library bundles an older TensorFlow core; running both on the same page caused conflicts. A separate worker isolates the LSTM and keeps the interface smooth.

**H5. What happens when the person looks away?**
Facial features become 0 for those seconds. The LSTM still runs if all four sensors are present, but the result is less reliable, and our tests show it tends to push predictions toward higher stress. The user should keep the face in frame.

**H6. How fast is it?**
**[Measure: time from reading to dashboard update, and LSTM prediction time.]** Predictions update every 5 seconds once 30 seconds of data are available.

**H7. How is patient data stored and protected?**
Locally on the mini PC (SQLite database), not uploaded anywhere. **[Mention sign-in / operator password mode, access control, anonymized IDs like "Patient 1".]**

---

## I. Results interpretation

**I1. Your CNN gets 84.8% but your LSTM 54.4%. Which part is the system's real accuracy?**
They do different jobs. The CNN recognizes emotions from a face, a well-studied task with large datasets. The LSTM grades stress into four levels from 30 participants, a harder task with far less data. The overall stress output depends on the LSTM, so 54.4% is the honest figure for stress-level classification.

**I2. What does the confusion matrix tell you?**
The model gets the *direction* right: only 18 of 896 errors were between the extremes (Minimal vs Severe). The difficulty is the boundaries between adjacent levels, especially Moderate.

**I3. If you deployed this tomorrow, what could go wrong?**
Misclassifying adjacent levels; unreliable results when the face is not visible or sensors are loose; a population that differs from our 30 participants. That is why it is decision support only.

---

## J. Limitations and future work

**J1. What are the main limitations?**
- Small dataset (30 participants, one clinic) and uneven data per participant.
- LSTM labels from the system's own integrated score, not a clinical reference.
- Facial features default to 0 without a face, which biases predictions upward.
- Weaker CNN performance on Fear and Disgust.
- Smartwatch as heart-rate reference.

**J2. What would you do next?**
Collect more participants across sites; validate against PHQ-9/GAD-7 and clinician ratings; integrate the trained CNN into the live system; handle missing faces explicitly (e.g. a "face present" input) instead of zeros; and explore longer windows and personal baselines.

**J3. What is your contribution compared with existing studies?**
A low-cost (₱11,069), offline-capable, multimodal system tested on real participants with a strict patient-wise evaluation, and evidence that combining facial and physiological signals improves stress-level classification over sensors alone.

---

## K. Curveball questions

**K1. Could someone fake a calm result?**
Facial expressions can be controlled, but heart rate, skin conductance and temperature are much harder to control voluntarily, which is a reason to combine them.

**K2. Does skin colour, glasses or lighting affect the face analysis?**
Possibly. Lighting affects the eyebag/fatigue scores (they are based on brightness), and the expression model's accuracy can vary across faces. We did not test this systematically; it is a limitation.

**K3. Why not use only the questionnaire?**
Questionnaires are essential but rely on self-report. Physiological signals give objective, continuous information that complements them.

**K4. Who is responsible if the system misses someone at risk?**
The system is a screening aid; the health worker and the standard referral process remain responsible. That is why we present it as decision support, not diagnosis.

**K5. Why these four stress levels and cut-offs (25 / 45 / 70)?**
They follow the integrated score's design, derived from the literature-based thresholds in Tables 1–2 **[explain how the cut-offs were chosen]**.

**K6. What did you personally contribute?**
**[Each member: prepare one sentence on your own part — hardware, firmware, CNN, LSTM, website, data collection, manuscript.]**
