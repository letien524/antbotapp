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

/**
 * Tim template trong screen.
 * @param {Buffer} screenPng  PNG buffer man hinh (tu device.capture()).
 * @param {Buffer} templatePng PNG buffer anh mau.
 * @param {object} opts { scale=0.5, threshold=0.7, step=1 }
 * @returns {Promise<null | {xPct,yPct,x,y,score,width,height}>}
 *   Toa do tra ve theo do phan giai GOC cua screen (da bu lai scale).
 */
async function findTemplate(screenPng, templatePng, opts = {}) {
  const { scale = 0.5, threshold = 0.7, step = 1 } = opts;

  const screenImg = await Jimp.read(screenPng);
  const tplImg = await Jimp.read(templatePng);

  const origW = screenImg.bitmap.width;
  const origH = screenImg.bitmap.height;

  const S = toGray(screenImg, scale);
  const T = toGray(tplImg, scale);

  if (T.w > S.w || T.h > S.h) return null;

  const tStat = meanStd(T.data);
  const tCentered = new Float32Array(T.data.length);
  for (let i = 0; i < T.data.length; i += 1) tCentered[i] = T.data[i] - tStat.mean;

  let best = { score: -Infinity, x: 0, y: 0 };
  const maxY = S.h - T.h;
  const maxX = S.w - T.w;

  for (let ty = 0; ty <= maxY; ty += step) {
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
          num += sv * tCentered[ti];
          sVar += sv * sv;
        }
      }
      const denom = Math.sqrt(sVar) * Math.sqrt(tStat.std * tStat.std * T.data.length) || 1e-6;
      const score = num / denom;
      if (score > best.score) best = { score, x: tx, y: ty };
    }
  }

  if (best.score < threshold) return null;

  // Tam template tren anh downscaled -> quy ve pixel goc.
  const invScale = 1 / scale;
  const centerXds = best.x + T.w / 2;
  const centerYds = best.y + T.h / 2;
  const x = centerXds * invScale;
  const y = centerYds * invScale;

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

module.exports = { findTemplate };
