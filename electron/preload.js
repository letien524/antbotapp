'use strict';

// Cau noi an toan giua renderer va main (contextIsolation = true).
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  listDevices: () => ipcRenderer.invoke('devices:list'),
  capture: (serial) => ipcRenderer.invoke('device:capture', serial),
  getState: (serial) => ipcRenderer.invoke('device:state', serial),
  troopTables: () => ipcRenderer.invoke('devices:troopTables'),
  startWorker: (serial) => ipcRenderer.invoke('worker:start', serial),
  stopWorker: (serial) => ipcRenderer.invoke('worker:stop', serial),

  // Quan ly device
  addDevice: (serial, name) => ipcRenderer.invoke('device:add', { serial, name }),
  renameDevice: (serial, name) => ipcRenderer.invoke('device:rename', { serial, name }),
  removeDevice: (serial) => ipcRenderer.invoke('device:remove', serial),

  // Cau hinh
  configMeta: () => ipcRenderer.invoke('config:meta'),
  getConfig: (serial) => ipcRenderer.invoke('config:get', serial),
  saveConfig: (serial, config, useOwnConfig, name) => ipcRenderer.invoke('config:save', { serial, config, useOwnConfig, name }),
  getGlobalConfig: () => ipcRenderer.invoke('config:getGlobal'),
  saveGlobalConfig: (config) => ipcRenderer.invoke('config:saveGlobal', { config }),

  // Load hang loat + chay song song + CSV
  loadAllDevices: () => ipcRenderer.invoke('devices:loadAll'),
  startAll: () => ipcRenderer.invoke('workers:startAll'),
  stopAll: () => ipcRenderer.invoke('workers:stopAll'),
  importCsv: (text) => ipcRenderer.invoke('config:importCsv', text),
  exportCsv: () => ipcRenderer.invoke('config:exportCsv'),

  onLog: (cb) => ipcRenderer.on('log', (_e, entry) => cb(entry)),
});
