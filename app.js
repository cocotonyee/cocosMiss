const crypto = require('crypto');
const fs = require('fs-extra');
const os = require('os');
const path = require('path');
const { exec, execSync } = require('child_process');
const { ObfuscatorPool } = require('./obfuscator-pool');

let _sharp;
function getSharp() {
  if (!_sharp) {
    _sharp = require('sharp');
    // Windows 上 libvips 多线程 + 多任务并发易卡住、文件锁 EPERM
    if (process.platform === 'win32') {
      _sharp.cache(false);
      _sharp.concurrency(1);
    }
  }
  return _sharp;
}

const {
  DIR_CONFIG,
  FILE_EXTENSIONS,
  OBFUSCATION_CONFIG,
  WHITELIST_CONFIG,
  getFeatureFlags,
  refreshFeatureFlags,
  applyFeatureFlags,
  getObfuscationPresets,
  buildLightObfuscationPreset,
  buildImageColorRanges,
  OBFUSCATION_LARGE_FILE_BYTES,
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

function getCpuCount() {
  return Math.max(1, os.cpus()?.length || 1);
}

function getNativeConcurrency() {
  const flags = getFeatureFlags();
  // 图片/音频走 Sharp 或 FFmpeg，必须串行，否则 Windows 长时间卡住
  if (flags.CAN_IMAGE_SWITCH || flags.CAN_AUDIO_SWITCH) return 1;
  if (process.platform === 'win32') return 2;
  return 4;
}

function getBundleConcurrency() {
  const flags = getFeatureFlags();
  if (flags.CAN_IMAGE_SWITCH || flags.CAN_AUDIO_SWITCH) return 1;
  const cpus = getCpuCount();
  if (process.platform === 'win32') return Math.min(2, Math.max(1, Math.floor(cpus / 2)));
  return Math.min(4, Math.max(2, cpus - 2));
}

function getObfuscationConcurrency() {
  return Math.min(4, Math.max(1, Math.floor(getCpuCount() / 2)));
}

function listBundleDirs(baseDir) {
  if (!fs.existsSync(baseDir)) return [];
  return fs.readdirSync(baseDir)
    .map((name) => path.join(baseDir, name))
    .filter((p) => fs.lstatSync(p).isDirectory());
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

function sortReplaceCommands(commands) {
  return [...commands].sort((a, b) => b.search.length - a.search.length);
}

function processDirectory(dirPath, replaceCommands) {
  const ordered = sortReplaceCommands(replaceCommands);
  for (const item of fs.readdirSync(dirPath)) {
    const itemPath = path.join(dirPath, item);
    if (fs.lstatSync(itemPath).isDirectory()) {
      processDirectory(itemPath, ordered);
    } else if (FILE_EXTENSIONS.TEXT.includes(path.extname(itemPath).toLowerCase())) {
      let content = fs.readFileSync(itemPath, 'utf8');
      let changed = false;
      for (const cmd of ordered) {
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
    const sorted = sortReplaceCommands(withoutAt);
    console.log(`Applying ${sorted.length} replace commands (without @, longest-first) in ${path.basename(dirPath)}`);
    processDirectory(dirPath, sorted);
  }
}

function isInWhitelist(filePath) {
  return WHITELIST_CONFIG.some((pattern) => filePath.includes(pattern));
}

// ─── 图片改色（客户强度 + 单次编码、尽量保持体积）────────────

const IMAGE_SIZE_WARN_RATIO = 0.1;

function randomColorModulation() {
  const { hueMax, brightPct, satPct } = buildImageColorRanges(getFeatureFlags().IMAGE_COLOR_INTENSITY);
  return {
    hue: crypto.randomInt(-hueMax, hueMax + 1),
    brightness: 1 + crypto.randomInt(-brightPct, brightPct + 1) / 100,
    saturation: 1 + crypto.randomInt(-satPct, satPct + 1) / 100,
  };
}

function buildImageEncodeOptions(ext, meta) {
  if (ext === '.jpg' || ext === '.jpeg') {
    let quality = 90;
    if (Number.isFinite(meta.quality) && meta.quality > 0) {
      quality = Math.min(100, Math.max(75, Math.round(meta.quality)));
    }
    const options = {
      quality,
      mozjpeg: true,
      chromaSubsampling: meta.chromaSubsampling === '4:4:4' ? '4:4:4' : '4:2:0',
    };
    if (meta.isProgressive) options.progressive = true;
    return { type: 'jpeg', options };
  }

  const colors = meta.colours || meta.colors || 256;
  const compressionLevel = Number.isFinite(meta.compression)
    ? Math.min(9, Math.max(0, meta.compression))
    : 9;

  if (meta.palette || colors <= 256) {
    return {
      type: 'png',
      options: {
        palette: true,
        colors: Math.min(Math.max(colors, 2), 256),
        compressionLevel,
        effort: 1,
      },
    };
  }

  return {
    type: 'png',
    options: {
      compressionLevel,
      effort: 1,
      adaptiveFiltering: false,
    },
  };
}

async function rehashImage(inputPath, outputPath) {
  await ensureDirectoryExists(outputPath);
  const ext = path.extname(inputPath).toLowerCase();
  const originalSize = fs.statSync(inputPath).size;
  const intensity = getFeatureFlags().IMAGE_COLOR_INTENSITY;
  const mod = randomColorModulation();
  const started = Date.now();

  const image = getSharp()(inputPath, { failOn: 'none' });
  const meta = await image.metadata();
  const encode = buildImageEncodeOptions(ext, meta);

  const pipeline = encode.type === 'jpeg'
    ? image.modulate(mod).removeAlpha().jpeg(encode.options)
    : image.modulate(mod).png(encode.options);

  await pipeline.toFile(outputPath);

  const outSize = fs.statSync(outputPath).size;
  const ms = Date.now() - started;
  const sizeDelta = (outSize - originalSize) / originalSize;
  if (Math.abs(sizeDelta) > IMAGE_SIZE_WARN_RATIO) {
    const sign = sizeDelta >= 0 ? '+' : '';
    console.warn(
      `Image size ${sign}${(sizeDelta * 100).toFixed(0)}% (强度${intensity}): ${path.basename(inputPath)} ${originalSize}→${outSize}B`,
    );
  }
  if (ms > 3000) {
    console.log(`Image done (${(ms / 1000).toFixed(1)}s): ${path.basename(inputPath)}`);
  }
}

async function writeProcessedNativeFile(inputPath, outputPath, fileExt) {
  const tempPath = `${outputPath}.milfun-${process.pid}-${Date.now()}.tmp`;
  let usedTemp = false;
  try {
    if (FILE_EXTENSIONS.IMAGE.includes(fileExt)) {
      if (getFeatureFlags().CAN_IMAGE_SWITCH) {
        try {
          await rehashImage(inputPath, tempPath);
          usedTemp = true;
        } catch (err) {
          await forceRemoveFile(tempPath).catch(() => {});
          await copyNativeFallback(inputPath, tempPath, `image: ${err.message}`);
          usedTemp = true;
        }
      } else {
        await fs.copy(inputPath, tempPath);
        usedTemp = true;
      }
    } else if (getFeatureFlags().CAN_AUDIO_SWITCH && FILE_EXTENSIONS.AUDIO.includes(fileExt)) {
      await processAudioFile(inputPath, tempPath, 'medium');
      usedTemp = true;
    } else {
      await fs.copy(inputPath, tempPath);
      usedTemp = true;
    }

    if (!isValidOutputFile(usedTemp ? tempPath : outputPath)) {
      throw new Error('empty or missing output');
    }

    if (fs.existsSync(outputPath)) await forceRemoveFile(outputPath);
    await fs.rename(tempPath, outputPath);
    usedTemp = false;
  } catch (err) {
    if (usedTemp) await forceRemoveFile(tempPath).catch(() => {});
    if (!isValidOutputFile(outputPath)) {
      await copyNativeFallback(inputPath, outputPath, err.message);
    }
  }

  if (!isValidOutputFile(outputPath)) {
    throw new Error(`Failed to write native file: ${path.basename(outputPath)}`);
  }
}

async function moveNativeFile(inputPath, outputPath, fileExt) {
  if (path.resolve(inputPath) === path.resolve(outputPath)) return;

  await ensureDirectoryExists(outputPath);
  await writeProcessedNativeFile(inputPath, outputPath, fileExt);

  if (!isValidOutputFile(outputPath) && fs.existsSync(inputPath)) {
    await copyNativeFallback(inputPath, outputPath, 'verify failed');
  }

  if (!isValidOutputFile(outputPath)) {
    throw new Error(`Failed to write native file: ${path.basename(outputPath)}`);
  }
  // 保留旧路径文件，避免引用未替换完时运行报 does not exist
}

// ─── JSON 迁移 ──────────────────────────────────────────────

async function migrateImportJson(subpackageDir, uuidAndExtra, plan, globalReplaceCommands, bundleRel, resultItem) {
  const renamedUUID = plan.renamedUUID;
  const firstTwoChars = renamedUUID.substring(0, 2);
  const originalFirstTwoChars = uuidAndExtra.uuid.substring(0, 2);
  const importSubDir = path.join(subpackageDir, 'import', originalFirstTwoChars);
  if (!fs.existsSync(importSubDir)) return [];

  const foundJsonFiles = fs.readdirSync(importSubDir).filter((f) => {
    if (!f.endsWith('.json')) return false;
    const parsed = extractUUIDAndExtra(path.basename(f, '.json'));
    return parsed && parsed.uuid === uuidAndExtra.uuid;
  });

  if (!foundJsonFiles.length) {
    console.log(`No JSON files found for UUID: ${uuidAndExtra.uuid}`);
    return [];
  }

  const newImportSubDir = path.join(subpackageDir, 'import', firstTwoChars);
  if (!fs.existsSync(newImportSubDir)) fs.mkdirSync(newImportSubDir, { recursive: true });
  const replaceCommands = buildPlanReplaceCommands(plan);
  const importMigrations = [];

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
    pushImportJsonPathCommands(
      globalReplaceCommands,
      bundleRel,
      originalFirstTwoChars,
      firstTwoChars,
      foundJsonFile,
      newJsonFileName,
    );
    const raw = fs.readFileSync(jsonFilePath, 'utf8');
    fs.writeFileSync(newJsonPath, applyReplaceToContent(raw, replaceCommands), 'utf8');
    importMigrations.push({ originalImportPath: jsonFilePath, newImportPath: newJsonPath });
    console.log(`Migrated JSON: ${foundJsonFile} → ${newJsonFileName}`);
  }

  if (resultItem) {
    resultItem.importMigrations = (resultItem.importMigrations || []).concat(importMigrations);
  }
  return importMigrations;
}

function buildBundlePathVariants(bundleRelPath, pathSearch, pathReplace) {
  const variants = [];
  const rel = bundleRelPath.replace(/\\/g, '/');
  variants.push({
    search: `${rel}/${pathSearch}`,
    replace: `${rel}/${pathReplace}`,
  });

  const bundleName = path.basename(rel);
  const parent = path.basename(path.dirname(rel));
  if (parent === 'subpackages') {
    variants.push({
      search: `assets/${bundleName}/${pathSearch}`,
      replace: `assets/${bundleName}/${pathReplace}`,
    });
  }
  if (parent === 'assets') {
    variants.push({
      search: `subpackages/${bundleName}/${pathSearch}`,
      replace: `subpackages/${bundleName}/${pathReplace}`,
    });
  }
  return variants;
}

function pushImportJsonPathCommands(commands, bundleRel, origPrefix, newPrefix, oldJsonFileName, newJsonFileName) {
  if (!oldJsonFileName || !newJsonFileName || oldJsonFileName === newJsonFileName) return;
  const importPathSearch = `import/${origPrefix}/${oldJsonFileName}`;
  const importPathReplace = `import/${newPrefix}/${newJsonFileName}`;
  if (bundleRel) {
    for (const variant of buildBundlePathVariants(bundleRel, importPathSearch, importPathReplace)) {
      pushPathReplaceCommands(commands, variant.search, variant.replace);
    }
  }
  pushPathReplaceCommands(commands, importPathSearch, importPathReplace);
}

function applyReplaceToContent(content, replaceCommands) {
  let result = content;
  for (const cmd of replaceCommands) {
    result = result.replace(new RegExp(escapeRegExp(cmd.search), 'g'), cmd.replace);
  }
  return result;
}

function buildPlanReplaceCommands(plan) {
  const commands = [];
  for (const variant of plan.bundlePathVariants || []) {
    pushPathReplaceCommands(commands, variant.search, variant.replace);
  }
  if (plan.nativePathSearch) {
    pushPathReplaceCommands(commands, plan.nativePathSearch, plan.nativePathReplace);
  }
  for (const variant of plan.importPathVariants || []) {
    pushPathReplaceCommands(commands, variant.search, variant.replace);
  }
  if (plan.importPathSearch) {
    pushPathReplaceCommands(commands, plan.importPathSearch, plan.importPathReplace);
  }
  pushUuidReplaceCommands(commands, plan);
  return sortReplaceCommands(commands);
}

function patchBundleConfig(subpackageDir, plan) {
  const configPath = path.join(subpackageDir, 'config.json');
  if (!fs.existsSync(configPath)) return false;
  const content = fs.readFileSync(configPath, 'utf8');
  const next = applyReplaceToContent(content, buildPlanReplaceCommands(plan));
  if (next === content) return false;
  fs.writeFileSync(configPath, next, 'utf8');
  return true;
}

function pushPathReplaceCommands(commands, search, replace) {
  if (!search || search === replace) return;
  commands.push({ search, replace, hasAt: false });
  if (search.includes('/')) {
    const bsSearch = search.replace(/\//g, '\\');
    const bsReplace = replace.replace(/\//g, '\\');
    if (bsSearch !== search) {
      commands.push({ search: bsSearch, replace: bsReplace, hasAt: false });
    }
  }
}

const UUID_DIR_REGEX = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

function isUuidDirectoryName(name) {
  return UUID_DIR_REGEX.test(name);
}

function extractNativeFileNameFromImportJson(content) {
  const nativeExtPattern = 'ttf|font|bin|png|jpg|jpeg|mp3|wav|aac|ogg|m4a|plist|atlas';
  const nestedMatch = content.match(new RegExp(`\\[\\[0,"[^"]*","([^"]+\\.(${nativeExtPattern}))"\\]`, 'i'));
  if (nestedMatch) return nestedMatch[1];
  const nativeMatch = content.match(new RegExp(`"_native"\\s*,\\s*"([^"]+\\.(${nativeExtPattern}))"`, 'i'));
  return nativeMatch ? nativeMatch[1] : null;
}

function pushNativePathReplaceCommands(commands, bundleRel, nativePathSearch, nativePathReplace) {
  if (!nativePathSearch || nativePathSearch === nativePathReplace) return;
  if (bundleRel) {
    for (const variant of buildBundlePathVariants(bundleRel, nativePathSearch, nativePathReplace)) {
      pushPathReplaceCommands(commands, variant.search, variant.replace);
    }
  }
  pushPathReplaceCommands(commands, nativePathSearch, nativePathReplace);
}

function createSharedUuidState() {
  return { uuidRegistry: new Map(), uuidReplaceDedupe: new Set() };
}

function collectBundleAssetUuids(bundlePath) {
  const uuids = new Set();
  const scanRoot = (root) => {
    if (!fs.existsSync(root)) return;
    for (const sub of fs.readdirSync(root)) {
      const subPath = path.join(root, sub);
      if (!fs.lstatSync(subPath).isDirectory()) continue;
      for (const file of fs.readdirSync(subPath)) {
        const filePath = path.join(subPath, file);
        if (fs.lstatSync(filePath).isDirectory() && isUuidDirectoryName(file)) {
          uuids.add(file);
          continue;
        }
        const ext = path.extname(file).toLowerCase();
        const baseName = ext ? path.basename(file, ext) : file;
        const parsed = extractUUIDAndExtra(baseName);
        if (parsed && !parsed.notUUid) uuids.add(parsed.uuid);
      }
    }
  };
  scanRoot(path.join(bundlePath, 'native'));
  scanRoot(path.join(bundlePath, 'import'));
  return uuids;
}

function preassignSharedUuids(bundlePaths, sharedUuidState) {
  let assigned = 0;
  for (const bundlePath of bundlePaths) {
    for (const uuid of collectBundleAssetUuids(bundlePath)) {
      if (sharedUuidState.uuidRegistry.has(uuid)) continue;
      sharedUuidState.uuidRegistry.set(uuid, { renamedUUID: generateNewUUID() });
      assigned++;
    }
  }
  if (assigned) {
    console.log(`[Pipeline] pre-assigned ${assigned} shared UUID(s) before bundle processing`);
  }
  return assigned;
}

function resolveSharedRenamePlan(uuidAndExtra, fileExt, originalFileName, bundleRelPath, uuidRegistry, options = {}) {
  const existing = !uuidAndExtra.notUUid ? uuidRegistry.get(uuidAndExtra.uuid) : null;
  const plan = buildRenamePlan(uuidAndExtra, fileExt, originalFileName, bundleRelPath, {
    ...options,
    reusedRenamedUUID: existing?.renamedUUID,
  });
  if (!uuidAndExtra.notUUid && !existing) {
    uuidRegistry.set(uuidAndExtra.uuid, { renamedUUID: plan.renamedUUID });
  }
  return plan;
}

function buildRenamePlan(uuidAndExtra, fileExt, originalFileName, bundleRelPath, options = {}) {
  const { skipNativePaths = false, skipImportPaths = false, reusedRenamedUUID = null } = options;
  const isNestedNative = originalFileName.includes('/');
  let originalEncryptedName;
  let encryptedRenamedName;
  let renamedUUID;

  if (uuidAndExtra.notUUid) {
    renamedUUID = generateRandomHexString(9);
    encryptedRenamedName = renamedUUID;
    originalEncryptedName = uuidAndExtra.uuid;
  } else {
    renamedUUID = reusedRenamedUUID || generateNewUUID();
    encryptedRenamedName = encode(renamedUUID.replace(/-/g, ''));
    originalEncryptedName = encode(uuidAndExtra.uuid.replace(/-/g, ''));
  }

  let newFileName;
  let searchString;
  let replaceString;

  if (isNestedNative) {
    newFileName = `${renamedUUID}/${path.basename(originalFileName)}`;
    searchString = originalEncryptedName;
    replaceString = encryptedRenamedName;
  } else if (uuidAndExtra.hasAt) {
    newFileName = `${renamedUUID}${uuidAndExtra.afterAt}${uuidAndExtra.extra ? '.' + uuidAndExtra.extra : ''}${fileExt}`;
    searchString = `${originalEncryptedName}${uuidAndExtra.afterAt}`;
    replaceString = `${encryptedRenamedName}${uuidAndExtra.afterAt}`;
  } else {
    newFileName = `${renamedUUID}${uuidAndExtra.extra ? '.' + uuidAndExtra.extra : ''}${fileExt}`;
    searchString = originalEncryptedName;
    replaceString = encryptedRenamedName;
  }

  const origPrefix = uuidAndExtra.uuid.substring(0, 2);
  const newPrefix = renamedUUID.substring(0, 2);
  let nativePathSearch = '';
  let nativePathReplace = '';
  let bundlePathVariants = [];
  if (!skipNativePaths) {
    nativePathSearch = `native/${origPrefix}/${originalFileName}`;
    nativePathReplace = `native/${newPrefix}/${newFileName}`;
    bundlePathVariants = bundleRelPath
      ? buildBundlePathVariants(bundleRelPath, nativePathSearch, nativePathReplace)
      : [];
  }

  let importPathSearch = '';
  let importPathReplace = '';
  let importPathVariants = [];
  if (!skipImportPaths) {
    const defaultImportOld = `${uuidAndExtra.uuid}.json`;
    const defaultImportNew = `${renamedUUID}.json`;
    importPathSearch = `import/${origPrefix}/${defaultImportOld}`;
    importPathReplace = `import/${newPrefix}/${defaultImportNew}`;
    importPathVariants = bundleRelPath
      ? buildBundlePathVariants(bundleRelPath, importPathSearch, importPathReplace)
      : [];
  }

  return {
    renamedUUID,
    newFileName,
    searchString,
    replaceString,
    hasAt: uuidAndExtra.hasAt,
    plainUuidSearch: uuidAndExtra.uuid,
    plainUuidReplace: renamedUUID,
    nativePathSearch,
    nativePathReplace,
    bundlePathVariants,
    importPathSearch,
    importPathReplace,
    importPathVariants,
  };
}

function pushUuidReplaceCommands(commands, plan, uuidReplaceDedupe) {
  const entries = [
    { search: plan.searchString, replace: plan.replaceString, hasAt: plan.hasAt },
  ];
  if (plan.plainUuidSearch && plan.plainUuidSearch !== plan.plainUuidReplace) {
    entries.push({ search: plan.plainUuidSearch, replace: plan.plainUuidReplace, hasAt: false });
    const noDashSearch = plan.plainUuidSearch.replace(/-/g, '');
    const noDashReplace = plan.plainUuidReplace.replace(/-/g, '');
    if (noDashSearch.length === 32 && noDashSearch !== noDashReplace) {
      entries.push({ search: noDashSearch, replace: noDashReplace, hasAt: false });
    }
  }
  for (const cmd of entries) {
    if (uuidReplaceDedupe?.has(cmd.search)) continue;
    uuidReplaceDedupe?.add(cmd.search);
    commands.push(cmd);
  }
}

function pushReplaceCommands(commands, plan, options = {}) {
  for (const variant of plan.bundlePathVariants || []) {
    pushPathReplaceCommands(commands, variant.search, variant.replace);
  }
  if (plan.nativePathSearch) {
    pushPathReplaceCommands(commands, plan.nativePathSearch, plan.nativePathReplace);
  }
  for (const variant of plan.importPathVariants || []) {
    pushPathReplaceCommands(commands, variant.search, variant.replace);
  }
  if (plan.importPathSearch) {
    pushPathReplaceCommands(commands, plan.importPathSearch, plan.importPathReplace);
  }
  pushUuidReplaceCommands(commands, plan, options.uuidReplaceDedupe);
}

function pushImportOnlyReplaceCommands(commands, plan, options = {}) {
  for (const variant of plan.importPathVariants || []) {
    pushPathReplaceCommands(commands, variant.search, variant.replace);
  }
  if (plan.importPathSearch) {
    pushPathReplaceCommands(commands, plan.importPathSearch, plan.importPathReplace);
  }
  pushUuidReplaceCommands(commands, plan, options.uuidReplaceDedupe);
}

function buildNativeImportJsonStub(fileExt) {
  const nativeExt = fileExt.toLowerCase();
  return `[1,0,0,[["cc.Texture2D",["_native"],1]],[[0,0,1,3]],[[0,"${nativeExt}"]],0,0,[],[],[]]`;
}

async function ensureNativeImportJsonStub(subpackageDir, uuidAndExtra, plan, fileExt, resultItem) {
  if (!FILE_EXTENSIONS.IMAGE.includes(fileExt.toLowerCase()) || uuidAndExtra.notUUid) return null;

  const renamedUUID = plan.renamedUUID;
  const prefix = renamedUUID.substring(0, 2);
  const importPath = path.join(subpackageDir, 'import', prefix, `${renamedUUID}.json`);
  if (isValidOutputFile(importPath)) return null;

  await ensureDirectoryExists(importPath);
  fs.writeFileSync(importPath, buildNativeImportJsonStub(fileExt), 'utf8');
  console.log(`Created native import stub: ${path.basename(importPath)}`);

  const originalImportPath = path.join(
    subpackageDir,
    'import',
    uuidAndExtra.uuid.substring(0, 2),
    `${uuidAndExtra.uuid}.json`,
  );
  const migration = { originalImportPath, newImportPath: importPath, stub: true };
  if (resultItem) {
    resultItem.importMigrations = (resultItem.importMigrations || []).concat([migration]);
  }
  return migration;
}

async function copyNativeFallback(inputPath, outputPath, reason) {
  if (!fs.existsSync(inputPath)) {
    throw new Error(`Source missing for fallback copy: ${path.basename(inputPath)}`);
  }
  await ensureDirectoryExists(outputPath);
  await fs.copy(inputPath, outputPath);
  console.warn(`Fallback copy: ${path.basename(outputPath)} (${reason})`);
}

function isValidOutputFile(filePath) {
  return fs.existsSync(filePath) && fs.statSync(filePath).size > 0;
}

// ─── 单资源 / 子包处理 ──────────────────────────────────────

async function processOneAsset(subpackageDir, currentNativeSubDir, file, globalReplaceCommands, results, uuidDir, sharedState) {
  const fileExt = path.extname(file).toLowerCase();
  if (!FILE_EXTENSIONS.NATIVE.includes(fileExt)) return;

  const uuidAndExtra = uuidDir
    ? extractUUIDAndExtra(uuidDir)
    : extractUUIDAndExtra(path.basename(file, fileExt));
  if (!uuidAndExtra) {
    console.log(`Skipping non-UUID file: ${file}`);
    return;
  }

  const originalFile = uuidDir ? `${uuidDir}/${file}` : file;
  const bundleParent = path.basename(path.dirname(subpackageDir));
  const bundleName = path.basename(subpackageDir);
  const bundleRel = path.join(bundleParent, bundleName);
  const plan = resolveSharedRenamePlan(
    uuidAndExtra,
    fileExt,
    originalFile,
    bundleRel,
    sharedState.uuidRegistry,
  );
  const firstTwoChars = plan.renamedUUID.substring(0, 2);
  await fs.mkdir(path.join(subpackageDir, 'native', firstTwoChars), { recursive: true });

  const originalPath = path.join(currentNativeSubDir, file);
  const newPath = path.join(subpackageDir, 'native', firstTwoChars, plan.newFileName);
  const resultItem = {
    originalFile,
    newFileName: plan.newFileName,
    uuid: uuidAndExtra.uuid,
    subpackageRel: path.join(bundleParent, bundleName),
    originalPath,
    newPath,
    ...plan,
  };

  console.log(`Processing: ${originalFile} → ${plan.newFileName}`);
  const t0 = Date.now();

  try {
    await moveNativeFile(originalPath, newPath, fileExt);
    if (!isValidOutputFile(newPath)) {
      throw new Error('output missing after move');
    }
    pushReplaceCommands(globalReplaceCommands, plan, { uuidReplaceDedupe: sharedState.uuidReplaceDedupe });
    results.push(resultItem);
    patchBundleConfig(subpackageDir, plan);
    await migrateImportJson(subpackageDir, uuidAndExtra, plan, globalReplaceCommands, bundleRel, resultItem);
    await ensureNativeImportJsonStub(subpackageDir, uuidAndExtra, plan, fileExt, resultItem);
  } catch (err) {
    console.error(`[Asset] failed ${file}: ${err.message}`);
    if (!isValidOutputFile(newPath) && fs.existsSync(originalPath)) {
      await copyNativeFallback(originalPath, newPath, err.message);
    }
    if (isValidOutputFile(newPath)) {
      pushReplaceCommands(globalReplaceCommands, plan, { uuidReplaceDedupe: sharedState.uuidReplaceDedupe });
      results.push(resultItem);
      patchBundleConfig(subpackageDir, plan);
      try {
        await migrateImportJson(subpackageDir, uuidAndExtra, plan, globalReplaceCommands, bundleRel, resultItem);
        await ensureNativeImportJsonStub(subpackageDir, uuidAndExtra, plan, fileExt, resultItem);
      } catch (migrateErr) {
        console.warn(`[Asset] import migrate failed for ${file}: ${migrateErr.message}`);
      }
    }
  }

  const moveMs = Date.now() - t0;
  if (moveMs > 3000 && FILE_EXTENSIONS.IMAGE.includes(fileExt)) {
    console.log(`  ↳ image ${(moveMs / 1000).toFixed(1)}s: ${file}`);
  }
}

async function migrateCompanionNative(subpackageDir, uuidAndExtra, plan, nativeFileName, globalReplaceCommands, bundleRel) {
  const origPrefix = uuidAndExtra.uuid.substring(0, 2);
  const newPrefix = plan.renamedUUID.substring(0, 2);
  const nestedRelative = `${uuidAndExtra.uuid}/${nativeFileName}`;
  const newNestedRelative = `${plan.renamedUUID}/${nativeFileName}`;
  const nativePathSearch = `native/${origPrefix}/${nestedRelative}`;
  const nativePathReplace = `native/${newPrefix}/${newNestedRelative}`;
  pushNativePathReplaceCommands(globalReplaceCommands, bundleRel, nativePathSearch, nativePathReplace);

  const originalNativePath = path.join(subpackageDir, 'native', origPrefix, nestedRelative);
  const newNativePath = path.join(subpackageDir, 'native', newPrefix, newNestedRelative);
  if (!fs.existsSync(originalNativePath)) {
    console.log(`No companion native for UUID: ${uuidAndExtra.uuid} (${nativeFileName})`);
    return null;
  }
  await ensureDirectoryExists(newNativePath);
  await fs.copy(originalNativePath, newNativePath);
  console.log(`Migrated companion native: ${nestedRelative} → ${newNestedRelative}`);
  return { originalNativePath, newNativePath };
}

async function processImportOnlyAsset(subpackageDir, importSubDir, file, uuidAndExtra, globalReplaceCommands, results, bundleRel, sharedState) {
  const plan = resolveSharedRenamePlan(
    uuidAndExtra,
    '.json',
    file,
    bundleRel,
    sharedState.uuidRegistry,
    { skipNativePaths: true },
  );
  const firstTwoChars = plan.renamedUUID.substring(0, 2);
  const originalPath = path.join(importSubDir, file);
  const newImportSubDir = path.join(subpackageDir, 'import', firstTwoChars);
  await fs.mkdir(newImportSubDir, { recursive: true });
  const newPath = path.join(newImportSubDir, plan.newFileName);

  console.log(`Processing import-only: ${file} → ${plan.newFileName}`);
  const replaceCommands = buildPlanReplaceCommands(plan);
  const raw = fs.readFileSync(originalPath, 'utf8');
  fs.writeFileSync(newPath, applyReplaceToContent(raw, replaceCommands), 'utf8');

  pushImportOnlyReplaceCommands(globalReplaceCommands, plan, { uuidReplaceDedupe: sharedState.uuidReplaceDedupe });
  pushImportJsonPathCommands(
    globalReplaceCommands,
    bundleRel,
    uuidAndExtra.uuid.substring(0, 2),
    firstTwoChars,
    file,
    plan.newFileName,
  );
  patchBundleConfig(subpackageDir, plan);

  const nativeFileName = extractNativeFileNameFromImportJson(raw);
  const companionNative = nativeFileName
    ? await migrateCompanionNative(
      subpackageDir,
      uuidAndExtra,
      plan,
      nativeFileName,
      globalReplaceCommands,
      bundleRel,
    )
    : null;

  results.push({
    originalFile: file,
    newFileName: plan.newFileName,
    uuid: uuidAndExtra.uuid,
    subpackageRel: bundleRel,
    originalPath,
    newPath,
    importMigrations: [{ originalImportPath: originalPath, newImportPath: newPath }],
    companionNative,
    importOnly: true,
    ...plan,
  });
}

async function processOrphanImportJson(subpackageDir, results, globalReplaceCommands, sharedState) {
  const importDir = path.join(subpackageDir, 'import');
  if (!fs.existsSync(importDir)) return;

  const bundleParent = path.basename(path.dirname(subpackageDir));
  const bundleName = path.basename(subpackageDir);
  const bundleRel = path.join(bundleParent, bundleName);
  const processedUuids = new Set();
  for (const item of results.filter((r) => r.subpackageRel === bundleRel)) {
    processedUuids.add(item.uuid);
    if (item.renamedUUID) processedUuids.add(item.renamedUUID);
  }
  for (const entry of sharedState.uuidRegistry.values()) {
    processedUuids.add(entry.renamedUUID);
  }

  for (const sub of fs.readdirSync(importDir)) {
    const subPath = path.join(importDir, sub);
    if (!fs.lstatSync(subPath).isDirectory()) continue;
    for (const file of fs.readdirSync(subPath)) {
      if (!file.endsWith('.json')) continue;
      const parsed = extractUUIDAndExtra(path.basename(file, '.json'));
      if (!parsed || parsed.notUUid) continue;
      if (processedUuids.has(parsed.uuid)) continue;
      processedUuids.add(parsed.uuid);
      await processImportOnlyAsset(subpackageDir, subPath, file, parsed, globalReplaceCommands, results, bundleRel, sharedState);
    }
  }
}

async function recoverMissingNativeAssets(sourceDir, results) {
  let recovered = 0;
  let missing = 0;
  for (const item of results) {
    if (isValidOutputFile(item.newPath)) continue;

    const srcPath = path.join(
      sourceDir,
      item.subpackageRel,
      'native',
      item.uuid.substring(0, 2),
      item.originalFile,
    );

    if (fs.existsSync(srcPath)) {
      await ensureDirectoryExists(item.newPath);
      await fs.copy(srcPath, item.newPath);
      console.warn(`Recovered from source: ${item.newFileName}`);
      recovered++;
    } else {
      console.error(`Missing native asset: ${item.newPath}`);
      missing++;
    }
  }
  if (recovered || missing) {
    console.log(`[Recover] restored=${recovered} stillMissing=${missing}`);
  }
  return { recovered, missing };
}

function decodeCocosEncodedUuid(base64) {
  if (!base64 || base64.length < 20 || !/^[A-Za-z0-9+/=]+$/.test(base64)) return null;
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=';
  const values = {};
  for (let i = 0; i < 64; i++) values[chars[i]] = i;
  const hex = '0123456789abcdef'.split('');
  const r = [base64[0], base64[1]];
  for (let i = 2; i < base64.length; i += 2) {
    const a = values[base64[i]];
    const l = values[base64[i + 1]];
    if (a === undefined || l === undefined) return null;
    r.push(hex[a >> 2]);
    r.push(hex[((a & 3) << 2) | (l >> 4)]);
    r.push(hex[l & 0xf]);
  }
  const s = r.join('');
  if (s.length < 32) return null;
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20, 32)}`;
}

function collectPackEncodedUuids(content) {
  const hits = [];
  try {
    const parsed = JSON.parse(content);
    if (!Array.isArray(parsed) || !Array.isArray(parsed[1])) return hits;
    for (const item of parsed[1]) {
      if (typeof item === 'string' && item.length >= 20) hits.push(item);
    }
  } catch {
    // ignore non-json import files
  }
  return hits;
}

function buildImportUuidIndex(processedDir) {
  const index = new Map();
  const assetsRoot = path.join(processedDir, 'assets');
  if (!fs.existsSync(assetsRoot)) return index;

  for (const bundleName of fs.readdirSync(assetsRoot)) {
    const importRoot = path.join(assetsRoot, bundleName, 'import');
    if (!fs.existsSync(importRoot)) continue;
    const bundleDir = path.join(assetsRoot, bundleName);

    const walk = (dirPath) => {
      for (const entry of fs.readdirSync(dirPath)) {
        const entryPath = path.join(dirPath, entry);
        if (fs.lstatSync(entryPath).isDirectory()) {
          walk(entryPath);
          continue;
        }
        if (!entry.endsWith('.json')) continue;
        const parsed = extractUUIDAndExtra(path.basename(entry, '.json'));
        if (!parsed || parsed.notUUid || parsed.hasAt) continue;
        if (!isValidOutputFile(entryPath)) continue;
        if (!index.has(parsed.uuid)) {
          index.set(parsed.uuid, { importPath: entryPath, bundleDir });
        }
      }
    };
    walk(importRoot);
  }
  return index;
}

function collectPackReferencedUuids(importRoot) {
  const uuids = new Set();
  if (!fs.existsSync(importRoot)) return uuids;

  const walk = (dirPath) => {
    for (const entry of fs.readdirSync(dirPath)) {
      const entryPath = path.join(dirPath, entry);
      if (fs.lstatSync(entryPath).isDirectory()) {
        walk(entryPath);
        continue;
      }
      if (!entry.endsWith('.json')) continue;
      const content = fs.readFileSync(entryPath, 'utf8');
      for (const encoded of collectPackEncodedUuids(content)) {
        const uuid = decodeCocosEncodedUuid(encoded);
        if (uuid) uuids.add(uuid);
      }
    }
  };
  walk(importRoot);
  return uuids;
}

async function mirrorNativeForImportJson(targetBundleDir, sourceImportPath, sourceBundleDir) {
  const raw = fs.readFileSync(sourceImportPath, 'utf8');
  const nativeFileName = extractNativeFileNameFromImportJson(raw);
  if (!nativeFileName) return false;

  const uuid = path.basename(sourceImportPath, '.json').split('@')[0];
  const prefix = uuid.substring(0, 2);
  const candidates = [
    path.join(sourceBundleDir, 'native', prefix, uuid, nativeFileName),
    path.join(sourceBundleDir, 'native', prefix, `${uuid}${path.extname(nativeFileName)}`),
    path.join(sourceBundleDir, 'native', prefix, nativeFileName),
  ];

  for (const srcNative of candidates) {
    if (!isValidOutputFile(srcNative)) continue;
    const relNative = path.relative(path.join(sourceBundleDir, 'native'), srcNative);
    const dstNative = path.join(targetBundleDir, 'native', relNative);
    if (isValidOutputFile(dstNative)) return true;
    await ensureDirectoryExists(dstNative);
    await fs.copy(srcNative, dstNative);
    return true;
  }
  return false;
}

async function ensureCrossBundleImportMirrors(processedDir) {
  const assetsRoot = path.join(processedDir, 'assets');
  if (!fs.existsSync(assetsRoot)) return 0;

  const importIndex = buildImportUuidIndex(processedDir);
  let copied = 0;

  for (const bundleName of fs.readdirSync(assetsRoot)) {
    const bundleDir = path.join(assetsRoot, bundleName);
    const importRoot = path.join(bundleDir, 'import');
    const neededUuids = collectPackReferencedUuids(importRoot);

    for (const uuid of neededUuids) {
      const targetImport = path.join(importRoot, uuid.substring(0, 2), `${uuid}.json`);
      if (isValidOutputFile(targetImport)) continue;

      const source = importIndex.get(uuid);
      if (!source) continue;

      await ensureDirectoryExists(targetImport);
      await fs.copy(source.importPath, targetImport);
      await mirrorNativeForImportJson(bundleDir, source.importPath, source.bundleDir);
      importIndex.set(uuid, { importPath: targetImport, bundleDir });
      copied++;
    }
  }

  if (copied) {
    console.warn(`[Mirror] copied ${copied} cross-bundle import JSON file(s)`);
  }
  return copied;
}

function verifyBundlePackImportRefs(processedDir) {
  const assetsRoot = path.join(processedDir, 'assets');
  if (!fs.existsSync(assetsRoot)) return { missingPackImports: 0, samples: [] };

  const importIndex = buildImportUuidIndex(processedDir);
  const samples = [];
  let missingPackImports = 0;

  for (const bundleName of fs.readdirSync(assetsRoot)) {
    const importRoot = path.join(assetsRoot, bundleName, 'import');
    if (!fs.existsSync(importRoot)) continue;

    const scanImportDir = (dirPath) => {
      for (const entry of fs.readdirSync(dirPath)) {
        const entryPath = path.join(dirPath, entry);
        if (fs.lstatSync(entryPath).isDirectory()) {
          scanImportDir(entryPath);
          continue;
        }
        if (!entry.endsWith('.json')) continue;
        const content = fs.readFileSync(entryPath, 'utf8');
        for (const encoded of collectPackEncodedUuids(content)) {
          const uuid = decodeCocosEncodedUuid(encoded);
          if (!uuid || !importIndex.has(uuid)) continue;
          const importPath = path.join(importRoot, uuid.substring(0, 2), `${uuid}.json`);
          if (isValidOutputFile(importPath)) continue;
          missingPackImports++;
          if (samples.length < 10) {
            samples.push({
              bundle: bundleName,
              pack: path.relative(importRoot, entryPath),
              uuid,
              expected: path.relative(processedDir, importPath),
            });
          }
        }
      }
    };
    scanImportDir(importRoot);
  }

  if (samples.length) {
    console.error(`[Verify] ${missingPackImports} pack import ref(s) missing in bundle, samples:`);
    for (const sample of samples.slice(0, 5)) {
      console.error(`  ${sample.bundle}/${sample.pack} → ${sample.expected}`);
    }
  }
  return { missingPackImports, samples };
}

function verifyPipelineResults(processedDir, results) {
  let missingFiles = 0;
  const staleByUuid = new Map();
  const staleSamples = [];

  for (const item of results) {
    if (isValidOutputFile(item.newPath)) continue;
    console.error(`[Verify] missing output: ${item.newPath}`);
    missingFiles++;
  }

  function noteStale(result, fileRel, reason) {
    staleByUuid.set(result.uuid, reason);
    if (staleSamples.length < 10) {
      staleSamples.push({ file: fileRel, uuid: result.uuid, reason });
    }
  }

  function scanDir(dirPath) {
    if (staleSamples.length >= 10 && staleByUuid.size >= results.length) return;
    for (const item of fs.readdirSync(dirPath)) {
      const itemPath = path.join(dirPath, item);
      if (fs.lstatSync(itemPath).isDirectory()) {
        scanDir(itemPath);
        continue;
      }
      if (!FILE_EXTENSIONS.TEXT.includes(path.extname(itemPath).toLowerCase())) continue;

      const content = fs.readFileSync(itemPath, 'utf8');
      const fileRel = path.relative(processedDir, itemPath);
      for (const result of results) {
        if (staleByUuid.has(result.uuid)) continue;
        const rel = result.subpackageRel.replace(/\\/g, '/');
        const staleNativePath = `native/${result.uuid.substring(0, 2)}/${result.originalFile}`;
        const staleFullPath = `${rel}/${staleNativePath}`;
        if (content.includes(staleFullPath)) {
          noteStale(result, fileRel, staleFullPath);
          continue;
        }
        if (content.includes(staleNativePath)) {
          noteStale(result, fileRel, staleNativePath);
          continue;
        }
        const staleImportFileName = result.importOnly
          ? result.originalFile
          : `${result.uuid}.json`;
        const staleImportPath = `import/${result.uuid.substring(0, 2)}/${staleImportFileName}`;
        const staleImportFullPath = `${rel}/${staleImportPath}`;
        if (content.includes(staleImportFullPath)) {
          noteStale(result, fileRel, staleImportFullPath);
          continue;
        }
        if (content.includes(staleImportPath)) {
          noteStale(result, fileRel, staleImportPath);
          continue;
        }
        if (result.searchString && content.includes(result.searchString)) {
          noteStale(result, fileRel, `encoded:${result.searchString}`);
          continue;
        }
        if (content.includes(result.uuid)) {
          noteStale(result, fileRel, `uuid:${result.uuid}`);
        }
      }
    }
  }

  try {
    scanDir(processedDir);
  } catch (err) {
    console.warn(`[Verify] scan failed: ${err.message}`);
  }

  const packImportVerify = verifyBundlePackImportRefs(processedDir);
  if (packImportVerify.missingPackImports) {
    missingFiles += packImportVerify.missingPackImports;
  }

  const staleRefs = staleByUuid.size;
  if (staleSamples.length) {
    console.error(`[Verify] stale references in ${staleRefs} asset(s), samples:`);
    for (const sample of staleSamples.slice(0, 5)) {
      console.error(`  ${sample.file}: ${sample.reason}`);
    }
  }
  if (missingFiles) {
    console.error(`[Verify] ${missingFiles} missing native file(s)`);
  }
  return { missingFiles, staleRefs, staleByUuid, staleSamples, packImportVerify };
}

async function ensureLegacyNativeMirrors(results) {
  let mirrored = 0;
  for (const item of results) {
    if (!isValidOutputFile(item.newPath)) continue;
    if (!item.originalPath || path.resolve(item.originalPath) === path.resolve(item.newPath)) continue;
    if (isValidOutputFile(item.originalPath)) continue;
    await ensureDirectoryExists(item.originalPath);
    await fs.copy(item.newPath, item.originalPath);
    mirrored++;
    if (item.companionNative && !isValidOutputFile(item.companionNative.originalNativePath)) {
      await ensureDirectoryExists(item.companionNative.originalNativePath);
      await fs.copy(item.companionNative.newNativePath, item.companionNative.originalNativePath);
      mirrored++;
    }
  }
  if (mirrored) {
    console.warn(`[Mirror] restored ${mirrored} legacy native path(s) from new copies`);
  }
  return mirrored;
}

async function ensureLegacyImportMirrors(results) {
  let mirrored = 0;
  for (const item of results) {
    for (const mig of item.importMigrations || []) {
      if (!isValidOutputFile(mig.newImportPath)) continue;
      if (isValidOutputFile(mig.originalImportPath)) continue;
      await ensureDirectoryExists(mig.originalImportPath);
      await fs.copy(mig.newImportPath, mig.originalImportPath);
      mirrored++;
    }
  }
  if (mirrored) {
    console.warn(`[Mirror] restored ${mirrored} legacy import path(s) from new copies`);
  }
  return mirrored;
}

function writePipelineAuditReport(appRoot, processedDir, results, verifyResult) {
  const reportPath = path.join(appRoot, 'post_process_audit.json');
  const staleUuids = [...(verifyResult.staleByUuid?.keys?.() || [])];
  const payload = {
    generatedAt: new Date().toISOString(),
    processedDir,
    assetsProcessed: results.length,
    missingFiles: verifyResult.missingFiles,
    staleReferenceCount: verifyResult.staleRefs,
    staleUuids: staleUuids.slice(0, 50),
    hint: verifyResult.staleRefs || verifyResult.missingFiles
      ? '请用 src_processed 运行游戏；在 src_processed 内搜索 staleUuids 应无结果'
      : '校验通过，请使用 src_processed 目录作为构建产物运行',
  };
  fs.writeFileSync(reportPath, JSON.stringify(payload, null, 2));
  console.log(`[Verify] audit report: ${reportPath}`);
  return reportPath;
}

async function processSubpackage(subpackageDir, results, globalReplaceCommands, sharedState) {
  const subpackageName = path.basename(subpackageDir);
  if (subpackageName.toLowerCase().includes('entryui')) {
    console.log(`⏩ Skip entryui: ${subpackageDir}`);
    return;
  }

  const nativeRoot = path.join(subpackageDir, 'native');
  const importDir = path.join(subpackageDir, 'import');
  if (!fs.existsSync(nativeRoot)) {
    console.log(`Skip ${subpackageName}: missing native`);
    return;
  }
  if (!fs.existsSync(importDir)) {
    console.warn(`[Bundle] ${subpackageName}: no import dir, processing native only`);
  }

  console.log(`\n[Bundle] ${subpackageName}`);
  const tasks = [];

  for (const entry of fs.readdirSync(nativeRoot)) {
    const entryPath = path.join(nativeRoot, entry);
    if (fs.lstatSync(entryPath).isDirectory()) {
      for (const file of fs.readdirSync(entryPath)) {
        const filePath = path.join(entryPath, file);
        if (fs.lstatSync(filePath).isDirectory() && isUuidDirectoryName(file)) {
          for (const innerFile of fs.readdirSync(filePath)) {
            tasks.push({
              subpackageDir,
              currentNativeSubDir: filePath,
              file: innerFile,
              uuidDir: file,
            });
          }
        } else {
          tasks.push({ subpackageDir, currentNativeSubDir: entryPath, file });
        }
      }
    } else {
      tasks.push({ subpackageDir, currentNativeSubDir: nativeRoot, file: entry });
    }
  }

  await runWithConcurrency(
    tasks,
    (task) => processOneAsset(
      task.subpackageDir,
      task.currentNativeSubDir,
      task.file,
      globalReplaceCommands,
      results,
      task.uuidDir,
      sharedState,
    ),
    getNativeConcurrency(),
  );
  await processOrphanImportJson(subpackageDir, results, globalReplaceCommands, sharedState);
  console.log(`[Bundle] ${subpackageName} done (${tasks.length} assets)`);
}

// ─── JS 混淆（Worker 池 + 并行）────────────────────────────

const OBFUSCATION_WORKER_TIMEOUT_MS = 20 * 60 * 1000;
let _obfuscatorPool = null;

function resolveObfuscateWorkerPath() {
  const candidates = [
    path.join(__dirname, 'obfuscate-worker.js'),
    process.resourcesPath
      ? path.join(process.resourcesPath, 'app.asar.unpacked', 'obfuscate-worker.js')
      : null,
  ].filter(Boolean);
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return path.join(__dirname, 'obfuscate-worker.js');
}

function looksAlreadyObfuscated(code) {
  if (code.length < 100 * 1024) return false;
  const head = code.slice(0, 12000);
  const hexVars = head.match(/_0x[0-9a-f]{4,6}/gi);
  if (hexVars && hexVars.length >= 8) return true;
  const newlineCount = (code.match(/\n/g) || []).length;
  if (code.length > 800 * 1024 && newlineCount < 30) return true;
  if (head.includes('stringArrayRotate') && head.includes('stringArray')) return true;
  return false;
}

function pickObfuscationPresets(originalSize, code) {
  if (looksAlreadyObfuscated(code)) {
    return { skip: true, reason: 'already obfuscated' };
  }
  if (originalSize >= OBFUSCATION_LARGE_FILE_BYTES) {
    const flags = getFeatureFlags();
    return {
      skip: false,
      presets: [buildLightObfuscationPreset(flags.OBFUSCATION_MAX_RATIO)],
      note: `large file (${(originalSize / 1024 / 1024).toFixed(2)}MB), light preset only`,
    };
  }
  return { skip: false, presets: getObfuscationPresets() };
}

async function getObfuscatorPool() {
  if (!_obfuscatorPool) {
    const size = getObfuscationConcurrency();
    _obfuscatorPool = new ObfuscatorPool(size, resolveObfuscateWorkerPath(), OBFUSCATION_WORKER_TIMEOUT_MS);
    await _obfuscatorPool.init();
    console.log(`[Obfuscator] worker pool size=${size}`);
  }
  return _obfuscatorPool;
}

async function shutdownObfuscatorPool() {
  if (!_obfuscatorPool) return;
  await _obfuscatorPool.destroy();
  _obfuscatorPool = null;
}

async function obfuscateInWorker(code, options, pool) {
  const activePool = pool || await getObfuscatorPool();
  return activePool.run(code, options);
}

async function obfuscateJavaScript(filePath, pool) {
  if (!fs.existsSync(filePath) || !getFeatureFlags().CAN_OBFUSCATION) return;
  if (isInWhitelist(filePath)) {
    console.log(`Skip obfuscation (whitelist): ${path.basename(filePath)}`);
    return;
  }

  const original = fs.readFileSync(filePath, 'utf8');
  const originalSize = original.length;

  if (originalSize < 8192) {
    console.log(`Skip obfuscation (too small): ${path.basename(filePath)} (${originalSize}B)`);
    return;
  }

  const plan = pickObfuscationPresets(originalSize, original);
  if (plan.skip) {
    console.log(
      `Skip obfuscation (${plan.reason}): ${path.basename(filePath)} (${(originalSize / 1024 / 1024).toFixed(2)}MB)`,
    );
    return;
  }
  if (plan.note) console.log(`${plan.note}: ${path.basename(filePath)}`);

  const baseName = path.basename(filePath);
  let heartbeat = null;
  if (originalSize >= OBFUSCATION_LARGE_FILE_BYTES) {
    heartbeat = setInterval(() => {
      console.log(`  still obfuscating ${baseName}...`);
    }, 15000);
  }

  let bestCode = null;
  let bestRatio = Infinity;
  let bestLabel = '';

  try {
    for (const preset of plan.presets) {
      const { maxRatio, label, ...options } = preset;
      const seed = crypto.randomInt(0, 1000000);
      try {
        const result = await obfuscateInWorker(original, { ...options, seed }, pool);
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
        console.warn(`Obfuscate ${label} failed for ${baseName}: ${err.message}`);
      }
    }
  } finally {
    if (heartbeat) clearInterval(heartbeat);
  }

  if (!bestCode) {
    console.warn(`Obfuscation skipped (kept original): ${filePath}`);
    return;
  }

  fs.writeFileSync(filePath, bestCode, 'utf8');
  console.log(
    `Obfuscated ${baseName} [${bestLabel}]: ${(originalSize / 1024).toFixed(1)}KB → ${(bestCode.length / 1024).toFixed(1)}KB (${bestRatio.toFixed(2)}x)`,
  );
}

function collectObfuscateTargets(subpackagesDir, assetsDir) {
  const files = [];
  for (const bundlePath of listBundleDirs(subpackagesDir)) {
    const gameJsPath = path.join(bundlePath, 'game.js');
    if (fs.existsSync(gameJsPath)) files.push(gameJsPath);
  }
  for (const bundlePath of listBundleDirs(assetsDir)) {
    const gameJsPath = path.join(bundlePath, 'game.js');
    if (fs.existsSync(gameJsPath)) files.push(gameJsPath);
    const indexJsFile = fs.readdirSync(bundlePath).find((f) => /index(\..*)?\.js$/.test(f));
    if (indexJsFile) files.push(path.join(bundlePath, indexJsFile));
  }
  return files;
}

async function obfuscateAllBundles(subpackagesDir, assetsDir) {
  const jsFiles = collectObfuscateTargets(subpackagesDir, assetsDir);
  if (!jsFiles.length) return;

  const pool = await getObfuscatorPool();
  const workers = getObfuscationConcurrency();
  console.log(`[Obfuscator] ${jsFiles.length} file(s), parallel=${workers}`);
  try {
    await runWithConcurrency(jsFiles, (filePath) => obfuscateJavaScript(filePath, pool), workers);
  } finally {
    await shutdownObfuscatorPool();
  }
}

// ─── 主流程 ─────────────────────────────────────────────────

const PIPELINE_STEPS = 5;

async function processAllBundles(subpackagesDir, assetsDir, results, globalReplaceCommands, sharedState) {
  const bundlePaths = [...listBundleDirs(subpackagesDir), ...listBundleDirs(assetsDir)];
  preassignSharedUuids(bundlePaths, sharedState);
  const bundleConcurrency = getBundleConcurrency();
  const nativeConcurrency = getNativeConcurrency();
  console.log(
    `[Pipeline] bundles=${bundlePaths.length} bundleWorkers=${bundleConcurrency} nativeWorkers=${nativeConcurrency}`,
  );
  await runWithConcurrency(
    bundlePaths,
    (bundlePath) => processSubpackage(bundlePath, results, globalReplaceCommands, sharedState),
    bundleConcurrency,
  );
}

async function main(options = {}) {
  const appRoot = options.appRoot || getAppRoot();
  const sourceDir = options.sourceDir || path.join(appRoot, 'src');
  const processedDir = options.processedDir || path.join(appRoot, 'src_processed');
  const onProgress = options.onProgress || (() => {});
  const { ASSETS_DIR, SUBPACKAGE_DIR } = DIR_CONFIG;

  const results = [];
  const globalReplaceCommands = [];
  const sharedUuidState = createSharedUuidState();
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

  step(3, 'Processing bundles (parallel)...');
  await processAllBundles(subpackagesDir, assetsDir, results, globalReplaceCommands, sharedUuidState);
  if (sharedUuidState.uuidRegistry.size) {
    console.log(`[Pipeline] shared UUID registry: ${sharedUuidState.uuidRegistry.size} unique asset(s)`);
  }

  await recoverMissingNativeAssets(sourceDir, results);
  await ensureLegacyNativeMirrors(results);
  await ensureLegacyImportMirrors(results);

  const replaceCommandsFile = path.join(appRoot, 'replace_commands_global.json');
  fs.writeFileSync(replaceCommandsFile, JSON.stringify(globalReplaceCommands, null, 2));
  step(4, `Saved ${globalReplaceCommands.length} replace commands`);

  console.log(`[${PIPELINE_STEPS}/${PIPELINE_STEPS}] Applying global UUID replacements...`);
  applyReplaceCommands(processedDir, globalReplaceCommands);
  await ensureCrossBundleImportMirrors(processedDir);
  let verifyResult = verifyPipelineResults(processedDir, results);
  if (verifyResult.staleRefs > 0) {
    console.warn('[Repair] stale references detected, retrying global replace...');
    applyReplaceCommands(processedDir, globalReplaceCommands);
    await ensureCrossBundleImportMirrors(processedDir);
    verifyResult = verifyPipelineResults(processedDir, results);
  }

  writePipelineAuditReport(appRoot, processedDir, results, verifyResult);

  step(5, 'Obfuscating bundle JavaScript (parallel)...');
  await obfuscateAllBundles(subpackagesDir, assetsDir);

  if (globalReplaceCommands.length) {
    console.log('[Repair] post-obfuscation UUID replace pass...');
    applyReplaceCommands(processedDir, globalReplaceCommands);
    await ensureCrossBundleImportMirrors(processedDir);
    verifyResult = verifyPipelineResults(processedDir, results);
    writePipelineAuditReport(appRoot, processedDir, results, verifyResult);
  }

  console.log(`\nSummary: ${results.length} assets processed, ${globalReplaceCommands.length} replacements`);
  if (verifyResult.staleRefs || verifyResult.missingFiles) {
    console.error(
      `[Summary] verify FAILED: stale=${verifyResult.staleRefs} missing=${verifyResult.missingFiles}. 请用 src_processed 运行，并查看 post_process_audit.json`,
    );
  } else {
    console.log('[Summary] verify OK — 请使用 src_processed 目录运行游戏');
  }
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
        `[Config] 界面开关: 混淆=${options.featureFlags.canObfuscation} 图片=${options.featureFlags.canImageSwitch}(强度${options.featureFlags.imageColorIntensity ?? 5}) 音频=${options.featureFlags.canAudioSwitch} tier1≤${options.featureFlags.obfuscationPreferRatio} tier2≤${options.featureFlags.obfuscationMaxRatio}`,
      );
    } else {
      const flags = refreshFeatureFlags();
      if (flags.configPath) {
        console.log(`[Config] 已加载: ${flags.configPath}`);
        console.log(`[Config] 混淆=${flags.CAN_OBFUSCATION} 图片=${flags.CAN_IMAGE_SWITCH}(强度${flags.IMAGE_COLOR_INTENSITY}) 音频=${flags.CAN_AUDIO_SWITCH} tier1≤${flags.OBFUSCATION_PREFER_RATIO} tier2≤${flags.OBFUSCATION_MAX_RATIO}`);
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
