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

// Vung 'X/Y' tren world map (ti le %, do tu 540x960). Ghi de qua cfg.world.queueRegion.
const QUEUE_REGION = { x: 0.126, y: 0.142, w: 0.111, h: 0.034 };

// Vung stamina 'X/100' cua tung trop tren man March Troops (ti le %, do tu 540x960).
// Moi trop mot vung; account nay co 2 trop (Pro Troop, Troop I). Ghi de qua cfg.world.staminaRegions.
const STAMINA_REGIONS = [
  { x: 0.567, y: 0.371, w: 0.119, h: 0.027 },
  { x: 0.567, y: 0.610, w: 0.119, h: 0.027 },
];

let workerPromise = null;
async function getWorker() {
  if (!workerPromise) {
    workerPromise = (async () => {
      const w = await Tesseract.createWorker('eng');
      await w.setParameters({ tessedit_char_whitelist: '0123456789/', tessedit_pageseg_mode: '7' });
      log.info('OCR worker san sang.');
      return w;
    })();
  }
  return workerPromise;
}

function px(region, W, H) {
  return [Math.round(region.x * W), Math.round(region.y * H), Math.round(region.w * W), Math.round(region.h * H)];
}

// Vung nut March (goc phai duoi man March Troops, ti le %, do tu 540x960).
const MARCH_BTN_REGION = { x: 0.546, y: 0.922, w: 0.380, h: 0.050 };

async function terminate() {
  if (workerPromise) {
    const w = await workerPromise;
    await w.terminate();
    workerPromise = null;
  }
}

// OCR 1 vung so. mode:
//  'threshold' (mac dinh) - binarize, tot cho stamina 'X/100' (chu nho, nen sang manh).
//  'contrast'  - grayscale + contrast, doc dau '/' cho queue 'X/Y' on dinh hon.
async function ocrRegion(img, region, mode = 'threshold') {
  const [x, y, w, h] = px(region, img.bitmap.width, img.bitmap.height);
  let crop = img.clone().crop(x, y, w, h);
  crop = mode === 'contrast'
    ? crop.scale(5).grayscale().contrast(0.6)
    : crop.scale(8).grayscale().threshold({ max: 150 });
  const buf = await crop.getBufferAsync(Jimp.MIME_PNG);
  const worker = await getWorker();
  const { data } = await worker.recognize(buf);
  return data.text.trim();
}

// Doc dem hanh quan tu 1 anh PNG (Buffer). Tra ve {used,total,free} hoac null.
async function parseQueueFromPng(png, region = QUEUE_REGION) {
  const img = await Jimp.read(png);
  const text = await ocrRegion(img, region, 'contrast');
  const m = text.match(/(\d+)\s*\/\s*(\d+)/);
  if (!m) return null;
  const used = parseInt(m[1], 10);
  const total = parseInt(m[2], 10);
  if (!Number.isFinite(used) || !Number.isFinite(total) || total <= 0) return null;
  return { used, total, free: Math.max(0, total - used) };
}

// Doc stamina 'X/100' cua tung trop tu man March Troops. Tra ve {troops:[...], best, min} hoac null.
async function readTroopStamina(device, cfg = {}) {
  try {
    const regions = (cfg.world && cfg.world.staminaRegions) || STAMINA_REGIONS;
    const png = await device.capture();
    const img = await Jimp.read(png);
    const troops = [];
    for (const r of regions) {
      const text = await ocrRegion(img, r);
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
function isGoldButton(img, region) {
  const [x, y, w, h] = px(region, img.bitmap.width, img.bitmap.height);
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
    const png = await device.capture();
    const img = await Jimp.read(png);
    return isGoldButton(img, region);
  } catch (e) {
    if (e && e.cancelled) throw e; // dung ngay khi bi huy
    return true;
  }
}

// Chup man hinh device roi doc dem hanh quan. Tra ve null neu doc that bai.
async function readMarchQueue(device, cfg = {}) {
  try {
    const region = (cfg.world && cfg.world.queueRegion) || QUEUE_REGION;
    const png = await device.capture();
    return await parseQueueFromPng(png, region);
  } catch (e) {
    if (e && e.cancelled) throw e; // dung ngay khi bi huy
    device.log.warn(`[state] doc dem hanh quan loi: ${e.message}`);
    return null;
  }
}

module.exports = {
  readMarchQueue, parseQueueFromPng, readTroopStamina, isMarchEnabled, isGoldButton,
  terminate, QUEUE_REGION, STAMINA_REGIONS, MARCH_BTN_REGION,
};
