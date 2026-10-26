// Host: opens the REAL camera, runs every frame through the effects engine
// (engine.html in a hidden iframe), shows the result and sends it to the
// virtual webcam helper through Electron.
const $ = (id) => document.getElementById(id);
const out = $('out');
const octx = out.getContext('2d', { willReadFrequently: true });
const engineFrame = $('engine');
const video = document.createElement('video');
video.muted = true; video.playsInline = true;

let W = 960, H = 540;
let stream = null, micStream = null, audioCtx = null, micTimer = 0;
let running = false, busy = false, starting = false, vcamOn = false;
let lastT = 0, lastSend = 0, lastSpike = 0;

function setStatus(text, kind) { const s = $('status'); s.textContent = text; s.className = kind || ''; }
const loadPref = (k, d) => { try { return localStorage.getItem('host:' + k) || d; } catch (e) { return d; } };
const savePref = (k, v) => { try { localStorage.setItem('host:' + k, v); } catch (e) {} };

// ------------------------------------------------------------ engine link
let engineReady = false, engineActive = true, needFull = false, smallW = 288, nextId = 1;
const pending = new Map();

window.addEventListener('message', (e) => {
  if (e.source !== engineFrame.contentWindow) return;
  const d = e.data;
  if (!d || d.__snapfx !== 1) return;
  if (d.type === 'ready') { engineReady = true; if (d.sw) smallW = d.sw; refreshStatus(); }
  else if (d.type === 'active') engineActive = !!d.value;
  else if (d.type === 'result') {
    const cb = pending.get(d.id);
    if (cb) { pending.delete(d.id); cb(d); } else if (d.bitmap) d.bitmap.close();
  } else if (d.type === 'error') setStatus(d.message, 'bad');
});

function toEngine(msg, transfer) {
  if (engineFrame.contentWindow) engineFrame.contentWindow.postMessage(Object.assign({ __snapfx: 1 }, msg), '*', transfer || []);
}

function processBitmap(bmp, full, fw, fh) {
  return new Promise((resolve) => {
    const id = nextId++;
    const timer = setTimeout(() => { pending.delete(id); resolve(null); }, 400);
    pending.set(id, (d) => { clearTimeout(timer); resolve(d); });
    toEngine({ type: 'frame', id, bitmap: bmp, full, fw, fh }, [bmp]);
  });
}

async function runEngine(src, fw, fh) {
  const full = needFull;
  const bmp = full
    ? await createImageBitmap(src)
    : await createImageBitmap(src, { resizeWidth: Math.min(smallW, fw), resizeQuality: 'low' });
  const d = await processBitmap(bmp, full, fw, fh);
  if (!d) return null;
  needFull = d.need === 'full';
  if (d.sw) smallW = d.sw;
  return d.bitmap || null;
}

// ------------------------------------------------------------ drawing / sending
function drawCover(src, sw, sh) {
  const s = Math.max(W / sw, H / sh);
  const dw = sw * s, dh = sh * s;
  octx.drawImage(src, (W - dw) / 2, (H - dh) / 2, dw, dh);
}

function sendOut() {
  const rgba = octx.getImageData(0, 0, W, H).data;
  const rgb = new Uint8Array(W * H * 3);
  for (let i = 0, j = 0; i < rgba.length; i += 4, j += 3) { rgb[j] = rgba[i]; rgb[j + 1] = rgba[i + 1]; rgb[j + 2] = rgba[i + 2]; }
  window.snapfx.sendFrame(rgb.buffer);
}

async function tick() {
  if (busy || !running || !video.videoWidth) return;
  busy = true;
  const now = performance.now();
  lastT = now;
  try {
    const fw = video.videoWidth, fh = video.videoHeight;
    let res = null;
    if (engineReady && engineActive) { try { res = await runEngine(video, fw, fh); } catch (e) { res = null; } }
    if (res) { drawCover(res, res.width, res.height); res.close(); }
    else drawCover(video, fw, fh);
    if (vcamOn && now - lastSend > 20) { lastSend = now; sendOut(); }
  } catch (e) { console.warn(e); }
  busy = false;
}

function onVideoFrame() {
  if (!running) return;
  video.requestVideoFrameCallback(onVideoFrame);
  tick();
}
// Safety net: keeps the virtual camera alive if the window is minimised / throttled.
setInterval(() => { if (running && !busy && performance.now() - lastT > 60) tick(); }, 30);

// ------------------------------------------------------------ microphone (snap sound)
function tapMic() {
  navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } })
    .then((ms) => {
      micStream = ms;
      audioCtx = new AudioContext();
      const node = audioCtx.createMediaStreamSource(ms);
      const hp = audioCtx.createBiquadFilter();
      hp.type = 'highpass'; hp.frequency.value = 1800;
      const an = audioCtx.createAnalyser(); an.fftSize = 512;
      node.connect(hp); hp.connect(an);
      const buf = new Float32Array(an.fftSize);
      let avg = 0.003;
      micTimer = setInterval(() => {
        if (audioCtx.state === 'suspended') { audioCtx.resume().catch(() => {}); return; }
        an.getFloatTimeDomainData(buf);
        let peak = 0, sum = 0;
        for (let i = 0; i < buf.length; i++) { const v = Math.abs(buf[i]); if (v > peak) peak = v; sum += v * v; }
        const rms = Math.sqrt(sum / buf.length);
        const now = performance.now();
        if (peak > 0.04 && rms > avg * 3.5 && now - lastSpike > 300) { lastSpike = now; toEngine({ type: 'audioSpike' }); }
        avg = avg * 0.94 + rms * 0.06;
      }, 12);
    })
    .catch(() => { /* microphone is optional */ });
}
function stopMic() {
  clearInterval(micTimer);
  if (micStream) micStream.getTracks().forEach((t) => t.stop());
  if (audioCtx) audioCtx.close().catch(() => {});
  micStream = null; audioCtx = null;
}

// ------------------------------------------------------------ cameras
const isVirtual = (label) => /obs|virtual|snap.?cinema|unity ?capture/i.test(label || '');

async function refreshDevices(currentId) {
  const devs = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput');
  const sel = $('cam');
  sel.innerHTML = '';
  devs.forEach((d, i) => {
    const o = document.createElement('option');
    o.value = d.deviceId; o.textContent = d.label || ('Camera ' + (i + 1));
    sel.appendChild(o);
  });
  if (currentId) sel.value = currentId;
  return devs;
}

async function openCamera(deviceId) {
  const video_ = { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } };
  if (deviceId) video_.deviceId = { exact: deviceId };
  return navigator.mediaDevices.getUserMedia({ video: video_, audio: false });
}

// ------------------------------------------------------------ virtual camera
function refreshStatus() {
  if (!running) return;
  if (!engineReady) setStatus('Camera on. Loading the effects engine…');
}

async function startVcam() {
  const r = await window.snapfx.startVcam(W, H, 30);
  if (r.ok) {
    vcamOn = true;
    setStatus('Live ✓  In WhatsApp / Zoom / Teams / Meet / etc. choose the camera "' + (r.device || 'OBS Virtual Camera') + '".', 'ok');
  } else {
    vcamOn = false;
    setStatus(r.error, 'bad');
  }
}

window.snapfx.onVcamExit((msg) => { vcamOn = false; if (running) setStatus('Virtual camera stopped: ' + msg, 'bad'); });
window.snapfx.onKey((action) => toEngine({ type: 'key', action }));

// ------------------------------------------------------------ start / stop
async function start() {
  if (starting || running) return;
  starting = true;
  $('toggle').disabled = true;
  setStatus('Opening camera…');
  try {
    const saved = loadPref('cam', '');
    try { stream = await openCamera(saved); } catch (e) { stream = await openCamera(''); }
    let devs = await refreshDevices(stream.getVideoTracks()[0].getSettings().deviceId);
    // never read from a virtual camera (would loop our own output)
    let cur = devs.find((d) => d.deviceId === stream.getVideoTracks()[0].getSettings().deviceId);
    if (cur && isVirtual(cur.label)) {
      const real = devs.find((d) => !isVirtual(d.label));
      if (real) { stream.getTracks().forEach((t) => t.stop()); stream = await openCamera(real.deviceId); devs = await refreshDevices(real.deviceId); }
    }
    $('cam').value = stream.getVideoTracks()[0].getSettings().deviceId;
    video.srcObject = stream;
    await video.play();
  } catch (e) {
    setStatus('Cannot open the camera: ' + (e && e.message || e) + '. Close other apps that use it, then press Start.', 'bad');
    starting = false; $('toggle').disabled = false; $('toggle').textContent = 'Start';
    return;
  }
  tapMic();
  running = true;
  video.requestVideoFrameCallback(onVideoFrame);
  refreshStatus();
  await startVcam();
  $('toggle').textContent = 'Stop'; $('toggle').disabled = false;
  starting = false;
}

async function stop() {
  running = false;
  stopMic();
  if (stream) stream.getTracks().forEach((t) => t.stop());
  stream = null; video.srcObject = null;
  vcamOn = false;
  await window.snapfx.stopVcam();
  octx.fillStyle = '#000'; octx.fillRect(0, 0, W, H);
  setStatus('Stopped. Press Start to turn the virtual camera back on.');
  $('toggle').textContent = 'Start';
}

$('toggle').addEventListener('click', () => (running ? stop() : start()));
$('cam').addEventListener('change', async () => { savePref('cam', $('cam').value); if (running) { await stop(); await start(); } });
$('size').addEventListener('change', async () => {
  savePref('size', $('size').value);
  const was = running;
  if (was) await stop();
  applySize();
  if (was) await start();
});

function applySize() {
  const [w, h] = $('size').value.split('x').map(Number);
  W = w; H = h; out.width = W; out.height = H;
}

// preview flip follows the "Unflipped preview" setting (output is never flipped)
function applyFlip(v) { out.style.transform = v === false ? 'scaleX(-1)' : ''; }
chrome.storage.local.get({ unmirror: true }, (s) => applyFlip(s.unmirror));
chrome.storage.onChanged.addListener((ch) => { if (ch.unmirror) applyFlip(ch.unmirror.newValue); });

$('size').value = loadPref('size', '960x540');
applySize();
start();
window.addEventListener('beforeunload', () => { try { window.snapfx.stopVcam(); } catch (e) {} });
