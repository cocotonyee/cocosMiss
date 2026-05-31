'use strict';

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

function getProjectRoot() {
  return path.join(__dirname, '..');
}

function hasDependencies(root = getProjectRoot()) {
  return fs.existsSync(path.join(root, 'node_modules', 'sharp', 'package.json'));
}

function runNpmInstall(root, onLine) {
  return new Promise((resolve, reject) => {
    const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    const child = spawn(npm, ['install'], {
      cwd: root,
      shell: true,
      env: {
        ...process.env,
        npm_config_fund: 'false',
        npm_config_audit: 'false',
      },
    });

    const forward = (data) => {
      const text = String(data).trim();
      if (text && onLine) onLine(text);
    };

    child.stdout.on('data', forward);
    child.stderr.on('data', forward);

    child.on('error', (err) => {
      reject(new Error(`无法运行 npm：${err.message}。请先安装 Node.js 并在项目目录手动执行 npm install`));
    });

    child.on('close', (code) => {
      if (code === 0 && hasDependencies(root)) {
        resolve();
        return;
      }
      reject(new Error(`npm install 失败 (exit ${code})。请在项目目录手动执行 npm install`));
    });
  });
}

async function ensureDependencies(onLine) {
  const root = getProjectRoot();
  if (!fs.existsSync(path.join(root, 'package.json'))) {
    throw new Error('找不到 package.json');
  }
  if (hasDependencies(root)) return { installed: false };

  onLine?.('首次启动，正在安装依赖 (npm install)...');
  onLine?.('可能需要几分钟，请稍候...');
  await runNpmInstall(root, onLine);
  onLine?.('依赖安装完成');
  return { installed: true };
}

module.exports = {
  getProjectRoot,
  hasDependencies,
  ensureDependencies,
};
