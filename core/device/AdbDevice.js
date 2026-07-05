'use strict';

// Lop truu tuong 1 thiet bi Android (emulator HOAC may that) dieu khien qua ADB.
// Ca hai deu la "device" co serial rieng => code gan nhu y het nhau.
//
// Backend capture mac dinh: `adb exec-out screencap -p` (don gian, cham ~0.5-2s/frame).
// Khi can farm nhanh, thay ham capture() bang minicap/scrcpy ma khong doi phan con lai.

const { execFile } = require('child_process');
const Jimp = require('jimp');
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
    this.size = null; // { width, height } - cache do phan giai device
    this.gameArea = null; // { x, y, width, height } - vung GAME thuc (bo vien den tren/duoi)
    this.cancelToken = null; // Worker gan token; thao tac se huy ngay khi token.cancel().
  }

  // Vung game hien tai (mac dinh = full man hinh neu chua detect).
  area() {
    if (this.gameArea) return this.gameArea;
    const s = this.size || { width: 0, height: 0 };
    return { x: 0, y: 0, width: s.width, height: s.height };
  }

  // Doi toa do % (theo vung GAME) -> pixel tuyet doi tren man hinh.
  pctToPx(xPct, yPct) {
    const a = this.area();
    return [a.x + xPct * a.width, a.y + yPct * a.height];
  }

  // Doi 1 vung % (theo game) -> [x,y,w,h] pixel tuyet doi.
  regionToPx(region) {
    const a = this.area();
    return [
      Math.round(a.x + region.x * a.width), Math.round(a.y + region.y * a.height),
      Math.round(region.w * a.width), Math.round(region.h * a.height),
    ];
  }

  // Detect vung GAME thuc: mot so may co VIEN DEN tren/duoi (game khong full man hinh).
  // Quet cac hang den o tren/duoi de tim vung game o giua. Game rong = rong man hinh.
  async detectGameArea() {
    const { width, height } = await this.getScreenSize();
    let ga = { x: 0, y: 0, width, height };
    try {
      const img = await Jimp.read(await this.capture());
      const W = img.bitmap.width;
      const H = img.bitmap.height;
      const step = Math.max(1, Math.floor(W / 40));
      const rowIsBlack = (y) => {
        let dark = 0; let n = 0;
        for (let x = 0; x < W; x += step) {
          n += 1;
          const { r, g, b } = Jimp.intToRGBA(img.getPixelColor(x, y));
          if (r < 16 && g < 16 && b < 16) dark += 1;
        }
        return dark / n >= 0.97;
      };
      let top = 0;
      while (top < H * 0.25 && rowIsBlack(top)) top += 1;
      let bottom = H - 1;
      while (bottom > H * 0.75 && rowIsBlack(bottom)) bottom -= 1;
      if (top > 2 || bottom < H - 3) {
        ga = { x: 0, y: top, width: W, height: bottom - top + 1 };
        this.log.info(`[gameArea] vien den phat hien -> game o y=${top}..${bottom} (cao ${ga.height}/${H}).`);
      }
    } catch (e) { /* loi -> dung full man hinh */ }
    this.gameArea = ga;
    return ga;
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

  // Doc LAI do phan giai + detect vung game (xoa cache) — goi khi bat dau chay bot.
  async refreshSize() {
    this.size = null;
    this.gameArea = null;
    await this.getScreenSize();
    await this.detectGameArea();
    return this.size;
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

  // Tap theo ti le % (0..1) theo VUNG GAME (bo vien den) -> pixel tuyet doi.
  async tapPct(xPct, yPct) {
    await this.getScreenSize();
    const [x, y] = this.pctToPx(xPct, yPct);
    await this.tap(x, y);
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
    await this.getScreenSize();
    const [x1, y1] = this.pctToPx(x1p, y1p);
    const [x2, y2] = this.pctToPx(x2p, y2p);
    await this.swipe(x1, y1, x2, y2, durationMs);
  }

  // Bam phim he thong (BACK=4, HOME=3...).
  async keyevent(code) {
    this._check();
    await run(this._args(['shell', 'input', 'keyevent', code]));
  }
}

module.exports = { AdbDevice, adbRaw: run };
