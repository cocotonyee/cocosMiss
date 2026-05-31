'use strict';

const fs = require('fs');
const path = require('path');

let _JavaScriptObfuscator;

function loadJavaScriptObfuscator() {
  if (_JavaScriptObfuscator) return _JavaScriptObfuscator;

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

  return _JavaScriptObfuscator;
}

module.exports = { loadJavaScriptObfuscator };
