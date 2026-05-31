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
const logOutput = document.getElementById('log-output');
const progressFill = document.getElementById('progress-fill');
const progressPercent = document.getElementById('progress-percent');
const setupOverlay = document.getElementById('setup-overlay');
const setupLog = document.getElementById('setup-log');

let sourcePath = '';
let workspaceDir = '';
let lastZipPath = '';
let licenseValid = false;
let isProcessing = false;
let appReady = false;

function shortPath(p) {
  if (!p) return './src';
  const parts = p.replace(/\\/g, '/').split('/');
  if (parts.length <= 3) return p.replace(/\\/g, '/');
  return '.../' + parts.slice(-2).join('/');
}

function appendLog(level, message) {
  if (!message.trim()) return;
  const line = document.createElement('div');
  line.className = `log-line-${level}`;
  line.textContent = message;
  logOutput.appendChild(line);
  logOutput.scrollTop = logOutput.scrollHeight;
}

function appendSetupLog(message) {
  if (!message.trim()) return;
  setupLog.textContent += (setupLog.textContent ? '\n' : '') + message;
  setupLog.scrollTop = setupLog.scrollHeight;
}

function setProgress(step, total) {
  const pct = total > 0 ? Math.round((step / total) * 100) : 0;
  progressFill.style.width = `${pct}%`;
  progressPercent.textContent = `${pct}%`;
  progressFill.classList.toggle('active', pct > 0);
}

function setLicenseBadge(result) {
  if (result.valid) {
    const expiry = new Date(result.expiryDate).toLocaleDateString('zh-CN');
    licenseBadge.className = 'auth-dot ok';
    licenseBadge.title = `已授权，到期 ${expiry}`;
    licenseText.textContent = `已授权 · ${expiry} 到期`;
    licenseText.className = 'license-text ok';
    licenseValid = true;
    btnStart.disabled = isProcessing || !appReady;
  } else {
    licenseBadge.className = 'auth-dot error';
    licenseBadge.title = result.reason || '未授权';
    licenseText.textContent = '未授权 · ⚙ 导入许可证';
    licenseText.className = 'license-text error';
    licenseValid = false;
    btnStart.disabled = true;
  }
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
    if (message) appendLog('info', message);
  });

  window.milfun.onProcessingState(({ running }) => {
    isProcessing = running;
    btnStart.disabled = running || !licenseValid || !appReady;
    btnBrowse.disabled = running;
    btnSettings.disabled = running;
    btnFingerprint.disabled = running;
    btnImportLicense.disabled = running;
    if (running) closeSettingsPopover();
  });

  window.milfun.onDone(({ zipPath, workspaceDir: wsDir }) => {
    lastZipPath = zipPath;
    if (wsDir) workspaceDir = wsDir;
    const name = zipPath.split(/[/\\]/).pop();
    appendLog('success', `ZIP created: ${name}`);
    btnOpenOutput.disabled = false;
    btnOpenOutput.classList.remove('hidden');
    setProgress(6, 6);
  });

  window.milfun.onError(({ message }) => {
    appendLog('error', message);
    setProgress(0, 6);
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
      appendLog('success', '许可证导入成功');
      setLicenseBadge(result.license);
    } else {
      appendLog('error', result.license?.reason || '许可证无效');
      setLicenseBadge(result.license || { valid: false, reason: '许可证无效' });
    }
  });

  btnFingerprint.addEventListener('click', async () => {
    closeSettingsPopover();
    try {
      const fp = await window.milfun.getFingerprint();
      await navigator.clipboard.writeText(fp);
      appendLog('success', '设备指纹已复制');
    } catch (err) {
      appendLog('error', '复制失败: ' + err.message);
    }
  });

  btnStart.addEventListener('click', async () => {
    logOutput.innerHTML = '';
    lastZipPath = '';
    btnOpenOutput.disabled = true;
    btnOpenOutput.classList.add('hidden');
    setProgress(0, 6);
    appendLog('info', 'MilFun Start...');
    const result = await window.milfun.startProcessing(sourcePath);
    if (!result.ok) {
      appendLog('error', result.error);
      setProgress(0, 6);
    }
  });

  btnOpenOutput.addEventListener('click', async () => {
    await window.milfun.openPath(workspaceDir);
  });
}

async function initApp() {
  const info = await window.milfun.getAppInfo();
  workspaceDir = info.workspaceDir || info.outputDir;
  sourcePath = info.defaultSource;
  sourceDisplay.textContent = shortPath(sourcePath);
  appReady = info.depsReady;
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
