'use strict';

// CLI demo de test pipeline nhanh (khong can Electron).
//
//   npm run devices          -> liet ke thiet bi
//   npm run capture          -> chup man hinh device dau tien -> screenshots/latest.png
//   node cli.js size         -> in do phan giai
//   node cli.js run          -> chay 1 vong task collectResources tren device dau tien
//   node cli.js run <serial> -> chi dinh serial

const fs = require('fs');
const path = require('path');
const { DeviceManager } = require('./core/device/DeviceManager');
const { Worker } = require('./core/scheduler/Worker');
const { accountForSerial } = require('./core/config');

async function pickDevice(dm, serialArg) {
  await dm.refresh();
  const all = dm.all();
  if (all.length === 0) throw new Error('Khong co device nao. Kiem tra `adb devices`.');
  if (serialArg) {
    const d = dm.get(serialArg);
    if (!d) throw new Error(`Khong thay device ${serialArg}`);
    return d;
  }
  return all[0];
}

async function main() {
  const [cmd = 'devices', arg] = process.argv.slice(2);
  const dm = new DeviceManager();

  if (cmd === 'devices') {
    const list = await dm.refresh();
    console.log(`Tim thay ${list.length} device:`);
    for (const d of list) {
      const size = await d.getScreenSize().catch(() => null);
      console.log(`  - ${d.serial}${size ? `  (${size.width}x${size.height})` : ''}`);
    }
    return;
  }

  if (cmd === 'size') {
    const d = await pickDevice(dm, arg);
    console.log(await d.getScreenSize());
    return;
  }

  if (cmd === 'capture') {
    const d = await pickDevice(dm, arg);
    const png = await d.capture();
    const outDir = path.join(__dirname, 'screenshots');
    fs.mkdirSync(outDir, { recursive: true });
    const out = path.join(outDir, 'latest.png');
    fs.writeFileSync(out, png);
    console.log(`Da chup ${png.length} bytes -> ${out}`);
    return;
  }

  if (cmd === 'run') {
    const d = await pickDevice(dm, arg);
    const account = accountForSerial(d.serial);
    if (account && account.name) d.setName(account.name); // log hien ten may
    const size = await d.refreshSize().catch(() => null);
    console.log(`Chay task tren ${d.serial} (${account ? account.name : 'khong co config'})${size ? ` [${size.width}x${size.height}]` : ''}. Ctrl+C de dung.`);
    const worker = new Worker(d, { account });
    process.on('SIGINT', () => {
      worker.stop();
      setTimeout(() => process.exit(0), 500);
    });
    await worker.start();
    return;
  }

  console.log('Lenh khong hop le. Dung: devices | size | capture | run [serial]');
}

main().catch((e) => {
  console.error('Loi:', e.message);
  process.exit(1);
});
