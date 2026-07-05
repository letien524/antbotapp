'use strict';

// TASK: Thu thap tai nguyen — cau hinh THEO TUNG LOAI tai nguyen (khong per-troop).
// Thu tu carousel: meat, plants, wet soil, sand, diamond. Moi loai: active + level.
//
// Luong:
//  1) Check queue -> con o trong bao nhieu.
//  2) Voi moi o trong: gan 1 loai tai nguyen (xoay vong qua cac loai ACTIVE, bo qua loai tat).
//  3) Search loai do (carousel THONG MINH: nho vi tri, di chuyen so buoc toi thieu; game
//     nho loai+level nen lan sau chi can di delta) -> Gather -> March troop ranh (auto-focus).
//
// Config: cfg.gather = { enabled, types: [ {active, level} x5 ] }  (index = vi tri carousel)

const { ensureWorldMap, searchTarget, deployMarch, recover } = require('./common');
const { levelToClicks } = require('../config');
const { readMarchQueue } = require('../state/StateReader');

async function collectResources(device, ctx = {}) {
  const log = device.log;
  const cfg = (ctx && ctx.config) || {};
  const g = cfg.gather || {};
  const types = Array.isArray(g.types) ? g.types : [];
  // Cac loai ACTIVE theo thu tu carousel (meat -> diamond).
  const activeIdx = types.map((t, i) => ({ t, i })).filter((x) => x.t && x.t.active !== false).map((x) => x.i);

  if (activeIdx.length === 0) {
    log.info('[collectResources] chua bat loai tai nguyen nao -> bo qua.');
    return { ok: false, reason: 'no_types' };
  }

  if (!(await ensureWorldMap(device, cfg))) {
    log.warn('[collectResources] khong o world map -> bo qua luot nay.');
    return { ok: false, reason: 'not_on_world_map' };
  }

  // 1) Check queue: con o trong khong.
  const q = (ctx && 'queue' in ctx) ? ctx.queue : await readMarchQueue(device, cfg);
  let freeSlots = activeIdx.length;
  if (q) {
    log.info(`[state] hanh quan ${q.used}/${q.total} (con trong ${q.free})`);
    if (q.free <= 0) {
      log.info('[collectResources] het o hanh quan -> bo qua luot nay.');
      return { ok: false, reason: 'no_free_troop' };
    }
    freeSlots = q.free;
  }

  // 2) Voi moi o trong: gan loai ke tiep (xoay vong qua cac loai active) roi di gather.
  let sent = 0;
  for (let k = 0; k < freeSlots; k += 1) {
    if (device._gatherRot == null) device._gatherRot = -1;
    device._gatherRot = (device._gatherRot + 1) % activeIdx.length;
    const typeIdx = activeIdx[device._gatherRot];
    const level = types[typeIdx].level || 1;

    // 3) Search loai nay (carousel thong minh + game cache); bo qua o bi nguoi khac khai thac.
    const gather = await searchTarget(device, cfg, {
      tab: 'resource',
      type: typeIdx,
      level,
      plusClicks: levelToClicks('gather', typeIdx, level),
      actionTemplate: 'btn_gather',
      retries: 4,
    });
    if (!gather) {
      log.warn(`[collectResources] loai ${typeIdx + 1} lv${level}: khong tim duoc o ranh -> bo qua.`);
      await recover(device, 2);
      continue;
    }
    await device.tap(gather.x, gather.y);
    await device.sleep(800);

    // March bang troop game da focus (troop ranh).
    const marched = await deployMarch(device, cfg);
    if (marched) {
      if (ctx.report) ctx.report(sent, { task: 'gather', type: typeIdx, level });
      sent += 1;
      log.info(`[collectResources] da gui gather loai ${typeIdx + 1} lv${level}.`);
    } else {
      log.info('[collectResources] khong con troop ranh -> dung.');
      await recover(device, 2);
      break;
    }
  }

  log.info(`[collectResources] xong — ${sent} troop di gather.`);
  return { ok: sent > 0, sent };
}

module.exports = { collectResources };
