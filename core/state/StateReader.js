'use strict';

// Doc TRANG THAI game tu HUD de bot ra quyet dinh (khong tap mu roi that bai).
// Hien doc: dem hanh quan "X/Y" (crossed-swords, goc tren trai world map).
//   used  = so trop dang di (dang ban)
//   total = tong so o hanh quan
//   free  = so o con trong -> con gui duoc hay khong.
//
// The luc (stamina) san da thu KHONG hien tren HUD chinh -> xu ly phan ung qua
// popup_no_stamina trong task (khong doc so truc tiep duoc).

const Jimp = require('jimp');
const Tesseract = require('tesseract.js');
const { makeLogger } = require('../logger');

const log = makeLogger('state');

// Vung so 'X/Y' tren world map (ti le %, do tu 540x960) — CAN SAT chu (ben phai icon kiem),
// bo icon + cham do de OCR khong nhieu. Ghi de qua cfg.world.queueRegion.
const QUEUE_REGION = { x: 0.15, y: 0.145, w: 0.092, h: 0.032 };

// Vung stamina 'X/100' cua tung trop tren man March Troops (ti le %, do tu 540x960).
// Moi trop mot vung; account nay co 2 trop (Pro Troop, Troop I). Ghi de qua cfg.world.staminaRegions.
const STAMINA_REGIONS = [
  { x: 0.567, y: 0.371, w: 0.119, h: 0.027 },
  { x: 0.567, y: 0.610, w: 0.119, h: 0.027 },
];

// Vung TIMER hoat dong tren avatar tung trop (man March Troops). Trop BAN hien dong ho
// "00:04:51" (gathering) / "00:00:58" (marching) tren avatar -> co >=4 chu so. Trop RANH ->
// vung trong (0 chu so). Vung NHAM DONG DONG HO (mong) de tranh vanh tron avatar bi doc nham
// thanh chu so. Do tu 540x960; ghi de qua cfg.world.troopBusyRegions.
const TROOP_BUSY_REGIONS = [
  { x: 0.085, y: 0.430, w: 0.25, h: 0.034 }, // Pro Troop
  { x: 0.085, y: 0.668, w: 0.25, h: 0.034 }, // Troop I
];

// Moi may la 1 process rieng -> 1 OCR worker/process la du (khong co canh tranh trong process).
const POOL_SIZE = 1;
let pool = null;
let rr = 0;
async function getWorker() {
  if (!pool) {
    pool = Array.from({ length: POOL_SIZE }, () => (async () => {
      const w = await Tesseract.createWorker('eng');
      await w.setParameters({ tessedit_char_whitelist: '0123456789/', tessedit_pageseg_mode: '7' });
      return w;
    })());
    log.info(`OCR pool ${POOL_SIZE} worker san sang.`);
  }
  rr = (rr + 1) % pool.length;
  return pool[rr]; // round-robin -> spread OCR ra nhieu worker
}

// Doi 1 vung % (theo VUNG GAME) -> [x,y,w,h] pixel tuyet doi tren anh.
function regionPx(region, area) {
  return [
    Math.round(area.x + region.x * area.width),
    Math.round(area.y + region.y * area.height),
    Math.round(region.w * area.width),
    Math.round(region.h * area.height),
  ];
}
// Vung game (bo vien den) theo PIXEL cua anh chup nay. Khong co -> full anh.
function areaOf(device, img) {
  if (device && typeof device.imageArea === 'function') return device.imageArea(img);
  return { x: 0, y: 0, width: img.bitmap.width, height: img.bitmap.height };
}
function fullArea(img) {
  return { x: 0, y: 0, width: img.bitmap.width, height: img.bitmap.height };
}

// Vung nut March (goc phai duoi man March Troops, ti le %, do tu 540x960).
const MARCH_BTN_REGION = { x: 0.546, y: 0.922, w: 0.380, h: 0.050 };

// Worker RIENG cho OCR dong ho hoat dong (whitelist them ':'). Tach khoi worker chinh
// (whitelist '0123456789/') de KHONG lam hong OCR queue 'X/Y'. psm 6 = doc khoi nhieu dong.
let timerWorker = null;
async function getTimerWorker() {
  if (!timerWorker) {
    timerWorker = (async () => {
      const w = await Tesseract.createWorker('eng');
      await w.setParameters({ tessedit_char_whitelist: '0123456789:', tessedit_pageseg_mode: '6' });
      return w;
    })();
  }
  return timerWorker;
}

async function terminate() {
  if (pool) {
    const workers = await Promise.all(pool);
    await Promise.all(workers.map((w) => w.terminate()));
    pool = null;
  }
  if (timerWorker) {
    try { (await timerWorker).terminate(); } catch (e) { /* bo qua */ }
    timerWorker = null;
  }
  if (nameWorkerP) {
    try { (await nameWorkerP).terminate(); } catch (e) { /* bo qua */ }
    nameWorkerP = null;
  }
}

// OCR vung timer: chu SANG tren nen toi -> invert roi thu VAI nguong (chu doi do sang theo
// nen avatar). Lay ket qua NHIEU CHU SO nhat (dong ho hh:mm:ss). Dau ':' hay bi mat nen KHONG
// dua vao ':' de ket luan — dem so chu so moi tin cay (xem parseTimerBusy).
async function ocrTimerRegion(img, region, area) {
  const [x, y, w, h] = regionPx(region, area);
  const base = img.clone().crop(x, y, w, h).scale(6).grayscale().invert();
  const worker = await getTimerWorker();
  let best = '';
  const digitCount = (s) => (String(s).match(/\d/g) || []).length;
  for (const thr of [150, 130, 170]) {
    const buf = await base.clone().threshold({ max: thr }).getBufferAsync(Jimp.MIME_PNG);
    const { data } = await worker.recognize(buf);
    const t = data.text.trim();
    if (digitCount(t) > digitCount(best)) best = t;
    // Da du chu so cua 1 dong ho (>=4) -> chac chan BAN, khong can thu them nguong (early-exit).
    if (digitCount(best) >= 4) break;
  }
  return best;
}

// Trop BAN neu vung timer co du chu so cua 1 dong ho (mm:ss / hh:mm:ss -> >=4 chu so).
// Trop RANH -> vung trong (0 chu so). Dem chu so on dinh hon match ':' (OCR hay rot ':').
function parseTimerBusy(text) {
  return (String(text || '').match(/\d/g) || []).length >= 4;
}

// Doc trang thai BAN/RANH tung trop tu man March Troops. Tra ve mang [{busy,text}] theo
// index trop, hoac null neu chup/OCR that bai (de caller fallback).
async function readTroopBusy(device, cfg = {}) {
  try {
    const regions = (cfg.world && cfg.world.troopBusyRegions) || TROOP_BUSY_REGIONS;
    const img = await device.captureImage();
    const area = areaOf(device, img);
    const out = [];
    for (const r of regions) {
      const text = await ocrTimerRegion(img, r, area);
      out.push({ busy: parseTimerBusy(text), text });
    }
    return out;
  } catch (e) {
    if (e && e.cancelled) throw e; // dung ngay khi bi huy
    device.log.warn(`[state] doc trang thai troop loi: ${e.message}`);
    return null;
  }
}

// ---- DOC DOI DANG FOCUS tren man DEPLOY (sau khi bam Gather) ----
// Game tu focus doi RANH dau tien (tu tren xuong). Doi focus co VIEN VANG quanh card.
// Ta: (1) tim hang co vien vang, (2) OCR ten header hang do -> biet CHINH XAC doi nao.
// Vi tri header tung doi theo game-fraction y (pitch ~0.24). Doi 1,2 da verify tren samsung;
// doi 3,4 ngoai suy. Ghi de qua cfg.world.troopHeaderY.
const TROOP_HEADER_Y = [0.338, 0.578, 0.818, 1.058];
const TROOP_INGAME_NAMES = ['Pro Troop', 'Troop I', 'Troop II', 'Troop III'];

// Worker OCR RIENG cho TEN doi (chu cai, KHONG dung whitelist so cua worker chinh).
let nameWorkerP = null;
async function getNameWorker() {
  if (!nameWorkerP) {
    nameWorkerP = (async () => {
      const w = await Tesseract.createWorker('eng');
      await w.setParameters({
        tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz |',
        tessedit_pageseg_mode: '7', // 1 dong
      });
      return w;
    })();
  }
  return nameWorkerP;
}

// OCR "Pro Troop"/"Troop I|II|III" -> index 0..3. Chuan hoa: 'I','l','|','1' -> 'i' (so La Ma).
// Tra ve -1 neu khong nhan ra (caller se BO QUA an toan, khong march).
function troopNameToIndex(text) {
  const s = String(text || '').toLowerCase();
  if (s.includes('pro')) return 0; // "Pro Troop" -> doi 1
  const norm = s.replace(/[l|!1/]/g, 'i').replace(/[^a-z]/g, ''); // "troop iii" -> "troopiii"
  const m = norm.match(/troop(i+)/);
  if (m) return Math.min(3, m[1].length); // 1->doi2, 2->doi3, 3->doi4
  return -1;
}

// % pixel VANG tren 1 dai ngang quanh vien-top cua card (band de chong lech vai pixel).
function goldBandFrac(img, area, gfy) {
  let best = 0;
  const x0 = Math.round(area.x + 0.06 * area.width);
  const x1 = Math.round(area.x + 0.94 * area.width);
  for (const d of [-0.005, -0.0025, 0, 0.0025, 0.005]) {
    const y = Math.round(area.y + (gfy + d) * area.height);
    if (y < 0 || y >= img.bitmap.height) continue;
    let gold = 0; let n = 0;
    for (let x = x0; x <= x1; x += 4) {
      n += 1;
      const { r, g, b } = Jimp.intToRGBA(img.getPixelColor(x, y));
      if (r > 120 && g > 80 && r - b > 40) gold += 1; // vien vang: R cao, B thap
    }
    if (n) best = Math.max(best, gold / n);
  }
  return best;
}

// OCR ten header cua doi tai vi tri game-fraction hy.
async function ocrTroopNameAt(img, area, hy) {
  const region = { x: 0.02, y: hy - 0.020, w: 0.38, h: 0.030 };
  const [x, y, w, h] = regionPx(region, area);
  const crop = img.clone().crop(x, y, w, h).scale(3).grayscale()
    .contrast(0.4);
  const buf = await crop.getBufferAsync(Jimp.MIME_PNG);
  const worker = await getNameWorker();
  const { data } = await worker.recognize(buf);
  return data.text.trim().replace(/\s+/g, ' ');
}

// Doc doi dang FOCUS tren man deploy. Tra ve { idx, name, rowIdx } hoac null.
// idx = doi thuc (theo ten OCR); rowIdx = hang tren man (theo vien vang tim thay).
async function readFocusedTroop(device, cfg = {}) {
  try {
    const rowsY = (cfg.world && cfg.world.troopHeaderY) || TROOP_HEADER_Y;
    const img = await device.captureImage();
    const area = areaOf(device, img);
    for (let rowIdx = 0; rowIdx < rowsY.length; rowIdx += 1) {
      const hy = rowsY[rowIdx];
      if (hy - 0.02 < 0 || hy + 0.01 > 1) continue; // hang nam ngoai vung game (vd doi 4 chua cuon)
      if (goldBandFrac(img, area, hy - 0.019) < 0.5) continue; // khong co vien vang -> khong focus
      const raw = await ocrTroopNameAt(img, area, hy);
      const idx = troopNameToIndex(raw);
      device.log.info(`[deploy] doi focus (hang ${rowIdx + 1}): OCR="${raw}" -> doi ${idx >= 0 ? idx + 1 : '?'}`);
      return { idx, name: raw, rowIdx };
    }
    device.log.info('[deploy] khong thay vien vang o hang doc duoc -> khong xac dinh duoc doi focus.');
    return null;
  } catch (e) {
    if (e && e.cancelled) throw e;
    device.log.warn(`[deploy] doc doi focus loi: ${e.message}`);
    return null;
  }
}

// Test OFFLINE: doc doi focus tu 1 anh PNG + game area cho truoc (de hieu chinh khong can device).
async function readFocusedTroopFromPng(png, area, cfg = {}) {
  const rowsY = (cfg.world && cfg.world.troopHeaderY) || TROOP_HEADER_Y;
  const img = await Jimp.read(png);
  const ar = area || fullArea(img);
  for (let rowIdx = 0; rowIdx < rowsY.length; rowIdx += 1) {
    const hy = rowsY[rowIdx];
    if (hy - 0.02 < 0 || hy + 0.01 > 1) continue;
    if (goldBandFrac(img, ar, hy - 0.019) < 0.5) continue;
    const raw = await ocrTroopNameAt(img, ar, hy);
    return { idx: troopNameToIndex(raw), name: raw, rowIdx };
  }
  return null;
}

// Test OFFLINE: doc busy/idle tung trop tu 1 anh PNG (full anh, khong co game area).
async function parseTroopBusyFromPng(png, regions = TROOP_BUSY_REGIONS) {
  const img = await Jimp.read(png);
  const area = fullArea(img);
  const out = [];
  for (const r of regions) {
    const text = await ocrTimerRegion(img, r, area);
    out.push({ busy: parseTimerBusy(text), text });
  }
  return out;
}

// OCR 1 vung so. mode:
//  'white'     - chu TRANG tren nen toi/nhieu (queue 'X/Y' tren world): invert + threshold
//                de tach chu khoi dia hinh -> on dinh nhat (da test 6/6 khi nen doi).
//  'contrast'  - grayscale + contrast.
//  'threshold' (mac dinh) - binarize, tot cho stamina 'X/100' (chu nho, nen sang manh).
async function ocrRegion(img, region, mode, area) {
  const [x, y, w, h] = regionPx(region, area);
  let crop = img.clone().crop(x, y, w, h);
  if (mode === 'white') crop = crop.scale(6).grayscale().invert().threshold({ max: 110 });
  else if (mode === 'contrast') crop = crop.scale(5).grayscale().contrast(0.6);
  else crop = crop.scale(8).grayscale().threshold({ max: 150 });
  const buf = await crop.getBufferAsync(Jimp.MIME_PNG);
  const worker = await getWorker();
  const { data } = await worker.recognize(buf);
  return data.text.trim();
}

function parseQueueText(text) {
  const m = text.match(/(\d+)\s*\/\s*(\d+)/);
  if (!m) return null;
  const used = parseInt(m[1], 10);
  const total = parseInt(m[2], 10);
  if (!Number.isFinite(used) || !Number.isFinite(total) || total <= 0) return null;
  return { used, total, free: Math.max(0, total - used) };
}

// Doc dem hanh quan tu 1 anh PNG (Buffer) — dung cho test (full anh, khong co game area).
async function parseQueueFromPng(png, region = QUEUE_REGION) {
  const img = await Jimp.read(png);
  return await ocrQueueMulti(img, region, fullArea(img));
}

// Doc stamina 'X/100' cua tung trop tu man March Troops. Tra ve {troops:[...], best, min} hoac null.
async function readTroopStamina(device, cfg = {}) {
  try {
    const regions = (cfg.world && cfg.world.staminaRegions) || STAMINA_REGIONS;
    const img = await device.captureImage();
    const area = areaOf(device, img);
    const troops = [];
    for (const r of regions) {
      const text = await ocrRegion(img, r, 'threshold', area);
      const m = text.match(/(\d+)\s*\/\s*100/);
      if (m) troops.push(parseInt(m[1], 10));
    }
    if (troops.length === 0) return null;
    return { troops, best: Math.max(...troops), min: Math.min(...troops) };
  } catch (e) {
    if (e && e.cancelled) throw e; // dung ngay khi bi huy
    device.log.warn(`[state] doc stamina loi: ${e.message}`);
    return null;
  }
}

// Nut March VANG = march duoc (doi ranh); XAM = doi dang ban.
// Phan biet bang do am mau: R - B (vang ~59, xam ~0). Nguong 25.
function isGoldButton(img, region, area) {
  const [x, y, w, h] = regionPx(region, area);
  let n = 0;
  let sumR = 0;
  let sumB = 0;
  let golden = 0;
  for (let yy = y; yy < y + h; yy += 1) {
    for (let xx = x; xx < x + w; xx += 1) {
      const { r, g, b } = Jimp.intToRGBA(img.getPixelColor(xx, yy));
      n += 1; sumR += r; sumB += b;
      if (r > 140 && g > 105 && b < 130 && (r - b) > 40) golden += 1;
    }
  }
  if (n === 0) return false;
  const rmb = (sumR - sumB) / n;
  return rmb >= 25 || golden / n >= 0.08;
}

// Kiem tra nut March co dang VANG (march duoc) khong. Loi doc -> tra ve true (khong chan).
async function isMarchEnabled(device, cfg = {}) {
  try {
    const region = (cfg.world && cfg.world.marchBtnRegion) || MARCH_BTN_REGION;
    const img = await device.captureImage();
    return isGoldButton(img, region, areaOf(device, img));
  } catch (e) {
    if (e && e.cancelled) throw e; // dung ngay khi bi huy
    return true;
  }
}

// Doc 1 con so tu 1 vung % (theo game area). Dung cho Hunting Times cua Auto Hunt.
async function readNumberRegion(device, region) {
  try {
    const img = await device.captureImage();
    const text = await ocrRegion(img, region, 'contrast', areaOf(device, img));
    const m = text.match(/(\d+)/);
    return m ? parseInt(m[1], 10) : null;
  } catch (e) {
    if (e && e.cancelled) throw e;
    return null;
  }
}

// Mask theo DO SANG (luminance): chu SANG (>thr) -> den, nen toi -> trang. OCR thich chu den
// tren nen trang. Tach chu trang khoi nen dia hinh mau tot hon threshold thuong.
function lumMask(crop, thr) {
  const c = crop.clone();
  c.scan(0, 0, c.bitmap.width, c.bitmap.height, function scanFn(x, y, idx) {
    const r = this.bitmap.data[idx];
    const g = this.bitmap.data[idx + 1];
    const b = this.bitmap.data[idx + 2];
    const lum = 0.299 * r + 0.587 * g + 0.114 * b;
    const v = lum > thr ? 0 : 255;
    this.bitmap.data[idx] = v;
    this.bitmap.data[idx + 1] = v;
    this.bitmap.data[idx + 2] = v;
  });
  return c;
}

// Doc 'X/Y' bang NHIEU nguong luminance, lay ket qua parse hop le DAU TIEN. Chu trang tren
// nen ban do doi lien tuc -> 1 nguong khong du -> thu vai nguong cho chac.
async function ocrQueueMulti(img, region, area) {
  const [x, y, w, h] = regionPx(region, area);
  const base = img.clone().crop(x, y, w, h).scale(6);
  const worker = await getWorker();
  for (const thr of [130, 115, 145, 100, 160]) {
    const buf = await lumMask(base, thr).getBufferAsync(Jimp.MIME_PNG);
    const { data } = await worker.recognize(buf);
    const parsed = parseQueueText(data.text.trim());
    if (parsed) return parsed;
  }
  return null;
}

// Chup man hinh device roi doc dem hanh quan. Tra ve null neu doc that bai.
async function readMarchQueue(device, cfg = {}) {
  try {
    const region = (cfg.world && cfg.world.queueRegion) || QUEUE_REGION;
    const img = await device.captureImage();
    return await ocrQueueMulti(img, region, areaOf(device, img));
  } catch (e) {
    if (e && e.cancelled) throw e; // dung ngay khi bi huy
    device.log.warn(`[state] doc dem hanh quan loi: ${e.message}`);
    return null;
  }
}

module.exports = {
  readMarchQueue, parseQueueFromPng, readTroopStamina, isMarchEnabled, isGoldButton,
  readNumberRegion, readTroopBusy, parseTroopBusyFromPng,
  readFocusedTroop, readFocusedTroopFromPng, troopNameToIndex,
  TROOP_HEADER_Y, TROOP_INGAME_NAMES,
  terminate, QUEUE_REGION, STAMINA_REGIONS, MARCH_BTN_REGION, TROOP_BUSY_REGIONS,
};
