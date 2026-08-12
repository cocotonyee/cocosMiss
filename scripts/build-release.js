#!/usr/bin/env node
/**
 * 发布构建：混淆 app.js → bytenode 字节码 → 打安装包
 * 客户安装包不含明文 app.js、license.js、私钥
 */
const fs = require('fs-extra');
const path = require('path');
const { execSync } = require('child_process');
const JavaScriptObfuscator = require('javascript-obfuscator');
const bytenode = require('bytenode');

const ROOT = path.join(__dirname, '..');
const BACKUP_DIR = path.join(ROOT, '.backup');
const APP_JS = path.join(ROOT, 'app.js');
const APP_JSC = path.join(ROOT, 'app.jsc');
const TEMP_OBF = path.join(BACKUP_DIR, 'app-obfuscated.js');
const BUILDER_CONFIG = path.join(ROOT, 'electron-builder.release.json');

const RELEASE_OBFUSCATION = {
  compact: true,
  controlFlowFlattening: false,
  deadCodeInjection: false,
  debugProtection: false,
  disableConsoleOutput: false,
  identifierNamesGenerator: 'hexadecimal',
  renameGlobals: false,
  selfDefending: false,
  simplify: true,
  splitStrings: false,
  stringArray: true,
  stringArrayEncoding: ['base64'],
  stringArrayThreshold: 0.5,
  stringArrayShuffle: true,
  stringArrayRotate: true,
  transformObjectKeys: false,
  unicodeEscapeSequence: false,
  seed: Math.floor(Math.random() * 1000000),
};

function runElectronBuilder(args) {
  const env = { ...process.env, CSC_IDENTITY_AUTO_DISCOVERY: 'false' };
  // 在 macOS 上交叉打包 Windows 时，优先用已缓存的 win Electron，避免误用本机 darwin dist
  if (String(args).includes('--win')) {
    const candidates = [
      process.env.ELECTRON_CUSTOM_DIST,
      path.join(os.tmpdir(), 'electron-win32-x64'),
      path.join(os.homedir(), 'Library/Caches/electron/win32-x64-unpacked'),
    ].filter(Boolean);
    for (const candidate of candidates) {
      if (fs.existsSync(path.join(candidate, 'electron.exe'))) {
        env.ELECTRON_BUILDER_ELECTRON_DIST = candidate;
        console.log(`   使用 Windows Electron: ${candidate}`);
        break;
      }
    }
  }
  const distFlag = env.ELECTRON_BUILDER_ELECTRON_DIST
    ? ` -c.electronDist="${env.ELECTRON_BUILDER_ELECTRON_DIST}"`
    : '';
  execSync(`npx electron-builder --config "${BUILDER_CONFIG}" ${args}${distFlag}`, {
    cwd: ROOT,
    stdio: 'inherit',
    env,
  });
}

function smokeTestJsc(jscPath) {
  const smokeScript = path.join(BACKUP_DIR, 'smoke-jsc.js');
  fs.writeFileSync(
    smokeScript,
    `'use strict';
require('bytenode');
const core = require(${JSON.stringify(jscPath)});
if (typeof core.runPipeline !== 'function') {
  throw new Error('app.jsc 缺少 runPipeline 导出');
}
console.log('   app.jsc 加载验证通过');
`,
  );

  const electronPath = require('electron');
  try {
    execSync(`"${electronPath}" "${smokeScript}"`, {
      cwd: ROOT,
      stdio: 'inherit',
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    });
  } finally {
    if (fs.existsSync(smokeScript)) fs.removeSync(smokeScript);
  }
}

async function build() {
  if (!fs.existsSync(path.join(ROOT, 'public.key'))) {
    throw new Error('缺少 public.key，请先运行 license.js 生成密钥对');
  }

  console.log('\n🔐 [1/4] 备份并混淆 app.js ...');
  await fs.ensureDir(BACKUP_DIR);
  await fs.copy(APP_JS, path.join(BACKUP_DIR, 'app.js.bak'));

  const source = await fs.readFile(APP_JS, 'utf8');
  const obfuscated = JavaScriptObfuscator.obfuscate(source, RELEASE_OBFUSCATION).getObfuscatedCode();
  await fs.writeFile(TEMP_OBF, obfuscated);
  console.log(`   混淆完成: ${(source.length / 1024).toFixed(1)}KB → ${(obfuscated.length / 1024).toFixed(1)}KB`);

  console.log('\n⚡ [2/4] 编译为 Electron 字节码 app.jsc ...');
  if (fs.existsSync(APP_JSC)) await fs.remove(APP_JSC);
  await bytenode.compileFile({
    filename: TEMP_OBF,
    output: APP_JSC,
    compileAsModule: true,
    electron: true,
    electronPath: require('electron'),
  });
  console.log(`   字节码: ${(fs.statSync(APP_JSC).size / 1024).toFixed(1)}KB`);

  console.log('\n🧪 [2.5/4] 验证 app.jsc 可加载（Electron 运行时）...');
  smokeTestJsc(APP_JSC);

  const platform = process.argv.includes('--win') ? '--win --x64' : process.argv.includes('--mac') ? '--mac' : '--mac';

  console.log(`\n📦 [3/4] 打包安装程序 (${platform}) ...`);
  try {
    runElectronBuilder(platform);
  } finally {
    console.log('\n🧹 [4/4] 清理临时文件 ...');
    if (fs.existsSync(APP_JSC)) await fs.remove(APP_JSC);
    if (fs.existsSync(TEMP_OBF)) await fs.remove(TEMP_OBF);
  }

  console.log('\n✅ 发布构建完成！输出目录: dist/');
  console.log('   发给客户: 安装包 + 单独生成的 license.lic');
  console.log('   勿发: app.js、license.js、license-keys/\n');
}

build().catch((err) => {
  console.error('\n❌ 发布构建失败:', err.message);
  process.exit(1);
});
