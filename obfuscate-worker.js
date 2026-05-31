'use strict';

const { parentPort } = require('worker_threads');
const { loadJavaScriptObfuscator } = require('./obfuscator-loader');

parentPort.on('message', (msg) => {
  try {
    const result = loadJavaScriptObfuscator()
      .obfuscate(msg.code, msg.options)
      .getObfuscatedCode();
    parentPort.postMessage({ ok: true, result });
  } catch (err) {
    parentPort.postMessage({ ok: false, error: err.message || String(err) });
  }
});
