'use strict';

// TASK: Thu thap tai nguyen — cau hinh THEO TUNG TROOP.
// Moi troop 1 dong: loai tai nguyen + level rieng. Troop nao gather loai do.
//
// Luong:
//  1) CHECK QUEUE truoc: con o trong khong. Full/khong doc duoc -> bo qua, cho luot moi.
//  2) Lap qua tung troop DA BAT: search dung loai+level cua troop do (carousel thong minh
//     + game cache) -> Gather -> chon DUNG troop do -> neu RANH thi march, BAN thi bo qua.
//
// Config: cfg.gather = { enabled, troops: [ {type, level, enabled} x4 ] }  (index = troop)

const { ensureWorldMap, searchTarget, deployMarchTroop, recover } = require('./common');
const { levelToClicks } = require('../config');
const { readMarchQueue } = require('../state/StateReader');

async function collectResources(device, ctx = {}) {
  const log = device.log;
  const cfg = (ctx && ctx.config) || {};
  const g = cfg.gather || {};
  const rows = Array.isArray(g.troops) ? g.troops : [];
  // Cac troop DA BAT gather (kem chi so troop that de chon dung troop tren man March).
  const enabled = rows.map((r, i) => ({ r, i })).filter((x) => x.r && x.r.enabled !== false);

  if (enabled.length === 0) {
    log.info('[collectResources] chua bat troop nao gather -> bo qua.');
    return { ok: false, reason: 'no_troops' };
  }

  if (!(await ensureWorldMap(device, cfg))) {
    log.warn('[collectResources] khong o world map -> bo qua luot nay.');
    return { ok: false, reason: 'not_on_world_map' };
  }

  // 1) CHECK QUEUE truoc khi doc thong tin troop. Full/khong doc duoc -> bo qua.
  const q = (ctx && 'queue' in ctx) ? ctx.queue : await readMarchQueue(device, cfg);
  if (!q || q.free <= 0) {
    log.info('[collectResources] queue day / chua doc duoc queue -> bo qua, cho luot moi.');
    return { ok: false, reason: 'no_free_troop' };
  }
  log.info(`[state] hanh quan ${q.used}/${q.total} (con trong ${q.free})`);
  const freeSlots = q.free;

  // 2) Lap qua tung troop da bat: gather loai cua troop do bang DUNG troop do.
  let sent = 0;
  for (const { r, i } of enabled) {
    if (sent >= freeSlots) break; // da dung het o trong (cac troop con lai dang ban)
    const troopIdx = i;
    const type = Number.isInteger(r.type) ? r.type : 0;
    const level = r.level || 1;

    // Search dung loai+level cua troop nay (carousel thong minh + game cache).
    const gather = await searchTarget(device, cfg, {
      tab: 'resource',
      type,
      level,
      plusClicks: levelToClicks('gather', type, level),
      actionTemplate: 'btn_gather',
      retries: 4,
    });
    if (!gather) {
      log.warn(`[collectResources] Doi ${troopIdx + 1} (loai ${type + 1} lv${level}): khong tim duoc o ranh -> bo qua.`);
      await recover(device, 2);
      continue;
    }
    await device.tap(gather.x, gather.y);
    await device.sleep(800);

    // March bang DUNG troop nay. Neu troop dang ban -> bo qua (khong march nham troop khac).
    const marched = await deployMarchTroop(device, cfg, troopIdx);
    if (marched) {
      if (ctx.report) ctx.report(troopIdx, { task: 'gather', type, level });
      sent += 1;
      log.info(`[collectResources] Doi ${troopIdx + 1} di gather loai ${type + 1} lv${level}.`);
    } else {
      await recover(device, 2); // troop ban -> thoat man March, thu troop khac
    }
  }

  log.info(`[collectResources] xong — ${sent} troop di gather.`);
  return { ok: sent > 0, sent };
}

module.exports = { collectResources };
