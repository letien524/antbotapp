'use strict';

// CACHE LEVEL tai nguyen ra DIA (mirror level ma GAME dang nho cho tung loai).
// Game nho level THEO TUNG LOAI (slot): set 1 lan roi lan sau giu nguyen. Bot cung nho
// dieu do de BO QUA buoc set level khi da dung -> it thao tac, giong nguoi hon.
//
// Luu FILE RIENG THEO SERIAL: ~/.antbot/cache/<serial>.json  (KHONG ghi chung accounts.json
// de nhieu may farm song song -> nhieu child-process -> khong clobber file cua nhau).
//   { levels: { "<slot>": level } }

const fs = require('fs');
const path = require('path');
const os = require('os');

const CACHE_DIR = path.join(os.homedir(), '.antbot', 'cache');

function safeSerial(serial) {
  return String(serial || 'unknown').replace(/[^a-z0-9]/gi, '_');
}
function cachePath(serial) {
  return path.join(CACHE_DIR, `${safeSerial(serial)}.json`);
}

// Doc cache 1 serial. Loi/thieu file -> {} (khoan dung, coi nhu chua cache gi).
function load(serial) {
  try {
    const raw = JSON.parse(fs.readFileSync(cachePath(serial), 'utf8'));
    return raw && typeof raw === 'object' && raw.levels && typeof raw.levels === 'object'
      ? raw : { levels: {} };
  } catch (e) {
    return { levels: {} };
  }
}

function save(serial, data) {
  try {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    fs.writeFileSync(cachePath(serial), JSON.stringify(data, null, 2));
  } catch (e) { /* cache la best-effort: loi ghi -> lan sau set lai level, khong sao */ }
}

// Level game DANG nho cho `slot` (loai), hoac null neu chua tung set.
function getCachedLevel(serial, slot) {
  const v = load(serial).levels[String(slot)];
  return Number.isFinite(v) ? v : null;
}

// Ghi lai: game vua duoc set `slot` -> `level`.
function setCachedLevel(serial, slot, level) {
  const data = load(serial);
  data.levels[String(slot)] = Number(level);
  save(serial, data);
}

// Xoa cache level cua 1 serial -> bot se CHON LAI loai + SET LAI level tu dau o luot sau.
function clearCache(serial) {
  try { fs.unlinkSync(cachePath(serial)); return true; } catch (e) { return false; }
}

// Xoa TOAN BO cache level (moi serial). Tra ve so file da xoa.
function clearAllCache() {
  let n = 0;
  try {
    for (const f of fs.readdirSync(CACHE_DIR)) {
      if (!f.endsWith('.json')) continue;
      try { fs.unlinkSync(path.join(CACHE_DIR, f)); n += 1; } catch (e) { /* bo qua */ }
    }
  } catch (e) { /* thu muc chua co */ }
  return n;
}

module.exports = { getCachedLevel, setCachedLevel, clearCache, clearAllCache, cachePath, CACHE_DIR };
