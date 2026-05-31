const { app, BrowserWindow, ipcMain, dialog, shell, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const fse = require('fs-extra');
const { ensureDependencies, getProjectRoot } = require('./deps');
const licenseService = require('../license-service');
const { resolveCoreRoot } = require('./worker-path');
const { loadCore } = require('./load-core');

let mainWindow = null;
let isProcessing = false;
let depsReady = false;

function getResourcesRoot() {
  if (app.isPackaged) return process.resourcesPath;
  return getProjectRoot();
}

function getExeDir() {
  if (app.isPackaged) return path.dirname(process.execPath);
  return getProjectRoot();
}

function getLicenseDir() {
  const dir = path.join(app.getPath('documents'), 'MilFun');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function getWorkDir() {
  if (app.isPackaged) {
    const dir = path.join(app.getPath('userData'), 'work');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    return dir;
  }
  return getProjectRoot();
}

function isDirWritable(dir) {
  try {
    fs.mkdirSync(dir, { recursive: true });
    const test = path.join(dir, `.milfun-write-test-${process.pid}`);
    fs.writeFileSync(test, 'ok');
    fs.unlinkSync(test);
    return true;
  } catch {
    return false;
  }
}

/** 程序工作目录：开发=项目根；安装版=exe 旁（可写）或 userData/work */
function getWorkspaceDir() {
  if (!app.isPackaged) return getProjectRoot();
  const exeDir = getExeDir();
  if (isDirWritable(exeDir)) return exeDir;
  return getWorkDir();
}

function getOutputDir() {
  return getWorkspaceDir();
}

function getDefaultSourceDir() {
  return path.join(getWorkspaceDir(), 'src');
}

const REMOVE_OPTS = { recursive: true, force: true, maxRetries: 5, retryDelay: 300 };

async function removeDir(dir) {
  if (!fs.existsSync(dir)) return;
  await fs.promises.rm(dir, REMOVE_OPTS);
}

function samePath(a, b) {
  const pa = path.resolve(a);
  const pb = path.resolve(b);
  if (process.platform === 'win32') return pa.toLowerCase() === pb.toLowerCase();
  return pa === pb;
}

function logLine(level, message) {
  send('log', { level, message });
}

async function copyWithProgress(from, to) {
  const started = Date.now();
  let heartbeat = null;

  const copyFilter = (srcPath) => {
    const base = path.basename(srcPath);
    if (base === 'node_modules' || base === '.src-staging' || base === 'src_processed') return false;
    const resolvedDest = path.resolve(to);
    const resolvedSrc = path.resolve(srcPath);
    if (resolvedDest.startsWith(resolvedSrc + path.sep)) return false;
    return true;
  };

  try {
    heartbeat = setInterval(() => {
      const sec = ((Date.now() - started) / 1000).toFixed(0);
      logLine('info', `[复制] 进行中... ${sec}s`);
    }, 3000);

    await fse.copy(from, to, {
      overwrite: true,
      errorOnExist: false,
      filter: copyFilter,
    });
  } finally {
    if (heartbeat) clearInterval(heartbeat);
  }

  logLine('info', `[复制] 完成，耗时 ${((Date.now() - started) / 1000).toFixed(1)}s`);
}

async function stageSourceToWorkspace(externalSource) {
  const workspace = getWorkspaceDir();
  const localSrc = path.join(workspace, 'src');

  logLine('info', `[源码] 外部: ${externalSource}`);
  logLine('info', `[源码] 工作目录: ${workspace}`);
  logLine('info', `[源码] 目标: ${localSrc}`);

  if (samePath(externalSource, localSrc)) {
    logLine('info', '[源码] 已在程序目录，跳过复制');
    return localSrc;
  }

  if (samePath(externalSource, workspace)) {
    if (fs.existsSync(localSrc)) {
      logLine('info', '[源码] 选中程序根目录，使用已有 src');
      return localSrc;
    }
    throw new Error('程序目录下没有 src，请选择 Cocos 构建产物目录');
  }

  const tempSrc = path.join(app.getPath('temp'), `milfun-src-${Date.now()}`);
  logLine('info', `[源码] 临时目录: ${tempSrc}`);

  try {
    logLine('info', '[源码] 清理临时目录...');
    await removeDir(tempSrc);

    logLine('info', '[源码] 开始复制（大项目可能需要数分钟）...');
    send('progress', { step: 0, total: 6, message: '正在复制源码...' });
    await copyWithProgress(externalSource, tempSrc);

    logLine('info', '[源码] 清理旧 src...');
    await removeDir(localSrc);

    logLine('info', '[源码] 移动到程序目录...');
    await fse.move(tempSrc, localSrc, { overwrite: true });

    logLine('success', `[源码] 就绪: ${localSrc}`);
    return localSrc;
  } catch (err) {
    logLine('error', `[源码] 失败: ${err.message}`);
    await removeDir(tempSrc).catch(() => {});
    throw err;
  }
}

function setupCoreEnv() {
  process.env.MILFUN_APP_ROOT = getResourcesRoot();
  process.env.MILFUN_EXE_DIR = getExeDir();
  process.env.MILFUN_LICENSE_DIR = getLicenseDir();
}

function getAppRoot() {
  if (app.isPackaged) return app.getAppPath();
  return getProjectRoot();
}

function getCoreRoot() {
  return resolveCoreRoot(getAppRoot());
}

function getWorkerEnv() {
  setupCoreEnv();
  const resources = getResourcesRoot();
  const coreRoot = getCoreRoot();
  const modulePaths = [
    path.join(resources, 'app.asar.unpacked', 'node_modules'),
    path.join(resources, 'app.asar', 'node_modules'),
    path.join(coreRoot, 'node_modules'),
  ].filter((p) => fs.existsSync(p));
  const nodePath = [...modulePaths, process.env.NODE_PATH].filter(Boolean).join(path.delimiter);

  return {
    MILFUN_APP_ROOT: resources,
    MILFUN_EXE_DIR: getExeDir(),
    MILFUN_LICENSE_DIR: getLicenseDir(),
    MILFUN_CORE_ROOT: coreRoot,
    NODE_PATH: nodePath,
  };
}

function send(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
}

async function runPipelineInMain(options) {
  Object.assign(process.env, getWorkerEnv());
  require('./worker-bootstrap');

  const coreRoot = getCoreRoot();
  logLine('info', `[Core] 主进程加载: ${coreRoot}`);
  send('progress', { step: 0, total: 6, message: '正在加载核心模块...' });

  await new Promise((resolve) => setImmediate(resolve));

  const core = loadCore(coreRoot, (level, message) => logLine(level, message));

  send('progress', { step: 0, total: 6, message: '正在处理资源...' });

  const result = await core.runPipeline({
    appRoot: options.appRoot,
    sourceDir: options.sourceDir,
    processedDir: options.processedDir,
    outputDir: options.outputDir,
    licenseRoot: getResourcesRoot(),
    trustUiLicense: true,
    onLog: (level, message) => logLine(level, message),
    onProgress: (step, total, message) => {
      send('progress', { step, total, message });
      if (message) logLine('info', message);
    },
  });

  send('done', {
    zipPath: result.zipPath,
    processedDir: result.processedDir,
    workspaceDir: getWorkspaceDir(),
  });

  return {
    ok: true,
    zipPath: result.zipPath,
    processedDir: result.processedDir,
    workspaceDir: getWorkspaceDir(),
  };
}

function createWindow() {
  Menu.setApplicationMenu(null);

  mainWindow = new BrowserWindow({
    width: 300,
    height: 480,
    minWidth: 260,
    minHeight: 380,
    maxWidth: 400,
    title: 'MilFun',
    backgroundColor: '#0d0d0d',
    resizable: true,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
    show: false,
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  mainWindow.setMenuBarVisibility(false);
  mainWindow.once('ready-to-show', () => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.show();
  });
  mainWindow.webContents.on('did-fail-load', (_event, code, desc) => {
    dialog.showErrorBox('界面加载失败', `${desc} (${code})`);
  });
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

async function bootstrap() {
  createWindow();

  if (!app.isPackaged) {
    send('setup-start', {});
    try {
      await ensureDependencies((line) => {
        send('setup-log', { message: line });
      });
      depsReady = true;
      send('setup-done', {});
    } catch (err) {
      send('setup-error', { message: err.message || String(err) });
      dialog.showErrorBox(
        '依赖安装失败',
        `${err.message || err}\n\n请在项目目录打开终端，手动执行：\nnpm install`,
      );
    }
  } else {
    depsReady = true;
    send('setup-done', {});
  }
}

ipcMain.handle('get-app-info', async () => ({
  resourcesRoot: getResourcesRoot(),
  licenseDir: getLicenseDir(),
  workspaceDir: getWorkspaceDir(),
  outputDir: getOutputDir(),
  defaultSource: getDefaultSourceDir(),
  isPackaged: app.isPackaged,
  depsReady,
}));

ipcMain.handle('check-license', async (_event, options = {}) => {
  if (!depsReady) return { valid: false, reason: '依赖尚未就绪' };
  try {
    setupCoreEnv();
    return await licenseService.checkLicense(getResourcesRoot(), options);
  } catch (err) {
    return { valid: false, reason: err.message || String(err) };
  }
});

ipcMain.handle('get-fingerprint', async () => {
  if (!depsReady) throw new Error('依赖尚未就绪');
  setupCoreEnv();
  return licenseService.getDeviceFingerprint();
});

ipcMain.handle('import-license', async () => {
  if (!depsReady) return { ok: false, error: '依赖尚未就绪' };
  const result = await dialog.showOpenDialog(mainWindow, {
    title: '导入许可证文件',
    properties: ['openFile'],
    filters: [{ name: 'License', extensions: ['lic'] }],
    defaultPath: getLicenseDir(),
  });
  if (result.canceled || !result.filePaths.length) {
    return { ok: false, canceled: true };
  }

  setupCoreEnv();
  const target = await licenseService.importLicense(result.filePaths[0], getResourcesRoot());
  const license = await licenseService.checkLicense(getResourcesRoot(), { skipDevice: true });
  return { ok: license.valid, path: target, license };
});

ipcMain.handle('select-source-dir', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: '选择 Cocos 构建产物目录',
    properties: ['openDirectory'],
    defaultPath: getDefaultSourceDir(),
  });
  if (result.canceled || !result.filePaths.length) return null;
  return result.filePaths[0];
});

ipcMain.handle('open-path', async (_event, targetPath) => {
  if (!targetPath || !fs.existsSync(targetPath)) return false;
  await shell.openPath(targetPath);
  return true;
});

ipcMain.handle('start-processing', async (_event, sourceDir) => {
  if (!depsReady) {
    return { ok: false, error: '依赖尚未就绪，请等待 npm install 完成' };
  }
  if (isProcessing) {
    return { ok: false, error: '正在处理中，请稍候...' };
  }

  const resolvedSource = sourceDir || getDefaultSourceDir();
  if (!fs.existsSync(resolvedSource)) {
    return { ok: false, error: `源码目录不存在: ${resolvedSource}` };
  }

  isProcessing = true;
  send('processing-state', { running: true });
  send('progress', { step: 0, total: 6, message: '正在启动...' });
  send('log', { level: 'info', message: 'MilFun Start...' });

  try {
    const stagedSource = await stageSourceToWorkspace(resolvedSource);
    const workspace = getWorkspaceDir();
    return await runPipelineInMain({
      appRoot: workspace,
      sourceDir: stagedSource,
      processedDir: path.join(workspace, 'src_processed'),
      outputDir: workspace,
    });
  } catch (error) {
    const message = error.message || String(error);
    send('log', { level: 'error', message });
    return { ok: false, error: message };
  } finally {
    isProcessing = false;
    send('processing-state', { running: false });
  }
});

app.whenReady().then(bootstrap);

process.on('uncaughtException', (err) => {
  try {
    const logPath = path.join(app.getPath('userData'), 'startup-error.log');
    fs.appendFileSync(logPath, `${new Date().toISOString()} uncaughtException\n${err.stack || err.message}\n`);
  } catch (_) { /* ignore */ }
  dialog.showErrorBox('MilFun 启动错误', err.message || String(err));
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) bootstrap();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
