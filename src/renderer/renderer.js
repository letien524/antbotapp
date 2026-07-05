'use strict';

const devicesEl = document.getElementById('devices');
const logsEl = document.getElementById('logs');
const statusEl = document.getElementById('status');
const configEl = document.getElementById('config');
const configTitleEl = document.getElementById('configTitle');

let configSerial = null;   // serial dang cau hinh
let meta = { huntTypes: [], resourceTypes: [], troops: [] };

// ---- Devices (danh sach DA THEM) ----
async function refresh() {
  const list = await window.api.listDevices();
  if (list.length === 0) {
    devicesEl.innerHTML = '<div style="color:#8b949e;font-size:12px">Chua co thiet bi. Bam "Load thiet bi" hoac "Them".</div>';
    return;
  }
  devicesEl.innerHTML = '';
  for (const d of list) {
    const card = document.createElement('div');
    card.className = 'device' + (d.serial === configSerial ? ' sel' : '');
    card.innerHTML = `
      <div class="name">${d.name}
        <span class="badge ${d.online ? 'on' : 'off'}">${d.online ? 'online' : 'offline'}</span>
        <span class="badge ${d.running ? 'on' : ''}">${d.running ? 'RUNNING' : 'idle'}</span>
        <span class="badge ${d.useOwnConfig ? 'own' : ''}">${d.useOwnConfig ? 'cau hinh rieng' : 'dung chung'}</span>
      </div>
      <div class="serial2">${d.serial}</div>
      <div class="row">
        <button class="small" data-act="config">⚙ Cau hinh</button>
        <button class="small" data-act="rename">✎</button>
        <button class="small danger" data-act="remove">🗑</button>
        <button class="small primary" data-act="start">▶</button>
        <button class="small danger" data-act="stop">■</button>
      </div>`;
    card.querySelector('[data-act="config"]').onclick = () => openConfig(d.serial);
    card.querySelector('[data-act="rename"]').onclick = async () => {
      const name = prompt('Ten moi cho ' + d.serial, d.name);
      if (name != null) { await window.api.renameDevice(d.serial, name); refresh(); }
    };
    card.querySelector('[data-act="remove"]').onclick = async () => {
      if (confirm('Xoa thiet bi ' + d.name + ' (' + d.serial + ')?')) { await window.api.removeDevice(d.serial); refresh(); }
    };
    card.querySelector('[data-act="start"]').onclick = async () => {
      try { await window.api.startWorker(d.serial); } catch (e) { toastErr(e); }
      refresh();
    };
    card.querySelector('[data-act="stop"]').onclick = async () => {
      await window.api.stopWorker(d.serial); refresh();
    };
    devicesEl.appendChild(card);
  }
}

// ---- Bang trang thai troop (thay cho xem truoc) ----
function typeName(kind, slot) {
  const list = kind === 'hunt' ? meta.huntTypes : meta.resourceTypes;
  const t = (list || []).find((x) => x.slot === Number(slot));
  return t ? t.label.split(' (')[0] : ('o ' + slot);
}
function jobLabel(troop) {
  const parts = [];
  if (troop.hunt) parts.push(`San ${typeName('hunt', troop.hunt.type)} Lv${troop.hunt.level}`);
  if (troop.gather) parts.push(`Thu ${typeName('gather', troop.gather.type)} Lv${troop.gather.level}`);
  return parts.length ? parts.join(' · ') : '—';
}
function agoLabel(ts) {
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 60) return s + 's truoc';
  return Math.round(s / 60) + 'p truoc';
}
function statusLabel(troop) {
  if (troop.status) {
    const t = troop.status;
    const verb = t.task === 'hunt' ? 'Dang san' : 'Dang thu';
    return `<span class="stbusy">${verb} ${typeName(t.task, t.type)} Lv${t.level} (${agoLabel(t.at)})</span>`;
  }
  return '<span class="stidle">ranh</span>';
}

async function renderStatus() {
  let tables;
  try { tables = await window.api.troopTables(); } catch (e) { return; }
  if (!tables.length) { statusEl.innerHTML = '<div style="color:#8b949e;font-size:12px">Chua co thiet bi.</div>'; return; }
  statusEl.innerHTML = '';
  for (const dev of tables) {
    const q = dev.queue;
    const qcls = q ? (q.free <= 0 ? 'full' : 'free') : '';
    const qtext = q ? `${q.used}/${q.total}` : (dev.online ? '—' : 'offline');
    const box = document.createElement('div');
    box.className = 'statdev';
    const rows = dev.troops.map((t) => `
      <tr>
        <td>${t.name}</td>
        <td>${jobLabel(t)}</td>
        <td>${dev.online ? statusLabel(t) : '<span class="stoff">offline</span>'}</td>
      </tr>`).join('');
    box.innerHTML = `
      <div class="dhead">${dev.name}
        <span class="badge ${dev.online ? 'on' : 'off'}">${dev.online ? 'online' : 'offline'}</span>
        ${dev.running ? '<span class="badge on">RUNNING</span>' : ''}
        <span class="qbadge ${qcls}">Queue ${qtext}</span>
      </div>
      <table class="troops">
        <tr><th>Doi</th><th>Nhiem vu</th><th>Trang thai</th></tr>
        ${rows}
      </table>`;
    statusEl.appendChild(box);
  }
}

// ---- Config editor ----
function fillTypeSelect(el, types) {
  el.innerHTML = '';
  for (const t of types) {
    const o = document.createElement('option');
    o.value = t.slot; o.textContent = t.label;
    el.appendChild(o);
  }
}

// Sinh dropdown level theo loai dang chon (moi loai co tap level rieng).
function fillLevelSelect(levelEl, types, slot, keepValue) {
  const t = types.find((x) => x.slot === Number(slot)) || types[0];
  const levels = (t && t.levels) || [1];
  levelEl.innerHTML = '';
  for (const lv of levels) {
    const o = document.createElement('option');
    o.value = lv; o.textContent = 'Lv ' + lv;
    levelEl.appendChild(o);
  }
  if (keepValue != null && levels.includes(Number(keepValue))) levelEl.value = keepValue;
  else levelEl.value = levels[0];
}

// Dung cac DONG cau hinh per-troop trong `container`. Moi doi 1 dong: bat | ten | loai | level.
function buildTroopRows(container, typeMeta, rowConfigs) {
  container.innerHTML = '';
  const els = [];
  (meta.troops || []).forEach((tr, i) => {
    const rc = (rowConfigs && rowConfigs[i]) || { type: 0, level: 1, enabled: true };
    const div = document.createElement('div');
    div.className = 'trow';
    div.innerHTML = `
      <input type="checkbox" class="tenabled" ${rc.enabled !== false ? 'checked' : ''} />
      <span class="tlabel">${tr.label}</span>
      <select class="ttype"></select>
      <select class="tlevel"></select>`;
    const typeSel = div.querySelector('.ttype');
    const levelSel = div.querySelector('.tlevel');
    fillTypeSelect(typeSel, typeMeta);
    typeSel.value = rc.type;
    fillLevelSelect(levelSel, typeMeta, rc.type, rc.level);
    typeSel.onchange = () => fillLevelSelect(levelSel, typeMeta, typeSel.value, levelSel.value);
    container.appendChild(div);
    els.push({ typeSel, levelSel, enabledEl: div.querySelector('.tenabled') });
  });
  return els;
}

function readTroopRows(els) {
  return els.map((e) => ({
    type: parseInt(e.typeSel.value, 10) || 0,
    level: parseInt(e.levelSel.value, 10) || 1,
    enabled: e.enabledEl.checked,
  }));
}

function bindEnableToggle(chkId, rowsId) {
  const chk = document.getElementById(chkId);
  const rows = document.getElementById(rowsId);
  const apply = () => rows.classList.toggle('dim', !chk.checked);
  chk.onchange = apply; apply();
}

let gRowEls = [];
let hRowEls = [];
let configMode = 'device'; // 'device' | 'global'

// Do config vao form (dung chung cho device va global).
function fillConfigForm(config) {
  document.getElementById('g_enabled').checked = !!config.gather.enabled;
  gRowEls = buildTroopRows(document.getElementById('g_rows'), meta.resourceTypes, config.gather.troops);

  document.getElementById('h_enabled').checked = !!config.hunt.enabled;
  document.getElementById('h_minstam').value = config.hunt.minStamina != null ? config.hunt.minStamina : 10;
  document.getElementById('h_recover').value = Math.round((config.hunt.recoverSec || 1800) / 60);
  hRowEls = buildTroopRows(document.getElementById('h_rows'), meta.huntTypes, config.hunt.troops);

  document.getElementById('pollSec').value = config.pollSec || 60;

  bindEnableToggle('g_enabled', 'g_rows');
  bindEnableToggle('h_enabled', 'h_rows');

  configEl.classList.add('show');
}

// Cau hinh RIENG cho 1 device.
async function openConfig(serial) {
  configMode = 'device';
  configSerial = serial;
  const { name, useOwnConfig, config } = await window.api.getConfig(serial);
  configTitleEl.innerHTML = `Cau hinh: <span>${name} (${serial})</span>`;
  document.getElementById('cfgopts').style.display = '';
  document.getElementById('useOwnConfig').checked = !!useOwnConfig;
  fillConfigForm(config);
  refresh();
}

// Cau hinh CHUNG (dung cho may khong bat cau hinh rieng).
async function openGlobalConfig() {
  configMode = 'global';
  configSerial = null;
  const { config } = await window.api.getGlobalConfig();
  configTitleEl.innerHTML = 'Cau hinh CHUNG (bot chung cho moi may)';
  document.getElementById('cfgopts').style.display = 'none';
  fillConfigForm(config);
  refresh();
}

function readConfigForm() {
  const num = (id, def) => { const v = parseInt(document.getElementById(id).value, 10); return Number.isFinite(v) ? v : def; };
  return {
    gather: {
      enabled: document.getElementById('g_enabled').checked,
      troops: readTroopRows(gRowEls),
    },
    hunt: {
      enabled: document.getElementById('h_enabled').checked,
      minStamina: Math.max(0, num('h_minstam', 10)),
      recoverSec: Math.max(60, num('h_recover', 30) * 60),
      troops: readTroopRows(hRowEls),
    },
    pollSec: Math.max(10, num('pollSec', 60)),
  };
}

document.getElementById('saveCfg').onclick = async () => {
  const config = readConfigForm();
  try {
    if (configMode === 'global') {
      const res = await window.api.saveGlobalConfig(config);
      addLog({ level: 'INFO', line: `[UI] Da luu cau hinh CHUNG${res.restarted ? ` (restart ${res.restarted} may dung chung)` : ''}.` });
    } else {
      if (!configSerial) return;
      const useOwn = document.getElementById('useOwnConfig').checked;
      const res = await window.api.saveConfig(configSerial, config, useOwn);
      addLog({ level: 'INFO', line: `[UI] Da luu ${configSerial} (${useOwn ? 'cau hinh rieng' : 'dung chung'})${res.restarted ? ' — worker restart' : ''}.` });
    }
    refresh();
  } catch (e) { toastErr(e); }
};

document.getElementById('closeCfg').onclick = () => {
  configEl.classList.remove('show');
  configSerial = null;
  refresh();
};

// ---- Logs ----
function addLog(entry) {
  const div = document.createElement('div');
  div.className = `log-${entry.level || 'INFO'}`;
  div.textContent = entry.line;
  logsEl.appendChild(div);
  logsEl.scrollTop = logsEl.scrollHeight;
  while (logsEl.children.length > 500) logsEl.removeChild(logsEl.firstChild);
}
function toastErr(e) { addLog({ level: 'ERROR', line: `[UI] ${e && e.message ? e.message : e}` }); }

window.api.onLog(addLog);
document.getElementById('refresh').onclick = refresh;

// ---- Load hang loat + chay song song + CSV ----
document.getElementById('loadAll').onclick = async () => {
  try {
    const r = await window.api.loadAllDevices();
    addLog({ level: 'INFO', line: `[UI] Load ${r.total} thiet bi dang ket noi (them moi ${r.created}).` });
    refresh();
  } catch (e) { toastErr(e); }
};
document.getElementById('globalCfgBtn').onclick = () => openGlobalConfig();
document.getElementById('toggleAdd').onclick = () => {
  document.getElementById('addbox').classList.toggle('show');
};
document.getElementById('addSubmit').onclick = async () => {
  const serial = document.getElementById('addSerial').value.trim();
  const name = document.getElementById('addName').value.trim();
  if (!serial) return;
  try {
    await window.api.addDevice(serial, name);
    document.getElementById('addSerial').value = '';
    document.getElementById('addName').value = '';
    addLog({ level: 'INFO', line: `[UI] Da them thiet bi ${name || serial}.` });
    refresh();
  } catch (e) { toastErr(e); }
};
document.getElementById('startAll').onclick = async () => {
  try {
    const r = await window.api.startAll();
    addLog({ level: 'INFO', line: `[UI] Chay song song ${r.started}/${r.total} thiet bi.` });
    refresh();
  } catch (e) { toastErr(e); }
};
document.getElementById('stopAll').onclick = async () => {
  try {
    const r = await window.api.stopAll();
    addLog({ level: 'INFO', line: `[UI] Da dung ${r.stopped} worker.` });
    refresh();
  } catch (e) { toastErr(e); }
};
document.getElementById('toggleCsv').onclick = () => {
  document.getElementById('csvbox').classList.toggle('show');
};
document.getElementById('csvImport').onclick = async () => {
  const text = document.getElementById('csvText').value;
  if (!text.trim()) return;
  try {
    const r = await window.api.importCsv(text);
    addLog({ level: 'INFO', line: `[UI] Import CSV: ${r.imported} device.` });
    refresh();
  } catch (e) { toastErr(e); }
};
document.getElementById('csvExport').onclick = async () => {
  try {
    const r = await window.api.exportCsv();
    document.getElementById('csvbox').classList.add('show');
    document.getElementById('csvText').value = r.csv;
    addLog({ level: 'INFO', line: '[UI] Da export cau hinh ra CSV (textarea).' });
  } catch (e) { toastErr(e); }
};

document.getElementById('refreshStatus').onclick = renderStatus;
setInterval(renderStatus, 12000);

// ---- Init ----
(async () => {
  meta = await window.api.configMeta();
  refresh();
  renderStatus();
})();
