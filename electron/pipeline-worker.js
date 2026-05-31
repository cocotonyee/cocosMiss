'use strict';

const path = require('path');
const fs = require('fs');
const { shouldForwardLogToUI } = require('./log-filter');
const { resolveCoreRoot } = require('./worker-path');

function emit(msg) {
  if (process.parentPort) {
    process.parentPort.postMessage(msg);
  } else if (typeof process.send === 'function') {
    process.send(msg);
  }
}

function onCommand(handler) {
  if (process.parentPort) {
    process.parentPort.on('message', (event) => handler(event.data));
  } else {
    process.on('message', handler);
  }
}

function loadCore(coreRoot) {
  const root = resolveCoreRoot(coreRoot);
  const jscPath = path.join(root, 'app.jsc');
  const loaderPath = path.join(root, 'loader-core.js');
  const jsPath = path.join(root, 'app.js');

  if (fs.existsSync(jscPath) && fs.existsSync(loaderPath)) {
    return require(loaderPath);
  }
  if (fs.existsSync(jsPath)) {
    return require(jsPath);
  }
  throw new Error(`找不到核心模块，目录: ${root}`);
}

onCommand(async (msg) => {
  if (!msg || msg.type !== 'run') return;

  try {
    if (msg.env) {
      for (const [key, value] of Object.entries(msg.env)) {
        process.env[key] = value;
      }
    }

    emit({ type: 'progress', step: 0, total: 6, message: '正在启动处理进程...' });
    emit({ type: 'log', level: 'info', message: 'MilFun Start...' });
    emit({ type: 'progress', step: 0, total: 6, message: '正在加载核心模块...' });

    const loadTimer = setInterval(() => {
      emit({ type: 'progress', step: 0, total: 6, message: '正在加载核心模块...' });
    }, 2000);

    let core;
    try {
      core = loadCore(msg.coreRoot);
    } finally {
      clearInterval(loadTimer);
    }

    emit({ type: 'progress', step: 0, total: 6, message: '正在处理资源...' });

    const result = await core.runPipeline({
      appRoot: msg.appRoot,
      sourceDir: msg.sourceDir,
      processedDir: msg.processedDir,
      outputDir: msg.outputDir,
      trustUiLicense: true,
      onLog: (level, message) => {
        if (shouldForwardLogToUI(level, message)) {
          emit({ type: 'log', level, message });
        }
      },
      onProgress: (step, total, message) => {
        emit({ type: 'progress', step, total, message });
      },
    });

    emit({
      type: 'done',
      zipPath: result.zipPath,
      processedDir: result.processedDir,
    });
    process.exit(0);
  } catch (err) {
    emit({ type: 'log', level: 'error', message: err.message || String(err) });
    emit({ type: 'error', message: err.message || String(err) });
    process.exit(1);
  }
});

emit({ type: 'ready' });
