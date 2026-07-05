'use strict';

// TASK: San da thu — cau hinh THEO TUNG DOI (troop).
// Moi doi co 1 dong: loai da thu + level rieng. Lap qua tung doi:
//   mo Search -> tab Da thu -> chon loai+level cua doi -> Go -> tap con -> Attack
//   -> doc THE LUC dung doi do (thap thi bo qua) -> chon dung doi -> March.
//
// Config: cfg.hunt = { enabled, minStamina, troops: [ {type, level, enabled}, ... ] }

const {
  ensureWorldMap, searchTarget, deployMarch, recover, hasBlocker,
} = require('./common');
const { levelToClicks } = require('../config');
const { readMarchQueue, readTroopStamina } = require('../state/StateReader');

async function huntBeast(device, ctx = {}) {
  const log = device.log;
  const cfg = (ctx && ctx.config) || {};
  const h = cfg.hunt || {};
  const rows = Array.isArray(h.troops) ? h.troops : [];
  const minStamina = h.minStamina != null ? h.minStamina : 10;

  const active = rows.filter((r) => r && r.enabled !== false).length;
  log.info(`[huntBeast] bat dau — ${active} doi bat san, minStamina=${minStamina}.`);

  if (!(await ensureWorldMap(device, cfg))) {
    log.warn('[huntBeast] khong o world map -> bo qua luot nay.');
    return { ok: false, reason: 'not_on_world_map' };
  }

  // Uu tien queue Worker da doc san (tranh doc lai).
  const q = (ctx && 'queue' in ctx) ? ctx.queue : await readMarchQueue(device, cfg);
  let freeSlots = rows.length;
  let troopCount = rows.length; // so troop thuc te = tong o hanh quan (Y)
  if (q) {
    log.info(`[state] hanh quan ${q.used}/${q.total} (con trong ${q.free})`);
    if (q.free <= 0) {
      log.info('[huntBeast] tat ca doi dang ban -> bo qua luot nay.');
      return { ok: false, reason: 'no_free_troop' };
    }
    freeSlots = q.free;
    if (q.total) troopCount = Math.min(rows.length, q.total);
  }

  let hunted = 0;
  let staminaBlocked = false; // co doi bi bo qua vi the luc thap
  for (let troopIdx = 0; troopIdx < troopCount; troopIdx += 1) {
    if (hunted >= freeSlots) break;
    const row = rows[troopIdx];
    if (!row || row.enabled === false) continue;

    // 1) Tim con da thu RANH (dung cache game; bo qua con nguoi khac dang danh -> tim con khac).
    const attack = await searchTarget(device, cfg, {
      tab: 'wild',
      type: row.type,
      level: row.level,
      plusClicks: levelToClicks('hunt', row.type, row.level),
      actionTemplate: 'btn_hunt',
      retries: 4,
    });
    if (!attack) {
      log.warn(`[huntBeast] Doi ${troopIdx + 1}: khong tim duoc con ranh (het / bi chiem). Bo qua.`);
      await recover(device, 2);
      continue;
    }
    await device.tap(attack.x, attack.y);
    await device.sleep(800); // -> man March Troops

    // 2) Doc THE LUC: troop khoe nhat < nguong -> nghi (het the luc).
    const st = await readTroopStamina(device, cfg);
    if (st && st.best != null) {
      log.info(`[state] the luc troop cao nhat ${st.best}/100`);
      if (st.best < minStamina) {
        log.info(`[huntBeast] the luc cao nhat ${st.best} < ${minStamina} -> nghi san.`);
        staminaBlocked = true;
        await recover(device, 3);
        continue;
      }
    }
    if (await hasBlocker(device, 'popup_no_stamina')) {
      log.info('[huntBeast] het the luc -> nghi san.');
      staminaBlocked = true;
      await recover(device, 3);
      continue;
    }

    // 3) March bang troop game da focus (troop ranh).
    const marched = await deployMarch(device, cfg);
    if (marched) {
      hunted += 1;
      if (ctx.report) ctx.report(troopIdx, { task: 'hunt', type: row.type, level: row.level });
      log.info(`[huntBeast] Doi ${troopIdx + 1} da di san da thu.`);
    } else {
      log.info(`[huntBeast] Doi ${troopIdx + 1} dang ban -> bo qua.`);
      await recover(device, 2);
    }
  }

  // Neu khong san duoc con nao VI THE LUC THAP -> bao Worker cho hoi the luc.
  const reason = (hunted === 0 && staminaBlocked) ? 'low_stamina' : undefined;
  log.info(`[huntBeast] xong — ${hunted} doi di san${reason ? ' (het the luc, can nghi hoi)' : ''}.`);
  return { ok: hunted > 0, hunted, reason };
}

module.exports = { huntBeast };
