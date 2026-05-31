const sourceDisplay = document.getElementById('source-dir');
const licenseBadge = document.getElementById('license-badge');
const licenseText = document.getElementById('license-text');
const btnBrowse = document.getElementById('btn-browse');
const btnSettings = document.getElementById('btn-settings');
const settingsPopover = document.getElementById('settings-popover');
const btnImportLicense = document.getElementById('btn-import-license');
const btnFingerprint = document.getElementById('btn-fingerprint');
const btnStart = document.getElementById('btn-start');
const btnOpenOutput = document.getElementById('btn-open-output');
const cfgObfuscation = document.getElementById('cfg-obfuscation');
const cfgObfRatio = document.getElementById('cfg-obf-ratio');
const cfgObfRatioVal = document.getElementById('cfg-obf-ratio-val');
const cfgObfRatioHint = document.getElementById('cfg-obf-ratio-hint');
const obfRatioRows = document.getElementById('obf-ratio-rows');
const cfgImage = document.getElementById('cfg-image');
const cfgImageIntensity = document.getElementById('cfg-image-intensity');
const cfgImageIntensityVal = document.getElementById('cfg-image-intensity-val');
const cfgImageIntensityHint = document.getElementById('cfg-image-intensity-hint');
const imageIntensityRows = document.getElementById('image-intensity-rows');
const cfgAudio = document.getElementById('cfg-audio');
const logOutput = document.getElementById('log-output');
const progressTrack = document.getElementById('progress-track');
const progressFill = document.getElementById('progress-fill');
const progressPercent = document.getElementById('progress-percent');
const progressSpinner = document.getElementById('progress-spinner');
const processingStatus = document.getElementById('processing-status');
const setupOverlay = document.getElementById('setup-overlay');
const setupLog = document.getElementById('setup-log');

const OBF_TIER_GAP = 0.3;
const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

let sourcePath = '';
let processedDir = '';
let licenseValid = false;
let isProcessing = false;
let appReady = false;
let saveConfigTimer = null;
let spinnerTimer = null;
let spinnerFrame = 0;
let statusMessage = '';

function shortPath(p) {
  if (!p) return './src';
  const parts = p.replace(/\\/g, '/').split('/');
  if (parts.length <= 3) return p.replace(/\\/g, '/');
  return '.../' + parts.slice(-2).join('/');
}

const LOG_MAX_LINES = 100;
const SETUP_LOG_MAX_LINES = 50;

function trimLogLines(container, maxLines) {
  while (container.childNodes.length > maxLines) {
    container.removeChild(container.firstChild);
  }
}

function appendLog(level, message) {
  if (!message.trim()) return;
  const line = document.createElement('div');
  line.className = `log-line-${level}`;
  line.textContent = message;
  logOutput.appendChild(line);
  trimLogLines(logOutput, LOG_MAX_LINES);
  logOutput.scrollTop = logOutput.scrollHeight;
  if (isProcessing && (level === 'info' || level === 'warn')) {
    setProcessingMessage(message);
  }
}

function appendSetupLog(message) {
  if (!message.trim()) return;
  const prefix = setupLog.textContent ? '\n' : '';
  setupLog.textContent += prefix + message;
  const lines = setupLog.textContent.split('\n');
  if (lines.length > SETUP_LOG_MAX_LINES) {
    setupLog.textContent = lines.slice(-SETUP_LOG_MAX_LINES).join('\n');
  }
  setupLog.scrollTop = setupLog.scrollHeight;
}

function setProgress(step, total) {
  const pct = total > 0 ? Math.round((step / total) * 100) : 0;
  progressFill.style.width = `${pct}%`;
  progressPercent.textContent = `${pct}%`;
  progressFill.classList.toggle('active', pct > 0 || isProcessing);
}

function setProcessingMessage(message) {
  if (!message) return;
  const text = String(message).trim();
  if (!text) return;
  statusMessage = text.length > 42 ? `…${text.slice(-41)}` : text;
  if (processingStatus && isProcessing) {
    processingStatus.textContent = statusMessage;
  }
}

function startSpinner() {
  stopSpinner();
  spinnerTimer = setInterval(() => {
    spinnerFrame = (spinnerFrame + 1) % SPINNER_FRAMES.length;
    progressSpinner.textContent = SPINNER_FRAMES[spinnerFrame];
  }, 80);
}

function stopSpinner() {
  if (spinnerTimer) {
    clearInterval(spinnerTimer);
    spinnerTimer = null;
  }
  progressSpinner.textContent = '';
}

function setProcessingUi(active, message = '') {
  document.querySelector('.app').classList.toggle('is-processing', active);
  progressTrack.classList.toggle('processing', active);
  progressFill.classList.toggle('processing', active);
  btnStart.classList.toggle('processing', active);
  progressSpinner.classList.toggle('hidden', !active);
  processingStatus.classList.toggle('hidden', !active);

  if (active) {
    btnStart.textContent = '◌ 处理中';
    statusMessage = message || '正在处理…';
    processingStatus.textContent = statusMessage;
    startSpinner();
    progressFill.classList.add('active');
  } else {
    btnStart.textContent = '▶ 开始处理';
    statusMessage = '';
    processingStatus.textContent = '';
    stopSpinner();
  }
}

function setLicenseBadge(result) {
  if (result.valid) {
    const expiry = new Date(result.expiryDate).toLocaleDateString('en-US');
    licenseBadge.className = 'auth-dot ok';
    licenseBadge.title = `Licensed, expires ${expiry}`;
    licenseText.textContent = `Licensed · ${expiry}`;
    licenseText.className = 'license-text ok';
    licenseValid = true;
    btnStart.disabled = isProcessing || !appReady;
  } else {
    licenseBadge.className = 'auth-dot error';
    licenseBadge.title = result.reason || 'Not licensed';
    licenseText.textContent = 'Not licensed · ⚙ Import';
    licenseText.className = 'license-text error';
    licenseValid = false;
    btnStart.disabled = true;
  }
}

function clampRatio(value, fallback = 1.8) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.min(n, 5);
}

function ratioToSlider(ratio) {
  return Math.round(clampRatio(ratio) * 10);
}

function sliderToRatio(slider) {
  return clampRatio(Number(slider) / 10);
}

function deriveTierRatios(maxRatio) {
  const max = clampRatio(maxRatio);
  const prefer = Math.max(1, Math.round((max - OBF_TIER_GAP) * 10) / 10);
  return { preferRatio: Math.min(prefer, max), maxRatio: max };
}

function clampIntensity(value, fallback = 5) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.min(n, 10);
}

function getImageColorRanges(level) {
  const intensity = clampIntensity(level);
  const factor = intensity / 5;
  return {
    intensity,
    hueMax: Math.max(1, Math.round(12 * factor)),
    brightPct: Math.max(1, Math.round(8 * factor)),
    satPct: Math.max(1, Math.round(14 * factor)),
  };
}

function syncImageIntensityUi() {
  const { intensity, hueMax, brightPct, satPct } = getImageColorRanges(cfgImageIntensity.value);
  cfgImageIntensity.value = String(intensity);
  cfgImageIntensityVal.textContent = String(intensity);
  cfgImageIntensityHint.textContent = `色相 ±${hueMax}° · 亮度 ±${brightPct}% · 饱和度 ±${satPct}%`;
  return intensity;
}

function syncObfRatioUi() {
  const { preferRatio, maxRatio } = deriveTierRatios(sliderToRatio(cfgObfRatio.value));
  cfgObfRatio.value = String(ratioToSlider(maxRatio));
  cfgObfRatioVal.textContent = maxRatio.toFixed(1);
  cfgObfRatioHint.textContent = `tier1 ≤ ${preferRatio.toFixed(1)} · tier2 ≤ ${maxRatio.toFixed(1)}`;
  return { preferRatio, maxRatio };
}

function getFeatureFlagsFromUi() {
  const { preferRatio, maxRatio } = syncObfRatioUi();
  const imageColorIntensity = syncImageIntensityUi();
  return {
    canObfuscation: cfgObfuscation.checked,
    canImageSwitch: cfgImage.checked,
    canAudioSwitch: cfgAudio.checked,
    obfuscationMaxRatio: maxRatio,
    obfuscationPreferRatio: preferRatio,
    imageColorIntensity,
  };
}

function applyFeatureFlagsToUi(flags) {
  cfgObfuscation.checked = Boolean(flags.canObfuscation);
  cfgImage.checked = Boolean(flags.canImageSwitch);
  cfgAudio.checked = Boolean(flags.canAudioSwitch);
  cfgObfRatio.value = String(ratioToSlider(flags.obfuscationMaxRatio ?? 1.8));
  cfgImageIntensity.value = String(clampIntensity(flags.imageColorIntensity ?? 5));
  syncObfRatioUi();
  syncImageIntensityUi();
  updateObfRatioState();
  updateImageIntensityState();
}

function updateObfRatioState() {
  const on = cfgObfuscation.checked && !cfgObfuscation.disabled;
  obfRatioRows.classList.toggle('disabled', !on);
  cfgObfRatio.disabled = !on;
}

function updateImageIntensityState() {
  const on = cfgImage.checked && !cfgImage.disabled;
  imageIntensityRows.classList.toggle('disabled', !on);
  cfgImageIntensity.disabled = !on;
}

function setFeatureControlsDisabled(disabled) {
  cfgObfuscation.disabled = disabled;
  cfgImage.disabled = disabled;
  cfgAudio.disabled = disabled;
  updateObfRatioState();
  updateImageIntensityState();
}

async function loadFeatureConfig() {
  try {
    const flags = await window.milfun.getFeatureConfig();
    applyFeatureFlagsToUi(flags);
  } catch (err) {
    appendLog('warn', `读取配置失败: ${err.message}`);
  }
}

function scheduleSaveFeatureConfig() {
  if (saveConfigTimer) clearTimeout(saveConfigTimer);
  saveConfigTimer = setTimeout(async () => {
    try {
      await window.milfun.saveFeatureConfig(getFeatureFlagsFromUi());
    } catch (err) {
      appendLog('warn', `保存配置失败: ${err.message}`);
    }
  }, 300);
}

function toggleSettingsPopover(force) {
  const open = force !== undefined ? force : settingsPopover.classList.contains('hidden');
  settingsPopover.classList.toggle('hidden', !open);
}

function closeSettingsPopover() {
  settingsPopover.classList.add('hidden');
}

async function refreshLicense() {
  try {
    const license = await window.milfun.checkLicense();
    setLicenseBadge(license);
    return license;
  } catch (err) {
    setLicenseBadge({ valid: false, reason: err.message });
    return null;
  }
}

function bindEvents() {
  window.milfun.onLog(({ level, message }) => {
    appendLog(level, message);
  });

  window.milfun.onProgress(({ step, total, message }) => {
    setProgress(step, total);
    if (!message) return;
    // 高频进度（UUID 替换）只更新底部状态，不刷屏
    if (isProcessing && /^Replacing UUIDs \(/i.test(message)) {
      setProcessingMessage(message);
      return;
    }
    appendLog('info', message);
    if (isProcessing) setProcessingMessage(message);
  });

  window.milfun.onProcessingState(({ running }) => {
    isProcessing = running;
    setProcessingUi(running);
    btnStart.disabled = running || !licenseValid || !appReady;
    btnOpenOutput.disabled = running || !appReady;
    btnBrowse.disabled = running;
    btnSettings.disabled = running;
    btnFingerprint.disabled = running;
    btnImportLicense.disabled = running;
    setFeatureControlsDisabled(running);
    if (running) closeSettingsPopover();
  });

  window.milfun.onDone(({ processedDir: outDir }) => {
    if (outDir) processedDir = outDir;
    appendLog('success', '处理完成，已打开 src_processed');
    setProgress(5, 5);
  });

  window.milfun.onError(({ message }) => {
    appendLog('error', message);
    setProgress(0, 5);
  });

  cfgObfuscation.addEventListener('change', () => {
    updateObfRatioState();
    if (!isProcessing) scheduleSaveFeatureConfig();
  });

  cfgImage.addEventListener('change', () => {
    updateImageIntensityState();
    if (!isProcessing) scheduleSaveFeatureConfig();
  });

  [cfgAudio].forEach((input) => {
    input.addEventListener('change', () => {
      if (!isProcessing) scheduleSaveFeatureConfig();
    });
  });

  cfgObfRatio.addEventListener('input', () => {
    syncObfRatioUi();
    if (!isProcessing) scheduleSaveFeatureConfig();
  });

  cfgImageIntensity.addEventListener('input', () => {
    syncImageIntensityUi();
    if (!isProcessing) scheduleSaveFeatureConfig();
  });

  document.addEventListener('click', (e) => {
    if (!e.target.closest('.settings-wrap')) closeSettingsPopover();
  });

  btnSettings.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleSettingsPopover();
  });

  btnBrowse.addEventListener('click', async () => {
    const dir = await window.milfun.selectSourceDir();
    if (dir) {
      sourcePath = dir;
      sourceDisplay.textContent = shortPath(dir);
    }
  });

  btnImportLicense.addEventListener('click', async () => {
    closeSettingsPopover();
    const result = await window.milfun.importLicense();
    if (result.canceled) return;
    if (result.ok) {
      appendLog('success', 'License imported');
      setLicenseBadge(result.license);
    } else {
      appendLog('error', result.license?.reason || 'Invalid license');
      setLicenseBadge(result.license || { valid: false, reason: 'Invalid license' });
    }
  });

  btnFingerprint.addEventListener('click', async () => {
    closeSettingsPopover();
    try {
      const fp = await window.milfun.getFingerprint();
      await navigator.clipboard.writeText(fp);
      appendLog('success', 'Fingerprint copied');
    } catch (err) {
      appendLog('error', '复制失败: ' + err.message);
    }
  });

  btnStart.addEventListener('click', async () => {
    logOutput.innerHTML = '';
    processedDir = '';
    setProgress(0, 5);
    const featureFlags = getFeatureFlagsFromUi();
    const result = await window.milfun.startProcessing({ sourceDir: sourcePath, featureFlags });
    if (!result.ok) {
      appendLog('error', result.error);
      setProgress(0, 5);
    }
  });

  btnOpenOutput.addEventListener('click', async () => {
    const dir = processedDir || (await window.milfun.getAppInfo()).processedDir;
    const ok = await window.milfun.openPath(dir);
    if (!ok) appendLog('warn', '输出目录尚不存在，请先处理一次');
  });
}

async function initApp() {
  const info = await window.milfun.getAppInfo();
  processedDir = info.processedDir || '';
  sourcePath = info.defaultSource;
  sourceDisplay.textContent = shortPath(sourcePath);
  appReady = info.depsReady;
  btnOpenOutput.disabled = !appReady;
  await loadFeatureConfig();
  await refreshLicense();
}

async function bootstrap() {
  bindEvents();

  window.milfun.onSetupStart(() => {
    setupOverlay.classList.remove('hidden');
    setupLog.textContent = '';
    licenseBadge.className = 'auth-dot pending';
    licenseText.textContent = '正在安装依赖...';
    licenseText.className = 'license-text';
  });

  window.milfun.onSetupLog(({ message }) => {
    appendSetupLog(message);
  });

  window.milfun.onSetupError(({ message }) => {
    appendSetupLog(message);
    licenseBadge.className = 'auth-dot error';
    licenseText.textContent = '依赖安装失败';
    licenseText.className = 'license-text error';
  });

  window.milfun.onSetupDone(async () => {
    setupOverlay.classList.add('hidden');
    appReady = true;
    await initApp();
  });

  const info = await window.milfun.getAppInfo();
  if (info.depsReady) {
    appReady = true;
    await initApp();
  }
}

bootstrap();
