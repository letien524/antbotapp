'use strict';

// Worker: 1 device = 1 worker chay doc lap. Lap qua danh sach task theo chu ky.
// Nguyen tac farm: KHONG chay tuan tu het account nay toi account khac trong 1 vong;
// moi device co worker rieng chay song song (o day chay trong cung process cho don gian,
// ban co the nang cap len worker_threads/child_process khi so device lon).

const { makeLogger } = require('../logger');
const { collectResources } = require('../tasks/collectResources');
const { huntBeast } = require('../tasks/huntBeast');
const { checkQueue } = require('../tasks/common');
const { tasksFromConfig } = require('../config');
const { CancelToken } = require('../cancel');

// Dang ky cac task kha dung.
const TASKS = {
  collectResources,
  huntBeast,
};

class Worker {
  constructor(device, { account = null, tasks = null } = {}) {
    this.device = device;
    this.account = account;
    const cfg = (account && account.config) || {};
    // Task suy ra tu config (gather.enabled / hunt.enabled); co the ep bang `tasks`.
    this.taskNames = tasks || tasksFromConfig(cfg);
    this.running = false;
    this.token = null; // token huy cho luot hien tai
    this.troopStatus = {}; // idx -> { task, type, level, at } : lan gui gan nhat cua tung doi
    this.lastQueue = null; // queue doc gan nhat (dung cho bang trang thai, khoi OCR lai)
    // Ten than thien tu account (neu co) -> hien trong log thay vi serial kho doc.
    if (account && account.name) device.setName(account.name);
    this.log = makeLogger(`worker:${device.name || device.serial}`);
  }

  // Khoang cach den lan chay ke tiep cua 1 task (ms), tuy ket qua:
  //  - hunt het the luc -> cho hoi (recoverSec)
  //  - con lai -> poll binh thuong (pollSec) de gui luot moi khi doi ve.
  _nextDelayMs(name, res, cfg) {
    const pollMs = (Number(cfg.pollSec) > 0 ? cfg.pollSec : 60) * 1000;
    // Auto Hunt: mot luot di+ve ~2p20s -> check lai sau ~140s.
    if (name === 'huntBeast') return 140 * 1000;
    return pollMs;
  }

  async start() {
    if (this.running) return;
    this.running = true;
    this.log.info(`Worker khoi dong (tasks: ${this.taskNames.join(', ')})`);
    this._loopPromise = this._loop().catch((e) => this.log.error(`Worker crash: ${e.message}`));
  }

  // Dung NGAY: huy token -> thao tac device/sleep dang cho bi abort tuc thi.
  stop() {
    this.running = false;
    if (this.token) this.token.cancel();
    this.log.info('Worker da nhan lenh DUNG (huy task dang chay ngay).');
  }

  // Dung roi CHO vong lam viec thoat han (de sau do lam buoc don dep an toan).
  async stopAndWait() {
    this.stop();
    if (this._loopPromise) await this._loopPromise.catch(() => {});
  }

  async _loop() {
    // Lich chay rieng cho tung task (moc thoi gian chay ke tiep). Chay ngay lan dau.
    const nextRun = {};
    for (const name of this.taskNames) nextRun[name] = 0;

    while (this.running) {
      const cfg = (this.account && this.account.config) || {};
      // Token moi cho luot nay; gan vao device de moi thao tac deu kiem tra.
      this.token = new CancelToken();
      this.device.cancelToken = this.token;

      const pollMs = (Number(cfg.pollSec) > 0 ? cfg.pollSec : 60) * 1000;
      const due = this.taskNames.filter((n) => Date.now() >= nextRun[n] && TASKS[n]);
      let cancelled = false;

      if (due.length > 0) {
        try {
          // CONG QUEUE (CHECK TRUOC MOI THAO TAC DOC TROOP): dem so troop dang hanh quan.
          // Chi lam task khi DOC DUOC queue VA con o trong. Khong doc duoc / full -> cho luot moi.
          const { onMap, queue } = await checkQueue(this.device, cfg);
          if (queue) this.lastQueue = { ...queue, at: Date.now() };
          if (!onMap) {
            this.log.warn('[state] chua ve duoc world map -> cho, khong lam task.');
            for (const n of due) nextRun[n] = Date.now() + pollMs;
          } else if (!queue) {
            this.log.warn('[state] khong doc duoc so queue -> cho, chua doc thong tin troop.');
            for (const n of due) nextRun[n] = Date.now() + pollMs;
          } else if (queue.free <= 0) {
            this.log.info(`[state] ${queue.used}/${queue.total} troop dang hanh quan -> QUEUE DAY, cho ${Math.round(pollMs / 1000)}s.`);
            for (const n of due) nextRun[n] = Date.now() + pollMs;
          } else {
            // Con o trong -> lam task theo THU TU UU TIEN (due da xep hunt truoc, gather sau).
            // Task uu tien dung o trong truoc; task sau chi con o con lai.
            let remainingFree = queue ? queue.free : null;
            for (const name of due) {
              if (!this.running) break;
              if (remainingFree != null && remainingFree <= 0) {
                // Task uu tien da dung het o trong -> task nay cho vong sau.
                nextRun[name] = Date.now() + pollMs;
                this.log.info(`[state] het o trong (task uu tien da dung) -> ${name} cho ${Math.round(pollMs / 1000)}s.`);
                continue;
              }
              const qForTask = (remainingFree != null) ? { ...queue, free: remainingFree } : queue;
              const res = await TASKS[name](this.device, {
                account: this.account, config: cfg, token: this.token, queue: qForTask,
                report: (troopIdx, info) => { this.troopStatus[troopIdx] = { ...info, at: Date.now() }; },
              });
              const used = (res && (res.sent || res.hunted)) || 0;
              if (remainingFree != null) remainingFree -= used;
              nextRun[name] = Date.now() + this._nextDelayMs(name, res, cfg);
              this.log.info(`[lich] ${name} chay lai sau ${Math.round((nextRun[name] - Date.now()) / 1000)}s`);
            }
          }
        } catch (e) {
          if (e && e.cancelled) {
            this.log.info('Task da dung giua chung theo yeu cau.');
            cancelled = true;
          } else {
            this.log.error(`Loi vong lam viec: ${e.message}`);
            for (const n of due) nextRun[n] = Date.now() + 30000;
          }
        }
      }

      // Chi go token neu van la token cua minh (tranh clobber worker moi khi restart).
      if (this.device.cancelToken === this.token) this.device.cancelToken = null;
      if (!this.running || cancelled) break;

      // Ngu toi moc chay gan nhat, nhung gioi han 30s de con re-check + phan hoi Stop.
      const soonest = Math.min(...this.taskNames.map((n) => nextRun[n]));
      const wait = Math.max(2000, Math.min(soonest - Date.now(), 30000));
      await this._sleep(wait);
    }
  }

  _sleep(ms) {
    return new Promise((resolve) => {
      const t = setInterval(() => {
        if (!this.running) {
          clearInterval(t);
          resolve();
        }
      }, 500);
      setTimeout(() => {
        clearInterval(t);
        resolve();
      }, ms);
    });
  }
}

module.exports = { Worker, TASKS };
