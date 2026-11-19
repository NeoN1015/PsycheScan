"""Train the PsycheScan LSTM on synthetic sensor sequences (bootstrap model).

There is not yet enough labelled real-world data (see train_lstm.py, which
needs >= 3 independent participants/sessions per class). Until there is, this
script produces a working 4-class model from synthetic 60-second windows whose
labels come from the project's Table 1 biomarker thresholds
(PROJECT_CONFIG.biomarkers in project_config.js).

What the LSTM adds over the instant threshold badge: the label reflects the
*sustained* level over the most recent 30 seconds (median per sensor) and the
temperature *decline across the window*, so brief spikes - a finger slipping
off the pulse sensor, an arm movement - do not change the result.

IMPORTANT: this model reproduces the threshold rules on clean synthetic data.
It is a placeholder for a model trained on real, clinically labelled sessions
and must not be presented as clinically validated.

Usage:  python train_lstm_synthetic.py [--output-dir .] [--seed 7]
Writes: tfjs_lstm_model/, lstm_norm_params.json, label_map.json
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

os.environ.setdefault("TF_CPP_MIN_LOG_LEVEL", "2")

import numpy as np

SEQUENCE_LENGTH = 60          # samples, resampled to 1 Hz in lstm_predictor.js
RECENT_WINDOW = 30            # label uses the median of the last 30 s
TEMP_EDGE = 10                # temperature decline = mean(first 10 s) - mean(last 10 s)
CLASS_NAMES = ["Minimal", "Mild", "Moderate", "Severe"]
FEATURES = ["hr", "gsr", "temp", "motion"]

# Table 1 thresholds, copied from project_config.js (biomarkers.*):
# (mild_min, moderate_min, severe_bound, severe_is_strictly_above).
# HR > 105 bpm, GSR > 4.0 µS and motion > 0.20 g are Severe; a temperature
# drop of 1.6 °C or more is Severe. The relative (% over baseline) HR/GSR rules
# need a per-patient baseline, which the LSTM input does not carry.
THRESHOLDS = {
    "hr": (86.0, 96.0, 105.0, True),
    "gsr": (1.2, 2.5, 4.0, True),
    "temp_drop": (0.3, 0.9, 1.6, False),
    "motion": (0.06, 0.11, 0.20, True),
}
# Value ranges used to *generate* each level (labels are recomputed afterwards).
LEVEL_RANGES = {
    "hr": [(58, 85.5), (86, 95.9), (96, 105.0), (105.1, 140)],
    "gsr": [(0.3, 1.19), (1.2, 2.49), (2.5, 4.0), (4.01, 9.0)],
    "temp_drop": [(0.0, 0.29), (0.3, 0.89), (0.9, 1.59), (1.6, 3.2)],
    "motion": [(0.003, 0.059), (0.06, 0.109), (0.11, 0.20), (0.201, 0.55)],
}
EPS = 1e-9  # same floating-point tolerance as the dashboard
VALID = {"hr": (25, 240), "gsr": (0, 100), "temp": (15, 45), "motion": (0, 16)}


def level_of(key: str, value: float) -> int:
    mild, moderate, severe, strictly_above = THRESHOLDS[key]
    if (value > severe + EPS) if strictly_above else (value >= severe - EPS):
        return 3
    if value >= moderate - EPS:
        return 2
    if value >= mild - EPS:
        return 1
    return 0


def label_sequence(seq: np.ndarray) -> int:
    """Ground-truth rule: worst sustained level across the four sensors."""
    recent = seq[-RECENT_WINDOW:]
    levels = [
        level_of("hr", float(np.median(recent[:, 0]))),
        level_of("gsr", float(np.median(recent[:, 1]))),
        level_of("temp_drop", float(seq[:TEMP_EDGE, 2].mean() - seq[-TEMP_EDGE:, 2].mean())),
        level_of("motion", float(np.median(recent[:, 3]))),
    ]
    return max(levels)


def _profile(rng, start: float, end: float, n: int) -> np.ndarray:
    """Steady, onset (ramp up/down) or step trajectory from start to end."""
    kind = rng.choice(["steady", "ramp", "step"], p=[0.45, 0.35, 0.20])
    if kind == "steady":
        return np.full(n, end)
    t0 = int(rng.integers(0, n // 2))
    t1 = int(rng.integers(t0 + 1, n - RECENT_WINDOW // 2)) if kind == "ramp" else t0 + 1
    out = np.empty(n)
    out[:t0] = start
    out[t0:t1] = np.linspace(start, end, t1 - t0)
    out[t1:] = end
    return out


def _ar_noise(rng, n: int, sd: float, phi: float = 0.7) -> np.ndarray:
    noise = np.empty(n)
    noise[0] = rng.normal(0, sd)
    for i in range(1, n):
        noise[i] = phi * noise[i - 1] + rng.normal(0, sd * np.sqrt(1 - phi ** 2))
    return noise


def _spikes(rng, series: np.ndarray, magnitude: float, multiplicative: bool = False) -> None:
    if rng.random() >= 0.45:
        return
    for _ in range(int(rng.integers(1, 4))):
        start = int(rng.integers(0, len(series)))
        width = int(rng.integers(1, 4))
        delta = rng.choice([-1, 1]) * magnitude * rng.uniform(0.5, 1.0)
        if multiplicative:
            series[start:start + width] *= max(0.2, 1 + delta)
        else:
            series[start:start + width] += delta


def make_sequence(rng, target: int) -> np.ndarray:
    n = SEQUENCE_LENGTH
    # One sensor carries the target level; the others sit at or below it.
    lead = int(rng.integers(0, 4))
    levels = [target if i == lead else int(rng.integers(0, target + 1)) for i in range(4)]
    pick = lambda key, lvl: rng.uniform(*LEVEL_RANGES[key][lvl])
    earlier = lambda lvl: int(rng.integers(0, 4)) if rng.random() < 0.3 else lvl

    hr_end = pick("hr", levels[0])
    hr = _profile(rng, pick("hr", earlier(levels[0])), hr_end, n) + _ar_noise(rng, n, 1.8)
    _spikes(rng, hr, 35)

    gsr_end = pick("gsr", levels[1])
    gsr = _profile(rng, pick("gsr", earlier(levels[1])), gsr_end, n)
    gsr *= 1 + _ar_noise(rng, n, 0.03)
    _spikes(rng, gsr, 0.8, multiplicative=True)

    start_temp = rng.uniform(31.0, 35.8)
    drop = pick("temp_drop", levels[2])
    shape = np.clip(np.linspace(0, 1, n) * rng.uniform(0.8, 1.25), 0, 1) if rng.random() < 0.6 \
        else 1 / (1 + np.exp(-(np.arange(n) - rng.uniform(15, 40)) / 3))
    temp = start_temp - drop * shape + _ar_noise(rng, n, 0.03)

    motion_end = pick("motion", levels[3])
    motion = _profile(rng, pick("motion", earlier(levels[3])), motion_end, n)
    motion = motion * (1 + _ar_noise(rng, n, 0.12)) + rng.normal(0, 0.003, n)
    _spikes(rng, motion, 0.35)

    seq = np.stack([
        np.clip(hr, *VALID["hr"]),
        np.clip(gsr, *VALID["gsr"]),
        np.clip(temp, *VALID["temp"]),
        np.clip(motion, *VALID["motion"]),
    ], axis=1)
    return seq.astype(np.float32)


def make_dataset(rng, count: int) -> tuple[np.ndarray, np.ndarray]:
    X = np.stack([make_sequence(rng, int(rng.integers(0, 4))) for _ in range(count)])
    y = np.array([label_sequence(seq) for seq in X], dtype=np.int64)
    return X, y


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--output-dir", type=Path, default=Path("."))
    parser.add_argument("--train-size", type=int, default=16000)
    parser.add_argument("--epochs", type=int, default=30)
    parser.add_argument("--seed", type=int, default=7)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    import tensorflow as tf
    from tensorflow.keras import Sequential
    from tensorflow.keras.callbacks import EarlyStopping, ReduceLROnPlateau
    from tensorflow.keras.layers import LSTM, Dense, Dropout, Input

    from lstm_tfjs_export import export_sequential_to_tfjs

    rng = np.random.default_rng(args.seed)
    tf.keras.utils.set_random_seed(args.seed)
    X_train, y_train = make_dataset(rng, args.train_size)
    X_val, y_val = make_dataset(rng, args.train_size // 5)
    X_test, y_test = make_dataset(rng, args.train_size // 5)
    print("Class counts (train):", dict(zip(CLASS_NAMES, np.bincount(y_train, minlength=4).tolist())))

    mean = X_train.mean(axis=(0, 1))
    std = X_train.std(axis=(0, 1))
    std[std == 0] = 1
    norm = lambda X: (X - mean) / std

    model = Sequential([
        Input(shape=(SEQUENCE_LENGTH, len(FEATURES))),
        LSTM(64, return_sequences=True),
        Dropout(0.2),
        LSTM(32),
        Dropout(0.2),
        Dense(len(CLASS_NAMES), activation="softmax"),
    ])
    model.compile(optimizer=tf.keras.optimizers.Adam(2e-3),
                  loss="sparse_categorical_crossentropy", metrics=["accuracy"])
    counts = np.bincount(y_train, minlength=4)
    class_weight = {i: float(len(y_train) / (4 * c)) for i, c in enumerate(counts) if c}
    model.fit(
        norm(X_train), y_train,
        validation_data=(norm(X_val), y_val),
        epochs=args.epochs, batch_size=64, class_weight=class_weight, verbose=2,
        callbacks=[EarlyStopping(patience=5, restore_best_weights=True, monitor="val_loss"),
                   ReduceLROnPlateau(patience=2, factor=0.5, monitor="val_loss")],
    )

    probabilities = model.predict(norm(X_test), verbose=0)
    predicted = probabilities.argmax(axis=1)
    accuracy = float((predicted == y_test).mean())
    confusion = np.zeros((4, 4), dtype=int)
    for truth, guess in zip(y_test, predicted):
        confusion[truth, guess] += 1
    print(f"\nHeld-out synthetic test accuracy: {accuracy:.3f}")
    print("Confusion matrix (rows = rule label, cols = LSTM):")
    for name, row in zip(CLASS_NAMES, confusion):
        print(f"  {name:<9}" + " ".join(f"{v:5d}" for v in row))

    out = args.output_dir
    export_sequential_to_tfjs(model, out / "tfjs_lstm_model")
    (out / "lstm_norm_params.json").write_text(json.dumps({
        "mean": mean.tolist(),
        "std": std.tolist(),
        "features": FEATURES,
        "sequenceLength": SEQUENCE_LENGTH,
        "sampleRateHz": 1,
        "trainingData": "synthetic",
        "note": "Bootstrap model trained on synthetic sequences labelled by the Table 1 thresholds; "
                "not clinically validated. Replace by training on real labelled sessions.",
        "syntheticTestAccuracy": round(accuracy, 4),
    }, indent=2), encoding="utf-8")
    (out / "label_map.json").write_text(json.dumps({n: i for i, n in enumerate(CLASS_NAMES)}), encoding="utf-8")

    # Reference vectors so the browser export can be checked against Keras.
    sample = X_test[:8]
    (out / "lstm_model_files").mkdir(exist_ok=True)
    (out / "lstm_model_files" / "parity_check.json").write_text(json.dumps({
        "inputs": sample.tolist(),
        "kerasProbabilities": model.predict(norm(sample), verbose=0).tolist(),
    }), encoding="utf-8")
    print(f"\nExported TF.js model, normalization and label map to {out.resolve()}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
