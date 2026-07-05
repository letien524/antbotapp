'use strict';

// CHILD PROCESS: 1 process cho 1 may. Toan bo CPU nang (chup, OCR, template matching,
// dieu khien adb) chay o day -> cach ly hoan toan khoi main process (UI) nen khong giat.
//
// Giao tiep voi parent qua process message:
//   Child -> parent: { type:'log', entry }  /  { type:'status', troopStatus, lastQueue }
//   parent -> child: { type:'stop' }
//
// Chay bang: child_process.fork(this, [serial], { env: { ELECTRON_RUN_AS_NODE: 1 } })

const { AdbDevice } = require('./device/AdbDevice');
const { Worker } = require('./scheduler/Worker');
const { accountForSerial } = require('./config');
const { logEmitter } = require('./logger');
const { terminate } = require('./state/StateReader');
const { CancelToken } = require('./cancel');
const { ensureWorldMap } = require('./tasks/common');
const { stopIfRunning } = require('./tasks/autohunt');

const serial = process.argv[2];

function send(msg) {
  try { if (process.send) process.send(msg); } catch (e) { /* parent da thoat */ }
}

// Chuyen moi log cua process nay ra parent (parent forward ra UI).
logEmitter.on('log', (entry) => send({ type: 'log', entry }));

const device = new AdbDevice(serial);
const account = accountForSerial(serial);
const worker = new Worker(device, { account });

// Gui trang thai (troop + queue) ra parent dinh ky cho bang status tren UI.
const statusTimer = setInterval(() => {
  send({ type: 'status', troopStatus: worker.troopStatus, lastQueue: worker.lastQueue });
}, 4000);

let stopping = false;
async function shutdown(opts = {}) {
  if (stopping) return;
  stopping = true;
  clearInterval(statusTimer);
  await worker.stopAndWait(); // huy task dang chay + cho vong lam viec thoat han

  // Don dep: neu nguoi dung bam DUNG va hunt bat -> dung Auto Hunt trong game (neu dang chay).
  if (opts.cleanup) {
    try {
      const cfg = (account && account.config) || {};
      if (cfg.hunt && cfg.hunt.enabled) {
        device.cancelToken = new CancelToken(); // token moi (khong bi huy) cho buoc don dep
        if (await ensureWorldMap(device, cfg)) {
          const stopped = await stopIfRunning(device);
          if (stopped) send({ type: 'log', entry: { level: 'INFO', scope: `worker:${serial}`, line: '[stop] Da dung Auto Hunt trong game.' } });
        }
      }
    } catch (e) { /* ignore loi don dep */ }
  }

  await terminate().catch(() => {}); // dong OCR worker cua process nay
  setTimeout(() => process.exit(0), 300);
}

process.on('message', (msg) => {
  if (msg === 'stop' || (msg && msg.type === 'stop')) shutdown({ cleanup: !!(msg && msg.cleanup) });
});
process.on('SIGTERM', shutdown);

(async () => {
  try {
    await device.refreshSize(); // doc lai kich thuoc + detect vung game khi bat dau
    send({ type: 'status', troopStatus: {}, lastQueue: null });
    await worker.start();
  } catch (e) {
    send({ type: 'log', entry: { level: 'ERROR', scope: `worker:${serial}`, line: `Worker khoi dong loi: ${e.message}` } });
  }
})();
