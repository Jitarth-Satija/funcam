const { app, BrowserWindow, ipcMain, session, globalShortcut, Menu, powerSaveBlocker } = require('electron');
const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const fs = require('fs');

// Keep processing at full speed even when the window is minimised or covered.
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

if (!app.requestSingleInstanceLock()) { app.quit(); }

const ROOT = path.join(__dirname, 'app') + path.sep;
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.json': 'application/json',
  '.wasm': 'application/wasm', '.task': 'application/octet-stream',
};

// Tiny local web server so camera access (secure context), WebAssembly and
// storage all behave exactly like a normal website. Fixed port keeps settings.
function startServer() {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      let p = '/';
      try { p = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch (e) {}
      if (p === '/') p = '/index.html';
      const f = path.normalize(path.join(ROOT, p));
      if (!f.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
      fs.stat(f, (err, st) => {
        if (err || !st.isFile()) { res.writeHead(404); return res.end(); }
        res.writeHead(200, {
          'Content-Type': MIME[path.extname(f).toLowerCase()] || 'application/octet-stream',
          'Content-Length': st.size, 'Cache-Control': 'no-store',
        });
        fs.createReadStream(f).pipe(res);
      });
    });
    let tried = false;
    srv.on('error', () => { if (!tried) { tried = true; srv.listen(0, '127.0.0.1', () => resolve(srv.address().port)); } });
    srv.listen(47821, '127.0.0.1', () => resolve(srv.address().port));
  });
}

// ---------------------------------------------------------------- virtual camera helper
let helper = null, helperGen = 0, win = null;

function helperCommand() {
  if (app.isPackaged) return { cmd: path.join(process.resourcesPath, 'helper', 'vcam_helper.exe'), args: [] };
  return { cmd: process.platform === 'win32' ? 'python' : 'python3', args: [path.join(__dirname, 'helper', 'vcam_helper.py')] };
}

const DRIVER_HINT = ' → Install OBS Studio (free, obsproject.com), open it, click "Start Virtual Camera" once, close OBS, then press Start here again.';

function stopHelper() {
  helperGen++;
  if (helper) {
    try { helper.stdin.end(); } catch (e) {}
    try { helper.kill(); } catch (e) {}
    helper = null;
  }
}

function startHelper(w, h, fps) {
  stopHelper();
  const gen = helperGen;
  return new Promise((resolve) => {
    const { cmd, args } = helperCommand();
    let child;
    try {
      child = spawn(cmd, [...args, String(w), String(h), String(fps)], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (e) { return resolve({ ok: false, error: 'Could not start the virtual camera helper: ' + e.message }); }
    helper = child;
    child.stdin.on('error', () => {});
    let done = false, errText = '', outBuf = '';
    const finish = (r) => { if (!done) { done = true; clearTimeout(timer); resolve(r); } };
    const timer = setTimeout(() => finish({ ok: false, error: 'Virtual camera helper did not start in time.' + DRIVER_HINT }), 30000);
    child.on('error', (e) => finish({ ok: false, error: 'Could not start the virtual camera helper: ' + e.message }));
    child.stderr.on('data', (d) => { errText = (errText + d.toString()).slice(-600); });
    child.stdout.on('data', (d) => {
      outBuf += d.toString();
      const m = outBuf.match(/READY (.*)/);
      if (m) finish({ ok: true, device: m[1].trim() });
    });
    child.on('exit', (code) => {
      if (!done) {
        const last = errText.trim().split(/\r?\n/).filter(Boolean).pop() || ('exit code ' + code);
        finish({ ok: false, error: 'Virtual camera not available (' + last + ').' + DRIVER_HINT });
      } else if (gen === helperGen && win && !win.isDestroyed()) {
        helper = null;
        win.webContents.send('vcam:exit', 'the helper closed unexpectedly');
      }
    });
  });
}

ipcMain.handle('vcam:start', (_e, w, h, fps) => startHelper(w, h, fps));
ipcMain.handle('vcam:stop', () => { stopHelper(); return true; });
ipcMain.on('vcam:frame', (_e, data) => {
  if (!helper || !helper.stdin.writable) return;
  if (helper.stdin.writableLength > 4 * 1024 * 1024) return; // helper is behind: drop this frame
  const buf = Buffer.isBuffer(data) ? data
    : ArrayBuffer.isView(data) ? Buffer.from(data.buffer, data.byteOffset, data.byteLength)
    : Buffer.from(data);
  helper.stdin.write(buf);
});

// ---------------------------------------------------------------- window
async function createWindow() {
  const port = await startServer();
  Menu.setApplicationMenu(null);
  win = new BrowserWindow({
    width: 1280, height: 760, minWidth: 900, minHeight: 560,
    backgroundColor: '#141118', title: 'Snap & Cinema FX',
    icon: path.join(__dirname, 'app', 'icons', 'icon128.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), backgroundThrottling: false, contextIsolation: true, nodeIntegration: false },
  });
  win.webContents.on('before-input-event', (_e, input) => {
    if (input.type === 'keyDown' && input.key === 'F12') win.webContents.toggleDevTools();
  });
  win.loadURL('http://127.0.0.1:' + port + '/index.html');
  win.on('closed', () => { win = null; });

  const keys = { S: 'snap', C: 'cinema', M: 'cash', F: 'facepalm' };
  for (const k of Object.keys(keys)) {
    try { globalShortcut.register('Alt+Shift+' + k, () => { if (win) win.webContents.send('key', keys[k]); }); } catch (e) {}
  }
}

app.whenReady().then(() => {
  const ok = (p) => p === 'media' || p === 'mediaKeySystem' || p === 'fullscreen';
  session.defaultSession.setPermissionRequestHandler((_wc, perm, cb) => cb(ok(perm)));
  session.defaultSession.setPermissionCheckHandler((_wc, perm) => ok(perm));
  powerSaveBlocker.start('prevent-app-suspension');
  createWindow();
});
app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
app.on('window-all-closed', () => { stopHelper(); app.quit(); });
app.on('before-quit', () => { stopHelper(); globalShortcut.unregisterAll(); });
