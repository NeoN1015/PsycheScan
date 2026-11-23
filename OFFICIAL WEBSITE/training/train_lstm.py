from __future__ import annotations

import argparse
import json
import math
import os
import random
import sys
from collections import Counter
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.model_selection import train_test_split

SEED = 42
SEQUENCE_LENGTH = 60
STRIDE = 15
FEATURES = ["hr", "gsr", "temp", "motion"]
CLASS_NAMES = ["Minimal", "Mild", "Moderate", "Severe"]
LABEL_MAP = {name: index for index, name in enumerate(CLASS_NAMES)}
VALID_RANGES = {
    "hr": (25, 240),
    "gsr": (0, 100),
    "temp": (15, 45),
    "motion": (0, 16),
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Train and export the PsycheScan LSTM model.")
    parser.add_argument("--csv", type=Path, default=Path(__file__).resolve().parent.parent / "data" / "cnn-lstm-mental-health-records.csv")
    parser.add_argument("--output-dir", type=Path, default=Path("."))
    parser.add_argument("--sequence-length", type=int, default=SEQUENCE_LENGTH)
    parser.add_argument("--stride", type=int, default=STRIDE)
    parser.add_argument("--epochs", type=int, default=100)
    return parser.parse_args()


def score_to_label(score: float) -> str:
    if score >= 70:
        return "Severe"
    if score >= 45:
        return "Moderate"
    if score >= 25:
        return "Mild"
    return "Minimal"


def find_group_column(frame: pd.DataFrame) -> str:
    participant_column = next(
        (column for column in ("profileId", "profile_id", "participantId", "participant_id") if column in frame),
        None,
    )
    session_column = next(
        (column for column in ("sessionId", "session_id") if column in frame),
        None,
    )
    if participant_column and frame[participant_column].nunique(dropna=True) > 1:
        return participant_column
    if session_column and frame[session_column].nunique(dropna=True) > 1:
        return session_column
    if participant_column:
        raise ValueError(
            f"Only one {participant_column} group is available and no independent session groups exist. "
            "At least three independent groups per class are needed for stratified train/validation/test splits."
        )
    if session_column:
        raise ValueError(
            f"Only one {session_column} group is available. "
            "At least three independent groups per class are needed for stratified train/validation/test splits."
        )
    raise ValueError("CSV must include participantId/profileId or sessionId/session_id for leakage-safe splits.")


def load_labeled_rows(csv_path: Path) -> tuple[pd.DataFrame, str]:
    frame = pd.read_csv(csv_path)
    missing_columns = [column for column in FEATURES if column not in frame.columns]
    if missing_columns:
        raise ValueError(f"CSV is missing required sensor columns: {', '.join(missing_columns)}")
    group_column = find_group_column(frame)

    for column in FEATURES:
        frame[column] = pd.to_numeric(frame[column], errors="coerce")
        lower, upper = VALID_RANGES[column]
        frame.loc[~frame[column].between(lower, upper), column] = np.nan
    frame = frame.dropna(subset=FEATURES).copy()

    if "timestamp" in frame.columns:
        frame["timestamp"] = pd.to_datetime(frame["timestamp"], errors="coerce")
        frame = frame.dropna(subset=["timestamp"]).sort_values([group_column, "timestamp"])
    else:
        frame = frame.sort_values(group_column)

    if "integratedScore" in frame.columns:
        scores = pd.to_numeric(frame["integratedScore"], errors="coerce")
        frame = frame.loc[scores.between(0, 100)].copy()
        frame["label"] = scores.loc[frame.index].map(score_to_label)
    elif "decision" in frame.columns:
        normalized = frame["decision"].astype(str).str.strip().str.lower()
        aliases = {
            "minimal": "Minimal",
            "okay": "Minimal",
            "mild": "Mild",
            "monitor": "Mild",
            "moderate": "Moderate",
            "severe": "Severe",
            "not okay": "Severe",
        }
        frame["label"] = normalized.map(aliases)
        frame = frame.dropna(subset=["label"])
    else:
        raise ValueError("CSV must include integratedScore or decision labels.")

    frame[group_column] = frame[group_column].astype(str)
    return frame, group_column


def make_sequences(frame: pd.DataFrame, group_column: str, sequence_length: int, stride: int):
    sequences: list[np.ndarray] = []
    labels: list[int] = []
    groups: list[str] = []
    for group_id, group in frame.groupby(group_column, sort=True):
        values = group[FEATURES].to_numpy(dtype=np.float32)
        group_labels = group["label"].to_numpy()
        for start in range(0, len(group) - sequence_length + 1, stride):
            end = start + sequence_length
            sequences.append(values[start:end])
            labels.append(LABEL_MAP[group_labels[end - 1]])
            groups.append(group_id)
    if not sequences:
        raise ValueError(
            f"No {sequence_length}-sample sequences could be formed after validation. "
            "Collect longer independent participant/session recordings."
        )
    return np.asarray(sequences, dtype=np.float32), np.asarray(labels, dtype=np.int64), np.asarray(groups)


def stratified_group_splits(groups: np.ndarray, labels: np.ndarray):
    group_labels: dict[str, int] = {}
    for group_id in np.unique(groups):
        values, counts = np.unique(labels[groups == group_id], return_counts=True)
        group_labels[group_id] = int(values[np.argmax(counts)])

    class_group_counts = Counter(group_labels.values())
    insufficient = [
        CLASS_NAMES[class_id]
        for class_id in range(len(CLASS_NAMES))
        if class_group_counts[class_id] < 3
    ]
    if insufficient:
        counts = ", ".join(
            f"{name}: {class_group_counts[index]}"
            for index, name in enumerate(CLASS_NAMES)
        )
        raise ValueError(
            "Cannot create stratified group-disjoint train/validation/test sets. "
            f"Each class needs at least three independent participant/session groups; "
            f"available group counts are {counts}. Insufficient: {', '.join(insufficient)}."
        )

    group_ids = np.asarray(list(group_labels))
    group_targets = np.asarray([group_labels[group_id] for group_id in group_ids])
    class_count = len(CLASS_NAMES)
    test_count = max(math.ceil(len(group_ids) * 0.2), class_count)
    if len(group_ids) - test_count < class_count * 2:
        raise ValueError("Not enough independent groups to place every class in train, validation, and test.")
    remaining_groups, test_groups = train_test_split(
        group_ids,
        test_size=test_count,
        random_state=SEED,
        stratify=group_targets,
    )
    remaining_targets = np.asarray([group_labels[group_id] for group_id in remaining_groups])
    validation_count = max(math.ceil(len(group_ids) * 0.2), class_count)
    if len(remaining_groups) - validation_count < class_count:
        raise ValueError("Not enough independent groups to stratify train, validation, and test sets.")
    train_groups, validation_groups = train_test_split(
        remaining_groups,
        test_size=validation_count,
        random_state=SEED,
        stratify=remaining_targets,
    )
    return train_groups, validation_groups, test_groups


def main() -> int:
    args = parse_args()
    if args.sequence_length < 1 or args.stride < 1 or args.epochs < 1:
        raise ValueError("Sequence length, stride, and epochs must be positive.")
    random.seed(SEED)
    np.random.seed(SEED)
    os.environ["PYTHONHASHSEED"] = str(SEED)

    frame, group_column = load_labeled_rows(args.csv)
    X, y, groups = make_sequences(frame, group_column, args.sequence_length, args.stride)
    train_groups, validation_groups, test_groups = stratified_group_splits(groups, y)

    train_mask = np.isin(groups, train_groups)
    validation_mask = np.isin(groups, validation_groups)
    test_mask = np.isin(groups, test_groups)
    X_train, y_train = X[train_mask], y[train_mask]
    X_validation, y_validation = X[validation_mask], y[validation_mask]
    X_test, y_test = X[test_mask], y[test_mask]

    mean = X_train.mean(axis=(0, 1))
    std = X_train.std(axis=(0, 1))
    std[std == 0] = 1
    X_train = (X_train - mean) / std
    X_validation = (X_validation - mean) / std
    X_test = (X_test - mean) / std

    import tensorflow as tf
    from tensorflow.keras import Sequential
    from tensorflow.keras.callbacks import EarlyStopping, ModelCheckpoint
    from tensorflow.keras.layers import LSTM, Dense, Dropout

    tf.keras.utils.set_random_seed(SEED)
    try:
        tf.config.experimental.enable_op_determinism()
    except (AttributeError, RuntimeError):
        pass

    model = Sequential([
        tf.keras.Input(shape=(args.sequence_length, len(FEATURES))),
        LSTM(64, return_sequences=True),
        Dropout(0.2),
        LSTM(32),
        Dropout(0.2),
        Dense(len(CLASS_NAMES), activation="softmax"),
    ])
    model.compile(
        optimizer="adam",
        loss="sparse_categorical_crossentropy",
        metrics=["accuracy"],
    )

    class_counts = np.bincount(y_train, minlength=len(CLASS_NAMES))
    if np.any(class_counts == 0):
        raise ValueError("Training split is missing a class; refusing to train an incomplete classifier.")
    class_weights = {
        index: float(len(y_train) / (len(CLASS_NAMES) * count))
        for index, count in enumerate(class_counts)
    }

    args.output_dir.mkdir(parents=True, exist_ok=True)
    model_path = args.output_dir / "sensor_lstm.keras"
    callbacks = [
        EarlyStopping(monitor="val_loss", patience=8, restore_best_weights=True),
        ModelCheckpoint(model_path, monitor="val_loss", save_best_only=True),
    ]
    history = model.fit(
        X_train,
        y_train,
        validation_data=(X_validation, y_validation),
        epochs=args.epochs,
        batch_size=32,
        class_weight=class_weights,
        callbacks=callbacks,
        verbose=1,
    )

    model = tf.keras.models.load_model(model_path)
    test_loss, test_accuracy = model.evaluate(X_test, y_test, verbose=0)
    print(f"Test loss: {test_loss:.4f}; test accuracy: {test_accuracy:.4f}")
    print(f"Best validation loss: {min(history.history['val_loss']):.4f}")

    output_dir = args.output_dir
    with (output_dir / "lstm_norm_params.json").open("w", encoding="utf-8") as file:
        json.dump({"mean": mean.tolist(), "std": std.tolist(), "trainingData": "real"}, file)
    with (output_dir / "label_map.json").open("w", encoding="utf-8") as file:
        json.dump(LABEL_MAP, file)

    # The tensorflowjs converter writes a Keras 3 config that TF.js cannot load;
    # this exporter writes the format TF.js expects.
    from lstm_tfjs_export import export_sequential_to_tfjs

    export_sequential_to_tfjs(model, output_dir / "tfjs_lstm_model")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (OSError, ValueError, ImportError, AttributeError) as error:
        print(f"Training failed: {error}", file=sys.stderr)
        raise SystemExit(1)
