# AntBot — The Ant: Underground Kingdom (farm da tai khoan)

Bot tu dong dieu khien game qua **ADB** (chay tren **emulator** hoac **may that**),
UI dashboard bang **Electron**. Nhan dien man hinh bang **template matching** (game khong co DOM).

> ⚠️ Auto-play vi pham ToS cua game, tai khoan co the bi ban (nhat la khi farm 24/7).
> Chi dung cho hoc tap/tai khoan phu. Repo nay khong ho tro ne he thong chong gian lan.

## Kien truc

```
Electron (UI + orchestrator)
   │  ADB (screencap + input)
   ▼
Android emulator / may that  ──►  screenshot
   ▲                                  │
   └──── tap/swipe ◄── vision (template matching)
```

- **1 device = 1 worker** chay doc lap (farm song song).
- Toa do luu theo **% man hinh** -> chay duoc tren nhieu do phan giai.
- Moi task la **state machine** nho (tim nut -> bam -> cho -> xac nhan).

## Cai dat

```bash
npm install
adb devices          # dam bao thay thiet bi
```

## Chay thu (CLI, khong can UI)

```bash
npm run devices      # liet ke thiet bi + do phan giai
npm run capture      # chup man hinh -> screenshots/latest.png
node cli.js run      # chay 1 vong task collectResources tren device dau tien
```

## Chay dashboard (Electron)

```bash
npm start
```

Cua so hien danh sach device, xem truoc man hinh real-time, nut Start/Stop worker cho tung device, va log.

## Them template (BAT BUOC de task hoat dong)

Task nhan dien nut bang anh mau. Xem `assets/templates/README.md`.
Chua co template -> task se log canh bao va bo qua (khong crash) — de ban test pipeline truoc.

## Cau truc thu muc

```
core/
  device/     AdbDevice, DeviceManager  (dieu khien ADB)
  vision/     matcher (template matching), screen (tien ich locate/tap/wait)
  tasks/      collectResources (task mau, dang state machine)
  scheduler/  Worker (vong lap task theo device)
electron/     main + preload (orchestrator + IPC)
src/renderer/ dashboard HTML/JS
config/       accounts.json (map account <-> serial)
assets/templates/  anh mau nhan dien
```

## Loi trinh nang cap khi can

- **Toc do screenshot**: thay `adb screencap` bang **scrcpy/minicap** + **minitouch** (farm nhanh).
- **Vision**: thay matcher pure-JS bang **@u4/opencv4nodejs** (matchTemplate cua OpenCV) — giu nguyen chu ky `findTemplate()`.
- **OCR** (doc so tai nguyen/level): them Tesseract/PaddleOCR.
- **Cach ly worker**: chuyen tung worker sang `worker_threads`/`child_process` khi so device lon.
- **UI**: nang tu HTML thuan len React + Vite khi can phuc tap hon.
```
