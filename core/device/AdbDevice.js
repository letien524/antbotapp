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
      {
        encoding: binary ? 'buffer' : 'utf8',
        timeout,
        maxBuffer: 64 * 1024 * 1024,
        windowsHide: true, // Windows: khong tao/nhap nhay cua so console moi lan spawn
      },
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
    this.size = null; // { width, height } - cache do phan giai device (theo wm size = he TAP)
    // Vung GAME thuc luu dang PHAN TRAM chieu cao (vien den chi o TREN/DUOI, x=0 w=1).
    // Luu % de dung dung cho CA HAI he toa do (thuong bang nhau, mot so may khac nhau):
    //   - He TAP (wm size): input tap dung he nay -> area().
    //   - He ANH chup (screencap px): crop OCR / so khop template -> imageArea(img).
    this.gameFrac = null; // { yFrac, hFrac }
    this.cancelToken = null; // Worker gan token; thao tac se huy ngay khi token.cancel().
  }

  // Vung game theo HE TOA DO TAP (wm size). Dung cho pctToPx (tap) va templateScale.
  area() {
    const s = this.size || { width: 0, height: 0 };
    const f = this.gameFrac || { yFrac: 0, hFrac: 1 };
    return {
      x: 0,
      y: Math.round(f.yFrac * s.height),
      width: s.width,
      height: Math.round(f.hFrac * s.height),
    };
  }

  // Vung game theo PIXEL cua 1 ANH chup cu the. Dung cho crop OCR / so khop mau.
  // (Anh chup co the khac do phan giai wm size -> phai tinh theo kich thuoc anh.)
  imageArea(img) {
    const W = img.bitmap.width;
    const H = img.bitmap.height;
    const f = this.gameFrac || { yFrac: 0, hFrac: 1 };
    return {
      x: 0,
      y: Math.round(f.yFrac * H),
      width: W,
      height: Math.round(f.hFrac * H),
    };
  }

  // Doi toa do % (theo vung GAME) -> pixel tuyet doi he TAP (wm size).
  pctToPx(xPct, yPct) {
    const a = this.area();
    return [a.x + xPct * a.width, a.y + yPct * a.height];
  }

  // Doi 1 vung % (theo game) -> [x,y,w,h] he TAP (wm size).
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
    await this.getScreenSize();
    let yFrac = 0;
    let hFrac = 1;
    try {
      const img = await Jimp.read(await this.capture());
      const W = img.bitmap.width;
      const H = img.bitmap.height;
      const step = Math.max(1, Math.floor(W / 40));
      // 1 hang la "vien den" neu >=97% diem gan nhu den (chong nham voi canh game toi).
      const rowIsBlack = (y) => {
        let dark = 0; let n = 0;
        for (let x = 0; x < W; x += step) {
          n += 1;
          const { r, g, b } = Jimp.intToRGBA(img.getPixelColor(x, y));
          if (r < 20 && g < 20 && b < 20) dark += 1;
        }
        return dark / n >= 0.97;
      };
      // Quet vien den tu tren xuong / tu duoi len (toi da 40% moi ben).
      let top = 0;
      while (top < H * 0.4 && rowIsBlack(top)) top += 1;
      let bottom = H - 1;
      while (bottom > H * 0.6 && rowIsBlack(bottom)) bottom -= 1;
      if (top > 2 || bottom < H - 3) {
        yFrac = top / H;
        hFrac = (bottom - top + 1) / H;
        this.log.info(`[gameArea] vien den: game chiem ${(hFrac * 100).toFixed(1)}% chieu cao (tu ${(yFrac * 100).toFixed(1)}% den ${((yFrac + hFrac) * 100).toFixed(1)}%).`);
      } else {
        this.log.info('[gameArea] khong co vien den -> game full man hinh.');
      }
    } catch (e) { /* loi -> dung full man hinh (yFrac=0, hFrac=1) */ }
    this.gameFrac = { yFrac, hFrac };
    return this.area();
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
    this.gameFrac = null;
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

  // Bam CUNG 1 diem (theo %) `count` lan trong 1 LENH adb duy nhat (chuoi 'input tap' noi
  // bang ';'). Giam manh so lan spawn process -> nhanh hon nhieu tren Windows.
  // `input` tren may co do tre san (~30-50ms) nen cac tap van cach nhau du de game nhan.
  async tapRepeat(xPct, yPct, count) {
    const n = Math.max(0, parseInt(count, 10) || 0);
    if (n === 0) return;
    this._check();
    await this.getScreenSize();
    const [x, y] = this.pctToPx(xPct, yPct);
    const rx = Math.round(x);
    const ry = Math.round(y);
    const one = `input tap ${rx} ${ry}`;
    try {
      // Chen 'sleep' nho GIUA cac tap (chay tren may) de game KHONG ROT tap (bam qua nhanh
      // se mat tap -> sai level). Van chi 1 lan spawn adb -> nhanh tren Windows.
      const cmd = Array(n).fill(one).join(' && sleep 0.05 && ');
      await run(this._args(['shell', cmd]));
    } catch (e) {
      // May khong ho tro 'sleep' phan so / chuoi lenh -> tap tung cai (co sleep phia host).
      this.log.warn(`[tapRepeat] gop lenh loi (${e.message}) -> tap tung cai.`);
      for (let i = 0; i < n; i += 1) { this._check(); await this.tap(rx, ry); await this.sleep(55); }
    }
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

  // Luu anh man hinh hien tai ra ~/.antbot/debug/ de chan doan (gui cho dev xem).
  async saveDebugShot(label = 'debug') {
    try {
      const os = require('os');
      const fs = require('fs');
      const path = require('path');
      const dir = path.join(os.homedir(), '.antbot', 'debug');
      fs.mkdirSync(dir, { recursive: true });
      const safe = String(this.serial).replace(/[^a-z0-9]/gi, '_');
      const p = path.join(dir, `${label}-${safe}.png`);
      fs.writeFileSync(p, await this.capture());
      this.log.info(`[debug] Da luu anh man hinh de chan doan: ${p}`);
      return p;
    } catch (e) {
      this.log.warn(`[debug] luu anh that bai: ${e.message}`);
      return null;
    }
  }

  // Bam phim he thong (BACK=4, HOME=3...).
  async keyevent(code) {
    this._check();
    await run(this._args(['shell', 'input', 'keyevent', code]));
  }
}

module.exports = { AdbDevice, adbRaw: run };
