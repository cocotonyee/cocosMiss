'use strict';

const { Worker } = require('worker_threads');

class ObfuscatorPool {
  constructor(size, workerPath, timeoutMs) {
    this.size = Math.max(1, size);
    this.workerPath = workerPath;
    this.timeoutMs = timeoutMs;
    this.workers = [];
    this.idle = [];
    this.queue = [];
    this.nextId = 1;
    this.pending = new Map();
    this.destroyed = false;
  }

  async init() {
    for (let i = 0; i < this.size; i++) {
      await this._spawnWorker();
    }
  }

  async _spawnWorker() {
    const worker = new Worker(this.workerPath);
    worker.on('message', (msg) => this._onMessage(worker, msg));
    worker.on('error', (err) => this._onWorkerError(worker, err));
    this.workers.push(worker);
    this.idle.push(worker);
  }

  _onMessage(worker, msg) {
    const job = this.pending.get(msg.id);
    if (!job) return;
    this.pending.delete(msg.id);
    clearTimeout(job.timer);
    this.idle.push(worker);
    if (msg.ok) job.resolve(msg.result);
    else job.reject(new Error(msg.error || 'Obfuscation failed'));
    this._dispatch();
  }

  _onWorkerError(worker, err) {
    for (const [id, job] of this.pending.entries()) {
      if (job.worker !== worker) continue;
      this.pending.delete(id);
      clearTimeout(job.timer);
      job.reject(err);
    }
    const idx = this.workers.indexOf(worker);
    if (idx >= 0) this.workers.splice(idx, 1);
    const idleIdx = this.idle.indexOf(worker);
    if (idleIdx >= 0) this.idle.splice(idleIdx, 1);
    worker.terminate().catch(() => {});
    if (!this.destroyed) {
      this._spawnWorker().then(() => this._dispatch()).catch(() => {});
    }
  }

  _dispatch() {
    while (!this.destroyed && this.queue.length && this.idle.length) {
      const job = this.queue.shift();
      const worker = this.idle.pop();
      const id = this.nextId++;
      const timer = setTimeout(() => {
        const pending = this.pending.get(id);
        if (!pending) return;
        this.pending.delete(id);
        pending.reject(new Error('Obfuscation timeout'));
        worker.terminate().catch(() => {});
        const wi = this.workers.indexOf(worker);
        if (wi >= 0) this.workers.splice(wi, 1);
        if (!this.destroyed) {
          this._spawnWorker().then(() => this._dispatch()).catch(() => {});
        }
      }, this.timeoutMs);
      this.pending.set(id, { ...job, timer, worker });
      worker.postMessage({ id, code: job.code, options: job.options });
    }
  }

  run(code, options) {
    if (this.destroyed) {
      return Promise.reject(new Error('Obfuscator pool destroyed'));
    }
    return new Promise((resolve, reject) => {
      this.queue.push({ code, options, resolve, reject });
      this._dispatch();
    });
  }

  async destroy() {
    this.destroyed = true;
    for (const [, job] of this.pending.entries()) {
      clearTimeout(job.timer);
      job.reject(new Error('Obfuscator pool shutdown'));
    }
    this.pending.clear();
    this.queue.length = 0;
    await Promise.all(this.workers.map((w) => w.terminate().catch(() => {})));
    this.workers = [];
    this.idle = [];
  }
}

module.exports = { ObfuscatorPool };
