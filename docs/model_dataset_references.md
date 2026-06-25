
# Model and dataset references used in this package

This build keeps the browser implementation on face-api.js, but the dashboard content and settings point to stronger dataset and model directions for future upgrades.

Recommended facial-expression datasets:
- AffectNet
- FER+
- RAF-DB
- CK+
- JAFFE

Recommended detector direction for stronger browser deployment:
- SSD MobileNet V1 inside face-api.js for stronger profile mode
- TinyFaceDetector kept as fallback for lighter devices

Multimodal stress-side reference from the uploaded paper:
- WESAD as the multimodal stress reference dataset
- weighted score-level fusion preferred over feature-level fusion in the referenced paper
- smartwatch-related signals discussed in the paper include EDA, ACC, TEMP, and BVP
