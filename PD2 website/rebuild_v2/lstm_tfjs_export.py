"""Export a small Keras Sequential LSTM model to the TensorFlow.js layers format.

Why this exists: Keras 3 writes a model config (``batch_shape``, DTypePolicy
objects) that TensorFlow.js 4.x cannot deserialize, which is what broke the
previous model ("An InputLayer should be passed either a batchInputShape or an
inputShape"). This writer emits the Keras 2 style topology that TF.js expects
and packs the weights itself, so it works with any installed Keras version.

Supported layers: LSTM, Dropout, Dense (all the PsycheScan model uses).
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np

_GLOROT = {"class_name": "GlorotUniform", "config": {"seed": None}}
_ORTHOGONAL = {"class_name": "Orthogonal", "config": {"gain": 1.0, "seed": None}}
_ZEROS = {"class_name": "Zeros", "config": {}}


def _activation_name(activation) -> str:
    return activation if isinstance(activation, str) else activation.__name__


def _layer_entry(layer) -> tuple[dict, list[tuple[str, np.ndarray]]]:
    kind = type(layer).__name__
    name = layer.name
    weights = [np.asarray(w, dtype=np.float32) for w in layer.get_weights()]
    if kind == "LSTM":
        config = {
            "name": name,
            "trainable": True,
            "dtype": "float32",
            "return_sequences": bool(layer.return_sequences),
            "return_state": False,
            "go_backwards": False,
            "stateful": False,
            "unroll": False,
            "time_major": False,
            "units": int(layer.units),
            "activation": _activation_name(layer.cell.activation),
            "recurrent_activation": _activation_name(layer.cell.recurrent_activation),
            "use_bias": True,
            "kernel_initializer": _GLOROT,
            "recurrent_initializer": _ORTHOGONAL,
            "bias_initializer": _ZEROS,
            "unit_forget_bias": True,
            "kernel_regularizer": None,
            "recurrent_regularizer": None,
            "bias_regularizer": None,
            "activity_regularizer": None,
            "kernel_constraint": None,
            "recurrent_constraint": None,
            "bias_constraint": None,
            "dropout": 0.0,
            "recurrent_dropout": 0.0,
            "implementation": 2,
        }
        # Keras and TF.js share the [kernel, recurrent_kernel, bias] layout with
        # gate order i, f, c, o, so the arrays transfer unchanged.
        names = [f"{name}/lstm_cell/kernel", f"{name}/lstm_cell/recurrent_kernel", f"{name}/lstm_cell/bias"]
    elif kind == "Dropout":
        config = {"name": name, "trainable": True, "dtype": "float32", "rate": float(layer.rate),
                  "noise_shape": None, "seed": None}
        names = []
    elif kind == "Dense":
        config = {
            "name": name,
            "trainable": True,
            "dtype": "float32",
            "units": int(layer.units),
            "activation": _activation_name(layer.activation),
            "use_bias": True,
            "kernel_initializer": _GLOROT,
            "bias_initializer": _ZEROS,
            "kernel_regularizer": None,
            "bias_regularizer": None,
            "activity_regularizer": None,
            "kernel_constraint": None,
            "bias_constraint": None,
        }
        names = [f"{name}/kernel", f"{name}/bias"]
    else:
        raise ValueError(f"Unsupported layer for TF.js export: {kind}")
    if len(names) != len(weights):
        raise ValueError(f"Layer {name} has {len(weights)} weight arrays; expected {len(names)}")
    return {"class_name": kind, "config": config}, list(zip(names, weights))


def export_sequential_to_tfjs(model, output_dir: Path) -> Path:
    """Write ``model.json`` + ``group1-shard1of1.bin`` into ``output_dir``."""
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    input_shape = [None, *[int(d) for d in model.input_shape[1:]]]

    layers = [{
        "class_name": "InputLayer",
        "config": {"batch_input_shape": input_shape, "dtype": "float32", "sparse": False,
                   "ragged": False, "name": "input_1"},
    }]
    manifest, blobs = [], []
    for layer in model.layers:
        entry, named_weights = _layer_entry(layer)
        layers.append(entry)
        for weight_name, array in named_weights:
            manifest.append({"name": weight_name, "shape": list(array.shape), "dtype": "float32"})
            blobs.append(np.ascontiguousarray(array, dtype="<f4").tobytes())

    bin_name = "group1-shard1of1.bin"
    (output_dir / bin_name).write_bytes(b"".join(blobs))
    model_json = {
        "format": "layers-model",
        "generatedBy": "keras (PsycheScan lstm_tfjs_export.py)",
        "convertedBy": "lstm_tfjs_export.py",
        "modelTopology": {
            "class_name": "Sequential",
            "config": {"name": "psychescan_lstm", "layers": layers},
            "keras_version": "2.15.0",
            "backend": "tensorflow",
        },
        "weightsManifest": [{"paths": [bin_name], "weights": manifest}],
    }
    path = output_dir / "model.json"
    path.write_text(json.dumps(model_json), encoding="utf-8")
    return path
