'use strict';

// Tien ich: tim 1 template tren man hinh HIEN TAI cua device va (tuy chon) bam vao.
// Dung boi cac task ben duoi.

const fs = require('fs');
const path = require('path');
const Jimp = require('jimp');
const { toGray, prepareTemplate, matchGray } = require('./matcher');

const TEMPLATES_DIR = path.join(__dirname, '..', '..', 'assets', 'templates');

// Do phan giai THAM CHIEU luc cat template. Man hinh may khac se scale template theo ti le nay.
const REF_WIDTH = 540;
// Ti le downscale khi match — PHAI khop mac dinh cua matcher (findTemplate/matchGray).
const SCALE = 0.5;

function templatePath(name) {
  return path.join(TEMPLATES_DIR, name.endsWith('.png') ? name : `${name}.png`);
}

// CACHE anh template da decode 1 lan (file tinh). null = file khong ton tai (nho lai de khoi
// stat lai moi lan). Cache prepared template theo (ten|templateScale) — thanh phan nang nhat
// (resize + grayscale + tinh mean/std) chi lam 1 lan cho moi do phan giai may.
const tplImgCache = new Map();  // path -> Jimp | null
const tplPrepCache = new Map(); // `${name}|${scale}` -> prepared

async function loadTemplateImg(name) {
  const p = templatePath(name);
  if (tplImgCache.has(p)) return tplImgCache.get(p);
  let img = null;
  if (fs.existsSync(p)) img = await Jimp.read(fs.readFileSync(p));
  tplImgCache.set(p, img);
  return img;
}

// Grayscale man hinh MEMO theo instance anh: 1 khung hinh so nhieu template -> chi grayscale 1 lan.
function grayOfScreen(img) {
  const k = `__gray_${SCALE}`;
  if (!img[k]) img[k] = toGray(img, SCALE);
  return img[k];
}

// ROI (vung tim) cho cac anchor CO DINH — quet trong vung nho thay vi ca man hinh -> nhanh
// hon nhieu. Toa do la % VUNG GAME (do tu anh that, noi rong bien de chiu sai lech may/scale).
// AN TOAN: locate luon FALLBACK quet ca man hinh neu ROI khong thay -> khong bao gio giam do
// chinh xac, chi nhanh hon o duong thuong gap. Ghi de qua cfg neu can (chua dung).
const ANCHOR_ROIS = {
  world_search_icon: { x: 0.00, y: 0.55, w: 0.24, h: 0.22 }, // kinh lup goc trai-duoi
  panel_go:          { x: 0.62, y: 0.77, w: 0.38, h: 0.18 }, // nut Go phai-duoi panel Search
  btn_march_deploy:  { x: 0.50, y: 0.87, w: 0.50, h: 0.13 }, // nut March day man March Troops
  btn_to_world:      { x: 0.78, y: 0.82, w: 0.22, h: 0.18 }, // nut len World (goc phai-duoi base)
  btn_gather:        { x: 0.30, y: 0.45, w: 0.60, h: 0.25 }, // nut Gather tren card (giua-duoi)
};

// So khop template trong 1 VUNG (ROI) cua anh -> quy toa do ve he FULL anh. null neu khong thay.
async function matchInRegion(device, img, prep, roi, opts) {
  if (!device.imageArea) return null;
  const a = device.imageArea(img);
  const W = img.bitmap.width;
  const H = img.bitmap.height;
  let bx = Math.round(a.x + roi.x * a.width);
  let by = Math.round(a.y + roi.y * a.height);
  let bw = Math.round(roi.w * a.width);
  let bh = Math.round(roi.h * a.height);
  // Clamp vao trong anh.
  if (bx < 0) { bw += bx; bx = 0; }
  if (by < 0) { bh += by; by = 0; }
  if (bx + bw > W) bw = W - bx;
  if (by + bh > H) bh = H - by;
  if (bw <= 0 || bh <= 0) return null;
  const crop = img.clone().crop(bx, by, bw, bh);
  const S = toGray(crop, SCALE);
  const res = await matchGray(S, prep, { ...opts, scale: SCALE, origW: bw, origH: bh });
  if (!res) return null;
  res.x += bx; res.y += by;
  res.xPct = res.x / W; res.yPct = res.y / H;
  return res;
}

// Tim template theo ten file trong assets/templates. Tra ve null neu khong thay
// hoac file template chua ton tai (de scaffold khong crash khi thieu asset).
// Tu scale template theo do phan giai may hien tai (template cat o 540 -> khop moi may).
//   opts.image: 1 Jimp da chup san -> KHONG chup lai (dung khi so nhieu template tren 1 khung hinh).
async function locate(device, templateName, opts = {}) {
  const { image, threshold = 0.7, step = 1 } = opts;
  const tplImg = await loadTemplateImg(templateName);
  if (!tplImg) {
    device.log.warn(`Chua co template "${templateName}" — bo qua.`);
    return null;
  }
  let templateScale = 1;
  try {
    await device.getScreenSize();
    const aw = device.area ? device.area().width : 0;
    if (aw) templateScale = aw / REF_WIDTH;
  } catch (e) { /* dung ti le 1 neu khong doc duoc */ }

  const key = `${templateName}|${templateScale.toFixed(3)}`;
  let prep = tplPrepCache.get(key);
  if (!prep) { prep = prepareTemplate(tplImg, templateScale, SCALE); tplPrepCache.set(key, prep); }

  const screenImg = image || await Jimp.read(await device.capture());

  // ROI-FIRST: anchor co dinh -> quet vung nho truoc (nhanh). Thay -> tra ve luon.
  const roi = ANCHOR_ROIS[templateName];
  if (roi) {
    const hit = await matchInRegion(device, screenImg, prep, roi, { threshold, step });
    if (hit) return hit;
  }

  // FALLBACK: khong co ROI / ROI khong thay -> quet ca man hinh (memo grayscale theo khung hinh).
  const S = grayOfScreen(screenImg);
  return matchGray(S, prep, {
    threshold, step, scale: SCALE, origW: screenImg.bitmap.width, origH: screenImg.bitmap.height,
  });
}

// Tim roi bam neu thay. Tra ve true/false.
async function tapTemplate(device, templateName, opts = {}) {
  const hit = await locate(device, templateName, opts);
  if (!hit) return false;
  device.log.info(`Thay "${templateName}" (score ${hit.score.toFixed(2)}) -> tap ${Math.round(hit.x)},${Math.round(hit.y)}`);
  await device.tap(hit.x, hit.y);
  return true;
}

// Cho den khi template xuat hien (poll), tra ve hit hoac null khi het gio.
async function waitFor(device, templateName, { timeoutMs = 10000, intervalMs = 800, ...opts } = {}) {
  const deadline = Date.now() + timeoutMs;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const hit = await locate(device, templateName, opts);
    if (hit) return hit;
    if (Date.now() > deadline) return null;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

module.exports = { locate, tapTemplate, waitFor, templatePath, TEMPLATES_DIR };
