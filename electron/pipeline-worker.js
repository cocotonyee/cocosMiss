'use strict';

/**
 * @deprecated 已改为主进程 runPipelineInMain；保留此文件仅为兼容旧安装包诊断。
 */
const { loadCore } = require('./load-core');

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

onCommand(async (msg) => {
  if (!msg || msg.type !== 'run') return;

  try {
    if (msg.env) {
      for (const [key, value] of Object.entries(msg.env)) {
        process.env[key] = value;
      }
    }

    require('./worker-bootstrap');

    emit({ type: 'progress', step: 0, total: 6, message: '正在启动处理进程...' });
    emit({ type: 'log', level: 'info', message: 'MilFun Start...' });
    emit({ type: 'progress', step: 0, total: 6, message: '正在加载核心模块...' });

    const core = loadCore(msg.coreRoot, (level, message) => {
      emit({ type: 'log', level, message });
    });

    emit({ type: 'progress', step: 0, total: 6, message: '正在处理资源...' });

    const result = await core.runPipeline({
      appRoot: msg.appRoot,
      sourceDir: msg.sourceDir,
      processedDir: msg.processedDir,
      outputDir: msg.outputDir,
      trustUiLicense: true,
      onLog: (level, message) => {
        emit({ type: 'log', level, message });
      },
      onProgress: (step, total, message) => {
        emit({ type: 'progress', step, total, message });
        if (message) emit({ type: 'log', level: 'info', message });
      },
    });

    emit({
      type: 'done',
      zipPath: result.zipPath,
      processedDir: result.processedDir,
    });
    process.exit(0);
  } catch (err) {
    emit({ type: 'log', level: 'error', message: err.stack || err.message || String(err) });
    emit({ type: 'error', message: err.message || String(err) });
    process.exit(1);
  }
});

emit({ type: 'ready' });
