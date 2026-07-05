'use strict';

// Electron main process = Orchestrator + cau noi UI.
// Mo hinh: cau hinh CHUNG (global) + danh sach DEVICE da them (moi device co the
// dung cau hinh rieng hoac dung chung). Home load cac device DA THEM.

const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const { fork } = require('child_process');
const { DeviceManager } = require('../core/device/DeviceManager');
const { logEmitter } = require('../core/logger');
const {
  accountForSerial, tasksFromConfig,
  HUNT_TYPES, RESOURCE_TYPES, TROOPS, CSV_HEADER,
  listDevices, deviceForSerial, addDevice, renameDevice, removeDevice, saveDeviceConfig,
  getGlobalConfig, saveGlobalConfig, effectiveConfig, normalizeConfig,
  importCsv, exportCsv, exportSettings, importSettings, CONFIG_PATH, HUNT_AUTO_TYPES,
} = require('../core/config');
const { readMarchQueue } = require('../core/state/StateReader');

const dm = new DeviceManager();
const DEVICE_WORKER = path.join(__dirname, '..', 'core', 'deviceWorker.js');

// Moi may = 1 CHILD PROCESS rieng (cach ly CPU khoi UI).
const procs = new Map();       // serial -> child process
const statusStore = new Map(); // serial -> { troopStatus, lastQueue, at } (child bao ve)
let win = null;

function createWindow() {
  win = new BrowserWindow({
    width: 1180,
    height: 760,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.loadFile(path.join(__dirname, '..', 'src', 'renderer', 'index.html'));
}

logEmitter.on('log', (entry) => {
  if (win && !win.isDestroyed()) win.webContents.send('log', entry);
});

// Tap serial dang online (adb thay).
async function onlineSerials() {
  const list = await dm.refresh();
  return new Set(list.map((d) => d.serial));
}

// Khoi dong 1 CHILD PROCESS cho serial. Child tu doc config + dieu khien may.
function startWorker(serial) {
  if (procs.has(serial)) return { running: true };
  const tasks = tasksFromConfig(accountForSerial(serial).config);
  if (tasks.length === 0) throw new Error('Chua bat task nao trong cau hinh');

  const child = fork(DEVICE_WORKER, [serial], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, // chay nhu Node thuan
  });
  procs.set(serial, child);

  child.on('message', (msg) => {
    if (!msg) return;
    if (msg.type === 'log') {
      if (win && !win.isDestroyed()) win.webContents.send('log', msg.entry);
    } else if (msg.type === 'status') {
      statusStore.set(serial, { troopStatus: msg.troopStatus || {}, lastQueue: msg.lastQueue || null, at: Date.now() });
    }
  });
  child.on('exit', () => { if (procs.get(serial) === child) procs.delete(serial); statusStore.delete(serial); });
  child.on('error', (e) => {
    if (win && !win.isDestroyed()) win.webContents.send('log', { level: 'ERROR', scope: `proc:${serial}`, line: `Child loi: ${e.message}` });
  });
  return { running: true, tasks };
}

// Dung child (Nut DUNG cua nguoi dung): gui 'stop' + cleanup (dung Auto Hunt trong game
// neu dang chay). Cho toi 12s de child kip mo popup + tap Stop truoc khi kill.
function stopWorker(serial) {
  const child = procs.get(serial);
  if (!child) return;
  procs.delete(serial);
  statusStore.delete(serial);
  try { child.send({ type: 'stop', cleanup: true }); } catch (e) { try { child.kill(); } catch (e2) { /* ignore */ } }
  const t = setTimeout(() => { try { child.kill(); } catch (e) { /* ignore */ } }, 12000);
  child.once('exit', () => clearTimeout(t));
}

// Dung roi cho child thoat han (dung khi restart de doi cu-moi khong tranh device).
// cleanup=true -> child dung Auto Hunt trong game truoc khi thoat (can nhieu thoi gian hon).
function stopWorkerAndWait(serial, cleanup = false) {
  return new Promise((resolve) => {
    const child = procs.get(serial);
    if (!child) return resolve();
    procs.delete(serial);
    statusStore.delete(serial);
    let done = false;
    const finish = () => { if (!done) { done = true; resolve(); } };
    child.once('exit', finish);
    try { child.send({ type: 'stop', cleanup }); } catch (e) { try { child.kill(); } catch (e2) {} finish(); }
    setTimeout(() => { try { child.kill(); } catch (e) {} finish(); }, cleanup ? 12000 : 4000);
  });
}

// Restart worker de ap dung config MOI. cleanup=true (khi cau hinh HUNT doi) -> dung Auto Hunt
// cu trong game truoc, de child moi bat lai hunt theo config moi (khong ke thua hunt cu).
async function restartIfRunning(serial, { cleanup = false } = {}) {
  if (!procs.has(serial)) return false;
  await stopWorkerAndWait(serial, cleanup);
  if (tasksFromConfig(accountForSerial(serial).config).length > 0) startWorker(serial);
  return true;
}

// ---- Home: danh sach DEVICE DA THEM (kem online/running/useOwnConfig) ----
ipcMain.handle('devices:list', async () => {
  const online = await onlineSerials();
  const out = [];
  for (const d of listDevices()) {
    let size = null;
    if (online.has(d.serial)) {
      const dev = dm.get(d.serial);
      if (dev) size = await dev.getScreenSize().catch(() => null);
    }
    out.push({
      serial: d.serial,
      name: d.name,
      useOwnConfig: d.useOwnConfig,
      online: online.has(d.serial),
      running: procs.has(d.serial),
      size,
    });
  }
  return out;
});

// Them device thu cong (serial + ten).
ipcMain.handle('device:add', async (_e, { serial, name }) => {
  if (!serial || !serial.trim()) throw new Error('Thieu serial');
  addDevice(serial.trim(), (name || '').trim());
  return { ok: true };
});

ipcMain.handle('device:rename', async (_e, { serial, name }) => {
  renameDevice(serial, name);
  return { ok: true };
});

ipcMain.handle('device:remove', async (_e, serial) => {
  stopWorker(serial);
  removeDevice(serial);
  return { ok: true };
});

// Load tat ca device DANG KET NOI vao danh sach da them.
ipcMain.handle('devices:loadAll', async () => {
  const list = await dm.refresh();
  const known = new Set(listDevices().map((d) => d.serial));
  let created = 0;
  for (const d of list) {
    if (!known.has(d.serial)) { addDevice(d.serial, d.serial); created += 1; }
  }
  return { total: list.length, created };
});

ipcMain.handle('device:capture', async (_e, serial) => {
  const d = dm.get(serial);
  if (!d) throw new Error('Device chua ket noi');
  const png = await d.capture();
  return `data:image/png;base64,${png.toString('base64')}`;
});

ipcMain.handle('device:state', async (_e, serial) => {
  const d = dm.get(serial);
  if (!d) throw new Error('Device chua ket noi');
  return readMarchQueue(d, accountForSerial(serial).config);
});

// Bang trang thai troop cua TAT CA may: queue (X/Y) + nhiem vu tung doi + trang thai.
ipcMain.handle('devices:troopTables', async () => {
  const online = await onlineSerials();
  const out = [];
  for (const dev of listDevices()) {
    const cfg = effectiveConfig(dev.serial);
    const st = statusStore.get(dev.serial); // child bao ve — main KHONG tu OCR (giu main nhe).
    const queue = (st && st.lastQueue) || null;
    const status = (st && st.troopStatus) || {};
    const allIdle = queue && queue.used === 0; // queue 0 -> moi doi deu ranh
    const troops = TROOPS.map((t) => ({
      idx: t.index,
      name: t.label,
      gather: null, // gather gio theo LOAI tai nguyen (global), khong per-troop
      hunt: null, // Auto Hunt cung global
      status: allIdle ? null : (status[t.index] || null),
    }));
    out.push({
      serial: dev.serial, name: dev.name,
      online: online.has(dev.serial), running: procs.has(dev.serial), queue, troops,
    });
  }
  return out;
});

// ---- Chay / dung worker ----
ipcMain.handle('worker:start', async (_e, serial) => {
  if (procs.has(serial)) return { running: true };
  return startWorker(serial);
});

ipcMain.handle('worker:stop', async (_e, serial) => {
  stopWorker(serial);
  return { running: false };
});

ipcMain.handle('workers:startAll', async () => {
  const online = await onlineSerials();
  const devs = listDevices();
  let started = 0;
  for (const d of devs) {
    if (!online.has(d.serial) || procs.has(d.serial)) continue;
    try { startWorker(d.serial); started += 1; } catch (e) { /* bo qua neu khong co task */ }
    // Stagger: cach nhau ~1.2s de cac child khong dong loat khoi tao nang cung luc.
    await new Promise((r) => setTimeout(r, 1200));
  }
  return { started, total: devs.length };
});

ipcMain.handle('workers:stopAll', async () => {
  const serials = [...procs.keys()];
  for (const s of serials) stopWorker(s);
  return { stopped: serials.length };
});

// ---- Meta cho UI ----
ipcMain.handle('config:meta', async () => ({
  huntTypes: HUNT_TYPES,
  huntAutoTypes: HUNT_AUTO_TYPES,
  resourceTypes: RESOURCE_TYPES,
  troops: TROOPS,
}));

// ---- Cau hinh CHUNG (global) ----
ipcMain.handle('config:getGlobal', async () => ({ config: getGlobalConfig() }));

ipcMain.handle('config:saveGlobal', async (_e, { config, applyToAll }) => {
  const beforeHunt = JSON.stringify(getGlobalConfig().hunt); // hunt cu (de biet co doi khong)
  saveGlobalConfig(config, { applyToAll });
  const huntChanged = JSON.stringify(getGlobalConfig().hunt) !== beforeHunt;
  // Restart cac worker dang dung cau hinh chung de ap dung ngay (applyToAll -> tat ca).
  // Neu hunt doi (hoac applyToAll ep may ve global) -> dung Auto Hunt cu de ap dung ngay.
  let restarted = 0;
  for (const d of listDevices()) {
    if ((!d.useOwnConfig || applyToAll) && procs.has(d.serial)) {
      await restartIfRunning(d.serial, { cleanup: huntChanged || !!applyToAll });
      restarted += 1;
    }
  }
  return { saved: true, restarted, applyToAll: !!applyToAll };
});

// ---- Cau hinh RIENG cua 1 device ----
ipcMain.handle('config:get', async (_e, serial) => {
  const dev = deviceForSerial(serial);
  const config = dev && dev.config ? normalizeConfig(dev.config) : getGlobalConfig();
  return {
    name: dev ? dev.name : serial,
    useOwnConfig: !!(dev && dev.useOwnConfig),
    config,
  };
});

ipcMain.handle('config:save', async (_e, { serial, config, useOwnConfig, name }) => {
  const beforeHunt = JSON.stringify(effectiveConfig(serial).hunt); // hunt cu dang chay
  saveDeviceConfig(serial, { config, useOwnConfig, name });
  const huntChanged = JSON.stringify(effectiveConfig(serial).hunt) !== beforeHunt;
  // Hunt doi -> dung Auto Hunt cu trong game de child moi bat lai theo config moi.
  const restarted = await restartIfRunning(serial, { cleanup: huntChanged });
  return { saved: true, restarted };
});

// ---- Import / Export CSV ----
ipcMain.handle('config:importCsv', async (_e, text) => {
  const serials = importCsv(text);
  for (const s of serials) await restartIfRunning(s, { cleanup: true });
  return { imported: serials.length, serials };
});

ipcMain.handle('config:exportCsv', async () => ({ csv: exportCsv(), header: CSV_HEADER }));

// ---- Backup / Restore TOAN BO settings (JSON) — de chuyen giua cac may ----
ipcMain.handle('settings:export', async () => ({ json: exportSettings(), path: CONFIG_PATH }));

ipcMain.handle('settings:import', async (_e, text) => {
  const n = importSettings(text);
  for (const s of [...procs.keys()]) await restartIfRunning(s, { cleanup: true });
  return { imported: n };
});

ipcMain.handle('settings:path', async () => ({ path: CONFIG_PATH }));

// Dung het child khi thoat app.
function killAllProcs() {
  for (const [serial, child] of procs) {
    try { child.send({ type: 'stop' }); } catch (e) { /* ignore */ }
    try { child.kill(); } catch (e) { /* ignore */ }
  }
  procs.clear();
}

app.whenReady().then(createWindow);

app.on('before-quit', killAllProcs);

app.on('window-all-closed', () => {
  killAllProcs();
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
