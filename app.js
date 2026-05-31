const crypto = require('crypto');
const fs = require('fs-extra');
const path = require('path');
const { exec, execSync } = require('child_process');

let _sharp;
function getSharp() {
  if (!_sharp) _sharp = require('sharp');
  return _sharp;
}

let _JavaScriptObfuscator;
function getObfuscator() {
  if (!_JavaScriptObfuscator) {
    const Module = require('module');
    const obfPkgPath = require.resolve('javascript-obfuscator/package.json');
    const obfDir = path.dirname(obfPkgPath);
    const origResolve = Module._resolveFilename;

    Module._resolveFilename = function patchedResolve(request, parent, isMain, options) {
      if (request === 'ansi-styles' && parent?.filename?.includes(`${path.sep}chalk${path.sep}`)) {
        const candidates = [
          path.join(obfDir, 'node_modules', 'chalk', 'node_modules', 'ansi-styles', 'index.js'),
          path.join(obfDir, 'node_modules', 'ansi-styles', 'index.js'),
        ];
        for (const candidate of candidates) {
          if (fs.existsSync(candidate)) return candidate;
        }
      }
      return origResolve.call(this, request, parent, isMain, options);
    };

    try {
      _JavaScriptObfuscator = require('javascript-obfuscator');
    } finally {
      Module._resolveFilename = origResolve;
    }
  }
  return _JavaScriptObfuscator;
}

const {
  DIR_CONFIG,
  FILE_EXTENSIONS,
  OBFUSCATION_CONFIG,
  OBFUSCATION_PRESETS,
  WHITELIST_CONFIG,
  getFeatureFlags,
  refreshFeatureFlags,
  applyFeatureFlags,
} = require('./config');

const {
  LicenseValidator,
  getLicenseStorageDir,
  resolveLicensePath,
  resolvePublicKeyPath,
  getDeviceFingerprint,
  importLicense,
  checkLicense,
} = require('./license-service');

function getAppRoot() {
  if (process.env.MILFUN_APP_ROOT) return process.env.MILFUN_APP_ROOT;
  return __dirname;
}

function stripAnsi(text) {
  return String(text).replace(/\x1b\[[0-9;]*m/g, '');
}

function installLogHooks(onLog) {
  if (!onLog) return null;
  const orig = { log: console.log, error: console.error, warn: console.warn };
  console.log = (...args) => {
    orig.log(...args);
    onLog('info', stripAnsi(args.join(' ')));
  };
  console.error = (...args) => {
    orig.error(...args);
    onLog('error', stripAnsi(args.join(' ')));
  };
  console.warn = (...args) => {
    orig.warn(...args);
    onLog('warn', stripAnsi(args.join(' ')));
  };
  return orig;
}

function restoreLogHooks(orig) {
  if (!orig) return;
  console.log = orig.log;
  console.error = orig.error;
  console.warn = orig.warn;
}

// ─── 音频 ───────────────────────────────────────────────────

function resolveAudioExtension(filePath) {
  let base = path.basename(filePath);
  base = base.replace(/\.milfun-\d+-\d+(?:-compressed)?\.tmp$/i, '').replace(/\.tmp$/i, '');
  const ext = path.extname(base).toLowerCase();
  return FILE_EXTENSIONS.AUDIO.includes(ext) ? ext : '.mp3';
}

function checkFFmpeg() {
  return new Promise((resolve) => {
    exec('ffmpeg -version', (error) => resolve(!error));
  });
}

function compressAudioFile(inputPath, outputPath, quality = 'medium', audioExt) {
  return new Promise((resolve, reject) => {
    let bitrate = '128k';
    if (quality === 'low') bitrate = '192k';
    if (quality === 'high') bitrate = '64k';

    const ext = audioExt || resolveAudioExtension(outputPath || inputPath);
    let codecArgs = '-c:a libmp3lame';
    if (ext === '.aac' || ext === '.m4a') codecArgs = '-c:a aac';
    else if (ext === '.wav') codecArgs = '-c:a pcm_s16le';
    else if (ext === '.ogg') codecArgs = '-c:a libvorbis';
    else if (ext === '.opus') codecArgs = '-c:a libopus';

    const command = `ffmpeg -y -hide_banner -loglevel error -i "${inputPath}" -b:a ${bitrate} ${codecArgs} "${outputPath}"`;
    exec(command, { windowsHide: true }, (error, _stdout, stderr) => {
      if (error) {
        const brief = (stderr || error.message || '').trim().split('\n').filter(Boolean).pop() || 'unknown error';
        reject(new Error(brief));
      } else resolve(outputPath);
    });
  });
}

async function processAudioFile(inputPath, outputPath, quality = 'medium') {
  await ensureDirectoryExists(outputPath);
  const audioExt = resolveAudioExtension(inputPath);
  const hasFFmpeg = await checkFFmpeg();

  if (!hasFFmpeg || quality === 'none') {
    await fs.copy(inputPath, outputPath);
    console.log(`Audio copied (no FFmpeg): ${path.basename(outputPath)}`);
    return;
  }

  const compressedPath = path.join(
    path.dirname(outputPath),
    `.milfun-${process.pid}-${Date.now()}${audioExt}`,
  );

  try {
    const originalSize = fs.statSync(inputPath).size;
    await compressAudioFile(inputPath, compressedPath, quality, audioExt);
    const compressedSize = fs.statSync(compressedPath).size;
    if (fs.existsSync(outputPath)) await removeFileWithRetry(outputPath);
    await fs.rename(compressedPath, outputPath);
    console.log(
      `Audio compressed: ${path.basename(outputPath)} (${((1 - compressedSize / originalSize) * 100).toFixed(1)}% saved)`
    );
  } catch (err) {
    await forceRemoveFile(compressedPath).catch(() => {});
    if (!fs.existsSync(outputPath)) await fs.copy(inputPath, outputPath);
    console.warn(`Audio compress failed, kept copy: ${err.message}`);
  }
}

// ─── UUID 工具 ──────────────────────────────────────────────

function encode(e) {
  for (var o = '0123456789abcdef'.split(''), t = new Array(123), n = 0; n < 123; ++n) t[n] = 64;
  for (var c = 0; c < 64; ++c)
    t[c] = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/='.charAt(c);
  if (((e = e.replace(/-/g, '')), 32 !== e.length)) throw new Error('Invalid UUID format');
  for (var r = [e[0], e[1]], i = 2; i < 32; i += 3) {
    var a = (o.indexOf(e[i]) << 2) | (o.indexOf(e[i + 1]) >> 2),
      l = ((3 & o.indexOf(e[i + 1])) << 4) | o.indexOf(e[i + 2]);
    r.push(t[a]), r.push(t[l]);
  }
  return r.join('');
}

function generateNewUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
    const r = crypto.randomBytes(1)[0] % 16 | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function generateRandomHexString(length) {
  let result = '';
  for (let i = 0; i < length; i++) {
    result += crypto.randomInt(0, 16).toString(16);
  }
  return result;
}

function extractUUIDAndExtra(baseName) {
  const uuidRegex = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
  const lastDotIndex = baseName.lastIndexOf('.');
  const mainPart = lastDotIndex !== -1 ? baseName.substring(0, lastDotIndex) : baseName;
  const extraPart = lastDotIndex !== -1 ? baseName.substring(lastDotIndex + 1) : '';

  if (mainPart.includes('@')) {
    const atIndex = mainPart.indexOf('@');
    const uuidPart = mainPart.substring(0, atIndex);
    const afterAtPart = mainPart.substring(atIndex);
    return {
      uuid: uuidPart,
      afterAt: afterAtPart,
      extra: extraPart,
      fullName: baseName,
      hasAt: true,
      notUUid: !uuidRegex.test(uuidPart),
    };
  }
  if (uuidRegex.test(mainPart)) {
    return { uuid: mainPart, afterAt: '', extra: extraPart, fullName: baseName, hasAt: false, notUUid: false };
  }
  if (mainPart.length === 9) {
    return { uuid: mainPart, afterAt: '', extra: extraPart, fullName: baseName, hasAt: false, notUUid: true };
  }
  return null;
}

// ─── 文件工具 ───────────────────────────────────────────────

async function ensureDirectoryExists(filePath) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
}

async function removeFileWithRetry(filePath, retries = 8, delayMs = 150) {
  if (!fs.existsSync(filePath)) return;
  let lastErr;
  for (let i = 0; i < retries; i++) {
    try {
      try {
        fs.chmodSync(filePath, 0o666);
      } catch (_) { /* ignore */ }
      await fs.promises.rm(filePath, { force: true, maxRetries: 3, retryDelay: 100 });
      return;
    } catch (err) {
      lastErr = err;
      if (process.platform === 'win32' && (err.code === 'EPERM' || err.code === 'EBUSY')) {
        await new Promise((r) => setTimeout(r, delayMs * (i + 1)));
        continue;
      }
      throw err;
    }
  }
  throw lastErr;
}

function forceRemoveFileSync(filePath) {
  if (!fs.existsSync(filePath)) return;
  if (process.platform === 'win32') {
    execSync(`cmd /c attrib -R "${filePath}" & del /f /q "${filePath}"`, { stdio: 'ignore', windowsHide: true });
    if (!fs.existsSync(filePath)) return;
  }
  fs.rmSync(filePath, { force: true, maxRetries: 5, retryDelay: 200 });
}

async function forceRemoveFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  try {
    await removeFileWithRetry(filePath, 12, 250);
    if (!fs.existsSync(filePath)) return;
  } catch (_) { /* retry below */ }

  await new Promise((resolve, reject) => {
    if (process.platform === 'win32') {
      exec(`cmd /c attrib -R "${filePath}" & del /f /q "${filePath}"`, { windowsHide: true }, (err) => {
        if (fs.existsSync(filePath)) reject(err || new Error(`无法删除: ${path.basename(filePath)}`));
        else resolve();
      });
      return;
    }
    try {
      forceRemoveFileSync(filePath);
      resolve();
    } catch (err) {
      reject(err);
    }
  });
}

async function runWithConcurrency(items, worker, limit = 4) {
  let index = 0;
  async function next() {
    while (index < items.length) {
      const i = index++;
      await worker(items[i], i);
    }
  }
  const workers = Math.min(limit, items.length || 1);
  await Promise.all(Array.from({ length: workers }, () => next()));
}

function copyDirRecursive(src, dest) {
  if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
  for (const item of fs.readdirSync(src)) {
    const srcPath = path.join(src, item);
    const destPath = path.join(dest, item);
    if (fs.lstatSync(srcPath).isDirectory()) copyDirRecursive(srcPath, destPath);
    else fs.copyFileSync(srcPath, destPath);
  }
}

function clearDirectory(directory) {
  if (fs.existsSync(directory)) {
    fs.rmSync(directory, { recursive: true, force: true });
    console.log('Processed directory cleared.');
  } else {
    fs.mkdirSync(directory, { recursive: true });
    console.log('Processed directory created.');
  }
}

function removeEmptyDir(dirPath) {
  if (fs.existsSync(dirPath) && fs.readdirSync(dirPath).length === 0) {
    fs.rmdirSync(dirPath);
    console.log(`Removed empty directory: ${dirPath}`);
  }
}

function escapeRegExp(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function processDirectory(dirPath, replaceCommands) {
  for (const item of fs.readdirSync(dirPath)) {
    const itemPath = path.join(dirPath, item);
    if (fs.lstatSync(itemPath).isDirectory()) {
      processDirectory(itemPath, replaceCommands);
    } else if (FILE_EXTENSIONS.TEXT.includes(path.extname(itemPath).toLowerCase())) {
      let content = fs.readFileSync(itemPath, 'utf8');
      let changed = false;
      for (const cmd of replaceCommands) {
        const escapedSearch = escapeRegExp(cmd.search);
        const newContent = content.replace(new RegExp(escapedSearch, 'g'), cmd.replace);
        if (newContent !== content) changed = true;
        content = newContent;
      }
      if (changed) fs.writeFileSync(itemPath, content, 'utf8');
    }
  }
}

function applyReplaceCommands(dirPath, replaceCommands) {
  if (!replaceCommands.length) return;
  const withAt = replaceCommands.filter((c) => c.hasAt);
  const withoutAt = replaceCommands.filter((c) => !c.hasAt);
  if (withAt.length) {
    console.log(`Applying ${withAt.length} replace commands (with @) in ${path.basename(dirPath)}`);
    processDirectory(dirPath, withAt);
  }
  if (withoutAt.length) {
    console.log(`Applying ${withoutAt.length} replace commands (without @) in ${path.basename(dirPath)}`);
    processDirectory(dirPath, withoutAt);
  }
}

function isInWhitelist(filePath) {
  return WHITELIST_CONFIG.some((pattern) => filePath.includes(pattern));
}

// ─── 图片无损重哈希 ─────────────────────────────────────────

async function rehashImage(inputPath, outputPath) {
  await ensureDirectoryExists(outputPath);
  const ext = path.extname(inputPath).toLowerCase();
  let pipeline = getSharp()(inputPath);

  if (getFeatureFlags().CAN_IMAGE_SWITCH) {
    const compressionLevel = crypto.randomInt(0, 10);
    if (ext === '.png') {
      pipeline = pipeline.png({ compressionLevel, adaptiveFiltering: true });
    } else if (ext === '.jpg' || ext === '.jpeg') {
      pipeline = pipeline.jpeg({ quality: 100, mozjpeg: true });
    }
  }

  // toBuffer 释放输入文件句柄，避免 Windows 上 unlink EPERM
  const buffer = await pipeline.toBuffer();
  await fs.writeFile(outputPath, buffer);
}

async function writeProcessedNativeFile(inputPath, outputPath, fileExt) {
  const tempPath = `${outputPath}.milfun-${process.pid}-${Date.now()}.tmp`;
  try {
    if (FILE_EXTENSIONS.IMAGE.includes(fileExt)) {
      if (getFeatureFlags().CAN_IMAGE_SWITCH) {
        await rehashImage(inputPath, tempPath);
      } else {
        await fs.copy(inputPath, tempPath);
      }
    } else if (getFeatureFlags().CAN_AUDIO_SWITCH && FILE_EXTENSIONS.AUDIO.includes(fileExt)) {
      await processAudioFile(inputPath, tempPath, 'medium');
    } else {
      await fs.copy(inputPath, tempPath);
    }

    if (fs.existsSync(outputPath)) await forceRemoveFile(outputPath);
    await fs.rename(tempPath, outputPath);
  } catch (err) {
    await forceRemoveFile(tempPath).catch(() => {});
    if (!fs.existsSync(outputPath)) {
      await fs.copy(inputPath, outputPath);
      return;
    }
    throw err;
  }
}

async function moveNativeFile(inputPath, outputPath, fileExt) {
  if (path.resolve(inputPath) === path.resolve(outputPath)) return;

  await ensureDirectoryExists(outputPath);
  await writeProcessedNativeFile(inputPath, outputPath, fileExt);

  if (path.resolve(inputPath) !== path.resolve(outputPath)) {
    await forceRemoveFile(inputPath);
  }
}

// ─── JSON 迁移 ──────────────────────────────────────────────

async function migrateImportJson(subpackageDir, uuidAndExtra, renamedUUID, firstTwoChars) {
  const originalFirstTwoChars = uuidAndExtra.uuid.substring(0, 2);
  const importSubDir = path.join(subpackageDir, 'import', originalFirstTwoChars);
  if (!fs.existsSync(importSubDir)) return;

  const foundJsonFiles = fs.readdirSync(importSubDir).filter((f) => {
    if (!f.endsWith('.json')) return false;
    const parsed = extractUUIDAndExtra(path.basename(f, '.json'));
    return parsed && parsed.uuid === uuidAndExtra.uuid;
  });

  if (!foundJsonFiles.length) {
    console.log(`No JSON files found for UUID: ${uuidAndExtra.uuid}`);
    return;
  }

  const newImportSubDir = path.join(subpackageDir, 'import', firstTwoChars);
  if (!fs.existsSync(newImportSubDir)) fs.mkdirSync(newImportSubDir, { recursive: true });

  for (const foundJsonFile of foundJsonFiles) {
    const jsonFilePath = path.join(importSubDir, foundJsonFile);
    const jsonUUIDAndExtra = extractUUIDAndExtra(path.basename(foundJsonFile, '.json'));
    let newJsonFileName;
    if (jsonUUIDAndExtra.hasAt) {
      newJsonFileName = `${renamedUUID}${jsonUUIDAndExtra.afterAt}${jsonUUIDAndExtra.extra ? '.' + jsonUUIDAndExtra.extra : ''}.json`;
    } else {
      newJsonFileName = `${renamedUUID}${jsonUUIDAndExtra.extra ? '.' + jsonUUIDAndExtra.extra : ''}.json`;
    }
    const newJsonPath = path.join(newImportSubDir, newJsonFileName);
    fs.copyFileSync(jsonFilePath, newJsonPath);
    await removeFileWithRetry(jsonFilePath);
    console.log(`Migrated JSON: ${path.basename(newJsonPath)}`);
  }

  removeEmptyDir(importSubDir);
}

function buildRenamePlan(uuidAndExtra, fileExt) {
  let originalEncryptedName;
  let encryptedRenamedName;
  let renamedUUID;

  if (uuidAndExtra.notUUid) {
    renamedUUID = generateRandomHexString(9);
    encryptedRenamedName = renamedUUID;
    originalEncryptedName = uuidAndExtra.uuid;
  } else {
    renamedUUID = generateNewUUID();
    encryptedRenamedName = encode(renamedUUID.replace(/-/g, ''));
    originalEncryptedName = encode(uuidAndExtra.uuid.replace(/-/g, ''));
  }

  let newFileName;
  let searchString;
  let replaceString;

  if (uuidAndExtra.hasAt) {
    newFileName = `${renamedUUID}${uuidAndExtra.afterAt}${uuidAndExtra.extra ? '.' + uuidAndExtra.extra : ''}${fileExt}`;
    searchString = `${originalEncryptedName}${uuidAndExtra.afterAt}`;
    replaceString = `${encryptedRenamedName}${uuidAndExtra.afterAt}`;
  } else {
    newFileName = `${renamedUUID}${uuidAndExtra.extra ? '.' + uuidAndExtra.extra : ''}${fileExt}`;
    searchString = originalEncryptedName;
    replaceString = encryptedRenamedName;
  }

  return { renamedUUID, newFileName, searchString, replaceString, hasAt: uuidAndExtra.hasAt };
}

// ─── 单资源 / 子包处理 ──────────────────────────────────────

async function processOneAsset(subpackageDir, currentNativeSubDir, file, globalReplaceCommands, results) {
  const fileExt = path.extname(file).toLowerCase();
  if (!FILE_EXTENSIONS.NATIVE.includes(fileExt)) return;

  const fileNameWithoutExt = path.basename(file, fileExt);
  const uuidAndExtra = extractUUIDAndExtra(fileNameWithoutExt);
  if (!uuidAndExtra) {
    console.log(`Skipping non-UUID file: ${file}`);
    return;
  }

  const plan = buildRenamePlan(uuidAndExtra, fileExt);
  const firstTwoChars = plan.renamedUUID.substring(0, 2);
  const newNativeSubDir = path.join(subpackageDir, 'native', firstTwoChars);
  await fs.mkdir(newNativeSubDir, { recursive: true });

  const originalPath = path.join(currentNativeSubDir, file);
  const newPath = path.join(newNativeSubDir, plan.newFileName);

  console.log(`Processing: ${file} → ${plan.newFileName}`);
  await moveNativeFile(originalPath, newPath, fileExt);

  await migrateImportJson(subpackageDir, uuidAndExtra, plan.renamedUUID, firstTwoChars);

  const cmd = { search: plan.searchString, replace: plan.replaceString, hasAt: plan.hasAt };
  globalReplaceCommands.push(cmd);
  results.push({ originalFile: file, newFileName: plan.newFileName, ...cmd });
}

async function processSubpackage(subpackageDir, results, globalReplaceCommands) {
  const subpackageName = path.basename(subpackageDir);
  if (subpackageName.toLowerCase().includes('entryui')) {
    console.log(`⏩ Skip entryui: ${subpackageDir}`);
    return;
  }

  const nativeDir = path.join(subpackageDir, 'native');
  const importDir = path.join(subpackageDir, 'import');
  if (!fs.existsSync(nativeDir) || !fs.existsSync(importDir)) {
    console.log(`Skip ${subpackageName}: missing native/import`);
    return;
  }

  console.log(`\n[Bundle] ${subpackageName}`);
  const tasks = [];
  const nativeSubDirs = new Set();

  for (const subDir of fs.readdirSync(nativeDir)) {
    const currentNativeSubDir = path.join(nativeDir, subDir);
    if (!fs.lstatSync(currentNativeSubDir).isDirectory()) continue;
    nativeSubDirs.add(currentNativeSubDir);
    for (const file of fs.readdirSync(currentNativeSubDir)) {
      tasks.push({ subpackageDir, currentNativeSubDir, file });
    }
  }

  await runWithConcurrency(
    tasks,
    (task) => processOneAsset(task.subpackageDir, task.currentNativeSubDir, task.file, globalReplaceCommands, results),
    process.platform === 'win32' ? 1 : 4,
  );
  for (const subDirPath of nativeSubDirs) removeEmptyDir(subDirPath);
  console.log(`[Bundle] ${subpackageName} done (${tasks.length} assets)`);
}

// ─── JS 混淆（三档 + 体积保护）──────────────────────────────

function obfuscateJavaScript(filePath) {
  if (!fs.existsSync(filePath) || !getFeatureFlags().CAN_OBFUSCATION) return;
  if (isInWhitelist(filePath)) {
    console.log(`Skip obfuscation (whitelist): ${path.basename(filePath)}`);
    return;
  }

  const original = fs.readFileSync(filePath, 'utf8');
  const originalSize = original.length;

  // 极小文件混淆体积膨胀无意义，跳过
  if (originalSize < 8192) {
    console.log(`Skip obfuscation (too small): ${path.basename(filePath)} (${originalSize}B)`);
    return;
  }

  let bestCode = null;
  let bestRatio = Infinity;
  let bestLabel = '';

  for (const preset of OBFUSCATION_PRESETS) {
    const { maxRatio, label, ...options } = preset;
    const seed = crypto.randomInt(0, 1000000);
    try {
      const result = getObfuscator().obfuscate(original, { ...options, seed }).getObfuscatedCode();
      const ratio = result.length / originalSize;
      if (ratio <= maxRatio) {
        bestCode = result;
        bestRatio = ratio;
        bestLabel = label;
        break;
      }
      if (ratio < bestRatio) {
        bestCode = result;
        bestRatio = ratio;
        bestLabel = label;
      }
    } catch (err) {
      console.warn(`Obfuscate ${label} failed for ${path.basename(filePath)}: ${err.message}`);
    }
  }

  if (!bestCode) {
    console.warn(`Obfuscation skipped (kept original): ${filePath}`);
    return;
  }

  fs.writeFileSync(filePath, bestCode, 'utf8');
  console.log(
    `Obfuscated ${path.basename(filePath)} [${bestLabel}]: ${(originalSize / 1024).toFixed(1)}KB → ${(bestCode.length / 1024).toFixed(1)}KB (${bestRatio.toFixed(2)}x)`
  );
}

async function obfuscateBundleJs(bundlePath, type) {
  if (type === 'subpackage') {
    const gameJsPath = path.join(bundlePath, 'game.js');
    if (fs.existsSync(gameJsPath)) obfuscateJavaScript(gameJsPath);
  } else {
    const indexJsFile = fs.readdirSync(bundlePath).find((f) => /index(\..*)?\.js$/.test(f));
    if (indexJsFile) obfuscateJavaScript(path.join(bundlePath, indexJsFile));
  }
}

// ─── 主流程 ─────────────────────────────────────────────────

const PIPELINE_STEPS = 5;

async function processBundles(baseDir, results, globalReplaceCommands, type) {
  if (!fs.existsSync(baseDir)) return;
  for (const name of fs.readdirSync(baseDir)) {
    const bundlePath = path.join(baseDir, name);
    if (!fs.lstatSync(bundlePath).isDirectory()) continue;
    await processSubpackage(bundlePath, results, globalReplaceCommands);
  }
}

async function obfuscateAllBundles(subpackagesDir, assetsDir) {
  if (fs.existsSync(subpackagesDir)) {
    for (const name of fs.readdirSync(subpackagesDir)) {
      const p = path.join(subpackagesDir, name);
      if (fs.lstatSync(p).isDirectory()) await obfuscateBundleJs(p, 'subpackage');
    }
  }
  if (fs.existsSync(assetsDir)) {
    for (const name of fs.readdirSync(assetsDir)) {
      const p = path.join(assetsDir, name);
      if (fs.lstatSync(p).isDirectory()) await obfuscateBundleJs(p, 'asset');
    }
  }
}

async function main(options = {}) {
  const appRoot = options.appRoot || getAppRoot();
  const sourceDir = options.sourceDir || path.join(appRoot, 'src');
  const processedDir = options.processedDir || path.join(appRoot, 'src_processed');
  const onProgress = options.onProgress || (() => {});
  const { ASSETS_DIR, SUBPACKAGE_DIR } = DIR_CONFIG;

  const results = [];
  const globalReplaceCommands = [];
  const subpackagesDir = path.join(processedDir, SUBPACKAGE_DIR);
  const assetsDir = path.join(processedDir, ASSETS_DIR);

  const step = (n, msg) => {
    onProgress(n, PIPELINE_STEPS, msg);
    console.log(`[${n}/${PIPELINE_STEPS}] ${msg}`);
  };

  console.log('\x1b[37m\x1b[44m %s \x1b[0m\x1b[37m\x1b[42m %s \x1b[0m', 'MilFun', 'Start');

  step(1, 'Clearing processed directory...');
  clearDirectory(processedDir);

  step(2, 'Copying source → processed...');
  if (!fs.existsSync(sourceDir)) throw new Error('Source directory does not exist: ' + sourceDir);
  copyDirRecursive(sourceDir, processedDir);

  step(3, 'Processing subpackages...');
  await processBundles(subpackagesDir, results, globalReplaceCommands, 'subpackage');

  step(4, 'Processing assets...');
  await processBundles(assetsDir, results, globalReplaceCommands, 'asset');

  const replaceCommandsFile = path.join(appRoot, 'replace_commands_global.json');
  fs.writeFileSync(replaceCommandsFile, JSON.stringify(globalReplaceCommands, null, 2));
  step(5, `Saved ${globalReplaceCommands.length} replace commands`);

  console.log(`[${PIPELINE_STEPS}/${PIPELINE_STEPS}] Applying global UUID replacements...`);
  applyReplaceCommands(processedDir, globalReplaceCommands);

  console.log(`[${PIPELINE_STEPS}/${PIPELINE_STEPS}] Obfuscating bundle JavaScript...`);
  await obfuscateAllBundles(subpackagesDir, assetsDir);

  console.log(`\nSummary: ${results.length} assets processed, ${globalReplaceCommands.length} replacements`);
  return processedDir;
}

async function runPipeline(options = {}) {
  const appRoot = options.appRoot || getAppRoot();
  const licenseRoot = options.licenseRoot || process.env.MILFUN_APP_ROOT || appRoot;
  const hooks = installLogHooks(options.onLog);
  try {
    if (!options.trustUiLicense) {
      options.onProgress?.(0, PIPELINE_STEPS, 'Verifying license...');
      const license = await checkLicense(licenseRoot, {});
      if (!license.valid) throw new Error(license.reason || 'Invalid license');
    }

    options.onProgress?.(0, PIPELINE_STEPS, '开始处理...');
    if (options.featureFlags) {
      applyFeatureFlags(options.featureFlags);
      console.log(
        `[Config] 界面开关: 混淆=${options.featureFlags.canObfuscation} 图片=${options.featureFlags.canImageSwitch} 音频=${options.featureFlags.canAudioSwitch}`,
      );
    } else {
      const flags = refreshFeatureFlags();
      if (flags.configPath) {
        console.log(`[Config] 已加载: ${flags.configPath}`);
        console.log(`[Config] 混淆=${flags.CAN_OBFUSCATION} 图片=${flags.CAN_IMAGE_SWITCH} 音频=${flags.CAN_AUDIO_SWITCH}`);
      } else {
        console.log('[Config] 未找到 milfun.config.json，使用默认开关');
      }
    }
    const processedDir = await main({ ...options, appRoot });
    options.onProgress?.(PIPELINE_STEPS, PIPELINE_STEPS, '处理完成');
    console.log('\x1b[37m\x1b[44m %s \x1b[0m\x1b[37m\x1b[42m %s \x1b[0m', 'MilFun', 'Well Done!');
    console.log(`✅ Output: ${processedDir}`);
    return { processedDir };
  } finally {
    restoreLogHooks(hooks);
  }
}

// ─── 应用入口 ───────────────────────────────────────────────

class ProtectedApplication {
  constructor() {
    this.appRoot = getAppRoot();
    this.licensePath = path.join(this.appRoot, 'license.lic');
    this.publicKeyPath = path.join(this.appRoot, 'public.key');
  }

  async initialize() {
    console.log('\x1b[37m\x1b[44m %s \x1b[0m\x1b[37m\x1b[42m %s \x1b[0m', 'MilFun', 'Check Authority');

    if (OBFUSCATION_CONFIG.ccSignalString === 'paloma' && process.argv.includes('--fingerprint')) {
      const fingerprint = await getDeviceFingerprint();
      console.log('Device fingerprint:', fingerprint);
      process.exit(0);
    }

    const result = await checkLicense(this.appRoot);
    if (!result.valid) {
      console.error('Startup failed:', result.reason);
      if (result.reason === 'Device mismatch') {
        console.log('\nDevice changed. Send this fingerprint to your vendor:');
        console.log(await getDeviceFingerprint());
      }
      process.exit(1);
    }

    console.log('✅ Authorized! Expires:', result.expiryDate);
    await this.runApplication();
  }

  async runApplication() {
    console.log('\n🚀 Starting processing pipeline...');
    try {
      await runPipeline({ appRoot: this.appRoot });
    } catch (error) {
      console.error('❌ Pipeline failed:', error.message || error);
      process.exit(1);
    }
  }
}

module.exports = {
  getAppRoot,
  getLicenseStorageDir,
  resolveLicensePath,
  resolvePublicKeyPath,
  importLicense,
  getDeviceFingerprint,
  checkLicense,
  LicenseValidator,
  main,
  runPipeline,
};

if (require.main === module && !process.versions.electron && !process.env.MILFUN_IN_WORKER) {
  const app = new ProtectedApplication();
  app.initialize();
}
