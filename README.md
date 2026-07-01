# Kodachrome Filter Web App

A static GitHub Pages app for Adam's trained neural Kodachrome filter.

## Features

- Runs the trained ONNX neural filter in the browser
- Multiple image selection on phone or desktop
- Before/after comparison slider
- Adjustable strength, grain, contrast, and output size
- Download selected image or all filtered images as a ZIP
- Images stay local in the browser; nothing is uploaded to a server

## Local test

From this folder:

```powershell
python -m http.server 8080
```

Open: <http://localhost:8080>

## GitHub Pages

This folder is ready to publish as a static GitHub Pages site. Use the repository root as the Pages source.

## Model

The model at `models/kodachrome_latest.onnx` was exported from:

`../kodachrome_film_nn/checkpoints/kodachrome_latest.pt`

Export script: `export_onnx.py`
