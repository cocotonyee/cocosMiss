'use strict';

const path = require('path');
const Module = require('module');

function addGlobalPath(dir) {
  if (!dir) return;
  try {
    if (!Module.globalPaths.includes(dir)) {
      Module.globalPaths.unshift(dir);
    }
  } catch (_) { /* ignore */ }
}

const resourcesRoot = process.env.MILFUN_APP_ROOT;
const coreRoot = process.env.MILFUN_CORE_ROOT;

if (resourcesRoot) {
  addGlobalPath(path.join(resourcesRoot, 'app.asar.unpacked', 'node_modules'));
  addGlobalPath(path.join(resourcesRoot, 'app.asar', 'node_modules'));
}

if (coreRoot) {
  const unpacked = coreRoot.replace(/app\.asar([/\\]|$)/, 'app.asar.unpacked$1');
  addGlobalPath(path.join(unpacked, 'node_modules'));
  addGlobalPath(path.join(coreRoot, 'node_modules'));
}
