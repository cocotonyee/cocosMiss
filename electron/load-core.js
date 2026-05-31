'use strict';

const path = require('path');
const fs = require('fs');
const { resolveCoreRoot } = require('./worker-path');

function loadModule(name) {
  const appRoot = process.env.MILFUN_APP_ROOT;
  if (appRoot) {
    const candidates = [
      path.join(appRoot, 'app.asar.unpacked', 'node_modules', name),
      path.join(appRoot, 'app.asar', 'node_modules', name),
    ];
    for (const candidate of candidates) {
      try {
        return require(candidate);
      } catch (_) { /* try next */ }
    }
  }
  return require(name);
}

/**
 * app.jsc 若在 app.asar.unpacked，require('fs-extra') 无法解析 asar 内的 node_modules。
 * 临时把 bare require 的解析上下文切到 app.asar 内。
 */
function installAsarModuleResolver(resourcesRoot) {
  if (!resourcesRoot) return () => {};
  const Module = require('module');
  const asarPackageJson = path.join(resourcesRoot, 'app.asar', 'package.json');
  if (!fs.existsSync(asarPackageJson)) return () => {};

  const asarPaths = Module._nodeModulePaths(asarPackageJson);
  const asarParent = { filename: path.join(resourcesRoot, 'app.asar', 'app.jsc'), paths: asarPaths };
  const orig = Module._resolveFilename;

  Module._resolveFilename = function patchedResolve(request, parent, isMain, options) {
    const isBare = !request.startsWith('.') && !path.isAbsolute(request) && !request.startsWith('node:');
    const parentFile = parent?.filename || '';
    const fromUnpacked = parentFile.includes('app.asar.unpacked');

    if (isBare && fromUnpacked) {
      try {
        return orig.call(this, request, asarParent, isMain, options);
      } catch (_) { /* fall through */ }
    }
    return orig.call(this, request, parent, isMain, options);
  };

  return () => {
    Module._resolveFilename = orig;
  };
}

function loadCore(coreRoot, log) {
  const root = resolveCoreRoot(coreRoot);
  const jscPath = path.join(root, 'app.jsc');
  const loaderPath = path.join(root, 'loader-core.js');
  const jsPath = path.join(root, 'app.js');
  const resourcesRoot = process.env.MILFUN_APP_ROOT;
  const fromUnpacked = root.includes('app.asar.unpacked');

  log?.('info', `[Core] 目录: ${root}`);

  if (fs.existsSync(jscPath) && fs.existsSync(loaderPath)) {
    log?.('info', '[Core] 加载 bytenode...');
    loadModule('bytenode');
    log?.('info', '[Core] 加载 app.jsc（首次可能需 10~30 秒）...');

    if (fromUnpacked) {
      log?.('info', '[Core] 检测到 unpacked 字节码，启用 asar 模块解析...');
    }

    const restoreResolver = fromUnpacked ? installAsarModuleResolver(resourcesRoot) : () => {};

    const heartbeat = setInterval(() => {
      log?.('info', '[Core] 仍在加载字节码，请稍候...');
    }, 8000);

    let core;
    try {
      core = require(jscPath);
    } catch (err) {
      throw new Error(`app.jsc 加载失败: ${err.message || err}`);
    } finally {
      clearInterval(heartbeat);
      restoreResolver();
    }

    if (!core || typeof core.runPipeline !== 'function') {
      throw new Error('app.jsc 未导出 runPipeline，安装包可能损坏或与 Electron 版本不匹配');
    }

    log?.('info', '[Core] 字节码加载完成');
    return core;
  }

  if (fs.existsSync(jsPath)) {
    log?.('info', '[Core] 加载 app.js...');
    return require(jsPath);
  }

  throw new Error(`找不到核心模块，目录: ${root}`);
}

module.exports = { loadCore, loadModule, installAsarModuleResolver };
