Plan
Audit the current system

List every place that shows Heart Rate, GSR/EDA, Temperature, Motion, Emotion, Visual Fatigue, Wrinkle Score, and Eyebag Score.

Find the current baseline/threshold constants.

Find duplicate sensor cards on the Sensors tab.

Find sidebar links for CNN Analysis, Temporal Engine, and Data Inputs.

Confirm what is UI-only and what is backend logic.

Replace the current baselines manually with the validated thresholds

Use Dr. Echavez’s thresholds for Heart Rate, GSR/EDA, Peripheral Skin Temperature, and Motion.

Use Dr. Stanley Ocampo’s thresholds for Facial Emotion Recognition, Eyebags/Periorbital Fatigue, and Wrinkle-Based Visual Fatigue.

Write the thresholds manually in the logic and documentation, not in a table format.

Keep per-person baseline readings where applicable.

For Heart Rate and GSR, use both absolute and relative thresholds. If both apply, use the more severe category.

Temperature should be treated as a change from baseline.

For Visual Fatigue, if it is a separate composite score, map it to the closest validated visual-fatigue category or derive it as the highest severity among facial emotion, eye bags, and wrinkles.

Change all dashboard charts to a rolling 2-minute window

Every time-series chart for Heart Rate, GSR/EDA, Temperature, Motion, and Emotion should show only the last 120 seconds.

X-axis should run from -120s to now.

The chart should auto-scroll and drop older data.

Keep the baseline reference line visible.

Do not show all-time history on the main dashboard.

For Emotion, show the last 2 minutes of emotion probability or timeline instead of all-time data.

Change Visual Fatigue, Wrinkle Score, and Eyebag Score to severity labels

Replace percentages with Minimal, Mild, Moderate, Severe.

Use the Stanley Ocampo descriptions to classify each score.

Add a short tooltip or info icon explaining each category.

Change the four main dashboard sensors to show severity labels

Heart Rate, GSR/EDA, Temperature, and Motion cards should show the current numeric value, the unit, and a severity badge: Minimal, Mild, Moderate, Severe.

Use consistent color coding: green for Minimal, yellow/amber for Mild, orange for Moderate, red for Severe.

Always show the text label, not just the color.

Remove CNN Analysis and Temporal Engine

Remove both from the sidebar and UI.

Remove their routes or pages.

If the backend still uses them internally, keep the logic but hide the UI.

Check for dead links or broken references after removal.

Move Data Inputs into Reports

Remove Data Inputs from the sidebar.

On the Reports page, add a toggle button labeled “Show Data Inputs” or “Hide Data Inputs.”

When toggled on, show the existing data input form or table inside Reports.

When toggled off, hide it.

Preserve all current data input functionality.

Fix duplication on the Sensors tab

Audit the Sensors tab for repeated sensor cards, repeated labels, or repeated readings.

Keep one card per sensor: Heart Rate, GSR/EDA, Temperature, Motion.

Reuse the same sensor card component used on the dashboard where possible.

Each card should show current value, unit, severity label, baseline reference, and a last 2-minute trend if applicable.

Improve typography and accessibility for older doctors

Increase base font size on the main dashboard.

Make labels, values, and units larger and easier to read.

Use high-contrast text.

Avoid thin or light font weights.

Increase button and touch-target sizes.

Make severity labels very clear.

Add units beside all numeric values.

Polish the overall UI structure and design

Use a consistent card-based layout.

Standardize spacing, padding, and section headers.

Create one reusable severity badge component.

Keep the dashboard balanced: camera preview on one side, biometrics on the other.

Add a severity legend.

Make the layout responsive.

Improve dark-theme contrast.

Make Reports print-friendly.

Keep sidebar navigation clean and minimal.

Acceptance criteria

No CNN Analysis or Temporal Engine in the sidebar.

No Data Inputs in the sidebar.

Reports page has a working Data Inputs toggle.

All main dashboard charts show only the last 2 minutes.

Heart Rate, GSR/EDA, Temperature, and Motion show Minimal, Mild, Moderate, Severe.

Visual Fatigue, Wrinkle Score, and Eyebag Score show severity labels instead of percentages.

Sensors tab has no duplicate sensor cards.

All thresholds match the Echavez and Stanley Ocampo PDFs.

Main dashboard text is noticeably larger and more readable.

UI is consistent, polished, and accessible.

Manual Baseline and Threshold Values
Write these manually into the system logic and documentation. Do not place them in a table.

Heart Rate, HR, bpm

Minimal: 60–85 bpm baseline.

Mild: 86–95 bpm or +10%.

Moderate: 96–105 bpm or +15–20%.

Severe: greater than 105 bpm or +20%.

GSR, μS

Minimal: 0.9–1.1 μS.

Mild: 1.2–2.4 μS, or +20–40%.

Moderate: 2.5–4.0 μS, or +50–100%.

Severe: greater than 4.0 μS, or +100–400%.

Peripheral Skin Temperature, °C

Minimal: about 0.0°C to -0.2°C.

Mild: -0.3°C to -0.8°C.

Moderate: -0.9°C to -1.5°C.

Severe: less than or equal to -1.6°C.

Motion, RMS, g

Minimal: 0.00–0.05 g.

Mild: 0.06–0.10 g.

Moderate: 0.11–0.20 g.

Severe: greater than 0.20 g.

Facial Emotion Recognition, AU

Minimal: neutral or positive expressions; no persistent visible distress.

Mild: occasional sadness or surprise.

Moderate: repeated sadness, disgust, or other visible distress expressions.

Severe: frequent or sustained expressions of distress, fear, or anger.

Eyebags / Periorbital Fatigue

Minimal: clear under-eye region, no visible darkening or puffiness, uniform skin texture.

Mild: mild under-eye shadowing, minor texture variation in the periorbital area.

Moderate: visible dark circles or mild puffiness, reduced brightness in the under-eye region.

Severe: prominent dark circles, deep eye bags, strong contrast difference, and/or swelling.

Wrinkle-Based Visual Fatigue

Minimal: smooth skin texture, no visible fine lines or wrinkles in the forehead and eye regions; uniform facial surface.

Mild: slight expression lines in the forehead or eye corners visible during facial movement; minimal static wrinkles.

Moderate: noticeable fine lines present even in a neutral expression; visible crow’s feet or forehead lines.

Severe: deep, persistent wrinkles in multiple facial regions; strong texture variation and high edge density indicating pronounced facial fatigue.

Copy-Paste Prompt
Update the PsycheScan UI and threshold logic with the following changes. Do not write code yet. This is a specification only.

Replace all current baseline and threshold values with the validated values below. Write these thresholds manually in the logic and documentation. Do not put the baseline values in a table.

Heart Rate, HR, bpm:
Minimal is 60–85 bpm baseline. Mild is 86–95 bpm or +10%. Moderate is 96–105 bpm or +15–20%. Severe is greater than 105 bpm or +20%.

GSR, μS:
Minimal is 0.9–1.1 μS. Mild is 1.2–2.4 μS, or +20–40%. Moderate is 2.5–4.0 μS, or +50–100%. Severe is greater than 4.0 μS, or +100–400%.

Peripheral Skin Temperature, °C:
Minimal is about 0.0°C to -0.2°C. Mild is -0.3°C to -0.8°C. Moderate is -0.9°C to -1.5°C. Severe is less than or equal to -1.6°C.

Motion, RMS, g:
Minimal is 0.00–0.05 g. Mild is 0.06–0.10 g. Moderate is 0.11–0.20 g. Severe is greater than 0.20 g.

Facial Emotion Recognition, AU:
Minimal is neutral or positive expressions with no persistent visible distress. Mild is occasional sadness or surprise. Moderate is repeated sadness, disgust, or other visible distress expressions. Severe is frequent or sustained expressions of distress, fear, or anger.

Eyebags and Periorbital Fatigue:
Minimal is a clear under-eye region, no visible darkening or puffiness, and uniform skin texture. Mild is mild under-eye shadowing and minor texture variation in the periorbital area. Moderate is visible dark circles or mild puffiness with reduced brightness in the under-eye region. Severe is prominent dark circles, deep eye bags, strong contrast difference, and/or swelling.

Wrinkle-Based Visual Fatigue:
Minimal is smooth skin texture, no visible fine lines or wrinkles in the forehead and eye regions, and a uniform facial surface. Mild is slight expression lines in the forehead or eye corners visible during facial movement, with minimal static wrinkles. Moderate is noticeable fine lines present even in a neutral expression, with visible crow’s feet or forehead lines. Severe is deep, persistent wrinkles in multiple facial regions, with strong texture variation and high edge density indicating pronounced facial fatigue.

For Heart Rate and GSR, use both absolute and relative thresholds. If both apply, use the more severe category. Treat Temperature as a change from baseline. Keep per-person baseline readings where applicable. For Visual Fatigue, if it is a separate composite score, map it to the closest validated visual-fatigue category or derive it as the highest severity among facial emotion, eye bags, and wrinkles.

On the main dashboard, every time-series chart for Heart Rate, GSR/EDA, Temperature, Motion, and Emotion must show only the most recent 2 minutes, which is 120 seconds. Do not show all-time data. Use a rolling window with relative time labels from -120s to now. Auto-scroll and drop older data. Keep the baseline reference line visible.

Change Visual Fatigue, Wrinkle Score, and Eyebag Score from percentages to severity labels: Minimal, Mild, Moderate, Severe. Use the descriptions above to classify them. Add tooltips if helpful.

Change the four main dashboard sensor cards, Heart Rate, GSR/EDA, Temperature, and Motion, to display both the numeric reading and a severity badge: Minimal, Mild, Moderate, Severe. Use consistent colors: green, yellow or amber, orange, red. Always show the text label too, not just the color.

Remove CNN Analysis and Temporal Engine from the sidebar and UI. Remove their routes or pages. If the backend still uses them internally, keep the logic but hide the UI.

Remove Data Inputs from the sidebar. On the Reports page, add a toggle button that shows or hides the Data Inputs form or table when pressed. Preserve all existing data input functionality.

Fix duplication on the Sensors tab. Show one card per sensor: Heart Rate, GSR/EDA, Temperature, Motion. Remove repeated sections, duplicate labels, or duplicate readings. Reuse the same sensor card component from the dashboard where possible. Each card should show current value, unit, severity label, baseline reference, and a last 2-minute trend if applicable.

Increase the font size and readability of the main dashboard because older doctors will use it. Use high-contrast text, larger labels, larger values, clear units, and larger buttons and touch targets.

Polish the overall UI. Use a consistent card layout, standard spacing, clear section headers, a reusable severity badge component, a severity legend, a responsive layout, better dark-theme contrast, and a print-friendly Reports page.

Acceptance criteria: no CNN Analysis or Temporal Engine tabs; no Data Inputs sidebar tab; Reports has a working Data Inputs toggle; all dashboard charts show only the last 2 minutes; the four sensors show severity labels; visual scores show severity labels; the Sensors tab has no duplicate sensor cards; all thresholds match the values above; main dashboard text is larger and accessible.

