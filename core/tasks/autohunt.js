'use strict';

// Tu dong hoa tinh nang AUTO HUNT WILD CREATURES cua game (thay flow san thu cong).
// Mo popup bang icon con bo -> chon target (carousel) + level + Select All (mac dinh)
// + Hunting Times -> Start Auto Hunt. Game tu san N lan roi dung.
//
// Toa do la ti le % theo VUNG GAME (do tu popup 540x960).

const { locate } = require('../vision/screen');
const { readNumberRegion } = require('../state/StateReader');

const AH = {
  bugIcon: [0.069, 0.58],   // icon con bo tren world map -> mo popup
  close: [0.91, 0.144],     // nut X dong popup
  carCenter: [0.5, 0.30],   // o giua carousel target
  carLeft: [0.093, 0.30],   // mui ten '<'
  carRight: [0.907, 0.30],  // mui ten '>'
  lvlMinus: [0.13, 0.417],  // level target -
  lvlPlus: [0.71, 0.417],   // level target +
  timesMinus: [0.13, 0.737], // Hunting Times -
  timesPlus: [0.71, 0.737],  // Hunting Times +
  timesInput: { x: 0.78, y: 0.723, w: 0.15, h: 0.033 }, // vung so Hunting Times (OCR)
  startBtn: [0.26, 0.822],  // Start Auto Hunt (man setup)
  restartBtn: [0.5, 0.78],  // Restart (man ended) -> quay ve setup
  stopBtn: [0.5, 0.78],     // Stop Auto Hunt (man running)
};

// Trang thai popup: 'running' (dang san) | 'setup' (cau hinh) | 'other' (ended/khac).
// Retry vi sau khi Start/Restart co popup thong bao + animation de len (can cho render xong).
async function getState(device, { retries = 3 } = {}) {
  for (let i = 0; i <= retries; i += 1) {
    if (await locate(device, 'ah_hunting', { threshold: 0.75 })) return 'running';
    if (await locate(device, 'ah_target', { threshold: 0.78 })) return 'setup';
    if (i < retries) await device.sleep(700);
  }
  return 'other';
}

// Mo popup Auto Hunt (tap icon con bo). Tra ve trang thai.
async function openAutoHunt(device) {
  await device.tapPct(AH.bugIcon[0], AH.bugIcon[1]);
  await device.sleep(1600);
  return getState(device);
}

async function closeAutoHunt(device) {
  await device.tapPct(AH.close[0], AH.close[1]);
  await device.sleep(800);
}

// Dam bao dang o man SETUP (carousel). ended -> tap Restart de ve setup.
// Tra ve 'setup' | 'running' | 'fail'.
async function ensureSetup(device) {
  let st = await getState(device);
  if (st === 'setup') return 'setup';
  if (st === 'running') return 'running';
  // 'other' (ended) -> Restart -> setup
  await device.tapPct(AH.restartBtn[0], AH.restartBtn[1]);
  await device.sleep(1200);
  st = await getState(device);
  return st === 'setup' ? 'setup' : (st === 'running' ? 'running' : 'fail');
}

// Chon target index (0-based): tap o giua -> reset ve dau (< 5 lan) -> > index lan (o giua = chon).
async function selectTarget(device, index) {
  await device.tapPct(AH.carCenter[0], AH.carCenter[1]);
  await device.sleep(300);
  for (let i = 0; i < 5; i += 1) { await device.tapPct(AH.carLeft[0], AH.carLeft[1]); await device.sleep(220); }
  for (let i = 0; i < index; i += 1) { await device.tapPct(AH.carRight[0], AH.carRight[1]); await device.sleep(280); }
}

// Set level target: ha ve min (bam '-' nhieu) roi '+' (level-1). Game tu cap neu vuot max.
async function setTargetLevel(device, level) {
  const clicks = Math.max(0, (parseInt(level, 10) || 1) - 1);
  await device.tapRepeat(AH.lvlMinus[0], AH.lvlMinus[1], 16); // 1 lenh adb thay vi 16
  await device.tapRepeat(AH.lvlPlus[0], AH.lvlPlus[1], clicks);
}

// Doc Hunting Times hien tai (khi Select All -> hien so max co the san).
async function readTimes(device) {
  return readNumberRegion(device, AH.timesInput);
}

// Set Hunting Times = n. Tap gop nhanh nhung co the SOT vai tap -> doc lai va sua den khi
// dung (toi da 5 lan). Vua nhanh (it spawn) vua chinh xac.
async function setTimes(device, n) {
  const target = Math.max(1, parseInt(n, 10) || 1);
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const cur = await readTimes(device);
    if (cur == null) {
      // Khong doc duoc -> reset ve min roi + (n-1) (best effort).
      await device.tapRepeat(AH.timesMinus[0], AH.timesMinus[1], 40);
      await device.tapRepeat(AH.timesPlus[0], AH.timesPlus[1], target - 1);
      return;
    }
    const delta = target - cur;
    if (delta === 0) return; // dung roi
    const [bx, by] = delta > 0 ? AH.timesPlus : AH.timesMinus;
    await device.tapRepeat(bx, by, Math.abs(delta));
  }
}

async function startAutoHunt(device) {
  await device.tapPct(AH.startBtn[0], AH.startBtn[1]);
  await device.sleep(2200); // cho popup thong bao "auto dang chay" tu tat
}

// Neu Auto Hunt DANG CHAY trong game -> mo popup + tap Stop Auto Hunt. Tra ve true neu da dung.
// Dung khi nguoi dung bam Dung bot ma auto hunt con dang xu ly.
async function stopIfRunning(device) {
  const state = await openAutoHunt(device);
  if (state === 'running') {
    await device.tapPct(AH.stopBtn[0], AH.stopBtn[1]);
    await device.sleep(1000);
    await closeAutoHunt(device);
    return true;
  }
  await closeAutoHunt(device);
  return false;
}

module.exports = {
  AH, getState, openAutoHunt, closeAutoHunt, ensureSetup,
  selectTarget, setTargetLevel, readTimes, setTimes, startAutoHunt, stopIfRunning,
};
