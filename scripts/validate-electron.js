#!/usr/bin/env node
'use strict';

/**
 * 发布前静态检查：模块导出、require 路径、IPC 通道一致性
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const ELECTRON_DIR = path.join(ROOT, 'electron');

function read(file) {
  return fs.readFileSync(path.join(ROOT, file), 'utf8');
}

function syntaxCheck(relativePath) {
  const full = path.join(ROOT, relativePath);
  const src = fs.readFileSync(full, 'utf8');
  try {
    new vm.Script(src, { filename: relativePath });
    return null;
  } catch (err) {
    return `${relativePath}: ${err.message}`;
  }
}

function listJsFiles(dir, base = dir) {
  const out = [];
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    if (fs.statSync(p).isDirectory()) out.push(...listJsFiles(p, base));
    else if (name.endsWith('.js')) out.push(path.relative(base, p));
  }
  return out;
}

const errors = [];

// 1. 语法检查
for (const file of [
  'app.js',
  'config.js',
  'license-service.js',
  'loader-core.js',
  'scripts/build-release.js',
  ...listJsFiles(ELECTRON_DIR).map((f) => path.join('electron', f)),
]) {
  const err = syntaxCheck(file);
  if (err) errors.push(err);
}

// 2. worker-path 导出
const workerPath = require(path.join(ELECTRON_DIR, 'worker-path'));
for (const key of ['resolveUnpackPath', 'resolveCoreRoot']) {
  if (typeof workerPath[key] !== 'function') errors.push(`worker-path 缺少导出: ${key}`);
}

// 3. main.js 必须导入 resolveCoreRoot
const mainSrc = read('electron/main.js');
for (const sym of ['resolveUnpackPath', 'resolveCoreRoot', 'getProjectRoot', 'ensureDependencies']) {
  if (!mainSrc.includes(sym)) errors.push(`electron/main.js 未引用: ${sym}`);
}
if (!/resolveCoreRoot\s*\}/.test(mainSrc) && !/resolveCoreRoot,\s*resolveUnpackPath/.test(mainSrc) && !/resolveUnpackPath,\s*resolveCoreRoot/.test(mainSrc)) {
  if (!mainSrc.includes('resolveCoreRoot } = require')) {
    errors.push('electron/main.js 未从 worker-path 导入 resolveCoreRoot');
  }
}

// 4. pipeline-worker 依赖
const workerSrc = read('electron/pipeline-worker.js');
for (const sym of ['resolveCoreRoot', 'worker-bootstrap', 'worker-path']) {
  if (!workerSrc.includes(sym)) errors.push(`pipeline-worker 缺少: ${sym}`);
}

// 5. preload IPC 与 main 一致
const preloadSrc = read('electron/preload.js');
const invokeChannels = [...preloadSrc.matchAll(/invoke\('([^']+)'/g)].map((m) => m[1]);
const mainHandlers = [...mainSrc.matchAll(/ipcMain\.handle\('([^']+)'/g)].map((m) => m[1]);
for (const ch of invokeChannels) {
  if (!mainHandlers.includes(ch)) errors.push(`preload 调用 ${ch} 但 main 未注册 handler`);
}
for (const ch of mainHandlers) {
  if (!invokeChannels.includes(ch)) errors.push(`main 注册了 ${ch} 但 preload 未暴露`);
}

// 6. renderer 事件与 preload 一致
const rendererSrc = read('electron/renderer/app.js');
const preloadEvents = [...preloadSrc.matchAll(/ipcRenderer\.on\('([^']+)'/g)].map((m) => m[1]);
const rendererEvents = [...rendererSrc.matchAll(/on([A-Z][A-Za-z]+)\(/g)]
  .map((m) => m[1])
  .filter((n) => n.startsWith('Setup') || ['Log', 'Progress', 'Done', 'Error', 'ProcessingState'].includes(n));
const eventMap = {
  SetupStart: 'setup-start',
  SetupLog: 'setup-log',
  SetupDone: 'setup-done',
  SetupError: 'setup-error',
  Log: 'log',
  Progress: 'progress',
  Done: 'done',
  Error: 'error',
  ProcessingState: 'processing-state',
};
for (const [method, channel] of Object.entries(eventMap)) {
  if (rendererSrc.includes(`on${method}`) && !preloadEvents.includes(channel)) {
    errors.push(`renderer 使用 on${method} 但 preload 未监听 ${channel}`);
  }
}

// 7. 打包必须包含的文件
const builder = JSON.parse(read('electron-builder.release.json'));
const requiredUnpack = [
  'electron/pipeline-worker.js',
  'electron/worker-path.js',
  'electron/worker-bootstrap.js',
  'electron/log-filter.js',
  'loader-core.js',
  'app.jsc',
  'config.js',
  'license-service.js',
];
const unpackPatterns = (builder.asarUnpack || []).join(' ');
for (const file of requiredUnpack) {
  const covered = unpackPatterns.includes('electron/**/*')
    || unpackPatterns.includes(file.replace(/\\/g, '/'))
    || (file.startsWith('electron/') && unpackPatterns.includes('electron/**/*'));
  if (!covered && !file.startsWith('electron/')) {
    if (!unpackPatterns.includes(path.basename(file))) {
      errors.push(`asarUnpack 可能未包含: ${file}`);
    }
  }
}

// 8. require 路径存在性（相对 electron 目录）
function checkRequires(relativeDir) {
  const dir = path.join(ROOT, relativeDir);
  for (const js of listJsFiles(dir)) {
    const full = path.join(dir, js);
    const src = fs.readFileSync(full, 'utf8');
    for (const m of src.matchAll(/require\(['"](\.[^'"]+)['"]\)/g)) {
      const req = m[1];
      const base = path.dirname(full);
      const candidates = [
        path.join(base, req),
        path.join(base, req + '.js'),
        path.join(base, req, 'index.js'),
      ];
      if (!candidates.some((c) => fs.existsSync(c))) {
        errors.push(`${path.join(relativeDir, js)} require 找不到: ${req}`);
      }
    }
  }
}
checkRequires('electron');

// 9. app.js 导出 pipeline 所需
const app = require(path.join(ROOT, 'app.js'));
for (const key of ['runPipeline', 'checkLicense', 'getDeviceFingerprint']) {
  if (typeof app[key] !== 'function') errors.push(`app.js 缺少导出: ${key}`);
}

if (errors.length) {
  console.error('❌ validate-electron 失败:\n');
  for (const e of errors) console.error(' -', e);
  process.exit(1);
}

console.log('✅ validate-electron 通过');
console.log(`   检查了 ${invokeChannels.length} 个 IPC 通道、${listJsFiles(ELECTRON_DIR).length} 个 electron 脚本`);
