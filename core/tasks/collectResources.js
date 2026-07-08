'use strict';

// TASK: Thu thap tai nguyen — cau hinh THEO TUNG TROOP.
// Moi troop 1 dong: loai tai nguyen + level rieng. Troop nao gather loai do.
//
// Luong (dung spec): CHECK QUEUE ranh -> CHECK TROOP ranh -> CHECK troop da setup -> quyet dinh.
//  1) CHECK QUEUE truoc: con o trong khong. Full/khong doc duoc -> bo qua, cho luot moi.
//  2) DOC TRUOC trang thai troop: mo man March Troops truc tiep, doc tung troop ranh/ban
//     (troop ban hien dong ho "Gathering/Marching"). Doc duoc -> Doi BAN bi bo qua NGAY (khong
//     ton cong tim tai nguyen). Khong doc duoc -> FALLBACK: kiem tra ranh o buoc march (nut vang).
//  3) Voi moi troop DA BAT + RANH: search dung loai (carousel nho vi tri) + level (game cache,
//     bo qua set neu da dung) -> Gather -> chon DUNG troop do -> RANH thi march, BAN thi bo qua.
//
// Config: cfg.gather = { enabled, commonLevel, troops: [ {type, level, enabled} x4 ] } (index=troop)

const {
  ensureWorldMap, searchGatherGo, deployGatherFixed, searchTarget, deployMarchTroop,
  deployMarchVerified, recover, readTroopStatuses,
} = require('./common');
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

  // 2) DOC TRUOC trang thai tung troop (mo March Troops truc tiep). null => fallback luong cu
  //    (van an toan vi buoc march con kiem tra nut vang cho tung troop).
  const statuses = await readTroopStatuses(device, cfg);
  // Trang thai BAN tung doi (tu buoc doc tren), CAP NHAT khi march thanh cong trong luot nay.
  // Khi mo man March Troops, game TU CHON doi RANH dau tien tu tren xuong -> ta doan duoc doi do
  // de biet co can tap chon khong (neu doi can dung la doi game chon san thi bo qua buoc chon).
  const liveBusy = statuses ? statuses.map((s) => !!s.busy) : [];
  const firstFreeIdx = () => {
    for (let k = 0; k < liveBusy.length; k += 1) if (liveBusy[k] === false) return k;
    return -1;
  };

  // 3) Lap qua tung troop da bat: BAN thi bo qua som; RANH thi gather bang DUNG troop do.
  let sent = 0;
  for (const { r, i } of enabled) {
    if (sent >= freeSlots) break; // da dung het o trong (cac troop con lai dang ban)
    const troopIdx = i;
    const type = Number.isInteger(r.type) ? r.type : 0;
    const level = r.level || 1;

    // Trang thai doc truoc: known = co du lieu troop nay; knownIdle = chac chan RANH.
    const known = statuses && troopIdx < statuses.length;
    if (known && statuses[troopIdx].busy) {
      log.info(`[collectResources] Doi ${troopIdx + 1} dang BAN (doc truoc) -> bo qua, khong tim tai nguyen.`);
      continue;
    }
    const plusClicks = levelToClicks('gather', type, level);

    // Doi duoc BAT nhung NAM NGOAI so doi doc truoc (vd Doi 3/4 tren may nhieu doi). Gather bang
    // doi GAME TU CHON (auto-focus doi ranh dau tien) + XAC MINH TEN doi focus == doi can:
    //   - Doc duoc ten & khop -> march (dung doi, dung loai).
    //   - Doc duoc ten & khac -> bo qua, cho luot sau (khong march nham doi).
    //   - Doi 4 co the NGOAI man (khong doc duoc ten): chi tin auto-focus khi cac doi doc duoc
    //     (1,2) DEU BAN (luc do doi game tu chon chac chan la doi can) + nut March vang.
    if (statuses && !known) {
      const lowerAllBusy = liveBusy.length > 0 && liveBusy.every((b) => b === true);
      const gather = await searchTarget(device, cfg, {
        tab: 'resource', type, level, plusClicks, actionTemplate: 'btn_gather', retries: 4,
      });
      if (!gather) {
        log.warn(`[collectResources] Doi ${troopIdx + 1} (loai ${type + 1} lv${level}): khong tim duoc o ranh -> bo qua.`);
        await recover(device, 2);
        continue;
      }
      await device.tap(gather.x, gather.y);
      await device.sleep(450);
      const res = await deployMarchVerified(device, cfg, troopIdx, { trustIfUnread: lowerAllBusy });
      if (res.marched) {
        if (ctx.report) ctx.report(troopIdx, { task: 'gather', type, level });
        sent += 1;
        log.info(`[collectResources] Doi ${troopIdx + 1} di gather loai ${type + 1} lv${level} (xac minh ten doi focus).`);
        // Doi CUOI (Troop III) da march -> khong con doi ngoai vung de xu ly, dung som.
        if (troopIdx >= rows.length - 1 || res.focusedIdx >= rows.length - 1) break;
      } else {
        log.info(`[collectResources] Doi ${troopIdx + 1}: ${res.reason} -> dong man deploy, cho luot sau.`);
        await recover(device, 1); // 1 BACK: dong deploy ve world map (KHONG march, tranh Exit dialog)
      }
      continue;
    }
    const knownIdle = known && !statuses[troopIdx].busy;

    if (knownIdle) {
      // Game tu chon san doi RANH dau tien tu tren xuong. Neu do DUNG la doi can (troopIdx)
      // -> bo qua buoc chon troop, March luon. Neu con doi r, ranh o tren -> van chon dung doi.
      const skipSelect = firstFreeIdx() === troopIdx;
      // NHANH: da chac troop RANH -> Search+Go roi CHI TAP TOA DO CO DINH (khong phan tich hinh).
      const ok = await searchGatherGo(device, cfg, { type, level, plusClicks });
      if (!ok) {
        log.warn(`[collectResources] Doi ${troopIdx + 1} (loai ${type + 1} lv${level}): khong mo duoc Search -> bo qua.`);
        await recover(device, 2);
        continue;
      }
      // tam -> (1 lan chup xac nhan Gather) -> [chon troop neu can] -> March. false = khong co tai nguyen.
      const deployed = await deployGatherFixed(device, cfg, troopIdx, { skipSelect });
      if (deployed) {
        if (troopIdx < liveBusy.length) liveBusy[troopIdx] = true; // doi nay gio dang ban (da march)
        if (ctx.report) ctx.report(troopIdx, { task: 'gather', type, level });
        sent += 1;
        log.info(`[collectResources] Doi ${troopIdx + 1} di gather loai ${type + 1} lv${level} (tap toa do co dinh).`);
      } else {
        log.info(`[collectResources] Doi ${troopIdx + 1}: khong tim thay ${type + 1} lv${level} gan to -> thu lai luot sau.`);
      }
    } else {
      // CHUA BIET troop ranh/ban (khong doc duoc overview / troop ngoai vung doc) -> LUONG XAC MINH
      // HINH an toan: doc card Gather + kiem nut March vang, bo qua neu troop ban.
      const gather = await searchTarget(device, cfg, {
        tab: 'resource', type, level, plusClicks, actionTemplate: 'btn_gather', retries: 4,
      });
      if (!gather) {
        log.warn(`[collectResources] Doi ${troopIdx + 1} (loai ${type + 1} lv${level}): khong tim duoc o ranh -> bo qua.`);
        await recover(device, 2);
        continue;
      }
      await device.tap(gather.x, gather.y);
      await device.sleep(400);
      const marched = await deployMarchTroop(device, cfg, troopIdx);
      if (marched) {
        if (ctx.report) ctx.report(troopIdx, { task: 'gather', type, level });
        sent += 1;
        log.info(`[collectResources] Doi ${troopIdx + 1} di gather loai ${type + 1} lv${level}.`);
      } else {
        await recover(device, 2);
      }
    }
  }

  log.info(`[collectResources] xong — ${sent} troop di gather.`);
  return { ok: sent > 0, sent };
}

module.exports = { collectResources };
