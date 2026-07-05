'use strict';

// Tien ich: tim 1 template tren man hinh HIEN TAI cua device va (tuy chon) bam vao.
// Dung boi cac task ben duoi.

const fs = require('fs');
const path = require('path');
const { findTemplate } = require('./matcher');

const TEMPLATES_DIR = path.join(__dirname, '..', '..', 'assets', 'templates');

// Do phan giai THAM CHIEU luc cat template. Man hinh may khac se scale template theo ti le nay.
const REF_WIDTH = 540;

function templatePath(name) {
  return path.join(TEMPLATES_DIR, name.endsWith('.png') ? name : `${name}.png`);
}

// Tim template theo ten file trong assets/templates. Tra ve null neu khong thay
// hoac file template chua ton tai (de scaffold khong crash khi thieu asset).
// Tu scale template theo do phan giai may hien tai (template cat o 540 -> khop moi may).
async function locate(device, templateName, opts = {}) {
  const p = templatePath(templateName);
  if (!fs.existsSync(p)) {
    device.log.warn(`Chua co template "${templateName}" (${p}) — bo qua.`);
    return null;
  }
  const screen = await device.capture();
  const tpl = fs.readFileSync(p);
  let templateScale = 1;
  try {
    const { width } = await device.getScreenSize();
    if (width) templateScale = width / REF_WIDTH;
  } catch (e) { /* dung ti le 1 neu khong doc duoc */ }
  return findTemplate(screen, tpl, { ...opts, templateScale });
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
