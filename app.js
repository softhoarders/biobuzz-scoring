/* ============================================================
   BIOBUZZ Scorer — FTC 2026-27
   Scoring model per BIOBUZZ Competition Manual V1 (Tables 10-2, 10-3).
   Unofficial. Pure client-side; no backend.
   ============================================================ */
'use strict';

/* ---------- point values, Table 10-2 ---------- */
const PTS = {
  LEAVE: 3,     // AUTO only, per ROBOT
  PARK: 5,      // AUTO and TELEOP, per ROBOT
  TIP: 20,      // AUTO and TELEOP, per HIVE TIP
  CELL: 2,      // per element left in the upward-facing CELL
  BOTTOM: 5,    // Bottom NECTAR Bonus, per FLOWER
  FLOWER: 2,    // per element in an owned FLOWER
  GARDEN: 1     // per element in own GARDEN
};
const FOUL = { minor: 5, major: 20 };              // credited to the OPPONENT
const RP = { win: 3, tie: 1, loss: 0 };
const DEFAULT_THRESHOLDS = { swarm: 16, poll1: 4, poll2: 7 };   // "All Other Events", Table 10-3

const FLOWERS = 4;
const TOTAL_POLLEN = 40, NECTAR_PER_ALLIANCE = 8;
const MAX_ELEMENTS = TOTAL_POLLEN + NECTAR_PER_ALLIANCE * 2;    // 56

/* field clock: 2:30 -> 0:00, AUTO ends at 2:00, then an 8s transition */
const T_START = 150, T_AUTO_END = 120, T_FLOWER = 60, T_FINAL = 20, TRANSITION = 8;

const VIEWS = ['match', 'breakdown', 'history', 'rules'];

/* ---------- state ---------- */
const blankAlliance = () => ({
  auto:   { leave: [false, false], park: [false, false], tips: 0 },
  teleop: { park: [false, false], tips: 0, cell: 0, garden: 0 },
  fouls:  { minor: 0, major: 0 },
  dq: false
});
const blankFlowers = () =>
  Array.from({ length: FLOWERS }, () => ({ owner: 'none', elements: 0, bottomRed: false, bottomBlue: false }));

const state = {
  red: blankAlliance(),
  blue: blankAlliance(),
  flowers: blankFlowers(),
  label: '',
  thresholds: { ...DEFAULT_THRESHOLDS },
  timer: { t: T_START, phase: 'pre', running: false, transitionLeft: 0 },
  sound: true,
  history: []
};

/* ---------- persistence ---------- */
const LS = { hist: 'biobuzz.history', cfg: 'biobuzz.config' };
function loadStore() {
  try {
    const h = JSON.parse(localStorage.getItem(LS.hist) || '[]');
    if (Array.isArray(h)) state.history = h;
    const c = JSON.parse(localStorage.getItem(LS.cfg) || '{}');
    if (c.thresholds) state.thresholds = { ...DEFAULT_THRESHOLDS, ...c.thresholds };
    if (typeof c.sound === 'boolean') state.sound = c.sound;
  } catch (e) { /* unavailable or corrupt storage: start clean */ }
}
const saveHistory = () => { try { localStorage.setItem(LS.hist, JSON.stringify(state.history)); } catch (e) {} };
const saveConfig  = () => {
  try { localStorage.setItem(LS.cfg, JSON.stringify({ thresholds: state.thresholds, sound: state.sound })); }
  catch (e) {}
};

/* ============================================================
   SCORING
   ============================================================ */
const count = arr => arr.filter(Boolean).length;

function flowerPoints(flowers, color) {
  let owned = 0, bottom = 0;
  for (const f of flowers) {
    if (f.owner === color) owned += f.elements * PTS.FLOWER;
    if (color === 'red' ? f.bottomRed : f.bottomBlue) bottom += PTS.BOTTOM;
  }
  return { owned, bottom };
}

/** Itemised score for one alliance. `opp` supplies the fouls credited to us. */
function scoreAlliance(a, opp, flowers, color, thresholds) {
  const leaveN = count(a.auto.leave);
  const autoParkN = count(a.auto.park);
  const teleParkN = count(a.teleop.park);

  const auto = {
    leave: leaveN * PTS.LEAVE,
    park:  autoParkN * PTS.PARK,
    tips:  a.auto.tips * PTS.TIP
  };
  auto.total = auto.leave + auto.park + auto.tips;

  const fl = flowerPoints(flowers, color);
  const teleop = {
    park:   teleParkN * PTS.PARK,
    tips:   a.teleop.tips * PTS.TIP,
    cell:   a.teleop.cell * PTS.CELL,
    bottom: fl.bottom,
    flower: fl.owned,
    garden: a.teleop.garden * PTS.GARDEN
  };
  teleop.total = teleop.park + teleop.tips + teleop.cell + teleop.bottom + teleop.flower + teleop.garden;

  // Fouls the opponent committed are credited to us; a DQ'd alliance credits nothing.
  const foulPts = opp.dq ? 0 : opp.fouls.minor * FOUL.minor + opp.fouls.major * FOUL.major;

  const noFouls = auto.total + teleop.total;
  const total = a.dq ? 0 : noFouls + foulPts;

  const swarmPts = auto.leave + auto.park + teleop.park;   // combined LEAVE + PARK points
  const tips = a.auto.tips + a.teleop.tips;

  return {
    auto, teleop, foulPts, noFouls, total, swarmPts, tips,
    leaveN, autoParkN, teleParkN,
    swarmRP: !a.dq && swarmPts >= thresholds.swarm,
    poll1RP: !a.dq && tips >= thresholds.poll1,
    poll2RP: !a.dq && tips >= thresholds.poll2
  };
}

/** Both alliances, plus the head-to-head RP that depend on the comparison. */
function scoreMatch(m) {
  const th = m.thresholds || state.thresholds;
  const red = scoreAlliance(m.red, m.blue, m.flowers, 'red', th);
  const blue = scoreAlliance(m.blue, m.red, m.flowers, 'blue', th);

  // A DQ is a forfeit, so it decides the result before any comparison of points:
  // otherwise a DQ'd alliance forced to 0 "ties" an opponent who also scored 0.
  let outcome;
  if (m.red.dq && m.blue.dq) outcome = 'tie';
  else if (m.red.dq) outcome = 'blue';
  else if (m.blue.dq) outcome = 'red';
  else if (red.total > blue.total) outcome = 'red';
  else if (blue.total > red.total) outcome = 'blue';
  else outcome = 'tie';

  for (const [side, s] of [['red', red], ['blue', blue]]) {
    const dq = side === 'red' ? m.red.dq : m.blue.dq;
    // A DQ'd alliance earns no RP at all, so its result component is 0 too —
    // showing "Tie +1" beside a total of 0 RP contradicts the rules tab.
    s.resultRP = dq ? 0 : (outcome === 'tie' ? RP.tie : (outcome === side ? RP.win : RP.loss));
    s.rp = dq ? 0 : s.resultRP + (s.swarmRP ? 1 : 0) + (s.poll1RP ? 1 : 0) + (s.poll2RP ? 1 : 0);
  }
  return { red, blue, outcome };
}

/* ============================================================
   RENDERING
   ============================================================ */
const $ = s => document.querySelector(s);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function stepper(path, value, min, max) {
  return `<div class="stepper">
    <button data-step="${path}" data-d="-1"${value <= min ? ' disabled' : ''} aria-label="Decrease">&minus;</button>
    <span class="v">${value}</span>
    <button data-step="${path}" data-d="1"${value >= max ? ' disabled' : ''} aria-label="Increase">+</button>
  </div>`;
}
function row(name, rate, sub, control, pts) {
  return `<div class="row"${control === '' ? ' data-derived="1"' : ''}>
    <div class="row-name">${name}<span class="rate">${rate}</span>${sub ? `<span class="sub">${sub}</span>` : ''}</div>
    ${control || '<span></span>'}
    <div class="row-val" data-on="${pts > 0 ? 1 : 0}">${pts}</div>
  </div>`;
}
function robotToggles(path, flags) {
  return `<div class="toggles">${flags.map((v, i) =>
    `<button class="toggle" data-toggle="${path}" data-i="${i}" aria-pressed="${v}">R${i + 1}</button>`
  ).join('')}</div>`;
}

function renderAlliance(color) {
  const a = state[color];
  const s = scores[color];
  const th = state.thresholds;

  const chip = (earned, label, detail) =>
    `<span class="rp" data-earned="${earned ? 1 : 0}">${label} <em>${detail}</em></span>`;

  return `
  <div class="col-head">
    <span class="col-name">${color}</span>
    <span class="col-sum">${s.total} pts &middot; ${s.rp} RP</span>
  </div>

  <div class="card">
    <div class="card-head"><h2>Autonomous</h2><span class="meta">0:30</span></div>
    ${row('LEAVE', '3 ea', 'Not contacting the perimeter wall', robotToggles(`${color}.auto.leave`, a.auto.leave), s.auto.leave)}
    ${row('PARK', '5 ea', 'Partially in the LOADING ZONE', robotToggles(`${color}.auto.park`, a.auto.park), s.auto.park)}
    ${row('HIVE TIP', '20 ea', '', stepper(`${color}.auto.tips`, a.auto.tips, 0, 30), s.auto.tips)}
    <div class="subtotal"><span>Auto subtotal</span><b>${s.auto.total}</b></div>
  </div>

  <div class="card">
    <div class="card-head"><h2>Teleop</h2><span class="meta">2:00</span></div>
    ${row('PARK', '5 ea', 'Partially in the LOADING ZONE', robotToggles(`${color}.teleop.park`, a.teleop.park), s.teleop.park)}
    ${row('HIVE TIP', '20 ea', '', stepper(`${color}.teleop.tips`, a.teleop.tips, 0, 30), s.teleop.tips)}
    ${row('In CELL', '2 ea', 'Left in the upward-facing CELL', stepper(`${color}.teleop.cell`, a.teleop.cell, 0, MAX_ELEMENTS), s.teleop.cell)}
    ${row('In GARDEN', '1 ea', `Any element in the ${color} GARDEN`, stepper(`${color}.teleop.garden`, a.teleop.garden, 0, MAX_ELEMENTS), s.teleop.garden)}
    ${row('Owned FLOWERS', '2 ea', 'Set in the Flowers panel', '', s.teleop.flower)}
    ${row('Bottom NECTAR', '5 ea', 'Set in the Flowers panel', '', s.teleop.bottom)}
    <div class="subtotal"><span>Teleop subtotal</span><b>${s.teleop.total}</b></div>
  </div>

  <div class="card">
    <div class="card-head"><h2>Fouls committed</h2><span class="meta">go to opponent</span></div>
    ${row('MINOR FOUL', '5 opp', '', stepper(`${color}.fouls.minor`, a.fouls.minor, 0, 99), a.fouls.minor * FOUL.minor)}
    ${row('MAJOR FOUL', '20 opp', '', stepper(`${color}.fouls.major`, a.fouls.major, 0, 99), a.fouls.major * FOUL.major)}
    <div class="subtotal"><span>Received from opponent</span><b>+${s.foulPts}</b></div>
    <div class="dq">
      <span>Disqualified</span>
      <button class="toggle is-dq" data-dq="${color}" aria-pressed="${a.dq}">${a.dq ? 'DQ — 0 pts' : 'No'}</button>
    </div>
  </div>

  <div class="card">
    <div class="card-head"><h2>Ranking points</h2><span class="meta">${s.rp} RP</span></div>
    <div class="rps">
      ${chip(s.swarmRP, 'SWARM', `${s.swarmPts}/${th.swarm}`)}
      ${chip(s.poll1RP, 'POLLINATOR 1', `${s.tips}/${th.poll1}`)}
      ${chip(s.poll2RP, 'POLLINATOR 2', `${s.tips}/${th.poll2}`)}
      ${a.dq
        ? chip(false, 'Disqualified', '+0')
        : chip(s.resultRP > 0, s.resultRP === RP.win ? 'Win' : (s.resultRP === RP.tie ? 'Tie' : 'Loss'), `+${s.resultRP}`)}
    </div>
  </div>`;
}

function renderFlowers() {
  $('#flowerList').innerHTML = state.flowers.map((f, i) => {
    const r = (f.owner === 'red' ? f.elements * PTS.FLOWER : 0) + (f.bottomRed ? PTS.BOTTOM : 0);
    const b = (f.owner === 'blue' ? f.elements * PTS.FLOWER : 0) + (f.bottomBlue ? PTS.BOTTOM : 0);
    const seg = (v, label) =>
      `<button class="toggle" data-owner="${i}" data-v="${v}" aria-pressed="${f.owner === v}">${label}</button>`;
    return `<div class="flower" data-owner="${f.owner}">
      <div class="flower-head">
        <span class="flower-name">Flower ${i + 1}</span>
        <span class="flower-out"><span class="${r ? 'r' : ''}">R ${r}</span> &middot; <span class="${b ? 'b' : ''}">B ${b}</span></span>
      </div>
      <div class="flower-row">
        <label>Elements</label>
        ${stepper(`flowers.${i}.elements`, f.elements, 0, MAX_ELEMENTS)}
      </div>
      <div class="flower-row">
        <label>Owner</label>
        <div class="seg">${seg('none', 'None')}${seg('red', 'Red')}${seg('blue', 'Blue')}</div>
      </div>
      <div class="flower-row">
        <label>Bottom NECTAR</label>
        <div class="seg">
          <button class="toggle" data-bottom="${i}" data-v="red" aria-pressed="${f.bottomRed}">Red +5</button>
          <button class="toggle" data-bottom="${i}" data-v="blue" aria-pressed="${f.bottomBlue}">Blue +5</button>
        </div>
      </div>
    </div>`;
  }).join('');
}

function renderFieldCheck() {
  const inFlowers = state.flowers.reduce((n, f) => n + f.elements, 0);
  const inCells = state.red.teleop.cell + state.blue.teleop.cell;
  const inGardens = state.red.teleop.garden + state.blue.teleop.garden;
  const placed = inFlowers + inCells + inGardens;
  const over = placed > MAX_ELEMENTS;
  const bR = state.flowers.filter(f => f.bottomRed).length;
  const bB = state.flowers.filter(f => f.bottomBlue).length;

  $('#fieldCheck').innerHTML = `<div class="fc">
    <div class="fc-row" data-bad="${over ? 1 : 0}"><span>Elements accounted for</span><b>${placed} / ${MAX_ELEMENTS}</b></div>
    <div class="meter"><i data-over="${over ? 1 : 0}" style="width:${Math.min(100, placed / MAX_ELEMENTS * 100)}%"></i></div>
    <div class="fc-row indent"><span>in FLOWERS</span><b>${inFlowers}</b></div>
    <div class="fc-row indent"><span>in CELLS</span><b>${inCells}</b></div>
    <div class="fc-row indent"><span>in GARDENS</span><b>${inGardens}</b></div>
    <div class="fc-row"><span>Bottom NECTAR bonuses</span><b>R ${bR} &middot; B ${bB}</b></div>
    <div class="fc-row"><span>Total TIPS</span><b>R ${scores.red.tips} &middot; B ${scores.blue.tips}</b></div>
  </div>`;

  // Things a scorekeeper wants caught before the match is committed.
  const alerts = [];
  if (over) alerts.push({ level: 'error', msg: `${placed} elements accounted for, but the FIELD only holds ${MAX_ELEMENTS} (40 POLLEN + 16 NECTAR).` });
  state.flowers.forEach((f, i) => {
    if (f.owner !== 'none' && f.elements === 0)
      alerts.push({ msg: `Flower ${i + 1} has an owner but no elements — the owner scores nothing.` });
    if (f.owner === 'none' && f.elements > 0)
      alerts.push({ msg: `Flower ${i + 1} holds ${f.elements} element${f.elements > 1 ? 's' : ''} but has no owner — nobody scores them.` });
    if ((f.bottomRed || f.bottomBlue) && f.elements === 0)
      alerts.push({ msg: `Flower ${i + 1} has a Bottom NECTAR bonus set but is empty.` });
  });
  $('#alerts').innerHTML = alerts
    .map(a => `<div class="alert"${a.level ? ` data-level="${a.level}"` : ''}>${a.msg}</div>`).join('');
}

function renderScoreline() {
  const { red, blue, outcome } = scores;
  $('#redTotal').textContent = red.total;
  $('#blueTotal').textContent = blue.total;
  $('#redRP').textContent = `${red.rp} RP`;
  $('#blueRP').textContent = `${blue.rp} RP`;
  const pill = $('#resultPill');
  pill.textContent = outcome === 'tie' ? 'Tie' : (outcome === 'red' ? 'Red wins' : 'Blue wins');
  pill.dataset.win = outcome;
  const d = Math.abs(red.total - blue.total);
  $('#margin').textContent = d === 0 ? '—' : `by ${d}`;
}

function renderBreakdown() {
  const col = color => {
    const s = scores[color], a = state[color], opp = color === 'red' ? state.blue : state.red;
    const lines = [
      ['group', 'Autonomous', s.auto.total],
      ['', `LEAVE &times; ${s.leaveN}`, s.auto.leave],
      ['', `PARK &times; ${s.autoParkN}`, s.auto.park],
      ['', `HIVE TIP &times; ${a.auto.tips}`, s.auto.tips],
      ['group', 'Teleop', s.teleop.total],
      ['', `PARK &times; ${s.teleParkN}`, s.teleop.park],
      ['', `HIVE TIP &times; ${a.teleop.tips}`, s.teleop.tips],
      ['', `In CELL &times; ${a.teleop.cell}`, s.teleop.cell],
      ['', 'Owned FLOWER elements', s.teleop.flower],
      ['', 'Bottom NECTAR bonus', s.teleop.bottom],
      ['', `In GARDEN &times; ${a.teleop.garden}`, s.teleop.garden],
      ['group', 'Adjustments', s.foulPts],
      ['', `Opponent MINOR FOULS &times; ${opp.fouls.minor}`, opp.dq ? 0 : opp.fouls.minor * FOUL.minor],
      ['', `Opponent MAJOR FOULS &times; ${opp.fouls.major}`, opp.dq ? 0 : opp.fouls.major * FOUL.major]
    ];
    const body = lines.map(([kind, label, v]) =>
      `<tr data-kind="${kind || (v === 0 ? 'zero' : '')}"><td>${label}</td><td class="n">${v}</td></tr>`
    ).join('');
    return `<div class="card bd-${color}">
      <h3>${color}${a.dq ? ' — disqualified' : ''}</h3>
      <table class="table"><tbody>${body}
        <tr data-kind="total"><td>Match points</td><td class="n">${s.total}</td></tr>
        <tr data-kind="zero"><td>Excluding fouls</td><td class="n">${s.noFouls}</td></tr>
        <tr data-kind="rp"><td>Ranking points</td><td class="n">${s.rp}</td></tr>
      </tbody></table></div>`;
  };
  $('#breakdown').innerHTML = `<div class="bd">${col('red')}${col('blue')}</div>`;
}

function renderHistory() {
  const wrap = $('#historyList');
  if (!state.history.length) {
    wrap.innerHTML = `<div class="empty">No saved matches yet. Score a match, then choose <b>Save match</b>.</div>`;
    return;
  }
  wrap.innerHTML = state.history.map((m, i) => {
    const s = scoreMatch(m);
    return `<div class="hist">
      <div class="hist-main">
        <span class="hist-label">${esc(m.label || '#' + (i + 1))}</span>
        <span class="hist-score"><span class="r">${s.red.total}</span><span class="x">vs</span><span class="b">${s.blue.total}</span></span>
        <span class="hist-rp">${s.red.rp} / ${s.blue.rp} RP</span>
      </div>
      <div class="hist-btns">
        <button class="btn btn-sm" data-load="${i}">Load</button>
        <button class="btn btn-sm btn-quiet" data-del="${i}">Delete</button>
      </div>
    </div>`;
  }).join('');
}

function renderThresholds() {
  const item = (key, label, unit) => `<div class="setting">
    <label>${label}<span class="unit">${unit}</span></label>
    ${stepper(`thresholds.${key}`, state.thresholds[key], 0, 99)}
  </div>`;
  $('#thresholdSettings').innerHTML =
    item('swarm', 'SWARM', 'LEAVE + PARK points') +
    item('poll1', 'POLLINATOR 1', 'HIVE TIPS') +
    item('poll2', 'POLLINATOR 2', 'HIVE TIPS');
}

let scores = null;
function render() {
  scores = scoreMatch(state);
  $('#redPanel').innerHTML = renderAlliance('red');
  $('#bluePanel').innerHTML = renderAlliance('blue');
  renderFlowers();
  renderScoreline();
  renderFieldCheck();
  renderBreakdown();
  renderHistory();
  renderThresholds();
}

/* ============================================================
   STATE MUTATION
   ============================================================ */
function getRef(path) {
  const parts = path.split('.');
  let o = state;
  for (let i = 0; i < parts.length - 1; i++) o = o[parts[i]];
  return { obj: o, key: parts[parts.length - 1] };
}
function stepPath(path, d) {
  const { obj, key } = getRef(path);
  const max = /tips|fouls/.test(path) || path.startsWith('thresholds') ? 99 : MAX_ELEMENTS;
  obj[key] = Math.max(0, Math.min(max, (obj[key] || 0) + d));
  if (path.startsWith('thresholds')) saveConfig();
  render();
}

document.addEventListener('click', e => {
  const t = e.target.closest('button');
  if (!t) return;

  if (t.dataset.step) return stepPath(t.dataset.step, Number(t.dataset.d));
  if (t.dataset.toggle) {
    const { obj, key } = getRef(t.dataset.toggle);
    const i = Number(t.dataset.i);
    obj[key][i] = !obj[key][i];
    return render();
  }
  if (t.dataset.owner !== undefined) {
    state.flowers[Number(t.dataset.owner)].owner = t.dataset.v;
    return render();
  }
  if (t.dataset.bottom !== undefined) {
    const f = state.flowers[Number(t.dataset.bottom)];
    if (t.dataset.v === 'red') f.bottomRed = !f.bottomRed; else f.bottomBlue = !f.bottomBlue;
    return render();
  }
  if (t.dataset.dq) {
    state[t.dataset.dq].dq = !state[t.dataset.dq].dq;
    return render();
  }
  if (t.dataset.load !== undefined) return loadMatch(Number(t.dataset.load));
  if (t.dataset.del !== undefined) {
    state.history.splice(Number(t.dataset.del), 1);
    saveHistory();
    return render();
  }
  if (t.classList.contains('tab')) return switchView(t.dataset.view);
});

document.addEventListener('input', e => {
  if (e.target.id === 'matchLabel') state.label = e.target.value;
});

/* ============================================================
   VIEWS
   ============================================================ */
function switchView(v) {
  document.querySelectorAll('.tab').forEach(b => {
    const on = b.dataset.view === v;
    b.classList.toggle('is-active', on);
    b.setAttribute('aria-selected', String(on));
  });
  document.querySelectorAll('.view').forEach(s => s.classList.toggle('is-active', s.id === 'view-' + v));
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

/* ============================================================
   SAVE / LOAD
   ============================================================ */
const snapshot = () => JSON.parse(JSON.stringify({
  label: state.label || `M${state.history.length + 1}`,
  red: state.red, blue: state.blue, flowers: state.flowers,
  thresholds: state.thresholds, ts: Date.now()
}));

function saveMatch() {
  state.history.unshift(snapshot());
  saveHistory();
  state.label = '';
  $('#matchLabel').value = '';
  clearScores();
  resetTimer();   // otherwise the next match is stuck in 'post' and Start does nothing
  switchView('history');
}
function loadMatch(i) {
  const m = state.history[i];
  if (!m) return;
  state.red = JSON.parse(JSON.stringify(m.red));
  state.blue = JSON.parse(JSON.stringify(m.blue));
  state.flowers = JSON.parse(JSON.stringify(m.flowers));
  // Score the loaded match under the thresholds it was saved with, so what the
  // history row shows and what the match view shows cannot disagree.
  if (m.thresholds) { state.thresholds = { ...DEFAULT_THRESHOLDS, ...m.thresholds }; saveConfig(); }
  state.label = m.label || '';
  $('#matchLabel').value = state.label;
  switchView('match');
  render();
}
function clearScores() {
  state.red = blankAlliance();
  state.blue = blankAlliance();
  state.flowers = blankFlowers();
  render();
}

/* ============================================================
   TIMER
   ============================================================ */
function fmt(sec) {
  const s = Math.max(0, Math.ceil(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
function phaseInfo() {
  const T = state.timer;
  if (T.phase === 'pre') return ['Pre-match', ''];
  if (T.phase === 'auto') return ['Autonomous', 'auto'];
  if (T.phase === 'transition') return ['Transition — pick up controllers', 'transition'];
  if (T.phase === 'post') return ['Match over', 'post'];
  if (T.t <= T_FINAL) return ['Final 20 seconds', 'final'];
  if (T.t <= T_FLOWER) return ['Teleop — flowers unlocked', 'unlocked'];
  return ['Teleop', 'teleop'];
}
function paintTimer() {
  const T = state.timer;
  const [txt, st] = phaseInfo();
  const pill = $('#phasePill');
  pill.textContent = txt;
  pill.dataset.state = st;

  const clock = $('#clock');
  clock.textContent = T.phase === 'transition' ? fmt(T.transitionLeft) : fmt(T.t);
  clock.dataset.warn = (T.phase === 'teleop' && T.t <= T_FINAL) ? '1' : '0';

  const btn = $('#btnStart');
  btn.textContent = T.running ? 'Pause' : (T.phase === 'pre' ? 'Start' : 'Resume');
  btn.dataset.running = T.running ? '1' : '0';

  const unlocked = T.phase === 'teleop' && T.t <= T_FLOWER;
  const hint = $('#flowerHint');
  if (T.phase === 'post') { hint.textContent = 'Final assessment'; hint.dataset.live = '0'; }
  else if (unlocked) { hint.textContent = 'Unlocked'; hint.dataset.live = '1'; }
  else { hint.textContent = 'Locked until 1:00'; hint.dataset.live = '0'; }
}

/* Consume `dt` across phase boundaries. requestAnimationFrame is throttled while
   the tab is backgrounded, so a single frame can span a boundary; spending the
   remainder in the next phase keeps the clock honest instead of losing the overshoot. */
function advance(dt) {
  const T = state.timer;
  for (let guard = 0; dt > 0 && T.running && guard < 8; guard++) {
    if (T.phase === 'auto') {
      const step = Math.min(dt, T.t - T_AUTO_END);
      T.t -= step; dt -= step;
      if (T.t > T_AUTO_END) return;
      T.t = T_AUTO_END; T.phase = 'transition'; T.transitionLeft = TRANSITION; beep(3, 420);
    } else if (T.phase === 'transition') {
      const step = Math.min(dt, T.transitionLeft);
      T.transitionLeft -= step; dt -= step;
      if (T.transitionLeft > 0) return;
      T.transitionLeft = 0; T.phase = 'teleop'; beep(3, 660);
    } else if (T.phase === 'teleop') {
      const prev = T.t;
      T.t = Math.max(0, T.t - dt); dt = 0;
      if (prev > T_FLOWER && T.t <= T_FLOWER) beep(2, 880);
      if (prev > T_FINAL && T.t <= T_FINAL) beep(1, 990);
      if (T.t <= 0) { T.t = 0; T.phase = 'post'; T.running = false; beep(1, 300, 0.9); }
      return;
    } else return;
  }
}

let lastTick = 0, rafId = null;
function tick(now) {
  const T = state.timer;
  if (!T.running) { rafId = null; return; }
  const dt = (now - lastTick) / 1000;
  lastTick = now;

  advance(dt);
  paintTimer();
  rafId = T.running ? requestAnimationFrame(tick) : null;
}
function startTimer() {
  const T = state.timer;
  if (T.phase === 'post') return;
  T.running = !T.running;
  if (T.running) {
    if (T.phase === 'pre') { T.phase = 'auto'; beep(1, 520, 0.5); }
    lastTick = performance.now();
    if (!rafId) rafId = requestAnimationFrame(tick);
  }
  paintTimer();
}
function resetTimer() {
  state.timer = { t: T_START, phase: 'pre', running: false, transitionLeft: 0 };
  paintTimer();
}

/* short WebAudio cues — no assets; a no-op where audio is blocked */
let actx = null;
function beep(times, freq, dur = 0.14) {
  if (!state.sound) return;
  try {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    if (actx.state === 'suspended') actx.resume();
    for (let i = 0; i < times; i++) {
      const t0 = actx.currentTime + i * (dur + 0.07);
      const osc = actx.createOscillator(), g = actx.createGain();
      osc.type = 'square';
      osc.frequency.value = freq;
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(0.16, t0 + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      osc.connect(g).connect(actx.destination);
      osc.start(t0); osc.stop(t0 + dur + 0.02);
    }
  } catch (e) { /* audio unavailable — scoring is unaffected */ }
}

/* ============================================================
   WIRING
   ============================================================ */
$('#btnStart').addEventListener('click', startTimer);
$('#btnReset').addEventListener('click', resetTimer);
$('#btnSave').addEventListener('click', saveMatch);
$('#btnClear').addEventListener('click', () => {
  if (confirm('Clear all scores for the current match?')) clearScores();
});
$('#btnSound').addEventListener('click', e => {
  state.sound = !state.sound;
  e.currentTarget.setAttribute('aria-pressed', String(state.sound));
  saveConfig();
});
$('#btnExport').addEventListener('click', async () => {
  if (!state.history.length) { alert('No saved matches to export yet.'); return; }
  const json = JSON.stringify(state.history, null, 2);
  const filename = `biobuzz-matches-${new Date().toISOString().slice(0, 10)}.json`;

  // Inside the Claude artifact viewer a plain download link is inert, so route
  // through the host's save flow when it exists and fall back everywhere else.
  try {
    const downloads = await window.claude?.use?.('downloads');
    if (downloads) { await downloads.save({ filename, data: json }); return; }
  } catch (err) {
    if (err && (err.code === 'declined' || err.code === 'rate_limited')) return;
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
});

document.addEventListener('keydown', e => {
  if (e.target.matches('input, textarea')) return;
  if (e.code === 'Space') { e.preventDefault(); startTimer(); }
  else if (e.key === 'r' || e.key === 'R') resetTimer();
  else if (e.key >= '1' && e.key <= String(VIEWS.length)) switchView(VIEWS[+e.key - 1]);
});

loadStore();
$('#btnSound').setAttribute('aria-pressed', String(state.sound));
render();
paintTimer();
