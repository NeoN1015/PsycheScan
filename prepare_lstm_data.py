import pandas as pd
import numpy as np
from sklearn.preprocessing import LabelEncoder
import json

# === CONFIGURATION ===
CSV_FILE = r"C:\Users\NeoN\Documents\PD1_Data_set\WEBSITE_PD1\cnn-lstm-mental-health-records.csv"
SEQ_LEN = 60          # 60 seconds
STRIDE = 15           # sliding window step

# === LOAD CSV ===
df = pd.read_csv(CSV_FILE)

# Keep only rows that have all four sensor values
df = df.dropna(subset=['hr', 'gsr', 'temp', 'motion'])

# Sort by timestamp to ensure chronological order
df['timestamp'] = pd.to_datetime(df['timestamp'])
df = df.sort_values('timestamp')

# Extract features and labels
features = df[['hr', 'gsr', 'temp', 'motion']].values.astype(np.float32)
labels_raw = df['decision'].values

# Encode labels: OKAY=0, MONITOR=1, NOT OKAY=2
le = LabelEncoder()
labels = le.fit_transform(labels_raw)
print("Label mapping:", dict(zip(le.classes_, le.transform(le.classes_))))

# === BUILD SEQUENCES ===
X, y = [], []
for i in range(0, len(features) - SEQ_LEN, STRIDE):
    X.append(features[i:i+SEQ_LEN])
    y.append(labels[i+SEQ_LEN-1])

X = np.array(X)
y = np.array(y)
print(f"Created {len(X)} sequences of shape {X.shape}")

# === NORMALIZATION ===
mean = X.mean(axis=(0, 1))
std = X.std(axis=(0, 1))
X_norm = (X - mean) / std

# === SAVE ===
np.save("X_lstm.npy", X_norm)
np.save("y_lstm.npy", y)
np.savez("lstm_norm_params.npz", mean=mean, std=std)

# Save label mapping
# Convert numpy ints to regular ints for JSON
label_map_serializable = {str(k): int(v) for k, v in zip(le.classes_, le.transform(le.classes_))}
with open("label_map.json", "w") as f:
    json.dump(label_map_serializable, f)

print("✅ Data preparation complete.")