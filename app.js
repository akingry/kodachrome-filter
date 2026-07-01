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

async function boot() {
  updateSliderLabels();
  try {
    if (!window.ort) throw new Error('ONNX Runtime did not load. Check your internet connection.');
    ort.env.wasm.wasmPaths = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.20.1/dist/';
    session = await ort.InferenceSession.create(MODEL_URL, {
      executionProviders: ['wasm'],
      graphOptimizationLevel: 'all',
    });
    setStatus('Ready. Choose photos to apply the neural Kodachrome filter.');
  } catch (err) {
    console.error(err);
    setStatus(`Could not load neural filter: ${err.message}`);
  }
  refreshButtons();
}

function refreshButtons() {
  const hasItems = items.length > 0;
  const hasSelected = selectedIndex >= 0;
  const selectedItem = hasSelected ? items[selectedIndex] : null;
  const selectedDone = !!selectedItem?.outputBlob;
  const selectedProcessable = !!selectedItem?.sourceCanvas;
  const anyDone = items.some(x => x.outputBlob);
  const anyProcessable = items.some(x => x.sourceCanvas);
  els.processSelected.disabled = busy || !session || !hasSelected || !selectedProcessable;
  els.processAll.disabled = busy || !session || !hasItems || !anyProcessable;
  els.downloadSelected.disabled = busy || !selectedDone;
  els.downloadZip.disabled = busy || !anyDone;
  els.prevBtn.disabled = !hasItems || selectedIndex <= 0;
  els.nextBtn.disabled = !hasItems || selectedIndex >= items.length - 1;
  els.clearBtn.disabled = busy || !hasItems;
}

function isHeicLike(file) {
  return /hei[cf]$/i.test(file.name) || /image\/(heic|heif)/i.test(file.type || '');
}

function loadImageFromBlob(blob) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('This browser could not decode the image file.'));
    };
    img.src = url;
  });
}

async function imageFromFile(file) {
  try {
    return await loadImageFromBlob(file);
  } catch (firstError) {
    if (isHeicLike(file) && window.heic2any) {
      const converted = await window.heic2any({ blob: file, toType: 'image/jpeg', quality: 0.95 });
      const blob = Array.isArray(converted) ? converted[0] : converted;
      return await loadImageFromBlob(blob);
    }
    throw firstError;
  }
}

function makePlaceholderCanvas(label, detail = '') {
  const canvas = document.createElement('canvas');
  canvas.width = 360;
  canvas.height = 360;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#1b120e';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = 'rgba(244,185,90,0.45)';
  ctx.lineWidth = 4;
  ctx.strokeRect(14, 14, canvas.width - 28, canvas.height - 28);
  ctx.fillStyle = '#f4b95a';
  ctx.font = 'bold 24px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(label, canvas.width / 2, 160);
  ctx.fillStyle = '#c9ad8f';
  ctx.font = '16px system-ui, sans-serif';
  const text = detail.length > 34 ? detail.slice(0, 31) + '…' : detail;
  ctx.fillText(text, canvas.width / 2, 195);
  return canvas;
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

function tensorToCanvas(tensor) {
  const [,, height, width] = tensor.dims;
  const out = document.createElement('canvas');
  out.width = width;
  out.height = height;
  const ctx = out.getContext('2d');
  const image = ctx.createImageData(width, height);
  const dst = image.data;
  const data = tensor.data;
  const plane = width * height;

  for (let p = 0, i = 0; p < plane; p++, i += 4) {
    dst[i] = Math.round(clamp01(data[p]) * 255);
    dst[i + 1] = Math.round(clamp01(data[plane + p]) * 255);
    dst[i + 2] = Math.round(clamp01(data[2 * plane + p]) * 255);
    dst[i + 3] = 255;
  }
  ctx.putImageData(image, 0, 0);
  return out;
}

function styledCanvasFromNeural(sourceCanvas, neuralCanvas, opts) {
  const { width, height } = sourceCanvas;
  const out = document.createElement('canvas');
  out.width = width;
  out.height = height;
  const ctx = out.getContext('2d');
  const src = sourceCanvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, width, height).data;
  const neu = neuralCanvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, width, height).data;
  const image = ctx.createImageData(width, height);
  const dst = image.data;
  const strength = opts.strength;
  const contrast = opts.contrast;
  const grain = opts.grain;
  let seed = 1234;
  const rand = () => {
    seed = (1664525 * seed + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const gaussianish = () => (rand() + rand() + rand() + rand() - 2) / 2;

  for (let i = 0; i < src.length; i += 4) {
    let r = src[i] / 255 * (1 - strength) + neu[i] / 255 * strength;
    let g = src[i + 1] / 255 * (1 - strength) + neu[i + 1] / 255 * strength;
    let b = src[i + 2] / 255 * (1 - strength) + neu[i + 2] / 255 * strength;

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
  const v = Number(els.compareSlider.value);
  els.afterCanvas.style.clipPath = `inset(0 0 0 ${v}%)`;
  els.wipe.style.left = `${v}%`;
}

function selectItem(index) {
  if (index < 0 || index >= items.length) return;
  selectedIndex = index;
  renderGallery();
  renderPreview();
  refreshButtons();
  autoProcessSelected();
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
  if (!item.sourceCanvas) {
    els.previewMeta.textContent = 'Cannot load';
    const placeholder = makePlaceholderCanvas('Cannot load', item.error || item.file.name);
    copyCanvas(placeholder, els.beforeCanvas);
    copyCanvas(placeholder, els.afterCanvas);
    setStatus(item.error || 'This image could not be loaded.');
    updateComparisonClip();
    return;
  }
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
    card.append(img, body);
    els.gallery.append(card);
  });
}

async function addFiles(fileList) {
  const files = [...fileList].filter(file => file.type.startsWith('image/'));
  if (!files.length) return;
  busy = true;
  refreshButtons();
  setStatus(`Loading ${files.length} image${files.length === 1 ? '' : 's'}…`);
  let failed = 0;
  for (const file of files) {
    try {
      const img = await imageFromFile(file);
      const sourceCanvas = drawImageToCanvas(img, settings().maxEdge);
      const thumbCanvas = drawImageToCanvas(img, 360);
      const thumbBlob = await canvasToBlob(thumbCanvas, 'image/jpeg', 0.82);
      items.push({ file, sourceCanvas, thumbUrl: URL.createObjectURL(thumbBlob), neuralCanvas: null, outputCanvas: null, outputBlob: null, processing: false, error: null });
    } catch (err) {
      failed += 1;
      console.error('Could not load image', file.name, err);
      const message = isHeicLike(file)
        ? 'HEIC/HEIF could not be converted in this browser. Try Camera Settings → Formats → Most Compatible, or export as JPEG.'
        : (err.message || 'Could not decode this image. Try JPEG or PNG.');
      const thumbCanvas = makePlaceholderCanvas('Cannot load', file.name);
      const thumbBlob = await canvasToBlob(thumbCanvas, 'image/jpeg', 0.82);
      items.push({ file, sourceCanvas: null, thumbUrl: URL.createObjectURL(thumbBlob), neuralCanvas: null, outputCanvas: null, outputBlob: null, processing: false, error: message });
    }
  }
  if (selectedIndex === -1 && items.length) selectedIndex = items.findIndex(item => item.sourceCanvas) >= 0 ? items.findIndex(item => item.sourceCanvas) : 0;
  busy = false;
  setStatus(failed ? `${items.length - failed} image${items.length - failed === 1 ? '' : 's'} ready; ${failed} could not be loaded.` : `${items.length} image${items.length === 1 ? '' : 's'} ready.`);
  renderGallery();
  renderPreview();
  refreshButtons();
  autoProcessSelected();
}

async function restyleItem(item) {
  if (!item?.neuralCanvas) return;
  item.outputCanvas = styledCanvasFromNeural(item.sourceCanvas, item.neuralCanvas, settings());
  item.outputBlob = await canvasToBlob(item.outputCanvas, 'image/jpeg', 0.95);
}

async function restyleSelected() {
  const item = items[selectedIndex];
  if (!item?.neuralCanvas || item.processing) return;
  await restyleItem(item);
  renderPreview();
  renderGallery();
  refreshButtons();
}

async function processIndex(index) {
  const item = items[index];
  if (!item || !session || !item.sourceCanvas) return;
  item.processing = true;
  item.error = null;
  renderGallery();
  setStatus(`Processing ${index + 1} of ${items.length}: ${item.file.name}`);
  try {
    if (!item.neuralCanvas) {
      const tensor = canvasToTensor(item.sourceCanvas);
      const results = await session.run({ image: tensor });
      const filtered = results.filtered || results[session.outputNames[0]];
      item.neuralCanvas = tensorToCanvas(filtered);
    }
    await restyleItem(item);
  } catch (err) {
    console.error(err);
    item.error = err.message || 'Processing failed';
  } finally {
    item.processing = false;
    renderGallery();
    if (index === selectedIndex) renderPreview();
  }
}

async function autoProcessSelected() {
  const item = items[selectedIndex];
  if (!item || !item.sourceCanvas || item.outputBlob || item.processing || busy || !session) return;
  await processItems([selectedIndex], { auto: true });
}

async function processItems(indices, options = {}) {
  if (busy || !session) return;
  busy = true;
  refreshButtons();
  for (const index of indices) await processIndex(index);
  busy = false;
  setStatus(options.auto ? 'Preview rendered. Move the slider to compare before and after.' : 'Done. Download one image or everything as a ZIP.');
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

async function downloadZip() {
  const done = items.filter(x => x.outputBlob);
  if (!done.length) return;
  busy = true;
  refreshButtons();
  setStatus(`Building ZIP with ${done.length} image${done.length === 1 ? '' : 's'}…`);
  const zip = new JSZip();
  for (const item of done) zip.file(filteredName(item.file.name), item.outputBlob);
  const blob = await zip.generateAsync({ type: 'blob' });
  downloadBlob(blob, 'kodachrome_filtered.zip');
  busy = false;
  setStatus('ZIP ready.');
  refreshButtons();
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

['strength', 'grain', 'contrast'].forEach(id => els[id].addEventListener('input', () => {
  updateSliderLabels();
  restyleSelected();
}));
els.maxEdge.addEventListener('input', updateSliderLabels);
els.fileInput.addEventListener('change', e => addFiles(e.target.files));
els.dropZone.addEventListener('dragover', e => { e.preventDefault(); els.dropZone.classList.add('drag'); });
els.dropZone.addEventListener('dragleave', () => els.dropZone.classList.remove('drag'));
els.dropZone.addEventListener('drop', e => { e.preventDefault(); els.dropZone.classList.remove('drag'); addFiles(e.dataTransfer.files); });
els.compareSlider.addEventListener('input', updateComparisonClip);
els.processSelected.addEventListener('click', () => processItems([selectedIndex]));
els.processAll.addEventListener('click', () => processItems(items.map((_, i) => i)));
els.downloadSelected.addEventListener('click', () => {
  const item = items[selectedIndex];
  if (item?.outputBlob) downloadBlob(item.outputBlob, filteredName(item.file.name));
});
els.downloadZip.addEventListener('click', downloadZip);
els.prevBtn.addEventListener('click', () => selectItem(selectedIndex - 1));
els.nextBtn.addEventListener('click', () => selectItem(selectedIndex + 1));
els.clearBtn.addEventListener('click', clearAll);

boot();
