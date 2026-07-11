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
    serial: d.serial, name: d.name || d.serial, useOwnConfig: !!d.useOwnConfig, group: d.group || '',
  }));
}
// Gan (hoac bo) NHOM cho 1 hay nhieu may. group rong -> bo khoi nhom. Tra ve so may da doi.
function setDeviceGroup(serials, group) {
  const s = loadStore();
  const set = new Set(Array.isArray(serials) ? serials : [serials]);
  const g = String(group || '').trim();
  let n = 0;
  for (const dev of s.devices) {
    if (set.has(dev.serial)) { dev.group = g; n += 1; }
  }
  saveStore(s);
  return n;
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
// Cot: serial,name,useOwnConfig,gatherOn,troops,pollSec
//   useOwnConfig = may dung cau hinh RIENG (1) hay theo cau hinh CHUNG (0).
//   gatherOn = cong tac gather chung cua may (1/0). gatherOn=0 -> tat gather du troops co gi.
//   troops = danh sach TUNG DOI, ngan cach ';', moi doi la "type:level".
//           VI TRI = so thu tu doi. O trong = doi TAT. Toi da 4 doi (thua thi bo).
//           Vd "0:6;1:8;2:6"  -> mo 3 doi (doi 4 tat). "0:6;;2:8" -> doi 1,3 bat, doi 2 tat.
// Van DOC DUOC dinh dang cu (serial,name,gatherOn,gatherType,gatherLevel,pollSec) -> ap cho ca 4 doi.
const CSV_HEADER = 'serial,name,useOwnConfig,gatherOn,troops,pollSec';

function truthy(v) {
  return /^(1|true|yes|y|on|x)$/i.test(String(v || '').trim());
}
function toInt(v, def = 0) {
  const n = parseInt(String(v).trim(), 10);
  return Number.isFinite(n) ? n : def;
}
function clampInt(v, lo, hi, def) {
  const n = toInt(v, def);
  return Math.min(hi, Math.max(lo, n));
}

// Boc 1 field theo RFC-4180: neu chua dau phay / dau nhay / xuong dong thi boc "..."
// va nhan doi dau nhay ben trong. Nho vay TEN co dau phay khong lam vo dinh dang CSV.
function csvEscape(v) {
  const s = String(v == null ? '' : v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// Tach 1 dong CSV thanh mang field, TON TRONG field boc trong ngoac kep (co the chua dau phay).
function parseCsvLine(line) {
  const out = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (inQ) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i += 1; } // "" -> mot dau nhay
        else inQ = false;
      } else cur += ch;
    } else if (ch === '"') { inQ = true; }
    else if (ch === ',') { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

// Parse cot "troops" ("type:level;type:level;...") -> mang 4 dong {type,level,enabled}.
// VI TRI = doi. O trong -> doi TAT. Qua 4 doi thi bo. Import ĐÚNG so doi nhu file.
function parseTroopsSpec(spec, maxSlot) {
  const parts = String(spec || '').split(';');
  const rows = [];
  for (let i = 0; i < TROOPS.length; i += 1) {
    const p = (parts[i] || '').trim();
    if (!p) { rows.push({ type: 0, level: 1, enabled: false }); continue; } // o trong -> doi tat
    const seg = p.split(':');
    rows.push({
      type: clampInt(seg[0], 0, maxSlot, 0),  // kep ve slot hop le (0..maxSlot)
      level: clampInt(seg[1], 1, 15, 1),      // kep level 1..15
      enabled: true,
    });
  }
  return rows;
}

// Ma hoa 4 dong troop -> cot "troops". Doi tat = o trong; bo cac o trong o CUOI cho gon.
function encodeTroopsSpec(troops) {
  const parts = (troops || []).slice(0, TROOPS.length)
    .map((t) => (t && t.enabled !== false ? `${t.type}:${t.level}` : ''));
  while (parts.length && parts[parts.length - 1] === '') parts.pop();
  return parts.join(';');
}

// Field "troops" hop le = o trong ('') hoac co chua ':' (type:level). Dung de nhan dang cot.
function looksLikeTroops(s) { return s === '' || String(s).includes(':'); }

// Parse CSV -> [{serial, name, useOwnConfig, config}]. Bo dong trong + dong header.
// Field boc quote giu nguyen dau phay. Ho tro 3 dinh dang:
//   v3 (chuan):  serial,name,useOwnConfig,gatherOn,troops,pollSec   (cot 5 = troops co ':' hoac rong)
//   v2 (rut gon): serial,name,gatherOn,troops,pollSec               (5 cot, khong co useOwnConfig)
//   v1 (cu):     serial,name,gatherOn,gatherType,gatherLevel,pollSec (ap cho ca 4 doi)
function parseCsv(text) {
  const out = [];
  const maxSlot = RESOURCE_TYPES.length - 1;
  for (const raw of String(text || '').split(/\r?\n/)) {
    if (!raw.trim()) continue; // dong trong
    const c = parseCsvLine(raw).map((x) => x.trim());
    if (/^serial$/i.test(c[0])) continue; // header
    const serial = c[0];
    if (!serial) continue;
    const name = c[1] || serial;

    let useOwnConfig = true; // mac dinh: import = cau hinh rieng (dinh dang cu khong co cot nay)
    let gatherOn; let troops; let pollSec;

    if (c.length >= 6 && looksLikeTroops(c[4])) {
      // v3: serial,name,useOwnConfig,gatherOn,troops,pollSec
      useOwnConfig = truthy(c[2]);
      gatherOn = truthy(c[3]);
      troops = parseTroopsSpec(c[4], maxSlot);
      pollSec = Math.max(10, toInt(c[5], 60));
    } else if (c.length >= 6) {
      // v1 cu: serial,name,gatherOn,gatherType,gatherLevel,pollSec -> ap cho ca 4 doi.
      gatherOn = truthy(c[2]);
      const type = clampInt(c[3], 0, maxSlot, 0);
      const level = clampInt(c[4], 1, 15, 1);
      troops = TROOPS.map(() => ({ type, level, enabled: true }));
      pollSec = Math.max(10, toInt(c[5], 60));
    } else {
      // v2 rut gon: serial,name,gatherOn,troops,pollSec
      gatherOn = truthy(c[2]);
      troops = parseTroopsSpec(c[3], maxSlot);
      pollSec = Math.max(10, toInt(c[4], 60));
    }

    out.push({
      serial, name, useOwnConfig,
      config: normalizeConfig({ gather: { enabled: gatherOn, troops }, pollSec }),
    });
  }
  return out;
}

// Import: them/cap nhat device + luu cau hinh theo cot useOwnConfig cua tung dong. Tra ve serial da import.
function importCsv(text) {
  const rows = parseCsv(text);
  for (const r of rows) saveDeviceConfig(r.serial, { config: r.config, useOwnConfig: r.useOwnConfig, name: r.name });
  return rows.map((r) => r.serial);
}

// Export tat ca device hien co ra CSV — giu day du: rieng/chung + tung doi (cot troops) + poll.
function exportCsv() {
  const lines = loadStore().devices.map((d) => {
    const cfg = effectiveConfig(d.serial); // gia tri THUC THI (rieng neu bat, khong thi chung)
    return [
      csvEscape(d.serial), csvEscape(d.name),
      d.useOwnConfig ? 1 : 0,
      cfg.gather.enabled ? 1 : 0,
      csvEscape(encodeTroopsSpec(cfg.gather.troops)),
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
  setDeviceGroup,
  saveDeviceConfig,
  effectiveConfig,
  // csv
  parseCsv,
  importCsv,
  exportCsv,
};
