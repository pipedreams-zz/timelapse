// Zeitraffer – Oberfläche: Einstellungen, Drag & Drop, Warteschlange
'use strict';

const VIDEO_EXT = ['.mp4', '.mkv', '.mov', '.flv', '.ts', '.m2ts', '.webm', '.avi', '.m4v', '.wmv'];
const STORAGE_KEY = 'zeitraffer.settings.v1';
const DEFAULTS = {
  mode: 'factor',
  speed: 4,
  target: '1:00',
  template: '{name}_{speed}x',
  overwrite: false,
  outMode: 'beside',
  outDir: '',
  fps: 'source',
  quality: 'balanced',
  encoder: 'auto',
  audio: 'drop',
  autoStart: true,
  toolDir: '',
  theme: 'system',
};

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

let settings = loadSettings();
let tools = { ok: false, nvenc: false, checking: true };
const jobs = [];
let nextId = 1;

// ---------- Einstellungen ----------

function loadSettings() {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') };
  } catch {
    return { ...DEFAULTS };
  }
}

function saveSettings() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(settings)); } catch { /* egal */ }
}

function setSetting(key, value) {
  settings[key] = value;
  saveSettings();
  syncSettingsUI();
  refreshPendingNames();
}

function parseNumber(str) {
  const n = parseFloat(String(str).replace(',', '.'));
  return Number.isFinite(n) ? n : NaN;
}

function parseDuration(str) {
  const s = String(str).trim().replace(',', '.');
  if (!s) return NaN;
  if (!s.includes(':')) return parseFloat(s);
  const parts = s.split(':').map(Number);
  if (parts.some((p) => !Number.isFinite(p))) return NaN;
  return parts.reduce((acc, p) => acc * 60 + p, 0);
}

function speedLabel(s) {
  return String(Number(s.toFixed(2))).replace('.', ',');
}

function speedFor(job) {
  if (settings.mode === 'target') {
    const t = parseDuration(settings.target);
    if (!(t > 0) || !job.info) return 1;
    return Math.max(1, job.info.duration / t);
  }
  return settings.speed;
}

function syncSettingsUI() {
  $$('.segmented').forEach((seg) => {
    const key = seg.dataset.setting;
    seg.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b.dataset.value === settings[key]));
  });
  $('#factorBox').hidden = settings.mode !== 'factor';
  $('#targetBox').hidden = settings.mode !== 'target';
  $$('#speedChips button').forEach((b) => b.classList.toggle('active', Number(b.dataset.speed) === settings.speed));
  if (document.activeElement !== $('#speedInput')) $('#speedInput').value = speedLabel(settings.speed);
  if (document.activeElement !== $('#targetInput')) $('#targetInput').value = settings.target;
  if (document.activeElement !== $('#templateInput')) $('#templateInput').value = settings.template;
  $('#overwrite').checked = settings.overwrite;
  $('#folderBox').hidden = settings.outMode !== 'folder';
  $('#folderPath').textContent = settings.outDir || 'Noch kein Ordner gewählt';
  $('#fpsSelect').value = settings.fps;
  $('#qualitySelect').value = settings.quality;
  $('#encoderSelect').value = settings.encoder;
  $('#audioSelect').value = settings.audio;
  $('#autoStart').checked = settings.autoStart;
  if (document.activeElement !== $('#toolDirInput')) $('#toolDirInput').value = settings.toolDir;
  $('#previewLabel').textContent = settings.mode === 'target' ? 'Beispiel' : 'Vorschau';
  $('#namePreview').textContent = previewName('aufnahme', settings.mode === 'target' ? 7.5 : settings.speed);
}

function today() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function previewName(name, speed) {
  const base = (settings.template || '{name}_{speed}x')
    .replaceAll('{name}', name)
    .replaceAll('{speed}', String(Number(speed.toFixed(2))))
    .replaceAll('{date}', today())
    .replace(/[<>:"/\\|?*]/g, '_');
  return (base.trim() || `${name}_${speed}x`) + '.mp4';
}

function bindSettings() {
  $$('.segmented').forEach((seg) => {
    seg.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (b) setSetting(seg.dataset.setting, b.dataset.value);
    });
  });

  $('#speedChips').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (b) setSetting('speed', Number(b.dataset.speed));
  });

  $('#speedInput').addEventListener('input', (e) => {
    const n = parseNumber(e.target.value);
    const valid = n >= 1 && n <= 1000;
    e.target.classList.toggle('invalid', !valid);
    if (valid) setSetting('speed', n);
  });
  $('#speedInput').addEventListener('blur', syncSettingsUI);

  $('#targetInput').addEventListener('input', (e) => {
    const valid = parseDuration(e.target.value) > 0;
    e.target.classList.toggle('invalid', !valid);
    if (valid) setSetting('target', e.target.value.trim());
  });
  $('#targetInput').addEventListener('blur', syncSettingsUI);

  $('#templateInput').addEventListener('input', (e) => setSetting('template', e.target.value));
  $$('.tokens button').forEach((b) => b.addEventListener('click', () => {
    const input = $('#templateInput');
    const start = input.selectionStart ?? input.value.length;
    const end = input.selectionEnd ?? input.value.length;
    input.value = input.value.slice(0, start) + b.dataset.token + input.value.slice(end);
    input.focus();
    input.setSelectionRange(start + b.dataset.token.length, start + b.dataset.token.length);
    setSetting('template', input.value);
  }));

  $('#overwrite').addEventListener('change', (e) => setSetting('overwrite', e.target.checked));
  $('#autoStart').addEventListener('change', (e) => setSetting('autoStart', e.target.checked));
  $('#fpsSelect').addEventListener('change', (e) => setSetting('fps', e.target.value));
  $('#qualitySelect').addEventListener('change', (e) => setSetting('quality', e.target.value));
  $('#encoderSelect').addEventListener('change', (e) => setSetting('encoder', e.target.value));
  $('#audioSelect').addEventListener('change', (e) => setSetting('audio', e.target.value));

  $('#pickFolder').addEventListener('click', async () => {
    const dir = await window.api.pickFolder();
    if (dir) setSetting('outDir', dir);
  });

  let toolTimer;
  $('#toolDirInput').addEventListener('input', (e) => {
    clearTimeout(toolTimer);
    toolTimer = setTimeout(() => {
      settings.toolDir = e.target.value.trim();
      saveSettings();
      checkTools();
    }, 600);
  });
}

async function checkTools() {
  tools = { ok: false, checking: true };
  updateStatusLine();
  tools = await window.api.checkTools(settings.toolDir);
  updateStatusLine();
  if (tools.ok) pump();
  else $('#advanced').open = true;
}

// Statuszeile oben rechts: Werkzeug-Zustand oder laufender Durchgang
function updateStatusLine() {
  const line = $('#toolStatus');
  const text = line.querySelector('.text');
  line.classList.remove('busy', 'err');
  line.title = '';
  if (tools.checking) {
    text.textContent = 'ffmpeg wird geprüft …';
    return;
  }
  if (!tools.ok) {
    line.classList.add('err');
    text.textContent = 'ffmpeg nicht gefunden';
    line.title = tools.error || '';
    return;
  }
  const batch = jobs.filter((j) => j.inBatch && j.state !== 'cancelled');
  const running = jobs.find((j) => j.state === 'running');
  if (running) {
    const finished = batch.filter((j) => j.state === 'done' || j.state === 'error').length;
    line.classList.add('busy');
    text.textContent = `Läuft · ${finished + 1} von ${Math.max(batch.length, 1)}`;
    return;
  }
  text.textContent = `ffmpeg ${tools.version} · ${tools.nvenc ? 'NVENC' : 'CPU'}`;
  line.title = (tools.nvenc
    ? 'Hardware-Encoding über die NVIDIA-Grafikkarte ist verfügbar.'
    : 'Kein NVENC gefunden – es wird mit der CPU (x264) kodiert.')
    + (tools.bundled ? '\nffmpeg wird mit der App mitgeliefert.' : '');
}

// ---------- Darstellung hell / dunkel ----------

function applyTheme() {
  const t = settings.theme;
  if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
  else delete document.documentElement.dataset.theme;
  $$('.theme-switch button').forEach((b) => b.classList.toggle('active', b.dataset.themeChoice === t));
  window.api.setTheme(t);
}

$$('.theme-switch button').forEach((b) => b.addEventListener('click', () => {
  settings.theme = b.dataset.themeChoice;
  saveSettings();
  applyTheme();
}));

// ---------- Hilfe-Kreise ----------

$$('.help').forEach((b) => {
  const target = document.getElementById(b.dataset.help);
  b.setAttribute('aria-controls', b.dataset.help);
  b.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    const open = b.getAttribute('aria-expanded') !== 'true';
    b.setAttribute('aria-expanded', String(open));
    target.hidden = !open;
  });
});

// ---------- Hilfen für die Anzeige ----------

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function fmtTime(sec) {
  if (!Number.isFinite(sec)) return '–';
  sec = Math.round(sec);
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}

function fmtSize(bytes) {
  if (!bytes) return '–';
  const mb = bytes / 1024 / 1024;
  return mb >= 1024 ? `${(mb / 1024).toFixed(2).replace('.', ',')} GB` : `${mb.toFixed(mb < 10 ? 1 : 0).replace('.', ',')} MB`;
}

function fmtFps(fps) {
  if (!fps) return '';
  return `${Number(fps.toFixed(2)).toString().replace('.', ',')} fps`;
}

let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2800);
}

// ---------- Warteschlange ----------

function isActive(job) {
  return ['probing', 'ready', 'queued', 'running'].includes(job.state);
}

function addFiles(paths) {
  let skipped = 0;
  let added = 0;
  for (const p of paths) {
    const ext = p.slice(p.lastIndexOf('.')).toLowerCase();
    if (!VIDEO_EXT.includes(ext)) { skipped++; continue; }
    if (jobs.some((j) => j.input === p && isActive(j))) { skipped++; continue; }
    const job = {
      id: nextId++,
      input: p,
      name: p.split(/[\\/]/).pop(),
      state: 'probing',
      pct: 0,
    };
    jobs.push(job);
    added++;
    renderItem(job);
    prepare(job);
  }
  if (skipped) toast(`${skipped} ${skipped === 1 ? 'Datei' : 'Dateien'} übersprungen (kein Video oder bereits in der Liste)`);
  if (added) updateChrome();
}

async function prepare(job) {
  const info = await window.api.probe(job.input);
  if (!info.ok) {
    job.state = 'error';
    job.error = info.error;
    renderItem(job);
    updateChrome();
    return;
  }
  job.info = info;
  job.state = settings.autoStart ? 'queued' : 'ready';
  await updateTargetName(job);
  renderItem(job);
  updateChrome();
  pump();
  window.api.thumbnail(job.input, info.duration).then((thumb) => {
    job.thumb = thumb;
    const el = document.querySelector(`[data-id="${job.id}"] .thumb`);
    if (el && thumb) el.style.backgroundImage = `url("${thumb}")`;
  });
}

function jobRequest(job) {
  return {
    id: job.id,
    input: job.input,
    speed: speedFor(job),
    duration: job.info.duration,
    rate: job.info.rate,
    hasAudio: job.info.hasAudio,
    encoder: settings.encoder === 'auto' && tools.nvenc ? 'nvenc' : 'cpu',
    settings: { ...settings },
  };
}

async function updateTargetName(job) {
  if (!job.info) return;
  job.speed = speedFor(job);
  job.target = await window.api.previewName(jobRequest(job));
}

let refreshTimer;
function refreshPendingNames() {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(async () => {
    for (const job of jobs.filter((j) => j.state === 'ready' || j.state === 'queued')) {
      await updateTargetName(job);
      renderItem(job);
    }
  }, 150);
}

async function pump() {
  if (!tools.ok) return;
  if (jobs.some((j) => j.state === 'running')) return;
  const job = jobs.find((j) => j.state === 'queued');
  if (!job) {
    finishRun();
    return;
  }

  const req = jobRequest(job);
  job.speed = req.speed;
  jobs.filter((j) => j.state === 'queued').forEach((j) => { j.inBatch = true; });
  job.state = 'running';
  job.pct = 0;
  job.eta = null;
  job.error = null;
  renderItem(job);
  updateChrome();

  const res = await window.api.convert(req);
  if (res.ok) {
    job.state = 'done';
    job.output = res.output;
    job.outSize = res.size;
    job.seconds = res.seconds;
    job.pct = 1;
  } else if (res.cancelled) {
    job.state = 'cancelled';
  } else {
    job.state = 'error';
    job.error = res.error;
  }
  renderItem(job);
  updateChrome();
  pump();
}

// Ein „Durchgang“ umfasst alle Jobs, die seit dem letzten Leerlauf gestartet wurden
function finishRun() {
  const batch = jobs.filter((j) => j.inBatch);
  if (!batch.length) return;
  const fresh = batch.filter((j) => j.state === 'done').length;
  batch.forEach((j) => { j.inBatch = false; });
  window.api.setProgress(-1);
  if (fresh > 0 && !document.hasFocus()) {
    new Notification('Zeitraffer', {
      body: fresh === 1 ? 'Ein Video ist fertig.' : `${fresh} Videos sind fertig.`,
    });
    window.api.flash();
  }
}

window.api.onProgress(({ id, pct, eta }) => {
  const job = jobs.find((j) => j.id === id);
  if (!job || job.state !== 'running') return;
  job.pct = pct;
  job.eta = eta;
  const li = document.querySelector(`[data-id="${id}"]`);
  if (li) {
    li.querySelector('.progress > span').style.width = `${(pct * 100).toFixed(1)}%`;
    li.querySelector('.status').textContent = statusText(job);
  }
  updateTaskbar();
});

function updateTaskbar() {
  const batch = jobs.filter((j) => j.inBatch && j.state !== 'cancelled');
  if (!batch.some((j) => j.state === 'queued' || j.state === 'running')) {
    window.api.setProgress(-1);
    return;
  }
  const finished = batch.filter((j) => j.state === 'done' || j.state === 'error').length;
  const running = batch.find((j) => j.state === 'running');
  window.api.setProgress((finished + (running ? running.pct : 0)) / batch.length);
}

// ---------- Darstellung ----------

function statusText(job) {
  switch (job.state) {
    case 'probing': return 'Wird analysiert …';
    case 'ready': return 'Bereit';
    case 'queued': return tools.ok ? 'Wartet' : 'Wartet auf ffmpeg';
    case 'running': {
      const pct = `${Math.floor((job.pct || 0) * 100)} %`;
      return job.eta != null ? `${pct} · noch ${fmtTime(job.eta)}` : pct;
    }
    case 'done': return `Fertig · ${fmtSize(job.outSize)} · ${fmtTime(job.seconds)} Rechenzeit`;
    case 'cancelled': return 'Abgebrochen';
    case 'error': return 'Fehler';
    default: return '';
  }
}

function renderItem(job) {
  let li = document.querySelector(`[data-id="${job.id}"]`);
  if (!li) {
    li = document.createElement('li');
    li.dataset.id = job.id;
    $('#queue').appendChild(li);
  }
  const info = job.info;
  const speed = job.speed || (info ? speedFor(job) : settings.speed);
  li.className = `item ${job.state}`;

  let facts = '';
  if (info) {
    const res = info.width ? `${info.width}×${info.height}` : '';
    facts = [fmtTime(info.duration), res, fmtFps(info.fps), fmtSize(info.size)].filter(Boolean).join(' · ');
    facts += ` &nbsp;→&nbsp; <b>${fmtTime(info.duration / speed)}</b>`;
  }

  let target = '';
  if (job.state === 'done' && job.output) {
    target = `<span>${esc(job.output.split(/[\\/]/).pop())}</span>`;
  } else if (job.target && info) {
    const where = settings.outMode === 'folder' && settings.outDir ? ' · im Zielordner' : '';
    target = `<span>${esc(job.target)}</span>${where}`;
  }

  let actions = '';
  if (job.state === 'ready') actions += '<button class="btn primary" data-act="start">Starten</button>';
  if (job.state === 'running' || job.state === 'queued') actions += '<button class="action" data-act="cancel">Abbrechen</button>';
  if (job.state === 'done') {
    actions += '<button class="action go" data-act="open">Abspielen ••</button>';
    actions += '<button class="action" data-act="reveal">Im Ordner zeigen</button>';
  }
  if ((job.state === 'error' || job.state === 'cancelled') && job.info) actions += '<button class="action go" data-act="retry">Erneut ••</button>';
  if (!['running', 'probing'].includes(job.state)) actions += '<button class="action" data-act="remove">Entfernen</button>';

  const pctWidth = job.state === 'done' ? 100 : (job.pct || 0) * 100;
  const showBar = ['probing', 'queued', 'running', 'done'].includes(job.state);

  // Stile werden per CSSOM gesetzt – die CSP verbietet style-Attribute im Markup
  li.innerHTML = `
    <div class="thumb">
      ${info ? `<span class="badge">${speedLabel(speed)}×</span>` : ''}
    </div>
    <div class="info">
      <div class="name" title="${esc(job.input)}">${esc(job.name)}</div>
      ${facts ? `<div class="facts">${facts}</div>` : ''}
      ${target ? `<div class="target">${target}</div>` : ''}
      ${job.error ? `<div class="error">${esc(job.error)}</div>` : ''}
      <div class="progress-row">
        ${showBar ? '<div class="progress"><span></span></div>' : ''}
        <span class="status">${statusText(job)}</span>
      </div>
    </div>
    <div class="actions">${actions}</div>`;
  if (job.thumb) li.querySelector('.thumb').style.backgroundImage = `url("${job.thumb}")`;
  const bar = li.querySelector('.progress > span');
  if (bar && job.state !== 'probing') bar.style.width = `${pctWidth}%`;
}

function updateChrome() {
  const hasJobs = jobs.length > 0;
  document.body.classList.toggle('has-jobs', hasJobs);
  $('#drop').classList.toggle('compact', hasJobs);
  $('#listHead').hidden = !hasJobs;
  const running = jobs.filter((j) => j.state === 'running' || j.state === 'queued').length;
  const done = jobs.filter((j) => j.state === 'done').length;
  const ready = jobs.filter((j) => j.state === 'ready').length;
  const parts = [`${jobs.length} ${jobs.length === 1 ? 'Video' : 'Videos'}`];
  if (running) parts.push(`${running} in Arbeit`);
  if (done) parts.push(`${done} fertig`);
  $('#summary').textContent = parts.join(' · ');
  $('#startAll').hidden = ready === 0;
  $('#clearDone').hidden = done === 0;
  updateTaskbar();
  updateStatusLine();
}

function removeJob(job) {
  const i = jobs.indexOf(job);
  if (i >= 0) jobs.splice(i, 1);
  document.querySelector(`[data-id="${job.id}"]`)?.remove();
  updateChrome();
}

$('#queue').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-act]');
  if (!b) return;
  const id = Number(b.closest('li').dataset.id);
  const job = jobs.find((j) => j.id === id);
  if (!job) return;
  switch (b.dataset.act) {
    case 'start':
    case 'retry':
      job.state = 'queued';
      job.error = null;
      job.pct = 0;
      updateTargetName(job).then(() => { renderItem(job); updateChrome(); pump(); });
      break;
    case 'cancel':
      if (job.state === 'running') window.api.cancel(job.id);
      else { job.state = 'cancelled'; renderItem(job); updateChrome(); }
      break;
    case 'open': window.api.open(job.output); break;
    case 'reveal': window.api.reveal(job.output); break;
    case 'remove': removeJob(job); break;
  }
});

$('#startAll').addEventListener('click', () => {
  jobs.filter((j) => j.state === 'ready').forEach((j) => { j.state = 'queued'; renderItem(j); });
  updateChrome();
  pump();
});

$('#clearDone').addEventListener('click', () => {
  jobs.filter((j) => j.state === 'done').forEach(removeJob);
});

// ---------- Drag & Drop ----------

let dragDepth = 0;
const hasFiles = (e) => e.dataTransfer && [...e.dataTransfer.types].includes('Files');

window.addEventListener('dragenter', (e) => {
  if (!hasFiles(e)) return;
  e.preventDefault();
  dragDepth++;
  document.body.classList.add('dragging');
});
window.addEventListener('dragover', (e) => {
  if (!hasFiles(e)) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'copy';
});
window.addEventListener('dragleave', () => {
  dragDepth = Math.max(0, dragDepth - 1);
  if (!dragDepth) document.body.classList.remove('dragging');
});
window.addEventListener('drop', (e) => {
  e.preventDefault();
  dragDepth = 0;
  document.body.classList.remove('dragging');
  const paths = [...e.dataTransfer.files].map((f) => window.api.getPathForFile(f)).filter(Boolean);
  if (paths.length) addFiles(paths);
});

$('#pickFiles').addEventListener('click', async (e) => {
  e.stopPropagation();
  const paths = await window.api.pickFiles();
  if (paths.length) addFiles(paths);
});
$('#drop').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') $('#pickFiles').click();
});

window.api.onFilesFromOS(addFiles);

// ---------- Start ----------

applyTheme();
bindSettings();
syncSettingsUI();
checkTools();
window.api.initialFiles().then((files) => { if (files.length) addFiles(files); });
