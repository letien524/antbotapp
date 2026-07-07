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
    const img = await Jimp.read(await device.capture());
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
    const img = await Jimp.read(await device.capture());
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
    const img = await Jimp.read(await device.capture());
    return isGoldButton(img, region, areaOf(device, img));
  } catch (e) {
    if (e && e.cancelled) throw e; // dung ngay khi bi huy
    return true;
  }
}

// Doc 1 con so tu 1 vung % (theo game area). Dung cho Hunting Times cua Auto Hunt.
async function readNumberRegion(device, region) {
  try {
    const img = await Jimp.read(await device.capture());
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
    const img = await Jimp.read(await device.capture());
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
  terminate, QUEUE_REGION, STAMINA_REGIONS, MARCH_BTN_REGION, TROOP_BUSY_REGIONS,
};
