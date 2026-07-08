'use strict';

// Doc/ghi config/accounts.json. Schema:
//   config = {
//     gather: { enabled, commonLevel, troops: [ {type, level, enabled} x4 ] },
//     pollSec,
//     world: {}   // ghi de toa do panel neu can
//   }

const fs = require('fs');
const path = require('path');
const os = require('os');

// Config luu o THU MUC NGUOI DUNG (~/.antbot) — NGOAI project — de tai/cap nhat code
// khong lam mat settings. File cu trong project se duoc di cu sang lan dau.
const CONFIG_DIR = path.join(os.homedir(), '.antbot');
const CONFIG_PATH = path.join(CONFIG_DIR, 'accounts.json');
const LEGACY_PATH = path.join(__dirname, '..', 'config', 'accounts.json');

function ensureConfigDir() {
  try { fs.mkdirSync(CONFIG_DIR, { recursive: true }); } catch (e) { /* da ton tai */ }
}

// Tao mang level [from..to] buoc `step`.
function range(from, to, step) {
  const a = [];
  for (let v = from; v <= to; v += step) a.push(v);
  return a;
}
const LV_1_15 = range(1, 15, 1);       // tai nguyen: 1->15 buoc 1

// Danh sach LOAI tai nguyen. Slot = thu tu o trong panel Search (selectSlot theo index).
// `levels` = cac level hop le theo dung thu tu tren slider -> so lan bam '+' = index cua level.
// Thu tu carousel gather: meat, plants, wet soil, sand, diamond (slot = vi tri 0-4).
const RESOURCE_TYPES = [
  { slot: 0, label: 'Meat - Woodlouse (o 1)', levels: LV_1_15 },
  { slot: 1, label: 'Plants - Bush (o 2)', levels: LV_1_15 },
  { slot: 2, label: 'Wet Soil (o 3)', levels: LV_1_15 },
  { slot: 3, label: 'Sand (o 4)', levels: LV_1_15 },
  { slot: 4, label: 'Diamond (o 5)', levels: LV_1_15 },
];

// Cac DOI (troop) co the chon di lam nhiem vu. Toi da 4 doi/may.
const TROOPS = [
  { index: 0, label: 'Doi 1 (Pro Troop)' },
  { index: 1, label: 'Doi 2 (Troop I)' },
  { index: 2, label: 'Doi 3 (Troop II)' },
  { index: 3, label: 'Doi 4 (Troop III)' },
];

// So lan bam '+' tu MIN de dat `level` cho 1 loai tai nguyen (kind giu de tuong thich, slot).
// = vi tri cua level trong danh sach levels (chon gan nhat neu khong khop).
function levelToClicks(kind, slot, level) {
  const t = RESOURCE_TYPES.find((x) => x.slot === slot) || RESOURCE_TYPES[0];
  const levels = t.levels;
  let idx = levels.indexOf(Number(level));
  if (idx < 0) {
    let best = Infinity;
    levels.forEach((lv, i) => { const d = Math.abs(lv - Number(level)); if (d < best) { best = d; idx = i; } });
  }
  return Math.max(0, idx);
}

// ---- Store: { global: <config chung>, devices: [{serial,name,useOwnConfig,config}] } ----
function loadStore() {
  // Di cu lan dau: chua co file o ~/.antbot nhung co file cu trong project -> copy sang.
  if (!fs.existsSync(CONFIG_PATH) && fs.existsSync(LEGACY_PATH)) {
    try { ensureConfigDir(); fs.copyFileSync(LEGACY_PATH, CONFIG_PATH); } catch (e) { /* bo qua */ }
  }
  let raw;
  try { raw = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')); } catch (e) { raw = {}; }
  // Migrate tu dinh dang cu {accounts:[...]} -> {global, devices}.
  if (Array.isArray(raw.accounts) && !raw.devices) {
    raw = {
      global: raw.global || (raw.accounts[0] && raw.accounts[0].config) || defaultConfig(),
      devices: raw.accounts.map((a) => ({
        serial: a.serial, name: a.name || a.serial, useOwnConfig: true, config: a.config,
      })),
    };
  }
  if (!raw.global) raw.global = defaultConfig();
  if (!Array.isArray(raw.devices)) raw.devices = [];
  return raw;
}

function saveStore(store) {
  ensureConfigDir();
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(store, null, 2));
}

// Export TOAN BO settings (global + devices) ra chuoi JSON de sao luu / chuyen may.
function exportSettings() {
  return JSON.stringify(loadStore(), null, 2);
}
// Import settings tu chuoi JSON (ghi de toan bo). Nem loi neu JSON sai.
function importSettings(text) {
  const parsed = JSON.parse(text);
  const store = {
    global: normalizeConfig(parsed.global || {}),
    devices: Array.isArray(parsed.devices) ? parsed.devices.map((d) => ({
      serial: d.serial,
      name: d.name || d.serial,
      useOwnConfig: !!d.useOwnConfig,
      config: normalizeConfig(d.config || {}),
    })) : [],
  };
  saveStore(store);
  return store.devices.length;
}

// ---- Cau hinh CHUNG (dung cho device khong bat cau hinh rieng) ----
function getGlobalConfig() {
  return normalizeConfig(loadStore().global);
}
// Luu cau hinh chung. opts.applyToAll = true -> dat TAT CA may ve dung cau hinh chung
// (useOwnConfig=false), ghi de cau hinh rieng cua tung may.
function saveGlobalConfig(config, opts = {}) {
  const s = loadStore();
  s.global = normalizeConfig(config);
  if (opts.applyToAll) {
    for (const dev of s.devices) dev.useOwnConfig = false;
  }
  saveStore(s);
  return s.global;
}

// ---- Quan ly DEVICE (them / doi ten / xoa / cau hinh rieng) ----
function listDevices() {
  return loadStore().devices.map((d) => ({
    serial: d.serial, name: d.name || d.serial, useOwnConfig: !!d.useOwnConfig,
  }));
}
function deviceForSerial(serial) {
  return loadStore().devices.find((d) => d.serial === serial) || null;
}
function addDevice(serial, name) {
  if (!serial) return null;
  const s = loadStore();
  let dev = s.devices.find((d) => d.serial === serial);
  if (!dev) {
    dev = { serial, name: name || serial, useOwnConfig: false, config: defaultConfig() };
    s.devices.push(dev);
  } else if (name) {
    dev.name = name;
  }
  saveStore(s);
  return dev;
}
function renameDevice(serial, name) {
  const s = loadStore();
  const dev = s.devices.find((d) => d.serial === serial);
  if (dev) { dev.name = name || dev.name; saveStore(s); }
  return dev;
}
function removeDevice(serial) {
  const s = loadStore();
  s.devices = s.devices.filter((d) => d.serial !== serial);
  saveStore(s);
}
// Luu cau hinh rieng + co bat dung cau hinh rieng hay khong.
function saveDeviceConfig(serial, { config, useOwnConfig, name } = {}) {
  const s = loadStore();
  let dev = s.devices.find((d) => d.serial === serial);
  if (!dev) { dev = { serial, name: name || serial, useOwnConfig: false, config: defaultConfig() }; s.devices.push(dev); }
  if (name != null) dev.name = name;
  if (useOwnConfig != null) dev.useOwnConfig = !!useOwnConfig;
  if (config) dev.config = normalizeConfig(config);
  saveStore(s);
  return dev;
}

// Config THUC THI cho 1 serial: cau hinh rieng neu bat, khong thi dung CHUNG.
function effectiveConfig(serial) {
  const dev = deviceForSerial(serial);
  if (dev && dev.useOwnConfig && dev.config) return normalizeConfig(dev.config);
  return getGlobalConfig();
}

// Mac dinh 1 dong cau hinh cho moi DOI (troop). Chi bat 2 doi dau (da co san),
// doi 3-4 tat mac dinh (bat khi tai khoan mo khoa them).
function defaultTroopRows() {
  return TROOPS.map((t) => ({ type: 0, level: 1, enabled: t.index < 2 }));
}

function defaultConfig() {
  return {
    // Gather THEO TUNG TROOP: moi troop chon loai tai nguyen + level rieng.
    // commonLevel = level CHUNG (UI): doi no -> keo moi troop ve cung level; doi level 1 troop
    // rieng thi commonLevel giu nguyen. Chi de luu/hien thi, khong dung truc tiep khi chay.
    gather: { enabled: true, commonLevel: 1, troops: defaultTroopRows() },
    pollSec: 60, // chu ky kiem tra doi ranh de gui luot moi
    world: {},
  };
}

// Chuan hoa mang dong cau hinh troop: dam bao du so dong = so DOI (4).
// Dong CO SAN giu enabled cua no; dong PAD them (mo rong 2->4) mac dinh TAT.
function normalizeTroopRows(rows) {
  const out = [];
  for (let i = 0; i < TROOPS.length; i += 1) {
    const has = Array.isArray(rows) && rows[i];
    const r = has || {};
    out.push({
      type: Number.isInteger(r.type) ? r.type : 0,
      level: Number(r.level) > 0 ? Number(r.level) : 1,
      enabled: has ? (r.enabled !== false) : false,
    });
  }
  return out;
}

// Bo sung field thieu bang mac dinh (chiu duoc config cu/thieu).
function normalizeConfig(cfg = {}) {
  const c = cfg || {};
  const g = c.gather || {};
  return {
    gather: {
      enabled: g.enabled !== false,
      commonLevel: Number(g.commonLevel) > 0 ? Number(g.commonLevel) : 1,
      troops: normalizeTroopRows(g.troops),
    },
    pollSec: Number(c.pollSec) > 0 ? Number(c.pollSec) : 60,
    world: c.world && typeof c.world === 'object' ? c.world : {},
  };
}

// Tuong thich Worker/CLI: {serial, name, config-thuc-thi}.
function accountForSerial(serial) {
  const dev = deviceForSerial(serial);
  return { serial, name: dev ? dev.name : serial, config: effectiveConfig(serial) };
}

// Danh sach task can chay. Hien chi con thu thap tai nguyen (Auto Hunt da go khoi app).
function tasksFromConfig(config) {
  const c = normalizeConfig(config);
  const t = [];
  if (c.gather.enabled) t.push('collectResources');
  return t;
}

// ---- Import / Export CSV (cau hinh hang loat nhieu device) ----
// Cot: serial,name,gatherOn,gatherType,gatherLevel,pollSec
// gatherType/gatherLevel ap dung cho MOI doi cua device do. gatherOn: 1/0 (hoac true/false).
const CSV_HEADER = 'serial,name,gatherOn,gatherType,gatherLevel,pollSec';

function truthy(v) {
  return /^(1|true|yes|y|on|x)$/i.test(String(v || '').trim());
}
function toInt(v, def = 0) {
  const n = parseInt(String(v).trim(), 10);
  return Number.isFinite(n) ? n : def;
}

// Build config tu cac gia tri 1 dong (ap dung cung type/level cho moi doi).
function configFromRow(r) {
  return normalizeConfig({
    gather: {
      enabled: r.gatherOn,
      troops: TROOPS.map(() => ({ type: r.gatherType, level: r.gatherLevel, enabled: true })),
    },
    pollSec: r.pollSec,
  });
}

// Parse CSV -> [{serial, name, config}]. Bo dong trong + dong header.
function parseCsv(text) {
  const out = [];
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const c = line.split(',').map((x) => x.trim());
    if (/^serial$/i.test(c[0])) continue; // header
    const serial = c[0];
    if (!serial) continue;
    out.push({
      serial,
      name: c[1] || serial,
      config: configFromRow({
        gatherOn: truthy(c[2]),
        gatherType: toInt(c[3], 0),
        gatherLevel: toInt(c[4], 1),
        pollSec: toInt(c[5], 60),
      }),
    });
  }
  return out;
}

// Import: them/cap nhat device + luu cau hinh RIENG (useOwnConfig=true). Tra ve serial da import.
function importCsv(text) {
  const rows = parseCsv(text);
  for (const r of rows) saveDeviceConfig(r.serial, { config: r.config, useOwnConfig: true, name: r.name });
  return rows.map((r) => r.serial);
}

// Export tat ca device hien co ra CSV (config thuc thi, lay doi dau lam dai dien).
function exportCsv() {
  const lines = loadStore().devices.map((d) => {
    const cfg = effectiveConfig(d.serial);
    const g0 = cfg.gather.troops[0] || { type: 0, level: 1 };
    return [
      d.serial, d.name,
      cfg.gather.enabled ? 1 : 0, g0.type, g0.level,
      cfg.pollSec,
    ].join(',');
  });
  return [CSV_HEADER, ...lines].join('\n');
}

module.exports = {
  CONFIG_PATH,
  RESOURCE_TYPES,
  TROOPS,
  CSV_HEADER,
  levelToClicks,
  accountForSerial,
  defaultConfig,
  normalizeConfig,
  tasksFromConfig,
  // store / global / devices
  loadStore,
  exportSettings,
  importSettings,
  getGlobalConfig,
  saveGlobalConfig,
  listDevices,
  deviceForSerial,
  addDevice,
  renameDevice,
  removeDevice,
  saveDeviceConfig,
  effectiveConfig,
  // csv
  parseCsv,
  importCsv,
  exportCsv,
};
