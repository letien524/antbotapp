'use strict';

// TASK: San da thu — dung tinh nang AUTO HUNT WILD CREATURES cua game.
// Config: cfg.hunt = { enabled, types: [ {enabled, level} x5 ] }  (5 loai: meat, plants,
//   wet soil, sand, honeydew). Bot xoay vong qua cac loai da bat, moi lan bat 1 auto hunt.
//
// Luong: check queue -> mo popup con bo -> neu dang chay thi cho; neu setup thi chon loai
//   ke tiep + level, doc so lan max (Select All), chia deu cho so loai, Start Auto Hunt.
// Auto hunt tu san N lan roi dung -> Worker check lai moi ~2p20s.

const { ensureWorldMap } = require('./common');
const {
  openAutoHunt, closeAutoHunt, ensureSetup, getState,
  selectTarget, setTargetLevel, readTimes, setTimes, startAutoHunt,
} = require('./autohunt');
const { readMarchQueue } = require('../state/StateReader');

async function huntBeast(device, ctx = {}) {
  const log = device.log;
  const cfg = (ctx && ctx.config) || {};
  const h = cfg.hunt || {};
  const types = Array.isArray(h.types) ? h.types : [];
  const enabledIdx = types.map((t, i) => ({ t, i })).filter((x) => x.t && x.t.enabled !== false).map((x) => x.i);

  if (enabledIdx.length === 0) {
    log.info('[huntBeast] chua bat loai nao -> bo qua.');
    return { ok: false, reason: 'no_types' };
  }

  if (!(await ensureWorldMap(device, cfg))) {
    log.warn('[huntBeast] khong o world map -> bo qua luot nay.');
    return { ok: false, reason: 'not_on_world_map' };
  }

  // CHECK QUEUE TRUOC khi mo popup Auto Hunt (thao tac doc thong tin troop).
  // Queue day hoac khong doc duoc -> bo qua ngay, cho luot moi (khong mo popup).
  const q = (ctx && 'queue' in ctx) ? ctx.queue : await readMarchQueue(device, cfg);
  if (q) log.info(`[state] hanh quan ${q.used}/${q.total} (con trong ${q.free})`);
  if (!q || q.free <= 0) {
    log.info('[huntBeast] queue day / chua doc duoc queue -> bo qua, cho luot moi.');
    return { ok: false, reason: 'no_free_troop' };
  }

  // Con o trong -> mo popup Auto Hunt.
  const state = await openAutoHunt(device);
  if (state === 'running') {
    log.info('[huntBeast] Auto Hunt dang chay -> cho luot sau.');
    await closeAutoHunt(device);
    return { ok: false, reason: 'auto_running' };
  }
  // Khong nhan ra setup/running ngay -> luu anh POPUP GOC de chan doan (truoc khi thao tac).
  if (state === 'other') await device.saveDebugShot('autohunt-popup');

  // Dua ve man SETUP (neu ended thi Restart).
  const setup = await ensureSetup(device);
  if (setup === 'running') { await closeAutoHunt(device); return { ok: false, reason: 'auto_running' }; }
  if (setup !== 'setup') {
    log.warn('[huntBeast] KHONG nhan dien duoc man Auto Hunt (template co the khong khop do phan giai may). Da luu anh: ~/.antbot/debug/autohunt-popup-*.png');
    await closeAutoHunt(device);
    return { ok: false, reason: 'no_setup' };
  }

  // Xoay vong sang loai ke tiep. Level CHUNG cho moi loai (game tu cap neu vuot max).
  if (device._ahRot == null) device._ahRot = -1;
  device._ahRot = (device._ahRot + 1) % enabledIdx.length;
  const typeIdx = enabledIdx[device._ahRot];
  const level = h.level || 1;

  // Doc so lan max (Select All), chia deu cho so loai (lam tron len).
  const maxTimes = await readTimes(device);
  const perType = maxTimes ? Math.max(1, Math.ceil(maxTimes / enabledIdx.length)) : 1;

  // Chon target + level + so lan.
  await selectTarget(device, typeIdx);
  await setTargetLevel(device, level);
  await setTimes(device, perType);
  await startAutoHunt(device);

  // Xac nhan da chay.
  const after = await getState(device);
  await closeAutoHunt(device);
  if (after === 'running') {
    log.info(`[huntBeast] Da bat Auto Hunt: loai ${typeIdx + 1} lv${level}, ${perType} lan (max ${maxTimes}, ${enabledIdx.length} loai).`);
    return { ok: true, started: true };
  }
  log.warn('[huntBeast] Bat Auto Hunt nhung khong xac nhan duoc trang thai running.');
  return { ok: false, reason: 'start_unconfirmed' };
}

module.exports = { huntBeast };
