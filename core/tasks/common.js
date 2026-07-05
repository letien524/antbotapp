'use strict';

// Cac buoc dung chung cho ca 2 task (thu tai nguyen + san da thu).
// Panel Search cua The Ant dung TOA DO CO DINH (cac nut khong doi cho) -> tap theo %
// on dinh hon template. Chi cac "card" dong (Gather/Hunt/March sau khi Go) moi dung template.
//
// Tat ca toa do la ti le % man hinh, do tu anh 540x960. Co the ghi de qua config.world.

const { tapTemplate, waitFor, locate } = require('../vision/screen');
const { isMarchEnabled, readMarchQueue } = require('../state/StateReader');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Toa do mac dinh cac nut CO DINH tren world map + panel Search.
const WORLD = {
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
  // Vi tri chon tung DOI (troop row) tren man March Troops. Account nay 2 doi.
  troopRows: [
    [0.20, 0.34],   // Doi 1 (Pro Troop, hang tren)
    [0.20, 0.58],   // Doi 2 (Troop I, hang duoi)
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
      await device.sleep(1700);
      continue;
    }
    // Con lai: overlay/card/popup che ban do -> BACK de dong.
    device.log.info('[ensureWorldMap] co overlay -> BACK de dong.');
    await device.keyevent(4);
    await device.sleep(800);
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
    await device.sleep(1100);
    if (await isSearchPanelOpen(device)) return true;
    device.log.warn('[openSearch] panel Search chua mo -> BACK va thu lai.');
    await device.keyevent(4);
    await device.sleep(700);
  }
  return false;
}

// Chon tab: 'wild' | 'resource'.
async function selectTab(device, cfg, which) {
  const [x, y] = coords(cfg, which === 'resource' ? 'tabResource' : 'tabWild');
  await device.tapPct(x, y);
  await device.sleep(700);
}

// Chon o loai theo chi so (0-based). Dai o loai la CAROUSEL cuon ngang, moi lan chi
// hien ~3 o, o giua duoc chon khi tap. Cach lam (da verify): reset ve dau danh sach
// (vuot trai->phai) -> vuot trai `index` lan de dua o thu `index` vao giua -> tap giua.
async function selectSlot(device, cfg, index = 0) {
  const y = 0.719;
  // 1) Reset ve dau: vuot trai->phai du nhieu de chac chan ve o 0.
  for (let i = 0; i < 6; i += 1) { await device.swipePct(0.2, y, 0.85, y, 320); await device.sleep(320); }
  await device.sleep(350);
  // 2) Vuot trai `index` lan (moi lan tien 1 o).
  for (let i = 0; i < index; i += 1) { await device.swipePct(0.68, y, 0.337, y, 320); await device.sleep(430); }
  await device.sleep(250);
  // 3) Tap o giua de chon.
  await device.tapPct(0.5, y);
  await device.sleep(400);
}

// Chinh level: ha ve MIN (bam '-' du nhieu de chac chan ve day) roi bam '+' `plusClicks` lan.
// `plusClicks` do task tinh san tu config (levelToClicks) — dung cho moi buoc nhay.
async function setLevel(device, cfg, plusClicks = 0) {
  const clicks = Math.max(0, parseInt(plusClicks, 10) || 0);
  const [mx, my] = coords(cfg, 'levelMinus');
  const [px, py] = coords(cfg, 'levelPlus');
  // 20 lan '-' du de ve min tu bat ky muc nao (toi da 15 muc / 7 muc lizard).
  for (let i = 0; i < 20; i += 1) { await device.tapPct(mx, my); await device.sleep(80); }
  for (let i = 0; i < clicks; i += 1) { await device.tapPct(px, py); await device.sleep(110); }
}

// Bam Go -> ban do bay toi muc tieu gan nhat.
async function pressGo(device, cfg) {
  const [x, y] = coords(cfg, 'goBtn');
  await device.tapPct(x, y);
  await device.sleep(1800); // cho ban do di chuyen
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
    await device.sleep(1000);
    hit = await locate(device, actionTemplate, { threshold });
    if (hit) return hit;
  }
  return null;
}

// Chon 1 DOI (troop row) tren man March Troops bang cach tap vao hang cua doi do.
async function selectTroopRow(device, cfg, index) {
  const rows = coords(cfg, 'troopRows');
  const pos = rows[index];
  if (!pos) return false;
  await device.tapPct(pos[0], pos[1]);
  await device.sleep(800); // cho nut March cap nhat trang thai/mau
  return true;
}

// Nut March co dang VANG khong; neu thay XAM thi re-check 1 lan (chong race luc chuyen doi).
async function marchGold(device, cfg) {
  if (await isMarchEnabled(device, cfg)) return true;
  await device.sleep(500);
  return isMarchEnabled(device, cfg);
}

// Bam March bang DUNG doi `troopIdx` (moi doi co nhiem vu rieng nen khong fallback).
// Chon doi -> neu nut March VANG (ranh) thi march; XAM (ban) -> tra ve false.
async function deployMarch(device, cfg = {}, troopIdx = 0) {
  await selectTroopRow(device, cfg, troopIdx);
  if (await marchGold(device, cfg)) {
    const hit = await locate(device, 'btn_march_deploy', { threshold: 0.7 });
    if (hit) {
      await device.tap(hit.x, hit.y);
      await device.sleep(1300);
      device.log.info(`[deployMarch] march bang Doi ${troopIdx + 1}.`);
      return true;
    }
  }
  device.log.info(`[deployMarch] Doi ${troopIdx + 1} dang ban (nut xam) -> khong march.`);
  return false;
}

// Thoat ve man hinh truoc bang BACK vai lan (recover khi ket luong).
async function recover(device, times = 2) {
  for (let i = 0; i < times; i += 1) {
    await device.keyevent(4);
    await device.sleep(500);
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
  pressGo, openTargetCard, deployMarch, recover, hasBlocker,
};
