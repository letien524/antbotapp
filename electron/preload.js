'use strict';

// Cau noi an toan giua renderer va main (contextIsolation = true).
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  appInfo: () => ipcRenderer.invoke('app:info'),
  listDevices: () => ipcRenderer.invoke('devices:list'),
  capture: (serial) => ipcRenderer.invoke('device:capture', serial),
  getState: (serial) => ipcRenderer.invoke('device:state', serial),
  troopTables: () => ipcRenderer.invoke('devices:troopTables'),
  startWorker: (serial) => ipcRenderer.invoke('worker:start', serial),
  stopWorker: (serial) => ipcRenderer.invoke('worker:stop', serial),
  pauseWorker: (serial, immediate) => ipcRenderer.invoke('worker:pause', { serial, immediate }),
  resumeWorker: (serial) => ipcRenderer.invoke('worker:resume', serial),

  // Quan ly device
  addDevice: (serial, name) => ipcRenderer.invoke('device:add', { serial, name }),
  renameDevice: (serial, name) => ipcRenderer.invoke('device:rename', { serial, name }),
  setGroup: (serials, group) => ipcRenderer.invoke('device:setGroup', { serials, group }),
  removeDevice: (serial) => ipcRenderer.invoke('device:remove', serial),
  clearCache: (serial) => ipcRenderer.invoke('cache:clear', serial),
  clearAllCache: () => ipcRenderer.invoke('cache:clearAll'),

  // Cau hinh
  configMeta: () => ipcRenderer.invoke('config:meta'),
  getConfig: (serial) => ipcRenderer.invoke('config:get', serial),
  saveConfig: (serial, config, useOwnConfig, name) => ipcRenderer.invoke('config:save', { serial, config, useOwnConfig, name }),
  saveConfigMany: (serials, config, useOwnConfig) => ipcRenderer.invoke('config:saveMany', { serials, config, useOwnConfig }),
  getGlobalConfig: () => ipcRenderer.invoke('config:getGlobal'),
  saveGlobalConfig: (config, applyToAll) => ipcRenderer.invoke('config:saveGlobal', { config, applyToAll }),

  // Load hang loat + chay song song + CSV
  loadAllDevices: () => ipcRenderer.invoke('devices:loadAll'),
  startAll: () => ipcRenderer.invoke('workers:startAll'),
  stopAll: () => ipcRenderer.invoke('workers:stopAll'),
  pauseAll: (immediate) => ipcRenderer.invoke('workers:pauseAll', immediate),
  importCsv: (text) => ipcRenderer.invoke('config:importCsv', text),
  exportCsv: () => ipcRenderer.invoke('config:exportCsv'),
  exportSettings: () => ipcRenderer.invoke('settings:export'),
  importSettings: (text) => ipcRenderer.invoke('settings:import', text),
  settingsPath: () => ipcRenderer.invoke('settings:path'),

  onLog: (cb) => ipcRenderer.on('log', (_e, entry) => cb(entry)),
});
