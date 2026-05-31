const crypto = require('crypto');
const fs = require('fs-extra');
const path = require('path');
const sharp = require('sharp');
const archiver = require('archiver');
const JavaScriptObfuscator = require('javascript-obfuscator');
const { exec } = require('child_process');

const {
  DIR_CONFIG,
  FILE_EXTENSIONS,
  OBFUSCATION_CONFIG,
  OBFUSCATION_PRESETS,
  CAN_OBFUSCATION,
  WHITELIST_CONFIG,
  CAN_IMAGE_SWITCH,
  CAN_AUDIO_SWITCH,
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

function checkFFmpeg() {
  return new Promise((resolve) => {
    exec('ffmpeg -version', (error) => resolve(!error));
  });
}

function compressAudioFile(inputPath, outputPath, quality = 'medium') {
  return new Promise((resolve, reject) => {
    let bitrate = '128k';
    if (quality === 'low') bitrate = '192k';
    if (quality === 'high') bitrate = '64k';

    const outputExtension = path.extname(outputPath).toLowerCase();
    let codec = 'mp3';
    if (outputExtension === '.aac') codec = 'aac';
    else if (outputExtension === '.wav') codec = 'pcm_s16le';

    const command = `ffmpeg -y -i "${inputPath}" -b:a ${bitrate} -acodec ${codec} "${outputPath}"`;
    exec(command, (error, _stdout, stderr) => {
      if (error) reject(new Error(`FFmpeg error: ${stderr}`));
      else resolve(outputPath);
    });
  });
}

async function processAudioFile(inputPath, outputPath, quality = 'medium') {
  await ensureDirectoryExists(outputPath);
  await fs.copy(inputPath, outputPath);

  const originalSize = fs.statSync(outputPath).size;
  const hasFFmpeg = await checkFFmpeg();
  if (!hasFFmpeg || quality === 'none') {
    console.log(`Audio copied (no FFmpeg): ${path.basename(outputPath)}`);
    return;
  }

  const compressedPath = outputPath.replace(/(\.[\w\d_-]+)$/i, '_compressed$1');
  try {
    await compressAudioFile(outputPath, compressedPath, quality);
    const compressedSize = fs.statSync(compressedPath).size;
    fs.unlinkSync(outputPath);
    fs.renameSync(compressedPath, outputPath);
    console.log(
      `Audio compressed: ${path.basename(outputPath)} (${((1 - compressedSize / originalSize) * 100).toFixed(1)}% saved)`
    );
  } catch (err) {
    if (fs.existsSync(compressedPath)) fs.unlinkSync(compressedPath);
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
  let pipeline = sharp(inputPath);

  if (CAN_IMAGE_SWITCH) {
    const compressionLevel = crypto.randomInt(0, 10);
    if (ext === '.png') {
      pipeline = pipeline.png({ compressionLevel, adaptiveFiltering: true });
    } else if (ext === '.jpg' || ext === '.jpeg') {
      pipeline = pipeline.jpeg({ quality: 100, mozjpeg: true });
    }
  }

  await pipeline.toFile(outputPath);
}

async function moveNativeFile(inputPath, outputPath, fileExt) {
  await ensureDirectoryExists(outputPath);
  try {
    if (FILE_EXTENSIONS.IMAGE.includes(fileExt)) {
      if (CAN_IMAGE_SWITCH) {
        await rehashImage(inputPath, outputPath);
      } else {
        await fs.copy(inputPath, outputPath);
      }
    } else if (CAN_AUDIO_SWITCH && FILE_EXTENSIONS.AUDIO.includes(fileExt)) {
      await processAudioFile(inputPath, outputPath, 'medium');
    } else {
      await fs.copy(inputPath, outputPath);
    }
    if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
  } catch (err) {
    console.warn(`Native file process failed, fallback copy: ${inputPath} → ${err.message}`);
    if (!fs.existsSync(outputPath)) {
      await fs.copy(inputPath, outputPath);
    }
    if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
  }
}

// ─── JSON 迁移 ──────────────────────────────────────────────

function migrateImportJson(subpackageDir, uuidAndExtra, renamedUUID, firstTwoChars) {
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
    fs.unlinkSync(jsonFilePath);
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

  migrateImportJson(subpackageDir, uuidAndExtra, plan.renamedUUID, firstTwoChars);

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
      tasks.push(processOneAsset(subpackageDir, currentNativeSubDir, file, globalReplaceCommands, results));
    }
  }

  await Promise.all(tasks);
  for (const subDirPath of nativeSubDirs) removeEmptyDir(subDirPath);
  console.log(`[Bundle] ${subpackageName} done (${tasks.length} assets)`);
}

// ─── JS 混淆（三档 + 体积保护）──────────────────────────────

function obfuscateJavaScript(filePath) {
  if (!fs.existsSync(filePath) || !CAN_OBFUSCATION) return;
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
      const result = JavaScriptObfuscator.obfuscate(original, { ...options, seed }).getObfuscatedCode();
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
    console.error(`Obfuscation failed: ${filePath}`);
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

// ─── 打包 ───────────────────────────────────────────────────

function generateFancyZipName(baseName) {
  const symbols = ['★', '☆', '⚡', '✨', '🎯', '🔥', '💎', '🚀'];
  const randomSymbol = symbols[crypto.randomInt(0, symbols.length)];
  const randomNum = crypto.randomInt(0, 1000).toString().padStart(3, '0');
  const timestamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  return `${baseName}_${randomSymbol}_${timestamp}_${randomNum}.zip`;
}

async function zipDirectory(sourceDir, zipPath) {
  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(zipPath);
    const archive = archiver('zip', { zlib: { level: 9 } });
    output.on('close', () => resolve(zipPath));
    archive.on('error', reject);
    archive.pipe(output);

    function addFiles(dir, prefix = '') {
      for (const file of fs.readdirSync(dir)) {
        const filePath = path.join(dir, file);
        if (fs.statSync(filePath).isDirectory()) addFiles(filePath, path.join(prefix, file));
        else archive.file(filePath, { name: path.join(prefix, file) });
      }
    }

    addFiles(sourceDir);
    archive.finalize();
  });
}

async function createFinalZip(processedDir, outputDir) {
  const outDir = outputDir || path.dirname(processedDir);
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const zipFileName = generateFancyZipName('MilFun');
  const zipFilePath = path.join(outDir, zipFileName);
  console.log(`\n[6/6] Creating ZIP: ${zipFileName}`);
  await zipDirectory(processedDir, zipFilePath);
  const stats = fs.statSync(zipFilePath);
  console.log(`✅ ZIP ready: ${zipFilePath} (${(stats.size / 1024 / 1024).toFixed(2)} MB)`);
  return zipFilePath;
}

// ─── 主流程 ─────────────────────────────────────────────────

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
    onProgress(n, 6, msg);
    console.log(`[${n}/6] ${msg}`);
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

  console.log('[5/6] Applying global UUID replacements...');
  applyReplaceCommands(processedDir, globalReplaceCommands);

  console.log('[5/6] Obfuscating bundle JavaScript...');
  await obfuscateAllBundles(subpackagesDir, assetsDir);

  console.log(`\nSummary: ${results.length} assets processed, ${globalReplaceCommands.length} replacements`);
  return processedDir;
}

async function runPipeline(options = {}) {
  const appRoot = options.appRoot || getAppRoot();
  const outputDir = options.outputDir || appRoot;
  const hooks = installLogHooks(options.onLog);
  try {
    options.onProgress?.(0, 6, '正在验证授权...');
    const licenseOpts = options.trustUiLicense ? { skipDevice: true } : {};
    const license = await checkLicense(appRoot, licenseOpts);
    if (!license.valid) throw new Error(license.reason || '许可证无效');

    options.onProgress?.(0, 6, '开始处理...');
    const processedDir = await main({ ...options, appRoot });
    options.onProgress?.(6, 6, '正在打包 ZIP...');
    const zipPath = await createFinalZip(processedDir, outputDir);
    console.log('\x1b[37m\x1b[44m %s \x1b[0m\x1b[37m\x1b[42m %s \x1b[0m', 'MilFun', 'Well Done!');
    return { processedDir, zipPath, license };
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
      console.error('应用程序启动失败:', result.reason);
      if (result.reason === '设备不匹配') {
        console.log('\n检测到设备变更，请将以下指纹发送给软件提供商:');
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
  createFinalZip,
  runPipeline,
};

if (require.main === module && !process.versions.electron) {
  const app = new ProtectedApplication();
  app.initialize();
}
