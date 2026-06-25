@echo off
echo Converting Keras model to TensorFlow.js (using Python module)...
python -m tensorflowjs_converter --input_format keras sensor_lstm.keras tfjs_lstm_model

echo.
echo Creating JSON normalization file...
python -c "import numpy as np, json; d=np.load('lstm_norm_params.npz'); json.dump({'mean':d['mean'].tolist(),'std':d['std'].tolist()}, open('lstm_norm_params.json','w'))"

echo.
echo Done! Check for tfjs_lstm_model folder and lstm_norm_params.json
pause
