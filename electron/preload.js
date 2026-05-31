const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('milfun', {
  getAppInfo: () => ipcRenderer.invoke('get-app-info'),
  checkLicense: () => ipcRenderer.invoke('check-license'),
  getFingerprint: () => ipcRenderer.invoke('get-fingerprint'),
  importLicense: () => ipcRenderer.invoke('import-license'),
  selectSourceDir: () => ipcRenderer.invoke('select-source-dir'),
  startProcessing: (sourceDir) => ipcRenderer.invoke('start-processing', sourceDir),
  openPath: (targetPath) => ipcRenderer.invoke('open-path', targetPath),
  onSetupStart: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('setup-start', handler);
    return () => ipcRenderer.removeListener('setup-start', handler);
  },
  onSetupLog: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('setup-log', handler);
    return () => ipcRenderer.removeListener('setup-log', handler);
  },
  onSetupDone: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('setup-done', handler);
    return () => ipcRenderer.removeListener('setup-done', handler);
  },
  onSetupError: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('setup-error', handler);
    return () => ipcRenderer.removeListener('setup-error', handler);
  },
  onLog: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('log', handler);
    return () => ipcRenderer.removeListener('log', handler);
  },
  onProgress: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('progress', handler);
    return () => ipcRenderer.removeListener('progress', handler);
  },
  onDone: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('done', handler);
    return () => ipcRenderer.removeListener('done', handler);
  },
  onError: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('error', handler);
    return () => ipcRenderer.removeListener('error', handler);
  },
  onProcessingState: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('processing-state', handler);
    return () => ipcRenderer.removeListener('processing-state', handler);
  },
});
