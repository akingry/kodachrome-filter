const MODEL_URL = 'models/kodachrome_latest.onnx';

const els = {
  fileInput: document.getElementById('fileInput'),
  dropZone: document.getElementById('dropZone'),
  strength: document.getElementById('strength'),
  grain: document.getElementById('grain'),
  contrast: document.getElementById('contrast'),
  maxEdge: document.getElementById('maxEdge'),
  strengthValue: document.getElementById('strengthValue'),
  grainValue: document.getElementById('grainValue'),
  contrastValue: document.getElementById('contrastValue'),
  maxEdgeValue: document.getElementById('maxEdgeValue'),
  processSelected: document.getElementById('processSelected'),
  processAll: document.getElementById('processAll'),
  downloadSelected: document.getElementById('downloadSelected'),
  downloadZip: document.getElementById('downloadZip'),
  status: document.getElementById('status'),
  previewTitle: document.getElementById('previewTitle'),
  previewMeta: document.getElementById('previewMeta'),
  comparison: document.getElementById('comparison'),
  beforeCanvas: document.getElementById('beforeCanvas'),
  afterCanvas: document.getElementById('afterCanvas'),
  compareSlider: document.getElementById('compareSlider'),
  wipe: document.getElementById('wipe'),
  prevBtn: document.getElementById('prevBtn'),
  nextBtn: document.getElementById('nextBtn'),
  gallery: document.getElementById('gallery'),
  clearBtn: document.getElementById('clearBtn'),
};

let session = null;
let neuralAvailable = false;
let fallbackMode = false;
let items = [];
let selectedIndex = -1;
let busy = false;

function setStatus(message) { els.status.textContent = message; }
function clamp01(v) { return Math.max(0, Math.min(1, v)); }
function settings() {
  return {
    strength: Number(els.strength.value) / 100,
    grain: Number(els.grain.value) / 1000,
    contrast: Number(els.contrast.value) / 100,
    maxEdge: Number(els.maxEdge.value),
  };
}
function updateSliderLabels() {
  els.strengthValue.textContent = `${els.strength.value}%`;
  els.grainValue.textContent = `${(Number(els.grain.value) / 10).toFixed(1)}%`;
  els.contrastValue.textContent = `${els.contrast.value}%`;
  els.maxEdgeValue.textContent = `${els.maxEdge.value} px`;
}

function withTimeout(promise, ms, message) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(message)), ms)),
  ]);
}

async function boot() {
  updateSliderLabels();
  // Reliability first: the ONNX model can block or fail on some browsers/networks.
  // The app is immediately usable with the built-in local filter; add ?neural=1 to try the model.
  session = null;
  neuralAvailable = false;
  fallbackMode = true;
  setStatus('Ready. Choose photos to apply the local Kodachrome-style filter.');
  refreshButtons();

  if (!new URLSearchParams(window.location.search).has('neural')) return;
  try {
    if (!window.ort) throw new Error('ONNX Runtime did not load.');
    setStatus('Trying to load the neural model…');
    ort.env.wasm.wasmPaths = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.20.1/dist/';
    session = await withTimeout(ort.InferenceSession.create(MODEL_URL, {
      executionProviders: ['wasm'],
      graphOptimizationLevel: 'all',
    }), 8000, 'Neural model load timed out.');
    neuralAvailable = true;
    fallbackMode = false;
    setStatus('Ready. Choose photos to apply the neural Kodachrome filter.');
  } catch (err) {
    console.warn('Neural filter unavailable; keeping local browser film filter.', err);
    session = null;
    neuralAvailable = false;
    fallbackMode = true;
    setStatus('Ready. Neural model is unavailable, so the built-in local Kodachrome-style filter will be used.');
  }
  refreshButtons();
}

function refreshButtons() {
  const hasItems = items.length > 0;
  const hasSelected = selectedIndex >= 0;
  const checked = items.filter(x => x.checked);
  els.processSelected.disabled = busy || checked.length === 0;
  els.processAll.disabled = busy || !hasItems;
  els.downloadSelected.disabled = busy || checked.length === 0;
  els.downloadZip.disabled = busy || !hasItems;
  els.prevBtn.disabled = !hasItems || selectedIndex <= 0;
  els.nextBtn.disabled = !hasItems || selectedIndex >= items.length - 1;
  els.clearBtn.disabled = busy || !hasItems;
}

function imageFromFile(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error(`Could not read ${file.name}. Try JPEG, PNG, or WebP; some browsers cannot preview HEIC/RAW files.`));
    };
    img.src = url;
  });
}

function looksLikeImage(file) {
  if (file.type && file.type.startsWith('image/')) return true;
  return /\.(avif|bmp|gif|heic|heif|jpe?g|png|tiff?|webp)$/i.test(file.name || '');
}

function fitSize(w, h, maxEdge) {
  const edge = Math.max(w, h);
  if (edge <= maxEdge) return { w, h };
  const scale = maxEdge / edge;
  return { w: Math.max(1, Math.round(w * scale)), h: Math.max(1, Math.round(h * scale)) };
}

function drawImageToCanvas(img, maxEdge) {
  const { w, h } = fitSize(img.naturalWidth || img.width, img.naturalHeight || img.height, maxEdge);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, w, h);
  return canvas;
}

function canvasToTensor(canvas) {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const { width, height } = canvas;
  const rgba = ctx.getImageData(0, 0, width, height).data;
  const data = new Float32Array(3 * width * height);
  const plane = width * height;
  for (let i = 0, p = 0; i < rgba.length; i += 4, p++) {
    data[p] = rgba[i] / 255;
    data[plane + p] = rgba[i + 1] / 255;
    data[2 * plane + p] = rgba[i + 2] / 255;
  }
  return new ort.Tensor('float32', data, [1, 3, height, width]);
}

function tensorToCanvas(tensor, sourceCanvas, opts) {
  const [,, height, width] = tensor.dims;
  const out = document.createElement('canvas');
  out.width = width;
  out.height = height;
  const ctx = out.getContext('2d');
  const src = sourceCanvas.getContext('2d').getImageData(0, 0, width, height).data;
  const image = ctx.createImageData(width, height);
  const dst = image.data;
  const data = tensor.data;
  const plane = width * height;
  const strength = opts.strength;
  const contrast = opts.contrast;
  const grain = opts.grain;
  let seed = 1234;
  const rand = () => {
    seed = (1664525 * seed + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const gaussianish = () => (rand() + rand() + rand() + rand() - 2) / 2;

  for (let p = 0, i = 0; p < plane; p++, i += 4) {
    let r = src[i] / 255 * (1 - strength) + data[p] * strength;
    let g = src[i + 1] / 255 * (1 - strength) + data[plane + p] * strength;
    let b = src[i + 2] / 255 * (1 - strength) + data[2 * plane + p] * strength;

    if (contrast !== 1) {
      r = (r - 0.5) * contrast + 0.5;
      g = (g - 0.5) * contrast + 0.5;
      b = (b - 0.5) * contrast + 0.5;
    }
    if (grain > 0) {
      const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      const noise = gaussianish() * grain * (0.45 + 0.75 * (1 - lum));
      r += noise; g += noise; b += noise;
    }

    dst[i] = Math.round(clamp01(r) * 255);
    dst[i + 1] = Math.round(clamp01(g) * 255);
    dst[i + 2] = Math.round(clamp01(b) * 255);
    dst[i + 3] = 255;
  }
  ctx.putImageData(image, 0, 0);
  return out;
}

function localKodachromeCanvas(sourceCanvas, opts) {
  const out = document.createElement('canvas');
  out.width = sourceCanvas.width;
  out.height = sourceCanvas.height;
  const srcCtx = sourceCanvas.getContext('2d', { willReadFrequently: true });
  const outCtx = out.getContext('2d');
  const image = srcCtx.getImageData(0, 0, out.width, out.height);
  const data = image.data;
  const strength = opts.strength;
  const contrast = opts.contrast;
  const grain = opts.grain;
  let seed = 98765;
  const rand = () => {
    seed = (1664525 * seed + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const gaussianish = () => (rand() + rand() + rand() + rand() - 2) / 2;

  for (let i = 0; i < data.length; i += 4) {
    const sr = data[i] / 255;
    const sg = data[i + 1] / 255;
    const sb = data[i + 2] / 255;
    const lum = 0.2126 * sr + 0.7152 * sg + 0.0722 * sb;

    // Warm highlights, deeper cyans/shadows, saturated reds/yellows: a robust local fallback.
    let r = sr * 1.10 + sg * 0.035 - sb * 0.025;
    let g = sg * 1.02 + sr * 0.018;
    let b = sb * 0.86 + sg * 0.045;
    r += Math.max(0, lum - 0.52) * 0.08;
    g += Math.max(0, lum - 0.50) * 0.035;
    b -= Math.max(0, lum - 0.45) * 0.055;
    r = (r - 0.5) * 1.08 + 0.5;
    g = (g - 0.5) * 1.04 + 0.5;
    b = (b - 0.5) * 1.10 + 0.5;

    r = sr * (1 - strength) + r * strength;
    g = sg * (1 - strength) + g * strength;
    b = sb * (1 - strength) + b * strength;

    if (contrast !== 1) {
      r = (r - 0.5) * contrast + 0.5;
      g = (g - 0.5) * contrast + 0.5;
      b = (b - 0.5) * contrast + 0.5;
    }
    if (grain > 0) {
      const noise = gaussianish() * grain * (0.45 + 0.75 * (1 - lum));
      r += noise; g += noise; b += noise;
    }

    data[i] = Math.round(clamp01(r) * 255);
    data[i + 1] = Math.round(clamp01(g) * 255);
    data[i + 2] = Math.round(clamp01(b) * 255);
  }
  outCtx.putImageData(image, 0, 0);
  return out;
}

async function canvasToBlob(canvas, type = 'image/jpeg', quality = 0.95) {
  return new Promise(resolve => canvas.toBlob(resolve, type, quality));
}

function copyCanvas(src, dst) {
  dst.width = src.width;
  dst.height = src.height;
  const ctx = dst.getContext('2d');
  ctx.clearRect(0, 0, dst.width, dst.height);
  ctx.drawImage(src, 0, 0);
}

function updateComparisonClip() {
  // The preview is intentionally side-by-side now; this no-op keeps older cached markup harmless.
}

function selectItem(index) {
  if (index < 0 || index >= items.length) return;
  selectedIndex = index;
  renderGallery();
  renderPreview();
  refreshButtons();
  if (!items[index].outputBlob && !busy) processItems([index], { auto: true });
}

function renderPreview() {
  const item = items[selectedIndex];
  if (!item) {
    els.previewTitle.textContent = 'No photo selected';
    els.previewMeta.textContent = '';
    els.comparison.classList.add('empty');
    return;
  }
  els.comparison.classList.remove('empty');
  els.previewTitle.textContent = item.file.name;
  els.previewMeta.textContent = `${item.sourceCanvas.width} × ${item.sourceCanvas.height}`;
  copyCanvas(item.sourceCanvas, els.beforeCanvas);
  copyCanvas(item.outputCanvas || item.sourceCanvas, els.afterCanvas);
  updateComparisonClip();
}

function renderGallery() {
  els.gallery.innerHTML = '';
  items.forEach((item, index) => {
    const card = document.createElement('div');
    card.className = `card ${index === selectedIndex ? 'selected' : ''}`;
    card.onclick = () => selectItem(index);
    const check = document.createElement('input');
    check.className = 'card-check';
    check.type = 'checkbox';
    check.checked = item.checked;
    check.title = 'Include when saving checked files';
    check.onclick = event => {
      event.stopPropagation();
      item.checked = check.checked;
      refreshButtons();
    };
    const img = document.createElement('img');
    img.src = item.thumbUrl;
    const body = document.createElement('div');
    body.className = 'card-body';
    const title = document.createElement('div');
    title.className = 'card-title';
    title.textContent = item.file.name;
    const badge = document.createElement('div');
    badge.className = `badge ${item.error ? 'error' : item.outputBlob ? 'done' : ''}`;
    badge.textContent = item.error ? 'Error' : item.processing ? 'Processing…' : item.outputBlob ? 'Filtered' : 'Ready';
    body.append(title, badge);
    card.append(check, img, body);
    els.gallery.append(card);
  });
}

async function addFiles(fileList) {
  const all = [...fileList];
  const files = all.filter(looksLikeImage);
  const rejected = all.length - files.length;
  if (!files.length) {
    setStatus(rejected ? 'No supported image files found. Try JPEG, PNG, or WebP.' : 'No files selected.');
    return;
  }
  busy = true;
  refreshButtons();
  setStatus(`Loading ${files.length} image${files.length === 1 ? '' : 's'}…`);
  let loaded = 0;
  let failed = 0;
  for (const file of files) {
    try {
      const img = await imageFromFile(file);
      const sourceCanvas = drawImageToCanvas(img, settings().maxEdge);
      const thumbCanvas = drawImageToCanvas(img, 360);
      const thumbBlob = await canvasToBlob(thumbCanvas, 'image/jpeg', 0.82);
      if (!thumbBlob) throw new Error(`Could not make a thumbnail for ${file.name}.`);
      items.push({ file, sourceCanvas, thumbUrl: URL.createObjectURL(thumbBlob), outputCanvas: null, outputBlob: null, processing: false, error: null, checked: true });
      loaded++;
    } catch (err) {
      console.error(err);
      failed++;
    }
  }
  if (selectedIndex === -1 && items.length) selectedIndex = 0;
  busy = false;
  if (loaded) {
    const notes = [];
    if (failed) notes.push(`${failed} could not be previewed`);
    if (rejected) notes.push(`${rejected} ignored`);
    setStatus(`${items.length} image${items.length === 1 ? '' : 's'} ready${notes.length ? ` (${notes.join(', ')}).` : '.'}`);
  } else {
    setStatus('No image preview could be created. Try a standard JPEG, PNG, or WebP file.');
  }
  renderGallery();
  renderPreview();
  refreshButtons();
  if (selectedIndex >= 0 && !busy) processItems([selectedIndex], { auto: true });
}

async function processIndex(index) {
  const item = items[index];
  if (!item) return;
  item.processing = true;
  item.error = null;
  renderGallery();
  setStatus(`Processing ${index + 1} of ${items.length}: ${item.file.name}`);
  try {
    if (neuralAvailable && session) {
      const tensor = canvasToTensor(item.sourceCanvas);
      const inputName = session.inputNames?.[0] || 'image';
      const outputName = session.outputNames?.[0];
      const results = await session.run({ [inputName]: tensor });
      const filtered = results.filtered || (outputName ? results[outputName] : Object.values(results)[0]);
      if (!filtered) throw new Error('The model did not return an image tensor.');
      item.outputCanvas = tensorToCanvas(filtered, item.sourceCanvas, settings());
    } else {
      item.outputCanvas = localKodachromeCanvas(item.sourceCanvas, settings());
    }
    item.outputBlob = await canvasToBlob(item.outputCanvas, 'image/jpeg', 0.95);
    if (!item.outputBlob) throw new Error('Could not encode the filtered image.');
  } catch (err) {
    console.error(err);
    if (neuralAvailable) {
      console.warn('Neural pass failed; retrying with local browser film filter.', err);
      try {
        item.outputCanvas = localKodachromeCanvas(item.sourceCanvas, settings());
        item.outputBlob = await canvasToBlob(item.outputCanvas, 'image/jpeg', 0.95);
        item.error = null;
        fallbackMode = true;
      } catch (fallbackErr) {
        console.error(fallbackErr);
        item.error = fallbackErr.message || err.message || 'Processing failed';
      }
    } else {
      item.error = err.message || 'Processing failed';
    }
  } finally {
    item.processing = false;
    renderGallery();
    if (index === selectedIndex) renderPreview();
  }
}

async function processItems(indices, options = {}) {
  if (busy) return;
  busy = true;
  refreshButtons();
  for (const index of indices) await processIndex(index);
  busy = false;
  const mode = fallbackMode && !neuralAvailable ? ' Local browser film filter was used.' : '';
  setStatus((options.auto ? 'Filtered preview ready. Save checked files whenever you want.' : 'Done. Save checked files or everything as a ZIP.') + mode);
  refreshButtons();
}

function filteredName(name) {
  const dot = name.lastIndexOf('.');
  const base = dot > 0 ? name.slice(0, dot) : name;
  return `${base}_kodachrome.jpg`;
}

function downloadBlob(blob, filename) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 30000);
}

async function downloadItemsZip(list, filename) {
  if (!list.length || busy) return;
  const missing = list
    .map(item => items.indexOf(item))
    .filter(index => index >= 0 && !items[index].outputBlob);
  if (missing.length) await processItems(missing);
  busy = true;
  refreshButtons();
  const done = list.filter(x => x.outputBlob);
  if (!done.length) {
    busy = false;
    setStatus('No filtered images are ready to save.');
    refreshButtons();
    return;
  }

  if (window.JSZip) {
    setStatus(`Building ZIP with ${done.length} image${done.length === 1 ? '' : 's'}…`);
    const zip = new JSZip();
    for (const item of done) zip.file(filteredName(item.file.name), item.outputBlob);
    const blob = await zip.generateAsync({ type: 'blob' });
    downloadBlob(blob, filename);
    setStatus('ZIP ready.');
  } else {
    setStatus(`Saving ${done.length} filtered image${done.length === 1 ? '' : 's'} individually because ZIP support did not load.`);
    for (const item of done) downloadBlob(item.outputBlob, filteredName(item.file.name));
  }
  busy = false;
  refreshButtons();
}

async function downloadZip() {
  await downloadItemsZip(items, 'kodachrome_all_filtered.zip');
}

function clearAll() {
  items.forEach(item => URL.revokeObjectURL(item.thumbUrl));
  items = [];
  selectedIndex = -1;
  els.gallery.innerHTML = '';
  setStatus('Cleared. Choose photos to begin again.');
  renderPreview();
  refreshButtons();
}

['strength', 'grain', 'contrast', 'maxEdge'].forEach(id => els[id].addEventListener('input', updateSliderLabels));
els.fileInput.addEventListener('change', async e => {
  await addFiles(e.target.files);
  e.target.value = '';
});
els.dropZone.addEventListener('dragover', e => { e.preventDefault(); els.dropZone.classList.add('drag'); });
els.dropZone.addEventListener('dragleave', () => els.dropZone.classList.remove('drag'));
els.dropZone.addEventListener('drop', e => { e.preventDefault(); els.dropZone.classList.remove('drag'); addFiles(e.dataTransfer.files); });
if (els.compareSlider) els.compareSlider.addEventListener('input', updateComparisonClip);
els.processSelected.addEventListener('click', () => processItems(items.map((item, index) => item.checked ? index : -1).filter(index => index >= 0)));
els.processAll.addEventListener('click', () => processItems(items.map((_, i) => i)));
els.downloadSelected.addEventListener('click', () => downloadItemsZip(items.filter(item => item.checked), 'kodachrome_checked_filtered.zip'));
els.downloadZip.addEventListener('click', downloadZip);
els.prevBtn.addEventListener('click', () => selectItem(selectedIndex - 1));
els.nextBtn.addEventListener('click', () => selectItem(selectedIndex + 1));
els.clearBtn.addEventListener('click', clearAll);

boot();
