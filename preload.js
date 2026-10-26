const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('snapfx', {
  startVcam: (w, h, fps) => ipcRenderer.invoke('vcam:start', w, h, fps),
  stopVcam: () => ipcRenderer.invoke('vcam:stop'),
  sendFrame: (buf) => ipcRenderer.send('vcam:frame', buf),
  onKey: (cb) => ipcRenderer.on('key', (_e, a) => cb(a)),
  onVcamExit: (cb) => ipcRenderer.on('vcam:exit', (_e, m) => cb(m)),
});
