'use strict';

// Electron main process = Orchestrator + cau noi UI.
// Mo hinh: cau hinh CHUNG (global) + danh sach DEVICE da them (moi device co the
// dung cau hinh rieng hoac dung chung). Home load cac device DA THEM.

const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const { DeviceManager } = require('../core/device/DeviceManager');
const { Worker } = require('../core/scheduler/Worker');
const { logEmitter } = require('../core/logger');
const {
  accountForSerial, tasksFromConfig, defaultConfig,
  HUNT_TYPES, RESOURCE_TYPES, TROOPS, CSV_HEADER,
  listDevices, deviceForSerial, addDevice, renameDevice, removeDevice, saveDeviceConfig,
  getGlobalConfig, saveGlobalConfig, effectiveConfig, normalizeConfig,
  importCsv, exportCsv,
} = require('../core/config');
const { readMarchQueue } = require('../core/state/StateReader');

const dm = new DeviceManager();
const workers = new Map(); // serial -> Worker
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

// Khoi dong worker cho 1 serial (config thuc thi = rieng hoac chung).
async function startWorker(serial) {
  let d = dm.get(serial);
  if (!d) { await dm.refresh(); d = dm.get(serial); }
  if (!d) throw new Error('Device chua ket noi (offline)');
  const account = accountForSerial(serial);
  const tasks = tasksFromConfig(account.config);
  if (tasks.length === 0) throw new Error('Chua bat task nao trong cau hinh');
  const w = new Worker(d, { account });
  workers.set(serial, w);
  await w.start();
  return { running: true, tasks };
}

function stopWorker(serial) {
  const w = workers.get(serial);
  if (w) { w.stop(); workers.delete(serial); }
}

async function restartIfRunning(serial) {
  if (!workers.has(serial)) return false;
  stopWorker(serial);
  if (tasksFromConfig(accountForSerial(serial).config).length > 0) await startWorker(serial);
  return true;
}

// ---- Home: danh sach DEVICE DA THEM (kem online/running/useOwnConfig) ----
ipcMain.handle('devices:list', async () => {
  const online = await onlineSerials();
  return listDevices().map((d) => ({
    serial: d.serial,
    name: d.name,
    useOwnConfig: d.useOwnConfig,
    online: online.has(d.serial),
    running: workers.has(d.serial),
  }));
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
    const d = dm.get(dev.serial);
    let queue = null;
    if (online.has(dev.serial) && d) {
      try { queue = await readMarchQueue(d, cfg); } catch (e) { queue = null; }
    }
    const w = workers.get(dev.serial);
    const status = (w && w.troopStatus) || {};
    const allIdle = queue && queue.used === 0; // queue 0 -> moi doi deu ranh
    const troops = TROOPS.map((t) => {
      const g = cfg.gather.troops[t.index] || {};
      const h = cfg.hunt.troops[t.index] || {};
      return {
        idx: t.index,
        name: t.label,
        gather: (cfg.gather.enabled && g.enabled !== false) ? { type: g.type, level: g.level } : null,
        hunt: (cfg.hunt.enabled && h.enabled !== false) ? { type: h.type, level: h.level } : null,
        status: allIdle ? null : (status[t.index] || null),
      };
    });
    out.push({
      serial: dev.serial, name: dev.name,
      online: online.has(dev.serial), running: !!w, queue, troops,
    });
  }
  return out;
});

// ---- Chay / dung worker ----
ipcMain.handle('worker:start', async (_e, serial) => {
  if (workers.has(serial)) return { running: true };
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
    if (!online.has(d.serial) || workers.has(d.serial)) continue;
    try { await startWorker(d.serial); started += 1; } catch (e) { /* bo qua neu khong co task */ }
  }
  return { started, total: devs.length };
});

ipcMain.handle('workers:stopAll', async () => {
  const serials = [...workers.keys()];
  for (const s of serials) stopWorker(s);
  return { stopped: serials.length };
});

// ---- Meta cho UI ----
ipcMain.handle('config:meta', async () => ({
  huntTypes: HUNT_TYPES,
  resourceTypes: RESOURCE_TYPES,
  troops: TROOPS,
}));

// ---- Cau hinh CHUNG (global) ----
ipcMain.handle('config:getGlobal', async () => ({ config: getGlobalConfig() }));

ipcMain.handle('config:saveGlobal', async (_e, { config }) => {
  saveGlobalConfig(config);
  // Restart cac worker dang dung cau hinh chung de ap dung ngay.
  let restarted = 0;
  for (const d of listDevices()) {
    if (!d.useOwnConfig && workers.has(d.serial)) { await restartIfRunning(d.serial); restarted += 1; }
  }
  return { saved: true, restarted };
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
  saveDeviceConfig(serial, { config, useOwnConfig, name });
  const restarted = await restartIfRunning(serial);
  return { saved: true, restarted };
});

// ---- Import / Export CSV ----
ipcMain.handle('config:importCsv', async (_e, text) => {
  const serials = importCsv(text);
  for (const s of serials) await restartIfRunning(s);
  return { imported: serials.length, serials };
});

ipcMain.handle('config:exportCsv', async () => ({ csv: exportCsv(), header: CSV_HEADER }));

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  for (const w of workers.values()) w.stop();
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
