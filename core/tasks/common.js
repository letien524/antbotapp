'use strict';

// Cac buoc dung chung cho ca 2 task (thu tai nguyen + san da thu).
// Panel Search cua The Ant dung TOA DO CO DINH (cac nut khong doi cho) -> tap theo %
// on dinh hon template. Chi cac "card" dong (Gather/Hunt/March sau khi Go) moi dung template.
//
// Tat ca toa do la ti le % man hinh, do tu anh 540x960. Co the ghi de qua config.world.

const { tapTemplate, waitFor, locate } = require('../vision/screen');
const { isMarchEnabled, readMarchQueue, readTroopBusy } = require('../state/StateReader');
const { getCachedLevel, setCachedLevel } = require('../state/levelCache');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Toa do mac dinh cac nut CO DINH tren world map + panel Search.
const WORLD = {
  queueIcon: [0.068, 0.158],   // icon hanh quan (kiem cheo 'X/Y') goc trai tren -> mo March Troops
  searchBtn: [0.067, 0.656],   // kinh lup goc trai duoi -> mo panel Search
  tabWild: [0.170, 0.953],     // tab Da thu (beetle)
  tabResource: [0.500, 0.953], // tab Tai nguyen (la)
  levelMinus: [0.078, 0.859],  // nut - giam level
  levelPlus: [0.667, 0.859],   // nut + tang level
  goBtn: [0.845, 0.859],       // nut Go (tim & bay toi muc tieu)
  slots: [                      // vi tri cac o chon loai (tai nguyen / da thu) trong panel
    [0.500, 0.719],             //   o thu 1
    [0.843, 0.719],             //   o thu 2
    [0.270, 0.719],             //   o thu 3 (neu co, uoc luong)
  ],
  center: [0.5, 0.5],           // tam ban do — muc tieu nam giua sau khi Go (da verify)
  cardAction: [0.5, 0.667],     // nut Attack/Gather tren card (da verify)
  marchBtn: [0.733, 0.945],     // nut March tren man March Troops (da verify)
  // Cac diem thu tap muc tieu sau Go (da thu/o tai nguyen hay lech nhe so voi tam).
  // Thu lan luot cho toi khi mo duoc card. Diem dau = tam; sau do le trai/tren theo
  // quan sat thuc te (da thu thuong o ~47%,51%).
  targetTaps: [
    [0.50, 0.50],
    [0.47, 0.51],
    [0.50, 0.46],
    [0.53, 0.52],
    [0.45, 0.47],
  ],
  // Vi tri chon tung DOI (troop row) tren man March Troops. Toi da 4 doi.
  // Doi 1,2 da verify. Doi 3,4 uoc luong theo khoang cach hang (~0.24) — can verify khi
  // tai khoan mo khoa doi 3-4 (co the phai cuon man March). Ghi de qua config.world.troopRows.
  troopRows: [
    [0.30, 0.34],   // Doi 1 (Pro Troop) — tap header card de chon (da verify)
    [0.30, 0.58],   // Doi 2 (Troop I) — da verify
    [0.30, 0.80],   // Doi 3 (uoc luong)
    [0.30, 0.80],   // Doi 4 (uoc luong - co the can cuon man)
  ],
};

function coords(cfg, key) {
  const w = (cfg && cfg.world) || {};
  return w[key] || WORLD[key];
}

// Co dang o WORLD MAP khong? Neo: thay kinh lup (world_search_icon).
async function isOnWorldMap(device) {
  const anchor = await locate(device, 'world_search_icon', { threshold: 0.8 });
  return !!anchor;
}

// Co dang mo panel Search khong? Neo: thay nut Go (nguong 0.8 de tranh khop nham man March).
async function isSearchPanelOpen(device) {
  const go = await locate(device, 'panel_go', { threshold: 0.8 });
  return !!go;
}

// Dam bao dang o WORLD MAP. Xu ly 2 truong hop khi CHUA o world map:
//  - Dang trong TO (base): thay nut "len World" (mui ten len, goc phai duoi) -> tap no.
//  - Co overlay/popup che ban do: BACK de dong.
async function ensureWorldMap(device, cfg = {}, { maxTries = 6 } = {}) {
  for (let i = 0; i < maxTries; i += 1) {
    if (await isOnWorldMap(device)) return true;
    // Dang trong to? nut "len World" chi co o base (nguong 0.85 de khong nham nut vao-to o world).
    const toWorld = await locate(device, 'btn_to_world', { threshold: 0.85 });
    if (toWorld) {
      device.log.info('[ensureWorldMap] dang trong to -> tap nut World de ra ban do.');
      await device.tap(toWorld.x, toWorld.y);
      await device.sleep(1300);
      continue;
    }
    // Con lai: overlay/card/popup che ban do -> BACK de dong.
    device.log.info('[ensureWorldMap] co overlay -> BACK de dong.');
    await device.keyevent(4);
    await device.sleep(550);
  }
  const ok = await isOnWorldMap(device);
  if (!ok) device.log.warn('[ensureWorldMap] khong ve duoc world map.');
  return ok;
}

// CONG KIEM TRA QUEUE: dam bao o world map roi doc dem hanh quan (so troop dang di).
// Tra ve { onMap, queue } — queue = {used,total,free} hoac null (doc that bai du da o map).
// Retry OCR vai lan cho chac. Dung TRUOC khi lam task de biet con o trong hay khong.
async function checkQueue(device, cfg = {}) {
  const onMap = await ensureWorldMap(device, cfg);
  if (!onMap) return { onMap: false, queue: null };
  let queue = null;
  for (let attempt = 0; attempt < 3 && !queue; attempt += 1) {
    queue = await readMarchQueue(device, cfg);
    if (!queue) await device.sleep(400);
  }
  return { onMap: true, queue };
}

// Mo panel Search: tap kinh lup roi XAC NHAN panel da mo (nut Go). Neu chua mo,
// thu BACK 1 lan roi tap lai. Tra ve false neu van khong mo -> task se dung, khong tap mu.
async function openSearch(device, cfg = {}) {
  const [x, y] = coords(cfg, 'searchBtn');
  for (let attempt = 0; attempt < 2; attempt += 1) {
    await device.tapPct(x, y);
    await device.sleep(420);
    if (await isSearchPanelOpen(device)) return true;
    device.log.warn('[openSearch] panel Search chua mo -> BACK va thu lai.');
    await device.keyevent(4);
    await device.sleep(350);
  }
  return false;
}

// Chon tab: 'wild' | 'resource'.
async function selectTab(device, cfg, which) {
  const [x, y] = coords(cfg, which === 'resource' ? 'tabResource' : 'tabWild');
  await device.tapPct(x, y);
  await device.sleep(300);
}

// Carousel loai (o SEARCH): 3 item, item GIUA = dang chon.
//  - next (index tang): vuot PHAI->TRAI.  - prev (index giam): vuot TRAI->PHAI.
// THONG MINH: biet vi tri hien tai `cur` -> di chuyen bang SO BUOC TOI THIEU (delta).
// `cur == null` (chua biet) -> reset ve 0 (vuot trai->phai nhieu lan) roi coi la 0.
// Tra ve vi tri moi (= index) de ben goi cap nhat bo nho.
async function selectSlot(device, cfg, index = 0, cur = null) {
  const y = 0.719;
  let pos = cur;
  if (pos == null) {
    // Chua biet -> reset ve dau danh sach.
    for (let i = 0; i < 6; i += 1) { await device.swipePct(0.2, y, 0.85, y, 200); await device.sleep(110); }
    await device.sleep(90);
    pos = 0;
  }
  const delta = index - pos;
  if (delta > 0) {
    for (let i = 0; i < delta; i += 1) { await device.swipePct(0.68, y, 0.337, y, 200); await device.sleep(180); } // next
  } else if (delta < 0) {
    for (let i = 0; i < -delta; i += 1) { await device.swipePct(0.337, y, 0.68, y, 200); await device.sleep(180); } // prev
  }
  await device.sleep(80);
  await device.tapPct(0.5, y); // tap giua de chon
  await device.sleep(160);
  return index;
}

// Chinh level: ha ve MIN bang cach bam '-' du nhieu (16 lan phu het 15 muc / 7 muc lizard),
// roi bam '+' `plusClicks` lan. Bam nhanh (sleep 45/60ms) — nhanh nhung van chinh xac.
async function setLevel(device, cfg, plusClicks = 0) {
  const clicks = Math.max(0, parseInt(plusClicks, 10) || 0);
  const [mx, my] = coords(cfg, 'levelMinus');
  const [px, py] = coords(cfg, 'levelPlus');
  await device.tapRepeat(mx, my, 16); // ve min — 1 lenh adb thay vi 16 lan spawn
  await device.tapRepeat(px, py, clicks);
}

// Bam Go -> ban do bay toi muc tieu gan nhat.
async function pressGo(device, cfg) {
  const [x, y] = coords(cfg, 'goBtn');
  await device.tapPct(x, y);
  await device.sleep(700); // cho ban do di chuyen
}

// Sau khi Go, tap muc tieu (da thu / o tai nguyen) gan tam de mo card, roi tim nut
// hanh dong (Attack/Gather). Muc tieu co the lech nhe -> thu vai diem quanh tam cho toi
// khi mo duoc card. CHI tra ve hit khi THAT SU thay nut -> khong bao gio tap mu.
async function openTargetCard(device, cfg, actionTemplate, { threshold = 0.7 } = {}) {
  // Truong hop Go da mo card san.
  let hit = await locate(device, actionTemplate, { threshold });
  if (hit) return hit;

  const taps = coords(cfg, 'targetTaps') || WORLD.targetTaps;
  for (const [cx, cy] of taps) {
    await device.tapPct(cx, cy);
    await device.sleep(320);
    hit = await locate(device, actionTemplate, { threshold });
    if (hit) return hit;
  }
  return null;
}

// Tim & mo card 1 muc tieu RANH. Tan dung GAME DA CACHE lua chon (theo tab):
//  - Loai khac lan truoc  -> chon lai o (carousel) + set level.
//  - Cung loai, khac level -> chi set lai level.
//  - Cung loai + cung level -> chi Search + chon tab + Go (khong chon lai gi).
// Neu muc tieu bi CHIEM (khong co nut hanh dong) -> Go lai tim doi tuong khac (game cycle).
async function searchTarget(device, cfg, opts) {
  const { tab, type, level, plusClicks, actionTemplate, threshold = 0.7, retries = 4 } = opts;
  if (!device._lastSearch) device._lastSearch = {};
  for (let i = 0; i <= retries; i += 1) {
    if (!(await openSearch(device, cfg))) return null;
    await selectTab(device, cfg, tab); // luon chon tab (may chay ca hunt lan gather)
    if (i === 0) {
      const last = device._lastSearch[tab];
      // 1) VI TRI carousel: keo toi dung loai bang so buoc toi thieu (nho vi tri lan truoc).
      if (!last || last.type !== type) {
        const curPos = last ? last.type : null;
        await selectSlot(device, cfg, type, curPos);
      }
      // 2) LEVEL: dua vao GAME CACHE (game nho level THEO TUNG LOAI). Ta mirror cache ra DIA
      //    theo serial+loai -> chi set level LAN DAU moi loai (hoac khi user doi level), cac lan
      //    sau BO QUA hoan toan (dung spec: da setup level tu dau, khong set lai).
      const cacheKey = `${tab}_${type}`;
      const cached = getCachedLevel(device.serial, cacheKey);
      if (cached !== level) {
        await setLevel(device, cfg, plusClicks);
        setCachedLevel(device.serial, cacheKey, level);
        device.log.info(`[search] loai ${type + 1}: set level -> lv${level} (luu cache).`);
      } else {
        device.log.info(`[search] loai ${type + 1}: da lv${level} tu cache -> BO QUA set level.`);
      }
      device._lastSearch[tab] = { type, level };
    }
    await pressGo(device, cfg);
    const hit = await openTargetCard(device, cfg, actionTemplate, { threshold });
    if (hit) return hit;
    if (i < retries) {
      device.log.info(`[search] muc tieu bi chiem/khong ranh -> tim doi tuong khac (${i + 1}/${retries}).`);
      await recover(device, 1);
    }
  }
  return null;
}

// GATHER NHANH — chi mo Search + chon loai + Go (KHONG doc card). Tra ve true neu mo duoc panel.
// Dung cho luong tap-toa-do-co-dinh: sau Go, muc tieu nam giua -> deployGatherFixed lo phan con lai.
async function searchGatherGo(device, cfg, { type, level, plusClicks }) {
  if (!device._lastSearch) device._lastSearch = {};
  if (!(await openSearch(device, cfg))) return false;
  await selectTab(device, cfg, 'resource');
  const last = device._lastSearch.resource;
  // Vi tri carousel: keo toi dung loai bang so buoc toi thieu (nho vi tri lan truoc).
  if (!last || last.type !== type) {
    await selectSlot(device, cfg, type, last ? last.type : null);
  }
  // Level qua GAME CACHE: chi set lan dau moi loai (hoac khi user doi level), sau do bo qua.
  const cacheKey = `resource_${type}`;
  if (getCachedLevel(device.serial, cacheKey) !== level) {
    await setLevel(device, cfg, plusClicks);
    setCachedLevel(device.serial, cacheKey, level);
    device.log.info(`[search] loai ${type + 1}: set level -> lv${level} (luu cache).`);
  } else {
    device.log.info(`[search] loai ${type + 1}: da lv${level} tu cache -> BO QUA set level.`);
  }
  device._lastSearch.resource = { type, level };
  await pressGo(device, cfg);
  return true;
}

// Sau khi Go bay toi tai nguyen: tap muc tieu mo card -> CHI 1 LAN CHUP xac nhan nut Gather that
// su hien (bat case "Targets not found"/o bi chiem). Neu co -> tu do CHI TAP TOA DO CO DINH:
// Gather (dung vi tri template tim duoc) -> chon DUNG troop -> March. Doi da duoc loc RANH truoc.
// Tra ve: true = da day quan; false = khong co tai nguyen (bo qua, KHONG tinh la da gui).
//
// skipSelect=true: game da TU CHON san dung doi can (doi RANH dau tien tu tren xuong trung voi
// troopIdx) -> BO QUA buoc selectTroopRow, March luon (khong ton 1 tap thua). Caller (collectResources)
// tinh dieu nay tu trang thai doc truoc, nen van dam bao dung doi -> giu gan loai-theo-doi.
async function deployGatherFixed(device, cfg, troopIdx, { skipSelect = false } = {}) {
  const [cx, cy] = coords(cfg, 'center');
  await device.tapPct(cx, cy);        // tap muc tieu giua man -> mo card tai nguyen
  await device.sleep(450);
  // MOT lan check anh duy nhat: nut Gather co hien khong (card mo & o con trong)?
  const hit = await locate(device, 'btn_gather', { threshold: 0.7 });
  if (!hit) {
    device.log.info('[gather] khong thay nut Gather (targets not found / o bi chiem) -> bo qua.');
    return false;
  }
  await device.tap(hit.x, hit.y);     // nut Gather (vi tri template)
  await device.sleep(650);            // cho man March Troops mo
  if (skipSelect) {
    device.log.info(`[gather] Doi ${troopIdx + 1} dang duoc game chon san (ranh) -> bo qua chon troop, March luon.`);
  } else {
    await selectTroopRow(device, cfg, troopIdx); // chon dung troop (tap co dinh, sleep 400 ben trong)
  }
  const [mx, my] = coords(cfg, 'marchBtn');
  await device.tapPct(mx, my);        // nut March -> day troop ra bai (tap co dinh)
  await device.sleep(650);
  return true;
}

// Mo man March Troops TRUC TIEP tu world map (tap icon hanh quan goc trai tren) de doc
// trang thai ranh/ban tung troop TRUOC khi di tim tai nguyen. Xac nhan da mo bang nut March.
// Tra ve true/false. (Toa do icon co the khac tuy game -> ghi de cfg.world.queueIcon.)
async function openMarchOverview(device, cfg = {}) {
  const [x, y] = coords(cfg, 'queueIcon');
  for (let attempt = 0; attempt < 2; attempt += 1) {
    await device.tapPct(x, y);
    await device.sleep(700);
    if (await locate(device, 'btn_march_deploy', { threshold: 0.7 })) return true;
    device.log.warn('[openMarchOverview] chua thay man March Troops -> thu lai.');
    await device.sleep(400);
  }
  return false;
}

// Doc TRUOC trang thai tung troop tu man March Troops (mo tu world map). Tra ve mang
// [{busy}] theo index troop, hoac null neu khong mo/doc duoc -> caller FALLBACK luong cu.
// Doc xong BACK ve world map de tiep tuc buoc tim tai nguyen.
async function readTroopStatuses(device, cfg = {}) {
  if (!(await openMarchOverview(device, cfg))) {
    device.log.info('[march] khong mo duoc March Troops truc tiep -> fallback luong cu.');
    return null;
  }
  const busy = await readTroopBusy(device, cfg);
  await recover(device, 1); // BACK ve world map
  if (!busy) { device.log.info('[march] doc trang thai troop that bai -> fallback.'); return null; }
  const parts = busy.map((b, i) => `Doi${i + 1}:${b.busy ? 'BAN' : 'ranh'}`);
  device.log.info(`[march] trang thai truoc khi tim tai nguyen -> ${parts.join(' ')}`);
  return busy;
}

// Chon 1 DOI (troop row) tren man March Troops bang cach tap vao hang cua doi do.
async function selectTroopRow(device, cfg, index) {
  const rows = coords(cfg, 'troopRows');
  const pos = rows[index];
  if (!pos) return false;
  await device.tapPct(pos[0], pos[1]);
  await device.sleep(400); // cho nut March cap nhat trang thai/mau
  return true;
}

// Nut March co dang VANG khong; neu thay XAM thi re-check 1 lan (chong race luc chuyen doi).
async function marchGold(device, cfg) {
  if (await isMarchEnabled(device, cfg)) return true;
  await device.sleep(250);
  return isMarchEnabled(device, cfg);
}

// Bam nut March. KHONG locate lai (tiet kiem 1 lan chup): marchGold da xac nhan nut VANG ton tai
// o vung marchBtnRegion -> tap thang toa do co dinh marchBtn (nut o thanh duoi, vi tri co dinh).
async function tapMarch(device, cfg = {}) {
  const [x, y] = coords(cfg, 'marchBtn');
  await device.tapPct(x, y);
  await device.sleep(700);
  return true;
}

// March 1 troop RANH — BO QUA troop dang ban.
// Nut March VANG = troop dang chon RANH; XAM = dang ban (da verify tin cay).
//  1) Game thuong tu focus troop ranh -> neu VANG thi march luon.
//  2) Neu XAM (game focus nham troop ban) -> chon tung troop, chi march troop nao cho VANG.
// Tra ve true neu march duoc, false neu khong con troop ranh.
async function deployMarch(device, cfg = {}) {
  // 1) Troop game da focus co ranh khong?
  if (await marchGold(device, cfg)) {
    if (await tapMarch(device, cfg)) { device.log.info('[deployMarch] march (troop game da focus, ranh).'); return true; }
  }
  // 2) Chon tung troop, chi march troop RANH (nut vang). Troop ban (xam) -> bo qua.
  const rows = coords(cfg, 'troopRows');
  for (let idx = 0; idx < rows.length; idx += 1) {
    await selectTroopRow(device, cfg, idx);
    if (await marchGold(device, cfg)) {
      if (await tapMarch(device, cfg)) { device.log.info(`[deployMarch] march Doi ${idx + 1} (ranh).`); return true; }
    } else {
      device.log.info(`[deployMarch] Doi ${idx + 1} dang ban -> bo qua.`);
    }
  }
  device.log.info('[deployMarch] khong con troop ranh -> khong march.');
  return false;
}

// March doi GAME DA TU CHON (khong chon hang cu the). Dung cho doi 3/4 tren may nhieu doi:
// man March Troops chi hien 2 doi dau, doi 3/4 nam duoi/can cuon nen KHONG dinh vi duoc hang.
// Khi mo March Troops qua Gather, game tu focus troop RANH dau tien -> chi can kiem nut March
// VANG (troop focus dang ranh) roi march. XAM -> khong con doi ranh, bo qua. An toan: KHONG tap
// mu toa do hang, KHONG bao gio march doi dang ban. Caller phai bao dam cac doi tren deu ban
// truoc khi goi (de doi game tu chon chac chan la doi 3+).
async function deployMarchAuto(device, cfg = {}) {
  if (await marchGold(device, cfg)) {
    if (await tapMarch(device, cfg)) { device.log.info('[deployMarch] march doi game tu chon (ranh).'); return true; }
  }
  device.log.info('[deployMarch] doi game tu chon dang ban / khong con doi ranh -> bo qua.');
  return false;
}

// March bang DUNG troop `troopIdx` (dung cho gather per-troop: moi troop gather loai rieng).
// Chon dung troop do -> neu RANH (nut vang) thi march; BAN (xam) -> bo qua, tra ve false.
async function deployMarchTroop(device, cfg, troopIdx) {
  await selectTroopRow(device, cfg, troopIdx);
  if (await marchGold(device, cfg)) {
    if (await tapMarch(device, cfg)) { device.log.info(`[deployMarch] march Doi ${troopIdx + 1} (dung troop cau hinh).`); return true; }
  }
  device.log.info(`[deployMarch] Doi ${troopIdx + 1} dang ban -> bo qua.`);
  return false;
}

// Thoat ve man hinh truoc bang BACK vai lan (recover khi ket luong).
async function recover(device, times = 2) {
  for (let i = 0; i < times; i += 1) {
    await device.keyevent(4);
    await device.sleep(350);
  }
}

// Kiem tra co popup chan (het hanh quan / het the luc) khong.
async function hasBlocker(device, templateName) {
  const hit = await locate(device, templateName, { threshold: 0.75 });
  return !!hit;
}

module.exports = {
  sleep, WORLD, coords,
  ensureWorldMap, checkQueue, openSearch, selectTab, selectSlot, setLevel,
  pressGo, openTargetCard, searchTarget, deployMarch, deployMarchTroop, deployMarchAuto, recover, hasBlocker,
  openMarchOverview, readTroopStatuses, searchGatherGo, deployGatherFixed,
};
