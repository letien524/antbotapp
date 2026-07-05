'use strict';

// Lop truu tuong 1 thiet bi Android (emulator HOAC may that) dieu khien qua ADB.
// Ca hai deu la "device" co serial rieng => code gan nhu y het nhau.
//
// Backend capture mac dinh: `adb exec-out screencap -p` (don gian, cham ~0.5-2s/frame).
// Khi can farm nhanh, thay ham capture() bang minicap/scrcpy ma khong doi phan con lai.

const { execFile } = require('child_process');
const { makeLogger } = require('../logger');
const { CancelError } = require('../cancel');

function run(args, { binary = false, timeout = 15000 } = {}) {
  return new Promise((resolve, reject) => {
    execFile(
      'adb',
      args,
      { encoding: binary ? 'buffer' : 'utf8', timeout, maxBuffer: 64 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) return reject(new Error(`adb ${args.join(' ')} failed: ${stderr || err.message}`));
        resolve(stdout);
      }
    );
  });
}

class AdbDevice {
  constructor(serial) {
    this.serial = serial;
    this.log = makeLogger(`dev:${serial}`);
    this.size = null; // { width, height } - cache do phan giai
    this.cancelToken = null; // Worker gan token; thao tac se huy ngay khi token.cancel().
  }

  _args(rest) {
    return ['-s', this.serial, ...rest];
  }

  // Nem CancelError neu da bi yeu cau dung -> unwind task ngay.
  _check() {
    if (this.cancelToken) this.cancelToken.check();
  }

  // Sleep CO THE HUY: neu bi cancel giua chung -> reject ngay, khong cho het gio.
  sleep(ms) {
    return new Promise((resolve, reject) => {
      const token = this.cancelToken;
      if (token && token.cancelled) return reject(new CancelError());
      let iv = null;
      const t = setTimeout(() => { if (iv) clearInterval(iv); resolve(); }, ms);
      if (token) {
        iv = setInterval(() => {
          if (token.cancelled) { clearTimeout(t); clearInterval(iv); reject(new CancelError()); }
        }, 80);
      }
    });
  }

  // Doc LAI do phan giai (xoa cache) — goi khi bat dau chay bot phong khi doi emulator/do phan giai.
  async refreshSize() {
    this.size = null;
    return this.getScreenSize();
  }

  // Lay do phan giai man hinh (dung de quy doi toa do % -> pixel).
  async getScreenSize() {
    this._check();
    if (this.size) return this.size;
    const out = await run(this._args(['shell', 'wm', 'size']));
    // Vi du: "Physical size: 1280x720" hoac them "Override size: ..."
    const m = out.match(/(?:Override|Physical) size:\s*(\d+)x(\d+)/g);
    const last = m ? m[m.length - 1] : null;
    const nums = last && last.match(/(\d+)x(\d+)/);
    if (!nums) throw new Error(`Khong doc duoc do phan giai: ${out}`);
    this.size = { width: parseInt(nums[1], 10), height: parseInt(nums[2], 10) };
    return this.size;
  }

  // Chup man hinh -> tra ve Buffer PNG.
  async capture() {
    this._check();
    return run(this._args(['exec-out', 'screencap', '-p']), { binary: true });
  }

  // Tap theo pixel tuyet doi.
  async tap(x, y) {
    this._check();
    await run(this._args(['shell', 'input', 'tap', Math.round(x), Math.round(y)]));
  }

  // Tap theo ti le % (0..1) man hinh -> ben giua emulator va may that do phan giai khac nhau.
  async tapPct(xPct, yPct) {
    const { width, height } = await this.getScreenSize();
    await this.tap(xPct * width, yPct * height);
  }

  async swipe(x1, y1, x2, y2, durationMs = 300) {
    this._check();
    await run(
      this._args([
        'shell', 'input', 'swipe',
        Math.round(x1), Math.round(y1), Math.round(x2), Math.round(y2), durationMs,
      ])
    );
  }

  async swipePct(x1p, y1p, x2p, y2p, durationMs = 300) {
    const { width, height } = await this.getScreenSize();
    await this.swipe(x1p * width, y1p * height, x2p * width, y2p * height, durationMs);
  }

  // Bam phim he thong (BACK=4, HOME=3...).
  async keyevent(code) {
    this._check();
    await run(this._args(['shell', 'input', 'keyevent', code]));
  }
}

module.exports = { AdbDevice, adbRaw: run };
