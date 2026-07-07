'use strict';

// Template matching thuan JS (khong can native build) — dung lam nen tang khoi dau.
// Nguyen ly: chuyen xam -> downscale -> truot template tim vi tri co NCC (normalized
// cross-correlation) cao nhat. NCC chong nhieu do sang tot hon so khop tuyet doi.
//
// LUU Y HIEU NANG: pure-JS nen cham (vai tram ms -> vai giay tuy kich thuoc).
// Khi farm nhieu device can toc do, thay module nay bang @u4/opencv4nodejs
// (ham matchTemplate cua OpenCV) — giu nguyen chu ky ham findTemplate().

const Jimp = require('jimp');

// Chuyen anh Jimp -> mang xam {w,h,data:Float32Array}, co the downscale bang `scale`.
function toGray(img, scale) {
  let work = img;
  if (scale && scale !== 1) {
    const w = Math.max(1, Math.round(img.bitmap.width * scale));
    const h = Math.max(1, Math.round(img.bitmap.height * scale));
    work = img.clone().resize(w, h);
  }
  const { width, height, data } = work.bitmap;
  const gray = new Float32Array(width * height);
  for (let i = 0, p = 0; i < data.length; i += 4, p += 1) {
    // Luminance chuan.
    gray[p] = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
  }
  return { w: width, h: height, data: gray };
}

function meanStd(data) {
  let sum = 0;
  for (let i = 0; i < data.length; i += 1) sum += data[i];
  const mean = sum / data.length;
  let varSum = 0;
  for (let i = 0; i < data.length; i += 1) {
    const d = data[i] - mean;
    varSum += d * d;
  }
  return { mean, std: Math.sqrt(varSum / data.length) || 1e-6 };
}

// CHUAN BI template 1 lan (CACHE DUOC): resize theo do phan giai may -> grayscale ->
// tinh san mean/std + mang da tru mean (tCentered). Template la file TINH nen ket qua nay
// khong doi giua cac lan match -> screen.js cache lai theo (ten, templateScale) de KHONG
// decode/grayscale template lap lai moi lan locate.
function prepareTemplate(tplImg, templateScale = 1, scale = 0.5) {
  let t = tplImg;
  // Scale template theo do phan giai man hinh (template cat o 540 -> khop may khac).
  if (templateScale && Math.abs(templateScale - 1) > 0.02) {
    const nw = Math.max(1, Math.round(tplImg.bitmap.width * templateScale));
    const nh = Math.max(1, Math.round(tplImg.bitmap.height * templateScale));
    t = tplImg.clone().resize(nw, nh);
  }
  const T = toGray(t, scale);
  const tStat = meanStd(T.data);
  const tCentered = new Float32Array(T.data.length);
  for (let i = 0; i < T.data.length; i += 1) tCentered[i] = T.data[i] - tStat.mean;
  return { w: T.w, h: T.h, data: T.data, tStat, tCentered };
}

/**
 * So khop 1 template DA CHUAN BI voi 1 man hinh DA GRAYSCALE (toGray).
 * Tach rieng buoc nay de: (1) cache template, (2) 1 khung hinh so nhieu template
 * (chi grayscale man hinh 1 lan).
 * @param {object} S  ket qua toGray(screenImg, scale) -> {w,h,data}
 * @param {object} prep ket qua prepareTemplate(...)
 * @param {object} opts { threshold=0.7, step=1, scale=0.5, origW, origH }
 * @returns {Promise<null | {xPct,yPct,x,y,score,width,height}>}
 */
async function matchGray(S, prep, opts = {}) {
  const { threshold = 0.7, step = 1, scale = 0.5, origW, origH } = opts;
  const T = prep;
  if (T.w > S.w || T.h > S.h) return null;

  let best = { score: -Infinity, x: 0, y: 0 };
  const maxY = S.h - T.h;
  const maxX = S.w - T.w;

  for (let ty = 0; ty <= maxY; ty += step) {
    // Nhuong event loop dinh ky de UI/IPC khong bi freeze khi nhieu may cung match.
    if ((ty & 15) === 0) await new Promise((r) => setImmediate(r));
    for (let tx = 0; tx <= maxX; tx += step) {
      // Mean cua vung screen dang xet.
      let sum = 0;
      for (let y = 0; y < T.h; y += 1) {
        const base = (ty + y) * S.w + tx;
        for (let x = 0; x < T.w; x += 1) sum += S.data[base + x];
      }
      const sMean = sum / T.data.length;

      let num = 0;
      let sVar = 0;
      let ti = 0;
      for (let y = 0; y < T.h; y += 1) {
        const base = (ty + y) * S.w + tx;
        for (let x = 0; x < T.w; x += 1, ti += 1) {
          const sv = S.data[base + x] - sMean;
          num += sv * T.tCentered[ti];
          sVar += sv * sv;
        }
      }
      const denom = Math.sqrt(sVar) * Math.sqrt(T.tStat.std * T.tStat.std * T.data.length) || 1e-6;
      const score = num / denom;
      if (score > best.score) best = { score, x: tx, y: ty };
    }
  }

  if (best.score < threshold) return null;

  // Tam template tren anh downscaled -> quy ve pixel goc.
  const invScale = 1 / scale;
  const x = (best.x + T.w / 2) * invScale;
  const y = (best.y + T.h / 2) * invScale;

  return {
    score: best.score,
    x,
    y,
    xPct: x / origW,
    yPct: y / origH,
    width: T.w * invScale,
    height: T.h * invScale,
  };
}

/**
 * Tim template trong screen (wrapper tuong thich nguoc — decode moi thu moi lan).
 * screen.js dung truc tiep prepareTemplate + matchGray de tan dung cache.
 * @param {Buffer} screenPng  PNG buffer man hinh (tu device.capture()).
 * @param {Buffer} templatePng PNG buffer anh mau.
 * @param {object} opts { scale=0.5, threshold=0.7, step=1, templateScale=1 }
 * @returns {Promise<null | {xPct,yPct,x,y,score,width,height}>}
 */
async function findTemplate(screenPng, templatePng, opts = {}) {
  const { scale = 0.5, threshold = 0.7, step = 1, templateScale = 1 } = opts;
  const screenImg = await Jimp.read(screenPng);
  const tplImg = await Jimp.read(templatePng);
  const prep = prepareTemplate(tplImg, templateScale, scale);
  const S = toGray(screenImg, scale);
  return matchGray(S, prep, {
    threshold, step, scale, origW: screenImg.bitmap.width, origH: screenImg.bitmap.height,
  });
}

module.exports = { findTemplate, toGray, prepareTemplate, matchGray };
