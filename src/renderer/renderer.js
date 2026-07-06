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
      <div class="serial2">${d.serial}${d.size ? ` · ${d.size.width}×${d.size.height}` : ''}</div>
      <div class="row">
        <button class="small" data-act="config">⚙ Cau hinh</button>
        <button class="small" data-act="rename">✎</button>
        <button class="small danger" data-act="remove">🗑</button>
        <button class="small primary" data-act="start">▶</button>
        <button class="small danger" data-act="stop">■</button>
      </div>`;
    card.querySelector('[data-act="config"]').onclick = () => openConfig(d.serial);
    // Sua ten INLINE (Electron khong ho tro prompt()).
    card.querySelector('[data-act="rename"]').onclick = () => {
      const nameEl = card.querySelector('.name');
      nameEl.innerHTML = '';
      const inp = document.createElement('input');
      inp.value = d.name;
      inp.style.cssText = 'width:70%;background:#0d1117;color:#e6e6e6;border:1px solid #388bfd;border-radius:6px;padding:4px 8px;font-size:13px;';
      nameEl.appendChild(inp);
      inp.focus(); inp.select();
      let done = false;
      const save = async () => {
        if (done) return; done = true;
        const v = inp.value.trim();
        if (v && v !== d.name) await window.api.renameDevice(d.serial, v);
        refresh();
      };
      inp.onkeydown = (e) => {
        if (e.key === 'Enter') save();
        else if (e.key === 'Escape') { done = true; refresh(); }
      };
      inp.onblur = save;
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

// Dung cac dong AUTO HUNT: moi loai 1 dong (checkbox | ten loai). Level la 1 dropdown CHUNG.
function buildHuntTypeRows(container, typeMeta, typesConfig) {
  container.innerHTML = '';
  const els = [];
  (typeMeta || []).forEach((t, i) => {
    const rc = (typesConfig && typesConfig[i]) || { enabled: false };
    const div = document.createElement('div');
    div.className = 'trow h2';
    div.innerHTML = `
      <input type="checkbox" class="tenabled" ${rc.enabled !== false ? 'checked' : ''} />
      <span class="tlabel">${t.label}</span>`;
    container.appendChild(div);
    els.push({ enabledEl: div.querySelector('.tenabled') });
  });
  return els;
}
function readHuntTypeRows(els) {
  return els.map((e) => ({ enabled: e.enabledEl.checked }));
}

// Dung cac dong GATHER: moi loai tai nguyen 1 dong (tich | ten loai | level).
function buildGatherTypeRows(container, typeMeta, typesConfig) {
  container.innerHTML = '';
  const els = [];
  (typeMeta || []).forEach((t, i) => {
    const rc = (typesConfig && typesConfig[i]) || { active: false, level: 1 };
    const div = document.createElement('div');
    div.className = 'trow h3';
    div.innerHTML = `
      <input type="checkbox" class="tenabled" ${rc.active !== false ? 'checked' : ''} />
      <span class="tlabel">${t.label}</span>
      <select class="tlevel"></select>`;
    const levelSel = div.querySelector('.tlevel');
    fillLevelSelect(levelSel, typeMeta, t.slot, rc.level);
    container.appendChild(div);
    els.push({ enabledEl: div.querySelector('.tenabled'), levelSel });
  });
  return els;
}
function readGatherTypeRows(els) {
  return els.map((e) => ({ active: e.enabledEl.checked, level: parseInt(e.levelSel.value, 10) || 1 }));
}

function bindEnableToggle(chkId, rowsId) {
  const chk = document.getElementById(chkId);
  const rows = document.getElementById(rowsId);
  const apply = () => rows.classList.toggle('dim', !chk.checked);
  chk.onchange = apply; apply();
}

let gRowEls = [];
let hTypeEls = [];
let configMode = 'device'; // 'device' | 'global'

// Do config vao form (dung chung cho device va global).
function fillConfigForm(config) {
  document.getElementById('g_enabled').checked = !!config.gather.enabled;
  gRowEls = buildTroopRows(document.getElementById('g_rows'), meta.resourceTypes, config.gather.troops);

  document.getElementById('h_enabled').checked = !!config.hunt.enabled;
  const hLevelSel = document.getElementById('h_level');
  if (!hLevelSel.options.length) {
    for (let lv = 1; lv <= 20; lv += 1) { const o = document.createElement('option'); o.value = lv; o.textContent = 'Lv ' + lv; hLevelSel.appendChild(o); }
  }
  hLevelSel.value = config.hunt.level || 1;
  hTypeEls = buildHuntTypeRows(document.getElementById('h_rows'), meta.huntAutoTypes, config.hunt.types);

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
  document.getElementById('globalOpts').style.display = 'none';
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
  document.getElementById('globalOpts').style.display = '';
  document.getElementById('applyToAll').checked = false;
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
      level: Math.max(1, num('h_level', 1)),
      types: readHuntTypeRows(hTypeEls),
    },
    pollSec: Math.max(10, num('pollSec', 60)),
  };
}

document.getElementById('saveCfg').onclick = async () => {
  const config = readConfigForm();
  try {
    if (configMode === 'global') {
      const applyToAll = document.getElementById('applyToAll').checked;
      const res = await window.api.saveGlobalConfig(config, applyToAll);
      addLog({ level: 'INFO', line: `[UI] Da luu cau hinh CHUNG${applyToAll ? ' + ap dung TOAN BO may' : ''}${res.restarted ? ` (restart ${res.restarted} may)` : ''}.` });
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
// Backup TOAN BO settings (JSON) -> textarea, de copy sao luu / chuyen may.
document.getElementById('settingsExport').onclick = async () => {
  try {
    const r = await window.api.exportSettings();
    document.getElementById('csvbox').classList.add('show');
    document.getElementById('csvText').value = r.json;
    document.getElementById('cfgPathNote').textContent = 'File settings: ' + r.path;
    addLog({ level: 'INFO', line: '[UI] Da backup settings (JSON) ra textarea. File luu tai: ' + r.path });
  } catch (e) { toastErr(e); }
};
// Restore settings tu JSON trong textarea (ghi de toan bo).
document.getElementById('settingsImport').onclick = async () => {
  const text = document.getElementById('csvText').value;
  if (!text.trim()) return;
  try {
    const r = await window.api.importSettings(text);
    addLog({ level: 'INFO', line: `[UI] Da restore settings: ${r.imported} thiet bi.` });
    refresh(); renderStatus();
  } catch (e) { toastErr({ message: 'Restore loi (JSON khong hop le?): ' + (e.message || e) }); }
};

document.getElementById('refreshStatus').onclick = renderStatus;
setInterval(renderStatus, 12000);

// ---- Init ----
(async () => {
  meta = await window.api.configMeta();
  try { const p = await window.api.settingsPath(); document.getElementById('cfgPathNote').textContent = 'File settings: ' + p.path; } catch (e) { /* ignore */ }
  refresh();
  renderStatus();
})();
