// Zeitraffer – schmale, sichere Brücke zwischen Oberfläche und Hauptprozess
const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('api', {
  checkTools: (dir) => ipcRenderer.invoke('tools:check', dir),
  probe: (file) => ipcRenderer.invoke('probe', file),
  thumbnail: (file, duration) => ipcRenderer.invoke('thumbnail', file, duration),
  previewName: (job) => ipcRenderer.invoke('output:preview', job),
  convert: (job) => ipcRenderer.invoke('convert', job),
  cancel: (id) => ipcRenderer.invoke('cancel', id),
  pickFolder: () => ipcRenderer.invoke('pick:folder'),
  pickFiles: () => ipcRenderer.invoke('pick:files'),
  reveal: (p) => ipcRenderer.invoke('reveal', p),
  open: (p) => ipcRenderer.invoke('open', p),
  initialFiles: () => ipcRenderer.invoke('initial-files'),
  getPathForFile: (file) => webUtils.getPathForFile(file),
  setProgress: (value) => ipcRenderer.send('taskbar', value),
  flash: () => ipcRenderer.send('flash'),
  setTheme: (theme) => ipcRenderer.send('theme', theme),
  onProgress: (cb) => ipcRenderer.on('progress', (_e, data) => cb(data)),
  onFilesFromOS: (cb) => ipcRenderer.on('files-from-os', (_e, files) => cb(files)),
});
