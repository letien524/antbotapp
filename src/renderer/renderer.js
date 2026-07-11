'use strict';

// Renderer moi (Control Room). Giu NGUYEN hop dong window.api.* — chi thay tang trinh bay:
//  - Card thiet bi HOP NHAT danh sach + trang thai troop + queue + hanh dong.
//  - Cau hinh trong DRAWER truot phai (device / global).
//  - Log trong CONSOLE dock day, loc theo cap.

const $ = (id) => document.getElementById(id);
const gridEl = $('deviceGrid');
const kpisEl = $('kpis');
const fleetEl = $('fleetPills');
const logsEl = $('logs');

let meta = { resourceTypes: [], troops: [] };
let filter = 'all';        // all | running | idle | offline
let searchText = '';
let merged = [];           // du lieu thiet bi da gop
let configSerial = null;
let configSerials = [];    // bulk config: danh sach may da chon
let configMode = 'device'; // device | global | bulk
let gRowEls = [];
const logLevels = { INFO: true, WARN: true, ERROR: true };

// Kieu hien thi + che do "dung" duoc nho lai giua cac phien.
let viewMode = localStorage.getItem('antbot.viewMode') || 'grid'; // grid | list
let haltMode = localStorage.getItem('antbot.haltMode') || 'stop';  // stop | pause | pause-soft
const selected = new Set(); // serial da tick (chi dung o list view)

// Cac che do "dung" cho split-button. stop = kill han; pause = treo ngay; pause-soft = xong luot roi treo.
const HALT_MODES = {
  stop:         { label: 'Dừng',            menu: 'Dừng hẳn',           cls: 'danger', hint: 'Dừng hẳn — tắt tiến trình worker của máy.' },
  pause:        { label: 'Tạm dừng ngay',   menu: 'Tạm dừng ngay',      cls: 'warn',   hint: 'Tạm dừng ngay — huỷ lượt đang chạy tức thì, giữ tiến trình (bấm Tiếp tục để chạy lại).' },
  'pause-soft': { label: 'Tạm dừng lượt sau', menu: 'Tạm dừng lượt sau', cls: 'warn',  hint: 'Tạm dừng lượt sau — để lượt hiện tại chạy xong rồi mới treo.' },
};
// Cac muc trong dropdown chon che do dung (co danh dau ✓ che do dang chon). Dung chung card/list/bulk.
function haltItemsHtml() {
  const item = (m, icon) => `<button data-halt="${m}" class="${haltMode === m ? 'active' : ''}">${icon}${HALT_MODES[m].menu}${haltMode === m ? '<span class="mk">✓</span>' : ''}</button>`;
  return item('stop', IC_STOP) + item('pause', IC_PAUSE) + item('pause-soft', IC_PAUSE);
}
function setHaltMode(m) { if (HALT_MODES[m]) { haltMode = m; localStorage.setItem('antbot.haltMode', m); } }
async function execHalt(serial, mode) {
  if (mode === 'stop') return window.api.stopWorker(serial);
  return window.api.pauseWorker(serial, mode !== 'pause-soft'); // pause = immediate; pause-soft = xong luot
}

function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
function fmtTime(t) { const d = new Date(t || Date.now()); return d.toTimeString().slice(0, 8); }

// ---- Toast ----
function toast(msg, isErr) {
  const t = document.createElement('div');
  t.className = 'toast' + (isErr ? ' err' : '');
  t.textContent = msg;
  $('toasts').appendChild(t);
  setTimeout(() => t.remove(), 3800);
}
function toastErr(e) { const m = e && e.message ? e.message : String(e); toast(m, true); addLog({ level: 'ERROR', line: '[UI] ' + m }); }

// ---- Logs ----
function addLog(entry) {
  const lvl = (entry.level || 'INFO').toUpperCase();
  const cls = lvl === 'ERROR' ? 'err' : lvl === 'WARN' ? 'warn' : 'info';
  const div = document.createElement('div');
  div.className = 'lg ' + cls + (logLevels[lvl] ? '' : ' hide');
  div.dataset.lvl = lvl;
  const scope = entry.scope ? String(entry.scope).split(':').pop() : '';
  const msg = entry.msg || entry.line || '';
  div.innerHTML = `<span class="ts">${fmtTime(entry.time)}</span>${scope ? `<span class="tag">${esc(scope)}</span>` : ''}<span class="msg">${esc(msg)}</span>`;
  logsEl.appendChild(div);
  logsEl.scrollTop = logsEl.scrollHeight;
  while (logsEl.children.length > 500) logsEl.removeChild(logsEl.firstChild);
}
window.api.onLog(addLog);

// ---- Type / job labels ----
function typeName(slot) {
  const t = (meta.resourceTypes || []).find((x) => x.slot === Number(slot));
  return t ? t.label.split(' (')[0] : ('ô ' + slot);
}
function agoLabel(ts) {
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 60) return s + 's';
  return Math.round(s / 60) + 'p';
}

// ---- Merge + render fleet ----
async function renderAll(force = false) {
  // Tam dung refresh dinh ky khi dang chinh sua (drawer/menu/rename) de khong ghi de.
  // `force` = hanh dong nguoi dung (chay/dung/xoa...) -> luon ve lai, khong bi guard chan.
  if (!force) {
    if ($('drawer').classList.contains('open')) return;
    if (document.querySelector('.menu.show') || document.querySelector('.nm input')) return;
  }
  let list = [];
  let tables = [];
  try { list = await window.api.listDevices(); } catch (e) { return; }
  try { tables = await window.api.troopTables(); } catch (e) { /* van hien list */ }
  const tByS = new Map(tables.map((t) => [t.serial, t]));
  merged = list.map((d) => {
    const t = tByS.get(d.serial) || {};
    return { ...d, queue: t.queue || null, troops: t.troops || null };
  });
  // Bo serial khong con ton tai khoi tap da chon (may bi xoa/mat).
  const present = new Set(merged.map((d) => d.serial));
  for (const s of [...selected]) if (!present.has(s)) selected.delete(s);
  renderFleet();
  renderKpis();
  renderCounts();
  renderTopActions();
  renderDevices();
}

// Bat/tat + dong bo nut top-bar theo trang thai dan:
//  - Chay tat ca: bam duoc khi CO may co the chay (online + chua chay) HOAC dang tam dung (se tiep tuc).
//  - Halt tat ca (split): bam duoc khi CO may dang chay; nhan/mau/menu theo che do dung dang chon
//    (dung chung haltMode voi tung may -> doi che do o day thi nut o cac may cung doi theo).
function renderTopActions() {
  const canStart = merged.some((d) => (d.online && !d.running) || d.paused);
  const canStop = merged.some((d) => d.running);
  const sa = $('startAll');
  if (sa) { sa.disabled = !canStart; sa.title = canStart ? 'Chạy máy đang dừng + tiếp tục máy tạm dừng' : 'Không có máy nào để chạy'; }

  const hm = HALT_MODES[haltMode] || HALT_MODES.stop;
  const cls = `btn ghost ${hm.cls === 'danger' ? 'danger' : 'warn'}`;
  const ha = $('haltAll');
  if (ha) {
    ha.className = cls;
    ha.disabled = !canStop;
    ha.title = hm.hint + ' — áp cho mọi máy đang chạy.';
    ha.innerHTML = `${haltIcon(haltMode)}${haltMode === 'stop' ? 'Dừng tất cả' : 'Tạm dừng tất cả'}`;
  }
  const caret = $('haltAllMenu');
  if (caret) caret.className = cls + ' caret';
  const menu = $('haltAllMenuList');
  if (menu) {
    menu.innerHTML = haltItemsHtml();
    menu.querySelectorAll('[data-halt]').forEach((b) => b.onclick = async (e) => {
      e.stopPropagation(); closeMenus(); setHaltMode(b.dataset.halt);
      if (merged.some((d) => d.running)) await haltAll();
      else { toast(`Đã chọn chế độ dừng: ${HALT_MODES[b.dataset.halt].menu}`); renderAll(true); }
    });
  }
}

// Halt TAT CA theo che do dang chon: stop = dung han; pause/pause-soft = tam dung (ngay/luot sau).
async function haltAll() {
  try {
    if (haltMode === 'stop') { const r = await window.api.stopAll(); toast(`Đã dừng ${r.stopped} máy.`); }
    else { const r = await window.api.pauseAll(haltMode !== 'pause-soft'); toast(`Đã ${HALT_MODES[haltMode].menu.toLowerCase()} ${r.paused} máy.`); }
  } catch (e) { toastErr(e); }
  renderAll(true);
}

function renderFleet() {
  const online = merged.filter((d) => d.online).length;
  const running = merged.filter((d) => d.running).length;
  let used = 0; let total = 0;
  for (const d of merged) if (d.online && d.queue) { used += d.queue.used; total += d.queue.total; }
  fleetEl.innerHTML = `
    <span class="fpill"><span class="dot ok"></span>Trực tuyến <b>${online}/${merged.length}</b></span>
    <span class="fpill"><span class="dot run"></span>Đang chạy <b>${running}</b></span>
    <span class="fpill">Đội ra trận <b>${used}/${total}</b></span>`;
}

function renderKpis() {
  const online = merged.filter((d) => d.online).length;
  const running = merged.filter((d) => d.running).length;
  let used = 0; let total = 0; let free = 0;
  for (const d of merged) if (d.online && d.queue) { used += d.queue.used; total += d.queue.total; free += d.queue.free; }
  const pct = (a, b) => (b > 0 ? Math.round((a / b) * 100) : 0);
  kpisEl.innerHTML = `
    <div class="kpi"><div class="k-label">Máy trực tuyến</div><div class="k-val">${online}<em> / ${merged.length}</em></div>
      <div class="k-sub">${merged.length - online} máy ngoại tuyến</div><div class="meter"><span style="width:${pct(online, merged.length)}%"></span></div></div>
    <div class="kpi"><div class="k-label">Worker đang chạy</div><div class="k-val">${running}</div>
      <div class="k-sub"><span class="dot run"></span>đang farm</div><div class="meter"><span style="width:${pct(running, merged.length || 1)}%"></span></div></div>
    <div class="kpi"><div class="k-label">Đội ra trận</div><div class="k-val">${used}<em> / ${total}</em></div>
      <div class="k-sub">${pct(used, total)}% công suất đội</div><div class="meter"><span style="width:${pct(used, total)}%"></span></div></div>
    <div class="kpi"><div class="k-label">Ô trống sẵn sàng</div><div class="k-val">${free}</div>
      <div class="k-sub">đội có thể nhận lượt mới</div></div>`;
}

function renderCounts() {
  const c = { all: merged.length, running: 0, idle: 0, offline: 0 };
  for (const d of merged) {
    if (!d.online) c.offline += 1;
    else if (d.running) c.running += 1;
    else c.idle += 1;
  }
  document.querySelectorAll('[data-cnt]').forEach((el) => { el.textContent = c[el.dataset.cnt]; });
}

function passFilter(d) {
  if (filter === 'running' && !d.running) return false;
  if (filter === 'idle' && (!d.online || d.running)) return false;
  if (filter === 'offline' && d.online) return false;
  if (searchText) {
    const s = (d.name + ' ' + d.serial).toLowerCase();
    if (!s.includes(searchText)) return false;
  }
  return true;
}

// ---- Troop rows in card ----
function troopRowsHtml(d) {
  if (!d.online) return '<div class="troop disabled"><span class="tdot"></span><span class="job">Mất kết nối — không đọc được trạng thái</span></div>';
  const troops = d.troops || [];
  const shown = troops.filter((t) => t.gather || t.status);
  if (!shown.length) return '<div class="troop disabled"><span class="tdot"></span><span class="job">Chưa bật đội nào</span></div>';
  return shown.map((t) => {
    if (t.status) {
      const s = t.status;
      return `<div class="troop busy"><span class="tdot"></span><span class="tn">${esc(t.name.split(' ')[0] + ' ' + (t.idx + 1))}</span>
        <span class="job">Gather <b>${esc(typeName(s.type))}</b> L${s.level}</span><span class="timer">${agoLabel(s.at)}</span></div>`;
    }
    if (t.gather) {
      return `<div class="troop free"><span class="tdot"></span><span class="tn">Đội ${t.idx + 1}</span>
        <span class="job">Gather <b>${esc(typeName(t.gather.type))}</b> L${t.gather.level}</span>${d.running ? '<span class="timer">sẵn sàng</span>' : '<span class="timer" style="background:var(--s2);color:var(--muted)">chưa chạy</span>'}</div>`;
    }
    return `<div class="troop disabled"><span class="tdot"></span><span class="tn">Đội ${t.idx + 1}</span><span class="job">Đã tắt</span></div>`;
  }).join('');
}

function queueHtml(d) {
  if (!d.online || !d.queue) {
    return `<div class="queue"><div><div class="q-label">Hàng quân</div><div class="q-num" style="color:var(--faint)">—</div></div>
      <div class="qbar"><i></i><i></i></div><span class="q-free mut">${d.online ? 'Đang đọc…' : 'Mất kết nối'}</span></div>`;
  }
  const q = d.queue;
  const cells = Math.min(q.total, 6);
  let bar = '';
  for (let i = 0; i < cells; i += 1) bar += `<i class="${i < q.used ? (q.free <= 0 ? 'full' : 'on') : ''}"></i>`;
  const freeCls = q.free <= 0 ? 'none' : '';
  const freeTxt = q.free <= 0 ? 'Hết chỗ' : `${q.free} chỗ trống`;
  return `<div class="queue"><div><div class="q-label">Hàng quân</div><div class="q-num">${q.used}<small>/${q.total}</small></div></div>
    <div class="qbar">${bar}</div><span class="q-free ${freeCls}">${freeTxt}</span></div>`;
}

const AVATAR_PHONE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><rect x="6" y="2" width="12" height="20" rx="3"/><path d="M10 19h4"/></svg>';
const AVATAR_EMU = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><rect x="2" y="4" width="20" height="14" rx="2.5"/><path d="M8 21h8M12 18v3"/></svg>';
const IC_GEAR = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="3"/><path d="M19 12a7 7 0 0 0-.1-1l2-1.5-2-3.4-2.3 1a7 7 0 0 0-1.7-1l-.3-2.5H10l-.3 2.5a7 7 0 0 0-1.7 1l-2.3-1-2 3.4 2 1.5a7 7 0 0 0 0 2l-2 1.5 2 3.4 2.3-1a7 7 0 0 0 1.7 1l.3 2.5h3.7l.3-2.5a7 7 0 0 0 1.7-1l2.3 1 2-3.4-2-1.5a7 7 0 0 0 .1-1z"/></svg>';
const IC_DOTS = '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>';
const IC_PLAY = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>';
const IC_STOP = '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>';
const IC_PAUSE = '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>';
const IC_RESUME = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>';
const IC_CARET = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 9l6 6 6-6z"/></svg>';

// Icon + nhan tuong ung che do "dung" hien tai.
function haltIcon(mode) { return mode === 'stop' ? IC_STOP : IC_PAUSE; }

// State pill dung chung cho card + list row.
function statePillHtml(d) {
  if (!d.online) return '<span class="state-pill off"><span class="dot off"></span>Ngoại tuyến</span>';
  if (d.running && d.paused) return `<span class="state-pill paused">${IC_PAUSE}Tạm dừng</span>`;
  if (d.running) return '<span class="state-pill run"><span class="dot run"></span>RUNNING</span>';
  return '<span class="state-pill idle">Rảnh</span>';
}

// Cum nut dieu khien bot (start / halt-split / resume) — dung chung card + list.
function controlsHtml(d) {
  if (!d.online) return `<button class="btn primary" disabled>${IC_PLAY}Chạy</button>`;
  if (!d.running) return `<button class="btn primary" data-act="start">${IC_PLAY}Chạy</button>`;
  if (d.paused) return `<button class="btn warn" data-act="resume">${IC_RESUME}Tiếp tục</button><button class="btn danger" data-act="stop">${IC_STOP}Dừng</button>`;
  const hm = HALT_MODES[haltMode] || HALT_MODES.stop;
  return `<div class="split">
    <button class="btn ${hm.cls}" data-act="halt" title="${esc(hm.hint)}">${haltIcon(haltMode)}${hm.label}</button>
    <button class="btn ${hm.cls} caret" data-act="haltmenu" title="Chọn thao tác dừng">${IC_CARET}</button>
    <div class="menu haltmenu">${haltItemsHtml()}</div>
  </div>`;
}

// Wire cum dieu khien bot cho 1 phan tu (card hoac list row).
function wireControls(el, d) {
  const act = (name, fn) => { const b = el.querySelector(`[data-act="${name}"]`); if (b) b.onclick = fn; };
  act('start', async (e) => { e.stopPropagation(); try { await window.api.startWorker(d.serial); toast('Đã chạy ' + d.name); } catch (er) { toastErr(er); } finally { renderAll(true); } });
  act('stop', async (e) => { e.stopPropagation(); try { await window.api.stopWorker(d.serial); toast('Đã dừng ' + d.name); } catch (er) { toastErr(er); } finally { renderAll(true); } });
  act('resume', async (e) => { e.stopPropagation(); try { await window.api.resumeWorker(d.serial); toast('Tiếp tục ' + d.name); } catch (er) { toastErr(er); } finally { renderAll(true); } });
  act('halt', async (e) => {
    e.stopPropagation();
    const hm = HALT_MODES[haltMode] || HALT_MODES.stop;
    try { await execHalt(d.serial, haltMode); toast(`${hm.label} ${d.name}`); } catch (er) { toastErr(er); } finally { renderAll(true); }
  });
  act('haltmenu', (e) => {
    e.stopPropagation();
    const m = el.querySelector('.haltmenu');
    const wasOpen = m.classList.contains('show');
    closeMenus();
    if (!wasOpen) m.classList.add('show');
  });
  el.querySelectorAll('.haltmenu [data-halt]').forEach((b) => b.onclick = async (e) => {
    e.stopPropagation(); closeMenus();
    const m = b.dataset.halt; setHaltMode(m);
    try { await execHalt(d.serial, m); toast(`${HALT_MODES[m].label} ${d.name}`); } catch (er) { toastErr(er); } finally { renderAll(true); }
  });
}

// Dispatcher: render theo kieu hien thi hien tai (card / list).
function renderDevices() {
  gridEl.classList.toggle('list', viewMode === 'list');
  renderGroupBar();
  updateBulkBar();
  const items = merged.filter(passFilter);
  if (viewMode === 'list') renderList(items); else renderCards(items);
}

function renderCards(items) {
  gridEl.innerHTML = '';
  if (!merged.length) { gridEl.innerHTML = '<div class="empty">Chưa có thiết bị. Bấm <b>Nạp thiết bị</b> hoặc <b>Thêm máy</b>.</div>'; return; }
  if (!items.length) { gridEl.innerHTML = '<div class="empty">Không có máy khớp bộ lọc.</div>'; return; }

  for (const d of items) {
    const isEmu = /^\d{1,3}(\.\d{1,3}){3}:\d+$/.test(d.serial) || d.serial.includes('emulator');
    const sizeTxt = d.size ? ` · ${d.size.width}×${d.size.height}` : '';

    const card = document.createElement('div');
    card.className = 'card' + (d.running ? ' run' : '') + (d.online ? '' : ' offline');
    card.innerHTML = `
      <div class="card-top">
        <div class="avatar">${isEmu ? AVATAR_EMU : AVATAR_PHONE}</div>
        <div class="card-id">
          <div class="nm"><b title="${esc(d.name)}">${esc(d.name)}</b>${d.useOwnConfig ? '<span class="chip own">Riêng</span>' : ''}${d.group ? `<span class="chip grp" title="Nhóm">${esc(d.group)}</span>` : ''}</div>
          <div class="sub">${esc(d.serial)}${sizeTxt}</div>
        </div>
        ${statePillHtml(d)}
      </div>
      ${queueHtml(d)}
      <div class="troops">${troopRowsHtml(d)}</div>
      <div class="card-actions">
        ${controlsHtml(d)}
        <button class="icon-btn" data-act="config" title="Cấu hình">${IC_GEAR}</button>
        <button class="icon-btn" data-act="menu" title="Thêm">${IC_DOTS}</button>
        <div class="menu overflow">
          <button data-act="rename"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 20h4L18 10l-4-4L4 16z"/></svg>Đổi tên</button>
          <button data-act="group"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 7h6l2 2h8v9H4z"/></svg>Đổi nhóm</button>
          <button data-act="capture"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="7" width="18" height="13" rx="2"/><circle cx="12" cy="13" r="3"/><path d="M9 7l1.5-2h3L15 7"/></svg>Chụp màn hình</button>
          <button data-act="clearcache"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 4v6h6M20 20v-6h-6"/><path d="M20 9a8 8 0 0 0-14-3M4 15a8 8 0 0 0 14 3"/></svg>Xoá cache tài nguyên</button>
          <button class="rm" data-act="remove"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/></svg>Xoá thiết bị</button>
        </div>
      </div>`;

    wireCard(card, d);
    gridEl.appendChild(card);
  }
}

function queueText(d) {
  if (!d.online) return '<span style="color:var(--faint)">mất kết nối</span>';
  if (!d.queue) return '<span style="color:var(--faint)">—</span>';
  const q = d.queue;
  return `<b>${q.used}</b>/${q.total}${q.free <= 0 ? ' · đầy' : ` · ${q.free} trống`}`;
}

function renderList(items) {
  gridEl.innerHTML = '';
  if (!merged.length) { gridEl.innerHTML = '<div class="empty">Chưa có thiết bị. Bấm <b>Nạp thiết bị</b> hoặc <b>Thêm máy</b>.</div>'; return; }
  if (!items.length) { gridEl.innerHTML = '<div class="empty">Không có máy khớp bộ lọc.</div>'; return; }

  for (const d of items) {
    const row = document.createElement('div');
    row.className = 'lrow' + (d.running ? ' run' : '') + (d.online ? '' : ' offline') + (selected.has(d.serial) ? ' sel' : '');
    row.innerHTML = `
      <input type="checkbox" class="chkbox rowchk" ${selected.has(d.serial) ? 'checked' : ''} />
      <div class="lname">
        <div class="nn"><b title="${esc(d.name)}">${esc(d.name)}</b>${d.useOwnConfig ? '<span class="chip own">Riêng</span>' : ''}${d.group ? `<span class="chip grp" title="Nhóm">${esc(d.group)}</span>` : ''}</div>
        <div class="lserial">${esc(d.serial)}</div>
      </div>
      ${statePillHtml(d)}
      <div class="lqueue">${queueText(d)}</div>
      <div class="lactions">
        ${controlsHtml(d)}
        <button class="icon-btn" data-act="config" title="Cấu hình">${IC_GEAR}</button>
      </div>`;

    const chk = row.querySelector('.rowchk');
    chk.onchange = (e) => { e.stopPropagation(); toggleSel(d.serial, chk.checked, row); };
    chk.onclick = (e) => e.stopPropagation();
    wireControls(row, d);
    const cfg = row.querySelector('[data-act="config"]');
    if (cfg) cfg.onclick = (e) => { e.stopPropagation(); openConfig(d.serial); };
    gridEl.appendChild(row);
  }
}

function wireCard(card, d) {
  wireControls(card, d);
  const act = (name, fn) => { const b = card.querySelector(`[data-act="${name}"]`); if (b) b.onclick = fn; };
  act('config', (e) => { e.stopPropagation(); openConfig(d.serial); });
  act('menu', (e) => {
    e.stopPropagation();
    const m = card.querySelector('.menu.overflow');
    const wasOpen = m.classList.contains('show');
    closeMenus();
    if (!wasOpen) m.classList.add('show');
  });
  act('rename', (e) => { e.stopPropagation(); closeMenus(); startRename(card, d); });
  act('group', (e) => { e.stopPropagation(); closeMenus(); openGroupModal([d.serial], d.group); });
  act('capture', async (e) => { e.stopPropagation(); closeMenus(); await doCapture(d); });
  act('clearcache', async (e) => {
    e.stopPropagation(); closeMenus();
    try { const r = await window.api.clearCache(d.serial); toast(`Đã xoá cache tài nguyên ${d.name}${r && r.restarted ? ' — worker restart' : ''}. Lượt sau sẽ chọn lại loại + set lại level.`); }
    catch (er) { toastErr(er); }
    renderAll(true);
  });
  act('remove', async (e) => {
    e.stopPropagation(); closeMenus();
    if (confirm(`Xoá thiết bị ${d.name} (${d.serial})?`)) { await window.api.removeDevice(d.serial); toast('Đã xoá ' + d.name); renderAll(true); }
  });
}

function closeMenus() { document.querySelectorAll('.menu.show').forEach((m) => m.classList.remove('show')); }
document.addEventListener('click', closeMenus);

function startRename(card, d) {
  const nm = card.querySelector('.nm');
  nm.innerHTML = '';
  const inp = document.createElement('input');
  inp.value = d.name;
  nm.appendChild(inp);
  inp.focus(); inp.select();
  let done = false;
  const save = async () => {
    if (done) return; done = true;
    const v = inp.value.trim();
    if (v && v !== d.name) { await window.api.renameDevice(d.serial, v); toast('Đã đổi tên'); }
    renderAll();
  };
  inp.onkeydown = (e) => { if (e.key === 'Enter') save(); else if (e.key === 'Escape') { done = true; renderAll(); } };
  inp.onblur = save;
}

async function doCapture(d) {
  if (!d.online) { toast('Máy ngoại tuyến, không chụp được.', true); return; }
  try {
    toast('Đang chụp ' + d.name + '…');
    const url = await window.api.capture(d.serial);
    $('capImg').src = url;
    $('capTitle').textContent = 'Ảnh màn hình — ' + d.name;
    $('capModal').classList.add('show');
  } catch (e) { toastErr(e); }
}
$('capClose').onclick = () => $('capModal').classList.remove('show');
$('capModal').onclick = (e) => { if (e.target === $('capModal')) $('capModal').classList.remove('show'); };

// ---- Config form (drawer) ----
function fillTypeSelect(el, types) {
  el.innerHTML = '';
  for (const t of types) { const o = document.createElement('option'); o.value = t.slot; o.textContent = t.label; el.appendChild(o); }
}
function fillLevelSelect(levelEl, types, slot, keepValue) {
  const t = types.find((x) => x.slot === Number(slot)) || types[0];
  const levels = (t && t.levels) || [1];
  levelEl.innerHTML = '';
  for (const lv of levels) { const o = document.createElement('option'); o.value = lv; o.textContent = 'Lv ' + lv; levelEl.appendChild(o); }
  if (keepValue != null && levels.includes(Number(keepValue))) levelEl.value = keepValue; else levelEl.value = levels[0];
}
function buildTroopRows(container, typeMeta, rowConfigs) {
  container.innerHTML = '';
  const els = [];
  (meta.troops || []).forEach((tr, i) => {
    const rc = (rowConfigs && rowConfigs[i]) || { type: 0, level: 1, enabled: true };
    const div = document.createElement('div');
    div.className = 'trow' + (rc.enabled === false ? ' off' : '');
    div.innerHTML = `<label class="switch"><input type="checkbox" class="tenabled" ${rc.enabled !== false ? 'checked' : ''}/><span></span></label>
      <span class="tname">Đội ${i + 1}</span><select class="ttype"></select><select class="tlevel"></select>`;
    const typeSel = div.querySelector('.ttype');
    const levelSel = div.querySelector('.tlevel');
    fillTypeSelect(typeSel, typeMeta);
    typeSel.value = rc.type;
    fillLevelSelect(levelSel, typeMeta, rc.type, rc.level);
    typeSel.onchange = () => fillLevelSelect(levelSel, typeMeta, typeSel.value, levelSel.value);
    const en = div.querySelector('.tenabled');
    en.onchange = () => div.classList.toggle('off', !en.checked);
    container.appendChild(div);
    els.push({ typeSel, levelSel, enabledEl: en });
  });
  return els;
}
function readTroopRows(els) {
  return els.map((e) => ({ type: parseInt(e.typeSel.value, 10) || 0, level: parseInt(e.levelSel.value, 10) || 1, enabled: e.enabledEl.checked }));
}
function bindEnableToggle(chkId, panelId) {
  const chk = $(chkId); const panel = $(panelId);
  const apply = () => panel.classList.toggle('dim', !chk.checked);
  chk.onchange = apply; apply();
}

function fillConfigForm(config) {
  $('g_enabled').checked = !!config.gather.enabled;
  gRowEls = buildTroopRows($('g_rows'), meta.resourceTypes, config.gather.troops);
  const gCommon = $('g_common_level');
  if (!gCommon.options.length) for (let lv = 1; lv <= 15; lv += 1) { const o = document.createElement('option'); o.value = lv; o.textContent = 'Lv ' + lv; gCommon.appendChild(o); }
  gCommon.value = config.gather.commonLevel || 1;
  gCommon.onchange = () => gRowEls.forEach((e) => fillLevelSelect(e.levelSel, meta.resourceTypes, e.typeSel.value, gCommon.value));

  $('pollSec').value = config.pollSec || 60;
  bindEnableToggle('g_enabled', 'g_panel');
}

function readConfigForm() {
  const num = (id, def) => { const v = parseInt($(id).value, 10); return Number.isFinite(v) ? v : def; };
  return {
    gather: { enabled: $('g_enabled').checked, commonLevel: Math.max(1, num('g_common_level', 1)), troops: readTroopRows(gRowEls) },
    pollSec: Math.max(10, num('pollSec', 60)),
  };
}

function openDrawer() { $('scrim').classList.add('open'); $('drawer').classList.add('open'); }
function closeDrawer() { $('scrim').classList.remove('open'); $('drawer').classList.remove('open'); configSerial = null; renderAll(); }

async function openConfig(serial) {
  configMode = 'device'; configSerial = serial;
  const { name, useOwnConfig, config } = await window.api.getConfig(serial);
  $('drawerTitle').textContent = 'Cấu hình — ' + name;
  $('drawerWho').textContent = serial;
  $('scopeDevice').style.display = ''; $('scopeGlobal').style.display = 'none';
  $('useOwnConfig').checked = !!useOwnConfig;
  fillConfigForm(config);
  openDrawer();
}
async function openBulkConfig() {
  if (!selected.size) { toast('Chưa chọn máy nào.', true); return; }
  configMode = 'bulk'; configSerial = null; configSerials = [...selected];
  const { config } = await window.api.getGlobalConfig(); // lay cau hinh chung lam mau
  $('drawerTitle').textContent = `Cấu hình ${configSerials.length} máy đã chọn`;
  $('drawerWho').textContent = 'Áp làm cấu hình riêng cho các máy đã chọn';
  $('scopeDevice').style.display = 'none'; $('scopeGlobal').style.display = 'none';
  fillConfigForm(config);
  openDrawer();
}
async function openGlobalConfig() {
  configMode = 'global'; configSerial = null;
  const { config } = await window.api.getGlobalConfig();
  $('drawerTitle').textContent = 'Cấu hình chung';
  $('drawerWho').textContent = 'Áp dụng cho mọi máy dùng cấu hình chung';
  $('scopeDevice').style.display = 'none'; $('scopeGlobal').style.display = '';
  $('applyToAll').checked = true; // mac dinh: ap dung cho toan bo may
  fillConfigForm(config);
  openDrawer();
}

$('saveCfg').onclick = async () => {
  const config = readConfigForm();
  try {
    if (configMode === 'global') {
      const applyToAll = $('applyToAll').checked;
      const res = await window.api.saveGlobalConfig(config, applyToAll);
      toast(`Đã lưu cấu hình chung${applyToAll ? ' + áp dụng toàn bộ' : ''}${res && res.restarted ? ` (restart ${res.restarted} máy)` : ''}.`);
    } else if (configMode === 'bulk') {
      if (!configSerials.length) return;
      const res = await window.api.saveConfigMany(configSerials, config, true);
      toast(`Đã áp cấu hình cho ${res.saved} máy${res && res.restarted ? ` — restart ${res.restarted}` : ''}.`);
    } else {
      if (!configSerial) return;
      const useOwn = $('useOwnConfig').checked;
      const res = await window.api.saveConfig(configSerial, config, useOwn);
      toast(`Đã lưu (${useOwn ? 'cấu hình riêng' : 'dùng chung'})${res && res.restarted ? ' — worker restart' : ''}.`);
    }
    closeDrawer();
  } catch (e) { toastErr(e); }
};
$('closeCfg').onclick = closeDrawer;
$('drawerClose').onclick = closeDrawer;
$('scrim').onclick = closeDrawer;

// ---- Toolbar / tools ----
$('themeBtn').onclick = () => {
  const root = document.documentElement;
  const cur = root.getAttribute('data-theme') || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  root.setAttribute('data-theme', cur === 'dark' ? 'light' : 'dark');
};
document.querySelectorAll('#filterSeg button').forEach((b) => b.onclick = () => {
  document.querySelectorAll('#filterSeg button').forEach((x) => x.classList.remove('on'));
  b.classList.add('on'); filter = b.dataset.filter; renderDevices();
});
$('searchInput').oninput = (e) => { searchText = e.target.value.trim().toLowerCase(); renderDevices(); };

// ---- View toggle (card / list) ----
document.querySelectorAll('#viewSeg button').forEach((b) => {
  b.classList.toggle('on', b.dataset.view === viewMode);
  b.onclick = () => {
    document.querySelectorAll('#viewSeg button').forEach((x) => x.classList.remove('on'));
    b.classList.add('on');
    viewMode = b.dataset.view; localStorage.setItem('antbot.viewMode', viewMode);
    if (viewMode !== 'list') selected.clear(); // bo chon khi roi che do list
    renderDevices();
  };
});

// ---- Selection + bulk bar ----
function toggleSel(serial, on, rowEl) {
  if (on) selected.add(serial); else selected.delete(serial);
  if (rowEl) rowEl.classList.toggle('sel', on);
  updateBulkBar();
}
function bySerial(serial) { return merged.find((d) => d.serial === serial); }
function selectedDevices() { return [...selected].map(bySerial).filter(Boolean); }

// ---- Nhom thiet bi ----
// Map nhom -> danh sach serial (suy ra tu field group cua tung may, giu thu tu xuat hien).
function listGroups() {
  const m = new Map();
  for (const d of merged) {
    const g = (d.group || '').trim();
    if (!g) continue;
    if (!m.has(g)) m.set(g, []);
    m.get(g).push(d.serial);
  }
  return m;
}

// Bam 1 nhom -> chon HET may trong nhom (toggle: neu da chon het thi bo chon het).
function toggleGroupSelect(group) {
  const serials = listGroups().get(group) || [];
  const allSel = serials.length > 0 && serials.every((s) => selected.has(s));
  for (const s of serials) { if (allSel) selected.delete(s); else selected.add(s); }
  renderDevices();
}

// Gan/bo nhom cho danh sach may — dung MODAL trong app (Electron khong ho tro window.prompt).
let groupTargets = [];
function openGroupModal(serials, current) {
  if (!serials || !serials.length) { toast('Chưa chọn máy nào.', true); return; }
  groupTargets = serials;
  const groups = [...listGroups().keys()];
  $('groupModalInfo').textContent = `Áp cho ${serials.length} máy. Để trống = bỏ khỏi nhóm.`;
  $('groupInput').value = current || '';
  $('groupList').innerHTML = groups.map((g) => `<option value="${esc(g)}"></option>`).join('');
  $('groupQuick').innerHTML = groups.map((g) => `<button class="gchip" data-g="${esc(g)}">${esc(g)}</button>`).join('')
    + (groups.length ? '<button class="gchip" data-g="">— Bỏ nhóm —</button>' : '');
  $('groupQuick').querySelectorAll('[data-g]').forEach((b) => { b.onclick = () => { $('groupInput').value = b.dataset.g; $('groupInput').focus(); }; });
  $('groupModal').classList.add('show');
  $('groupInput').focus(); $('groupInput').select();
}
async function saveGroup() {
  const serials = groupTargets;
  const name = $('groupInput').value.trim();
  $('groupModal').classList.remove('show');
  if (!serials.length) return;
  try {
    const r = await window.api.setGroup(serials, name);
    toast(name ? `Đã gán ${r.updated} máy vào nhóm “${name}”.` : `Đã bỏ nhóm ${r.updated} máy.`);
  } catch (e) { toastErr(e); }
  renderAll(true);
}

// Render thanh nhom (chi o list view). Moi nhom la 1 chip; chip sang khi da chon het may trong nhom.
function renderGroupBar() {
  const bar = $('groupBar');
  const show = viewMode === 'list';
  bar.classList.toggle('show', show);
  if (!show) { bar.innerHTML = ''; return; }
  const groups = listGroups();
  if (!groups.size) { bar.innerHTML = '<span class="ghint">Chưa có nhóm. Chọn máy rồi bấm <b>Nhóm</b> để tạo.</span>'; return; }
  let html = '<span class="glabel">Nhóm</span>';
  for (const [g, serials] of groups) {
    const allSel = serials.every((s) => selected.has(s));
    html += `<button class="gchip${allSel ? ' on' : ''}" data-group="${esc(g)}" title="Chọn tất cả máy trong nhóm">${esc(g)}<span class="gcount">${serials.length}</span></button>`;
  }
  bar.innerHTML = html;
  bar.querySelectorAll('[data-group]').forEach((b) => { b.onclick = () => toggleGroupSelect(b.dataset.group); });
}

function updateBulkBar() {
  const bar = $('bulkBar');
  const show = viewMode === 'list';
  bar.classList.toggle('show', show);
  if (!show) return;
  const n = selected.size;
  $('selCount').textContent = n ? `${n} máy đã chọn` : 'Chọn máy để thao tác';
  bar.querySelectorAll('[data-bulk]').forEach((b) => { b.disabled = n === 0; });
  // Nhan cua nut halt bulk theo che do dang chon.
  const hm = HALT_MODES[haltMode] || HALT_MODES.stop;
  const hbtn = $('bulkHaltBtn');
  hbtn.className = `btn ${hm.cls}`;
  hbtn.title = hm.hint;
  hbtn.innerHTML = `${haltIcon(haltMode)}${hm.label}`;
  document.querySelector('.split .caret[data-bulk="haltmenu"]').className = `btn ${hm.cls} caret`;
  // Menu che do (dung chung nhan, danh dau ✓ che do dang chon).
  $('bulkHaltMenu').innerHTML = haltItemsHtml();
  $('bulkHaltMenu').querySelectorAll('[data-halt]').forEach((b) => b.onclick = (e) => {
    e.stopPropagation(); closeMenus(); setHaltMode(b.dataset.halt); updateBulkBar(); renderDevices();
    bulkHalt();
  });
  // Trang thai select-all theo tap dang loc.
  const items = merged.filter(passFilter);
  const selCount = items.filter((d) => selected.has(d.serial)).length;
  const sa = $('selAll');
  sa.checked = items.length > 0 && selCount === items.length;
  sa.indeterminate = selCount > 0 && selCount < items.length;
}

$('selAll').onchange = (e) => {
  const on = e.target.checked;
  const items = merged.filter(passFilter);
  for (const d of items) { if (on) selected.add(d.serial); else selected.delete(d.serial); }
  renderDevices();
};

async function bulkRun(label, fn, filterFn) {
  const devs = selectedDevices().filter(filterFn);
  if (!devs.length) { toast('Không có máy phù hợp trong lựa chọn.', true); return; }
  let ok = 0;
  for (const d of devs) { try { await fn(d); ok += 1; } catch (er) { /* bo qua tung may */ } }
  toast(`${label}: ${ok}/${devs.length} máy.`);
  renderAll(true);
}
async function bulkHalt() {
  const hm = HALT_MODES[haltMode] || HALT_MODES.stop;
  await bulkRun(hm.label, (d) => execHalt(d.serial, haltMode), (d) => d.running && !d.paused);
}

$('bulkBar').querySelector('[data-bulk="start"]').onclick = () =>
  bulkRun('Chạy', (d) => window.api.startWorker(d.serial), (d) => d.online && !d.running);
$('bulkBar').querySelector('[data-bulk="halt"]').onclick = () => bulkHalt();
$('bulkBar').querySelector('[data-bulk="haltmenu"]').onclick = (e) => {
  e.stopPropagation();
  const m = $('bulkHaltMenu');
  const wasOpen = m.classList.contains('show');
  closeMenus();
  if (!wasOpen) m.classList.add('show');
};
$('bulkBar').querySelector('[data-bulk="resume"]').onclick = () =>
  bulkRun('Tiếp tục', (d) => window.api.resumeWorker(d.serial), (d) => d.running && d.paused);
$('bulkBar').querySelector('[data-bulk="config"]').onclick = () => openBulkConfig();
$('bulkBar').querySelector('[data-bulk="group"]').onclick = () => { const f = selectedDevices()[0]; openGroupModal([...selected], f && f.group); };

// Modal nhom
$('groupSave').onclick = saveGroup;
$('groupCancel').onclick = () => $('groupModal').classList.remove('show');
$('groupModalClose').onclick = () => $('groupModal').classList.remove('show');
$('groupModal').onclick = (e) => { if (e.target === $('groupModal')) $('groupModal').classList.remove('show'); };
$('groupInput').onkeydown = (e) => { if (e.key === 'Enter') saveGroup(); else if (e.key === 'Escape') $('groupModal').classList.remove('show'); };

$('toggleAdd').onclick = () => $('addbox').classList.toggle('show');
$('toggleCsv').onclick = () => $('csvbox').classList.toggle('show');
$('globalCfgBtn').onclick = openGlobalConfig;

$('startAll').onclick = async () => { try { const r = await window.api.startAll(); toast(`Chạy ${r.started} máy${r.resumed ? `, tiếp tục ${r.resumed} máy tạm dừng` : ''}.`); } catch (e) { toastErr(e); } renderAll(true); };
$('haltAll').onclick = () => haltAll();
$('haltAllMenu').onclick = (e) => {
  e.stopPropagation();
  const m = $('haltAllMenuList');
  const wasOpen = m.classList.contains('show');
  closeMenus();
  if (!wasOpen) m.classList.add('show');
};
$('loadAll').onclick = async () => { try { const r = await window.api.loadAllDevices(); toast(`Nạp ${r.total} thiết bị (thêm mới ${r.created}).`); } catch (e) { toastErr(e); } renderAll(); };
$('addSubmit').onclick = async () => {
  const serial = $('addSerial').value.trim(); const name = $('addName').value.trim();
  if (!serial) { toast('Thiếu serial.', true); return; }
  try { await window.api.addDevice(serial, name); $('addSerial').value = ''; $('addName').value = ''; toast('Đã thêm ' + (name || serial)); } catch (e) { toastErr(e); }
  renderAll();
};
$('csvImport').onclick = async () => { const text = $('csvText').value; if (!text.trim()) return; try { const r = await window.api.importCsv(text); toast(`Import CSV: ${r.imported} máy.`); } catch (e) { toastErr(e); } renderAll(); };
$('csvExport').onclick = async () => { try { const r = await window.api.exportCsv(); $('csvbox').classList.add('show'); $('csvText').value = r.csv; toast('Đã export cấu hình ra CSV.'); } catch (e) { toastErr(e); } };
$('settingsExport').onclick = async () => { try { const r = await window.api.exportSettings(); $('csvbox').classList.add('show'); $('csvText').value = r.json; $('cfgPathNote').textContent = 'File settings: ' + r.path; toast('Đã backup settings ra ô văn bản.'); } catch (e) { toastErr(e); } };
$('settingsImport').onclick = async () => { const text = $('csvText').value; if (!text.trim()) return; try { const r = await window.api.importSettings(text); toast(`Đã restore: ${r.imported} thiết bị.`); renderAll(); } catch (e) { toastErr({ message: 'Restore lỗi (JSON không hợp lệ?): ' + (e.message || e) }); } };
$('clearAllCache').onclick = async () => { if (!confirm('Xoá cache tài nguyên (loại + level) của TẤT CẢ máy? Các worker đang chạy sẽ restart và chọn lại loại + set lại level từ đầu.')) return; try { const r = await window.api.clearAllCache(); toast(`Đã xoá cache ${r.cleared} máy${r.restarted ? ` — restart ${r.restarted} worker` : ''}.`); } catch (e) { toastErr(e); } renderAll(true); };

// Log console
$('consoleToggle').onclick = () => $('console').classList.toggle('min');
$('clearLogs').onclick = () => { logsEl.innerHTML = ''; };
document.querySelectorAll('.lvl[data-lvl]').forEach((b) => b.onclick = () => {
  const lvl = b.dataset.lvl; logLevels[lvl] = !logLevels[lvl]; b.classList.toggle('on', logLevels[lvl]);
  logsEl.querySelectorAll('.lg').forEach((l) => l.classList.toggle('hide', !logLevels[l.dataset.lvl]));
});

// Rail nav shortcuts
$('navDevices').onclick = () => { $('main').scrollTo({ top: 0, behavior: 'smooth' }); };
$('navLogs').onclick = () => { $('console').classList.remove('min'); };
$('navSettings').onclick = () => { $('csvbox').classList.add('show'); $('csvbox').scrollIntoView({ behavior: 'smooth' }); };

// ---- Init ----
(async () => {
  try { meta = await window.api.configMeta(); } catch (e) { /* ignore */ }
  try {
    const info = await window.api.appInfo();
    const d = new Date(info.updatedAt); const p2 = (n) => String(n).padStart(2, '0');
    $('appVer').textContent = ` · cập nhật ${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())}`;
  } catch (e) { /* ignore */ }
  try { const p = await window.api.settingsPath(); $('cfgPathNote').textContent = 'File settings: ' + p.path; } catch (e) { /* ignore */ }
  renderAll();
  setInterval(renderAll, 8000);
})();
