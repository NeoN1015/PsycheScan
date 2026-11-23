# LSTM model slot

Put the trained LSTM here. The site loads:

- `model.json` and its weight file(s) (`*.bin`): a TensorFlow.js **Layers** model.
  Input shape `[null, sequenceLength, features.length]`. Output: either one unit per label
  (softmax) or, for two labels, a single sigmoid unit giving the probability of `labels[1]`.
- `norm_params.json`:

```json
{"features":["hr","gsr","temp","motion"],"mean":[0,0,0,0],"std":[1,1,1,1],"sequenceLength":30,"labels":["Not stressed","Stressed"]}
```

`features` may list any of `hr`, `gsr`, `temp`, `motion`, in the order the model was trained on.
`mean` and `std` must have one value per feature; the site normalises each reading as `(x - mean) / std`.

Until `norm_params.json` is here, the dashboard shows "LSTM model not loaded", and the browser
console shows one 404 for `norm_params.json`. That 404 is expected and harmless.
