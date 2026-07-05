'use strict';

// TASK: Thu thap tai nguyen — cau hinh THEO TUNG DOI (troop).
// Moi doi co 1 dong: loai tai nguyen + level rieng. Lap qua tung doi:
//   mo Search -> chon loai+level cua doi -> Go -> Gather -> chon dung doi do -> March.
// Doi nao dang ban (nut March xam) thi bo qua. Khong co "so luong toi da".
//
// Config: cfg.gather = { enabled, troops: [ {type, level, enabled}, ... ] }  (index = doi)

const {
  ensureWorldMap, searchTarget, deployMarch, recover,
} = require('./common');
const { levelToClicks } = require('../config');
const { readMarchQueue } = require('../state/StateReader');

async function collectResources(device, ctx = {}) {
  const log = device.log;
  const cfg = (ctx && ctx.config) || {};
  const g = cfg.gather || {};
  const rows = Array.isArray(g.troops) ? g.troops : [];

  const active = rows.filter((r) => r && r.enabled !== false).length;
  log.info(`[collectResources] bat dau — ${active} doi bat thu thap.`);

  if (!(await ensureWorldMap(device, cfg))) {
    log.warn('[collectResources] khong o world map -> bo qua luot nay.');
    return { ok: false, reason: 'not_on_world_map' };
  }

  // Het o hanh quan -> khong lam gi. Uu tien queue Worker da doc san (tranh doc lai).
  const q = (ctx && 'queue' in ctx) ? ctx.queue : await readMarchQueue(device, cfg);
  let freeSlots = rows.length;
  // So troop thuc te cua may = tong o hanh quan (X/Y -> Y). Chi lay config cua tung ay doi.
  let troopCount = rows.length;
  if (q) {
    log.info(`[state] hanh quan ${q.used}/${q.total} (con trong ${q.free})`);
    if (q.free <= 0) {
      log.info('[collectResources] tat ca doi dang ban -> bo qua luot nay.');
      return { ok: false, reason: 'no_free_troop' };
    }
    freeSlots = q.free;
    if (q.total) troopCount = Math.min(rows.length, q.total);
  }

  let sent = 0;
  for (let troopIdx = 0; troopIdx < troopCount; troopIdx += 1) {
    if (sent >= freeSlots) break; // da dung het o trong
    const row = rows[troopIdx];
    if (!row || row.enabled === false) continue;

    // 1) Tim o tai nguyen RANH (dung cache game; bo qua o bi nguoi khac khai thac -> tim cai khac).
    const gather = await searchTarget(device, cfg, {
      tab: 'resource',
      type: row.type,
      level: row.level,
      plusClicks: levelToClicks('gather', row.type, row.level),
      actionTemplate: 'btn_gather',
      retries: 4,
    });
    if (!gather) {
      log.warn(`[collectResources] Doi ${troopIdx + 1}: khong tim duoc o ranh (het / bi chiem). Bo qua.`);
      await recover(device, 2);
      continue;
    }
    await device.tap(gather.x, gather.y);
    await device.sleep(800);

    // 2) March bang troop game da focus (troop ranh).
    const marched = await deployMarch(device, cfg);
    if (marched) {
      sent += 1;
      if (ctx.report) ctx.report(troopIdx, { task: 'gather', type: row.type, level: row.level });
      log.info(`[collectResources] Doi ${troopIdx + 1} da di thu tai nguyen.`);
    } else {
      log.info(`[collectResources] Doi ${troopIdx + 1} dang ban -> bo qua.`);
      await recover(device, 2);
    }
  }

  log.info(`[collectResources] xong — ${sent} doi di thu thap.`);
  return { ok: sent > 0, sent };
}

module.exports = { collectResources };
