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
  const unpacked = coreRoot.replace(/app\.asar([/\\]|$)/, 'app.asar.unpacked$1');
  if (fs.existsSync(path.join(unpacked, 'app.jsc')) || fs.existsSync(path.join(unpacked, 'app.js'))) {
    return unpacked;
  }
  return coreRoot;
}

module.exports = { resolveUnpackPath, resolveCoreRoot };
