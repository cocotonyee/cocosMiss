'use strict';

const path = require('path');
const fs = require('fs');

function resolveUnpackPath(baseDir, relativeScript) {
  const scriptPath = path.join(baseDir, relativeScript);
  if (!scriptPath.includes('app.asar')) return scriptPath;
  const unpacked = scriptPath.replace(/app\.asar([/\\]|$)/, 'app.asar.unpacked$1');
  return fs.existsSync(unpacked) ? unpacked : scriptPath;
}

function resolveCoreRoot(coreRoot) {
  if (!coreRoot) return coreRoot;

  // 优先从 app.asar 内加载，require('fs-extra') 等才能走 Electron asar 模块解析
  if (fs.existsSync(path.join(coreRoot, 'app.jsc')) || fs.existsSync(path.join(coreRoot, 'app.js'))) {
    return coreRoot;
  }

  const unpacked = coreRoot.replace(/app\.asar([/\\]|$)/, 'app.asar.unpacked$1');
  if (fs.existsSync(path.join(unpacked, 'app.jsc')) || fs.existsSync(path.join(unpacked, 'app.js'))) {
    return unpacked;
  }
  return coreRoot;
}

module.exports = { resolveUnpackPath, resolveCoreRoot };
