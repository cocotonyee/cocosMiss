'use strict';

const path = require('path');

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

let _core;

function getCore() {
  if (!_core) {
    loadModule('bytenode');
    _core = require('./app.jsc');
  }
  return _core;
}

module.exports = new Proxy(
  {},
  {
    get(_target, prop) {
      const core = getCore();
      const value = core[prop];
      return typeof value === 'function' ? value.bind(core) : value;
    },
  },
);
