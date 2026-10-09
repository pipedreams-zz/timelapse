// Zeitraffer – Hauptprozess: Fenster, IPC und Steuerung von ffmpeg/ffprobe
const { app, BrowserWindow, ipcMain, dialog, shell, nativeTheme } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const VIDEO_EXT = new Set(['.mp4', '.mkv', '.mov', '.flv', '.ts', '.m2ts', '.webm', '.avi', '.m4v', '.wmv']);
const QUALITY = {
  balanced: { cq: 23, crf: 20 },
  high: { cq: 19, crf: 17 },
  small: { cq: 28, crf: 24 },
};

let win = null;
let toolDir = '';                // vom Nutzer gesetzter ffmpeg-Ordner
const running = new Map();       // jobId -> { proc, cancelled }
let initialFiles = [];

// Mitgeliefertes ffmpeg im installierten Paket (resources/ffmpeg/bin)
const BUNDLED_DIR = path.join(process.resourcesPath || '', 'ffmpeg', 'bin');
const hasBundled = app.isPackaged && fs.existsSync(path.join(BUNDLED_DIR, 'ffmpeg.exe'));

// ---------- Hilfsfunktionen ----------

// Reihenfolge: eigener Ordner > mitgeliefert > PATH
function tool(name) {
  if (toolDir) return path.join(toolDir, name + '.exe');
  if (hasBundled) return path.join(BUNDLED_DIR, name + '.exe');
  return name;
}

function run(cmd, args, { binary = false } = {}) {
  return new Promise((resolve) => {
    let proc;
    try {
      proc = spawn(cmd, args, { windowsHide: true });
    } catch (err) {
      resolve({ code: -1, stdout: '', stderr: String(err) });
      return;
    }
    const out = [];
    let err = '';
    proc.stdout.on('data', (d) => out.push(d));
    proc.stderr.on('data', (d) => { err += d; });
    proc.on('error', (e) => resolve({ code: -1, stdout: '', stderr: String(e) }));
    proc.on('close', (code) => {
      const buf = Buffer.concat(out);
      resolve({ code, stdout: binary ? buf : buf.toString('utf8'), stderr: err });
    });
  });
}

function filesFromArgv(argv, cwd = process.cwd()) {
  return argv.slice(1)
    .filter((a) => a && !a.startsWith('-'))
    .map((a) => path.resolve(cwd, a))
    .filter((p) => VIDEO_EXT.has(path.extname(p).toLowerCase()) && fs.existsSync(p));
}

function parseRate(r) {
  if (!r || r === '0/0') return 0;
  const [n, d] = r.split('/').map(Number);
  return d ? n / d : n;
}

function formatSpeed(s) {
  return String(Number(s.toFixed(2)));
}

function today() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function buildBaseName(template, inputPath, speed) {
  const name = path.parse(inputPath).name;
  let base = (template || '{name}_{speed}x')
    .replaceAll('{name}', name)
    .replaceAll('{speed}', formatSpeed(speed))
    .replaceAll('{date}', today())
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
    .replace(/[. ]+$/, '')
    .trim();
  return base || `${name}_${formatSpeed(speed)}x`;
}

function resolveOutput(job) {
  const s = job.settings;
  const dir = s.outMode === 'folder' && s.outDir ? s.outDir : path.dirname(job.input);
  const base = buildBaseName(s.template, job.input, job.speed);
  const inputAbs = path.resolve(job.input).toLowerCase();
  let candidate = path.join(dir, base + '.mp4');
  let n = 2;
  while (
    path.resolve(candidate).toLowerCase() === inputAbs ||
    (!s.overwrite && fs.existsSync(candidate))
  ) {
    candidate = path.join(dir, `${base} (${n++}).mp4`);
  }
  return candidate;
}

function atempoChain(f) {
  const parts = [];
  while (f > 2) { parts.push('atempo=2'); f /= 2; }
  while (f < 0.5) { parts.push('atempo=0.5'); f /= 0.5; }
  parts.push(`atempo=${f.toFixed(6)}`);
  return parts.join(',');
}

function encoderArgs(encoder, quality) {
  const q = QUALITY[quality] || QUALITY.balanced;
  if (encoder === 'nvenc') {
    return ['-c:v', 'h264_nvenc', '-preset', 'p5', '-tune', 'hq', '-rc', 'vbr', '-cq', String(q.cq), '-b:v', '0', '-profile:v', 'high'];
  }
  return ['-c:v', 'libx264', '-preset', 'medium', '-crf', String(q.crf)];
}

function safeUnlink(p) {
  try { fs.unlinkSync(p); } catch { /* bereits weg */ }
}

// ---------- IPC ----------

ipcMain.handle('tools:check', async (_e, dir) => {
  toolDir = (dir || '').trim();
  const v = await run(tool('ffmpeg'), ['-hide_banner', '-version']);
  if (v.code !== 0) return { ok: false, error: 'ffmpeg wurde nicht gefunden.' };
  const p = await run(tool('ffprobe'), ['-version']);
  if (p.code !== 0) return { ok: false, error: 'ffprobe wurde nicht gefunden.' };
  const version = (v.stdout.match(/ffmpeg version (\S+)/) || [])[1] || '?';
  // Kurzer Testencode: ist NVENC auf dieser Maschine wirklich nutzbar?
  const t = await run(tool('ffmpeg'), [
    '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=black:s=256x256:d=0.2',
    '-c:v', 'h264_nvenc', '-f', 'null', '-',
  ]);
  return {
    ok: true,
    version: version.replace(/-.*$/, '').replace(/^n(?=\d)/, ''),
    nvenc: t.code === 0,
    bundled: !toolDir && hasBundled,
  };
});

ipcMain.handle('probe', async (_e, file) => {
  const r = await run(tool('ffprobe'), [
    '-v', 'error', '-show_entries',
    'format=duration:stream=codec_type,width,height,r_frame_rate,avg_frame_rate',
    '-of', 'json', file,
  ]);
  if (r.code !== 0) return { ok: false, error: r.stderr.trim() || 'Datei konnte nicht gelesen werden.' };
  let info;
  try { info = JSON.parse(r.stdout); } catch { return { ok: false, error: 'Unerwartete Antwort von ffprobe.' }; }
  const streams = info.streams || [];
  const v = streams.find((s) => s.codec_type === 'video');
  if (!v) return { ok: false, error: 'Keine Videospur gefunden.' };
  const rate = v.r_frame_rate && v.r_frame_rate !== '0/0' ? v.r_frame_rate : v.avg_frame_rate;
  return {
    ok: true,
    duration: parseFloat(info.format && info.format.duration) || 0,
    width: v.width,
    height: v.height,
    rate,
    fps: parseRate(rate),
    hasAudio: streams.some((s) => s.codec_type === 'audio'),
    size: fs.statSync(file).size,
  };
});

ipcMain.handle('thumbnail', async (_e, file, duration) => {
  const at = Math.max(0, Math.min((duration || 0) * 0.3, 30));
  const r = await run(tool('ffmpeg'), [
    '-hide_banner', '-loglevel', 'error', '-ss', at.toFixed(2), '-i', file,
    '-frames:v', '1', '-vf', 'scale=320:-2', '-f', 'image2', '-c:v', 'mjpeg', '-q:v', '5', 'pipe:1',
  ], { binary: true });
  if (r.code !== 0 || !r.stdout.length) return null;
  return 'data:image/jpeg;base64,' + r.stdout.toString('base64');
});

ipcMain.handle('output:preview', (_e, job) => path.basename(resolveOutput(job)));

ipcMain.handle('convert', (e, job) => new Promise((resolve) => {
  const s = job.settings;
  if (!fs.existsSync(job.input)) {
    resolve({ ok: false, error: 'Originaldatei nicht mehr vorhanden.' });
    return;
  }
  if (s.outMode === 'folder' && s.outDir && !fs.existsSync(s.outDir)) {
    resolve({ ok: false, error: 'Zielordner existiert nicht.' });
    return;
  }

  const output = resolveOutput(job);
  const part = output.replace(/\.mp4$/i, '.part.mp4');
  const outDuration = job.duration / job.speed;
  const keepAudio = s.audio === 'keep' && job.hasAudio;

  let rate = '';
  if (s.fps === 'source') rate = job.rate && job.rate !== '0/0' ? job.rate : '';
  else rate = String(s.fps);

  const args = [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-i', job.input,
    '-map', '0:v:0',
    '-vf', `setpts=PTS/${job.speed}`,
  ];
  if (rate) args.push('-fps_mode', 'cfr', '-r', rate);
  args.push(...encoderArgs(job.encoder, s.quality), '-pix_fmt', 'yuv420p');
  if (keepAudio) args.push('-map', '0:a:0', '-af', atempoChain(job.speed), '-c:a', 'aac', '-b:a', '160k');
  else args.push('-an');
  args.push('-sn', '-dn', '-movflags', '+faststart', '-progress', 'pipe:1', '-nostats', part);

  const proc = spawn(tool('ffmpeg'), args, { windowsHide: true });
  const entry = { proc, cancelled: false };
  running.set(job.id, entry);

  const started = Date.now();
  let stderr = '';
  let buf = '';

  proc.stdout.on('data', (d) => {
    buf += d;
    const lines = buf.split(/\r?\n/);
    buf = lines.pop();
    for (const line of lines) {
      const m = line.match(/^out_time_us=(\d+)/);
      if (!m || !outDuration) continue;
      const pct = Math.min(1, Number(m[1]) / 1e6 / outDuration);
      const elapsed = (Date.now() - started) / 1000;
      const eta = pct > 0.01 ? elapsed * (1 - pct) / pct : null;
      if (!e.sender.isDestroyed()) e.sender.send('progress', { id: job.id, pct, eta });
    }
  });
  proc.stderr.on('data', (d) => { stderr += d; });

  const finish = (result) => {
    running.delete(job.id);
    resolve(result);
  };

  proc.on('error', (err) => {
    safeUnlink(part);
    finish({ ok: false, error: String(err) });
  });

  proc.on('close', (code) => {
    if (entry.cancelled) {
      safeUnlink(part);
      finish({ ok: false, cancelled: true });
      return;
    }
    if (code !== 0) {
      safeUnlink(part);
      const msg = stderr.trim().split(/\r?\n/).slice(-4).join('\n');
      finish({ ok: false, error: msg || `ffmpeg beendet mit Code ${code}` });
      return;
    }
    try {
      if (s.overwrite && fs.existsSync(output)) fs.unlinkSync(output);
      fs.renameSync(part, output);
    } catch (err) {
      finish({ ok: false, error: 'Umbenennen fehlgeschlagen: ' + err.message });
      return;
    }
    finish({
      ok: true,
      output,
      size: fs.statSync(output).size,
      seconds: (Date.now() - started) / 1000,
    });
  });
}));

ipcMain.handle('cancel', (_e, id) => {
  const entry = running.get(id);
  if (entry) {
    entry.cancelled = true;
    entry.proc.kill();
  }
});

ipcMain.handle('pick:folder', async () => {
  const r = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'] });
  return r.canceled ? null : r.filePaths[0];
});

ipcMain.handle('pick:files', async () => {
  const r = await dialog.showOpenDialog(win, {
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'Videos', extensions: [...VIDEO_EXT].map((x) => x.slice(1)) }],
  });
  return r.canceled ? [] : r.filePaths;
});

ipcMain.handle('reveal', (_e, p) => shell.showItemInFolder(p));
ipcMain.handle('open', (_e, p) => shell.openPath(p));
ipcMain.on('taskbar', (_e, value) => win && win.setProgressBar(value));
ipcMain.on('flash', () => win && !win.isFocused() && win.flashFrame(true));
// Native Teile (Auswahllisten, Scrollbars, Dialoge) folgen der gewählten Darstellung
ipcMain.on('theme', (_e, theme) => {
  nativeTheme.themeSource = ['light', 'dark'].includes(theme) ? theme : 'system';
  if (win) win.setBackgroundColor(nativeTheme.shouldUseDarkColors ? '#141414' : '#ffffff');
});
ipcMain.handle('initial-files', () => {
  const f = initialFiles;
  initialFiles = [];
  return f;
});

// ---------- Fenster & Lebenszyklus ----------

function createWindow() {
  win = new BrowserWindow({
    width: 1080,
    height: 780,
    minWidth: 900,
    minHeight: 560,
    title: 'Zeitraffer',
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#141414' : '#ffffff',
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.removeMenu();
  win.loadFile('index.html');
  win.once('ready-to-show', () => win.show());

  // Keine Navigation, falls eine Datei außerhalb der Drop-Zone landet
  win.webContents.on('will-navigate', (ev) => ev.preventDefault());

  win.on('close', (ev) => {
    if (running.size === 0) return;
    const choice = dialog.showMessageBoxSync(win, {
      type: 'question',
      buttons: ['Abbrechen und beenden', 'Weiterlaufen lassen'],
      defaultId: 1,
      cancelId: 1,
      title: 'Zeitraffer',
      message: 'Es läuft noch eine Konvertierung.',
      detail: 'Beim Beenden wird sie abgebrochen und die unfertige Datei gelöscht.',
    });
    if (choice === 1) {
      ev.preventDefault();
      return;
    }
    ev.preventDefault();
    const pending = [...running.values()].map((entry) => new Promise((res) => {
      entry.cancelled = true;
      entry.proc.once('close', res);
      entry.proc.kill();
    }));
    // die close-Handler der Jobs räumen die .part-Dateien auf
    Promise.all(pending).then(() => setTimeout(() => win.destroy(), 100));
  });
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  initialFiles = filesFromArgv(process.argv);

  app.on('second-instance', (_e, argv, cwd) => {
    const files = filesFromArgv(argv, cwd);
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.focus();
    if (files.length) win.webContents.send('files-from-os', files);
  });

  app.whenReady().then(createWindow);
  app.on('window-all-closed', () => app.quit());
}
