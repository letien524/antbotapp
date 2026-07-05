'use strict';

// Phat hien va quan ly nhieu thiet bi (emulator + may that) qua `adb devices`.

const { AdbDevice, adbRaw } = require('./AdbDevice');

async function listSerials() {
  const out = await adbRaw(['devices']);
  return out
    .split('\n')
    .slice(1) // bo dong tieu de "List of devices attached"
    .map((l) => l.trim())
    .filter((l) => l && l.endsWith('\tdevice'))
    .map((l) => l.split('\t')[0]);
}

class DeviceManager {
  constructor() {
    this.devices = new Map(); // serial -> AdbDevice
  }

  async refresh() {
    const serials = await listSerials();
    for (const s of serials) {
      if (!this.devices.has(s)) this.devices.set(s, new AdbDevice(s));
    }
    // Bo device da rut ra.
    for (const s of [...this.devices.keys()]) {
      if (!serials.includes(s)) this.devices.delete(s);
    }
    return [...this.devices.values()];
  }

  get(serial) {
    return this.devices.get(serial);
  }

  all() {
    return [...this.devices.values()];
  }
}

module.exports = { DeviceManager, listSerials };
