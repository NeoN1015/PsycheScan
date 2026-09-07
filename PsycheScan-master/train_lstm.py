import numpy as np
import tensorflow as tf
from tensorflow.keras.models import Sequential
from tensorflow.keras.layers import LSTM, Dropout, Dense
from sklearn.model_selection import train_test_split
import matplotlib.pyplot as plt

# Load prepared data
X = np.load("X_lstm.npy")
y = np.load("y_lstm.npy")

print(f"Loaded {len(X)} sequences of shape {X.shape}")

# Train/validation split (80% train, 20% validation)
X_train, X_val, y_train, y_val = train_test_split(X, y, test_size=0.2, random_state=42)

# Build LSTM model
model = Sequential([
    LSTM(64, input_shape=(60, 4), return_sequences=True),
    Dropout(0.2),
    LSTM(32),
    Dropout(0.2),
    Dense(4, activation='softmax')   # 4 classes (Minimal, Mild, Moderate, Severe)
])

model.compile(optimizer='adam',
              loss='sparse_categorical_crossentropy',
              metrics=['accuracy'])

model.summary()

# Train the model
history = model.fit(
    X_train, y_train,
    validation_data=(X_val, y_val),
    epochs=30,
    batch_size=4,
    verbose=1
)

# -----------------------------------------------
# Plot training history (accuracy & loss)
# -----------------------------------------------
plt.figure(figsize=(12, 4))

plt.subplot(1, 2, 1)
plt.plot(history.history['accuracy'], label='Train Accuracy')
plt.plot(history.history['val_accuracy'], label='Validation Accuracy')
plt.title('Model Accuracy')
plt.ylabel('Accuracy')
plt.xlabel('Epoch')
plt.legend()

plt.subplot(1, 2, 2)
plt.plot(history.history['loss'], label='Train Loss')
plt.plot(history.history['val_loss'], label='Validation Loss')
plt.title('Model Loss')
plt.ylabel('Loss')
plt.xlabel('Epoch')
plt.legend()

plt.tight_layout()
plt.savefig('training_history.png', dpi=150)
plt.show()

# Print final accuracies
final_train_acc = history.history['accuracy'][-1] * 100
final_val_acc = history.history['val_accuracy'][-1] * 100
print(f"\n📈 Final Training Accuracy: {final_train_acc:.2f}%")
print(f"📊 Final Validation Accuracy: {final_val_acc:.2f}%")

# Save the trained model
model.save("sensor_lstm.keras")
print("✅ Model saved as sensor_lstm.keras")