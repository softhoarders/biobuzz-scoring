/* ============================================================
   BIOBUZZ Scorer — FTC 2026-27
   Scoring model per BIOBUZZ Competition Manual V1, Tables 10-2 / 10-3 / 13-1.
   Unofficial. Pure client-side; no backend.
   ============================================================ */
'use strict';

/* ---------- constants from the manual ---------- */
const PTS = {
  LEAVE: 3,        // AUTO only, per ROBOT
  PARK: 5,         // AUTO and TELEOP, per ROBOT
  TIP: 20,         // AUTO and TELEOP, per HIVE TIP
  CELL: 2,         // per POLLEN/NECTAR left in upward-facing CELL
  BOTTOM: 5,       // Bottom NECTAR Bonus, per FLOWER
  FLOWER: 2,       // per element in an owned FLOWER
  GARDEN: 1        // per element in own GARDEN
};
const FOUL = { minor: 5, major: 20 };   // credited to the OPPONENT
const RP = { win: 3, tie: 1, loss: 0 };
const DEFAULT_THRESHOLDS = { swarm: 16, poll1: 4, poll2: 7 };  // "All Other Events", Table 10-3

const FLOWERS = 4;
const ROBOTS = 2;
const TOTAL_POLLEN = 40, NECTAR_PER_ALLIANCE = 8;
const MAX_ELEMENTS = TOTAL_POLLEN + NECTAR_PER_ALLIANCE * 2;   // 56

/* timer: field clock shows 2:30 -> 0:00; AUTO ends at 2:00; 8s transition */
const T_START = 150, T_AUTO_END = 120, T_FLOWER = 60, T_FINAL = 20, TRANSITION = 8;

/* ---------- state ---------- */
const blankAlliance = () => ({
  teams: ['', ''],
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
  view: 'match',
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
    if (c.theme) document.documentElement.dataset.theme = c.theme;
  } catch (e) { /* corrupt or unavailable storage: start clean */ }
}
function saveHistory() {
  try { localStorage.setItem(LS.hist, JSON.stringify(state.history)); } catch (e) {}
}
function saveConfig() {
  try {
    localStorage.setItem(LS.cfg, JSON.stringify({
      thresholds: state.thresholds, sound: state.sound,
      theme: document.documentElement.dataset.theme
    }));
  } catch (e) {}
}

/* ============================================================
   SCORING ENGINE
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

/** Full itemised score for one alliance. `opp` supplies the fouls credited to us. */
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

  // Fouls committed by the opponent are credited to us.
  const foulPts = opp.dq ? 0 : opp.fouls.minor * FOUL.minor + opp.fouls.major * FOUL.major;

  const noFouls = auto.total + teleop.total;
  const total = a.dq ? 0 : noFouls + foulPts;

  // Ranking-point components
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

/** Scores both alliances plus the head-to-head RP that depend on the comparison. */
function scoreMatch(m) {
  const th = m.thresholds || state.thresholds;
  const red = scoreAlliance(m.red, m.blue, m.flowers, 'red', th);
  const blue = scoreAlliance(m.blue, m.red, m.flowers, 'blue', th);

  let outcome = 'tie';
  if (red.total > blue.total) outcome = 'red';
  else if (blue.total > red.total) outcome = 'blue';

  for (const [side, s] of [['red', red], ['blue', blue]]) {
    s.resultRP = outcome === 'tie' ? RP.tie : (outcome === side ? RP.win : RP.loss);
    const dq = side === 'red' ? m.red.dq : m.blue.dq;
    s.rp = dq ? 0 : s.resultRP + (s.swarmRP ? 1 : 0) + (s.poll1RP ? 1 : 0) + (s.poll2RP ? 1 : 0);
  }
  return { red, blue, outcome };
}

/* ============================================================
   RENDERING
   ============================================================ */
const $ = s => document.querySelector(s);
const el = (tag, cls, html) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (html != null) n.innerHTML = html;
  return n;
};
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/** A -/+ stepper bound to a state path. */
function stepper(path, value, min, max) {
  return `<div class="stepper">
    <button data-step="${path}" data-d="-1" ${value <= min ? 'disabled' : ''} aria-label="decrease">&minus;</button>
    <span class="val">${value}</span>
    <button data-step="${path}" data-d="1" ${value >= max ? 'disabled' : ''} aria-label="increase">+</button>
  </div>`;
}
/** A scoring row: label, control, computed points. */
function row(label, badge, control, pts, sub) {
  return `<div class="row">
    <div class="row-label">${label}<span class="pts">${badge}</span>${sub ? `<span class="row-sub">${sub}</span>` : ''}</div>
    ${control}
    <div class="row-pts ${pts > 0 ? 'on' : ''}">${pts}</div>
  </div>`;
}
/** Per-robot toggle chips (LEAVE / PARK). */
function robotChips(path, flags) {
  return `<div class="chips">${flags.map((v, i) =>
    `<button class="chip ${v ? 'on' : ''}" data-toggle="${path}" data-i="${i}">R${i + 1}</button>`
  ).join('')}</div>`;
}

function renderAlliance(color) {
  const a = state[color];
  const s = currentScores[color];
  const th = state.thresholds;
  const NAME = color.toUpperCase();

  const rpPill = (on, name, detail) =>
    `<span class="rp ${on ? 'on' : ''}">${on ? '&#9679;' : '&#9675;'} ${name} <small>${detail}</small></span>`;

  return `
  <div class="card">
    <div class="card-head"><h2>${NAME} ALLIANCE</h2><span class="hint">${s.total} pts</span></div>
    <div class="teams">
      <input class="text-input" data-team="${color}.0" value="${esc(a.teams[0])}" placeholder="Team 1" inputmode="numeric">
      <input class="text-input" data-team="${color}.1" value="${esc(a.teams[1])}" placeholder="Team 2" inputmode="numeric">
    </div>
  </div>

  <div class="card">
    <div class="card-head"><h2>AUTONOMOUS</h2><span class="hint">0:30</span></div>
    ${row('LEAVE', '3 ea', robotChips(`${color}.auto.leave`, a.auto.leave), s.auto.leave, 'Not contacting perimeter wall')}
    ${row('PARK', '5 ea', robotChips(`${color}.auto.park`, a.auto.park), s.auto.park, 'Partially in LOADING ZONE')}
    ${row('HIVE TIP', '20 ea', stepper(`${color}.auto.tips`, a.auto.tips, 0, 30), s.auto.tips)}
    <div class="subtotal"><span>AUTO SUBTOTAL</span><b>${s.auto.total}</b></div>
  </div>

  <div class="card">
    <div class="card-head"><h2>TELEOP</h2><span class="hint">2:00</span></div>
    ${row('PARK', '5 ea', robotChips(`${color}.teleop.park`, a.teleop.park), s.teleop.park, 'Partially in LOADING ZONE')}
    ${row('HIVE TIP', '20 ea', stepper(`${color}.teleop.tips`, a.teleop.tips, 0, 30), s.teleop.tips)}
    ${row('In CELL', '2 ea', stepper(`${color}.teleop.cell`, a.teleop.cell, 0, MAX_ELEMENTS), s.teleop.cell, 'Left in upward-facing CELL at end')}
    ${row('In GARDEN', '1 ea', stepper(`${color}.teleop.garden`, a.teleop.garden, 0, MAX_ELEMENTS), s.teleop.garden, 'Any element in the ' + color + ' GARDEN')}
    ${row('Owned FLOWERS', '2 ea', `<span class="hint">from FLOWERS &rarr;</span>`, s.teleop.flower)}
    ${row('Bottom NECTAR', '5 ea', `<span class="hint">from FLOWERS &rarr;</span>`, s.teleop.bottom)}
    <div class="subtotal"><span>TELEOP SUBTOTAL</span><b>${s.teleop.total}</b></div>
  </div>

  <div class="card">
    <div class="card-head"><h2>FOULS COMMITTED</h2><span class="hint">credited to opponent</span></div>
    ${row('MINOR FOUL', '5 to opp', stepper(`${color}.fouls.minor`, a.fouls.minor, 0, 99), a.fouls.minor * FOUL.minor)}
    ${row('MAJOR FOUL', '20 to opp', stepper(`${color}.fouls.major`, a.fouls.major, 0, 99), a.fouls.major * FOUL.major)}
    <div class="subtotal"><span>RECEIVED FROM OPPONENT</span><b>+${s.foulPts}</b></div>
    <div class="dq-row">
      <span class="dq-label">DISQUALIFIED</span>
      <button class="chip dq ${a.dq ? 'on' : ''}" data-dq="${color}">${a.dq ? 'DQ &mdash; 0 pts' : 'No'}</button>
    </div>
  </div>

  <div class="card">
    <div class="card-head"><h2>RANKING POINTS</h2><span class="hint">${s.rp} RP</span></div>
    <div class="rp-list">
      ${rpPill(s.swarmRP, 'SWARM', `${s.swarmPts}/${th.swarm} pts`)}
      ${rpPill(s.poll1RP, 'POLLINATOR&nbsp;1', `${s.tips}/${th.poll1} tips`)}
      ${rpPill(s.poll2RP, 'POLLINATOR&nbsp;2', `${s.tips}/${th.poll2} tips`)}
      ${rpPill(s.resultRP > 0, s.resultRP === RP.win ? 'WIN' : (s.resultRP === RP.tie ? 'TIE' : 'LOSS'), `+${s.resultRP}`)}
    </div>
  </div>`;
}

function renderFlowers() {
  const wrap = $('#flowerList');
  wrap.innerHTML = state.flowers.map((f, i) => {
    const redPts = (f.owner === 'red' ? f.elements * PTS.FLOWER : 0) + (f.bottomRed ? PTS.BOTTOM : 0);
    const bluePts = (f.owner === 'blue' ? f.elements * PTS.FLOWER : 0) + (f.bottomBlue ? PTS.BOTTOM : 0);
    const yield_ = `<span class="${redPts ? 'r' : 'z'}">R&nbsp;${redPts}</span> &middot; <span class="${bluePts ? 'b' : 'z'}">B&nbsp;${bluePts}</span>`;
    return `<div class="flower ${f.owner !== 'none' ? 'owned-' + f.owner : ''}">
      <div class="flower-head">
        <span class="flower-name">FLOWER ${i + 1}</span>
        <span class="flower-yield">${yield_}</span>
      </div>
      <div class="flower-line">
        <span>ELEMENTS</span>
        ${stepper(`flowers.${i}.elements`, f.elements, 0, MAX_ELEMENTS)}
      </div>
      <div class="flower-line">
        <span>OWNER</span>
        <div class="owner-chips">
          <button class="chip ${f.owner === 'none' ? 'on-none' : ''}" data-owner="${i}" data-v="none">None</button>
          <button class="chip ${f.owner === 'red' ? 'on-red' : ''}" data-owner="${i}" data-v="red">Red</button>
          <button class="chip ${f.owner === 'blue' ? 'on-blue' : ''}" data-owner="${i}" data-v="blue">Blue</button>
        </div>
      </div>
      <div class="flower-line">
        <span>BOTTOM&nbsp;NECTAR</span>
        <div class="bottom-chips">
          <button class="chip ${f.bottomRed ? 'on-red' : ''}" data-bottom="${i}" data-v="red">Red +5</button>
          <button class="chip ${f.bottomBlue ? 'on-blue' : ''}" data-bottom="${i}" data-v="blue">Blue +5</button>
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
  const pct = Math.min(100, (placed / MAX_ELEMENTS) * 100);
  const over = placed > MAX_ELEMENTS;
  const bottomRed = state.flowers.filter(f => f.bottomRed).length;
  const bottomBlue = state.flowers.filter(f => f.bottomBlue).length;

  $('#fieldCheck').innerHTML = `
    <div class="fc-row ${over ? 'bad' : ''}"><span>Elements accounted for</span><b>${placed} / ${MAX_ELEMENTS}</b></div>
    <div class="bar"><i class="${over ? 'over' : ''}" style="width:${pct}%"></i></div>
    <div class="fc-row"><span>&nbsp;&nbsp;in FLOWERS</span><b>${inFlowers}</b></div>
    <div class="fc-row"><span>&nbsp;&nbsp;in CELLS</span><b>${inCells}</b></div>
    <div class="fc-row"><span>&nbsp;&nbsp;in GARDENS</span><b>${inGardens}</b></div>
    <div class="fc-row"><span>Bottom NECTAR bonuses</span><b>R ${bottomRed} &middot; B ${bottomBlue}</b></div>
    <div class="fc-row"><span>Total TIPS</span><b>R ${currentScores.red.tips} &middot; B ${currentScores.blue.tips}</b></div>`;

  // Warnings that a scorekeeper would want to catch before committing a match.
  const alerts = [];
  if (over) alerts.push({ err: true, msg: `${placed} elements accounted for, but only ${MAX_ELEMENTS} exist on the FIELD (40 POLLEN + 16 NECTAR).` });
  state.flowers.forEach((f, i) => {
    if (f.owner !== 'none' && f.elements === 0)
      alerts.push({ msg: `FLOWER ${i + 1} has an owner but 0 elements — owner scores nothing.` });
    if (f.owner === 'none' && f.elements > 0)
      alerts.push({ msg: `FLOWER ${i + 1} has ${f.elements} element(s) but no owner — no one scores them.` });
    if (f.bottomRed && f.elements === 0) alerts.push({ msg: `FLOWER ${i + 1}: red Bottom NECTAR bonus set but the FLOWER is empty.` });
    if (f.bottomBlue && f.elements === 0) alerts.push({ msg: `FLOWER ${i + 1}: blue Bottom NECTAR bonus set but the FLOWER is empty.` });
  });
  $('#alerts').innerHTML = alerts.map(a => `<div class="alert ${a.err ? 'err' : ''}">${a.msg}</div>`).join('');
}

function renderScorebar() {
  const { red, blue, outcome } = currentScores;
  $('#redTotal').textContent = red.total;
  $('#blueTotal').textContent = blue.total;
  $('#redRP').textContent = `${red.rp} RP`;
  $('#blueRP').textContent = `${blue.rp} RP`;
  const pill = $('#resultPill');
  pill.className = 'result-pill ' + (outcome === 'tie' ? '' : outcome);
  pill.textContent = outcome === 'tie' ? 'TIE' : outcome.toUpperCase() + ' WINS';
  const d = Math.abs(red.total - blue.total);
  $('#margin').textContent = d === 0 ? '—' : `by ${d}`;
}

function renderBreakdown() {
  const lines = (s, a) => [
    ['sub', 'AUTONOMOUS', s.auto.total],
    ['', `LEAVE &times; ${s.leaveN}`, s.auto.leave],
    ['', `PARK &times; ${s.autoParkN}`, s.auto.park],
    ['', `HIVE TIP &times; ${a.auto.tips}`, s.auto.tips],
    ['sub', 'TELEOP', s.teleop.total],
    ['', `PARK &times; ${s.teleParkN}`, s.teleop.park],
    ['', `HIVE TIP &times; ${a.teleop.tips}`, s.teleop.tips],
    ['', `In CELL &times; ${a.teleop.cell}`, s.teleop.cell],
    ['', `Owned FLOWER elements`, s.teleop.flower],
    ['', `Bottom NECTAR bonus`, s.teleop.bottom],
    ['', `In GARDEN &times; ${a.teleop.garden}`, s.teleop.garden],
    ['sub', 'ADJUSTMENTS', s.foulPts],
    ['', `Opponent MINOR FOULS`, (a === state.red ? state.blue : state.red).fouls.minor * FOUL.minor],
    ['', `Opponent MAJOR FOULS`, (a === state.red ? state.blue : state.red).fouls.major * FOUL.major]
  ];
  const col = (color) => {
    const s = currentScores[color], a = state[color];
    const rows = lines(s, a).map(([kind, label, v]) =>
      `<tr class="${kind === 'sub' ? 'bd-sub' : (v === 0 ? 'bd-zero' : '')}"><td>${label}</td><td class="num">${v}</td></tr>`
    ).join('');
    return `<div class="bd-col ${color}">
      <h3>${color.toUpperCase()} ALLIANCE${a.dq ? ' — DISQUALIFIED' : ''}</h3>
      <table><tbody>${rows}
        <tr class="bd-total"><td>MATCH POINTS</td><td class="num">${s.total}</td></tr>
        <tr class="bd-zero"><td>Points excluding FOULS <small>(rank sort 2)</small></td><td class="num">${s.noFouls}</td></tr>
        <tr><td>RANKING POINTS</td><td class="num">${s.rp}</td></tr>
      </tbody></table></div>`;
  };
  $('#breakdown').innerHTML = `<div class="bd-grid">${col('red')}${col('blue')}</div>`;
}

function renderHistory() {
  const wrap = $('#historyList');
  if (!state.history.length) {
    wrap.innerHTML = `<div class="empty">No saved matches yet. Score a match, then press <b>Save Match to History</b>.</div>`;
    return;
  }
  wrap.innerHTML = state.history.map((m, i) => {
    const s = scoreMatch(m);
    const teams = t => t.filter(Boolean).join(' & ') || '—';
    return `<div class="hist">
      <div class="hist-label">${esc(m.label || '#' + (i + 1))}</div>
      <div>
        <div class="hist-score">
          <span class="r">${s.red.total}</span><span class="sep">vs</span><span class="b">${s.blue.total}</span>
          <span class="sep">&nbsp;${s.red.rp} / ${s.blue.rp} RP</span>
        </div>
        <div class="hist-teams">Red ${esc(teams(m.red.teams))} &nbsp;&middot;&nbsp; Blue ${esc(teams(m.blue.teams))}</div>
      </div>
      <div style="display:flex;gap:6px">
        <button class="btn btn-small" data-load="${i}">Load</button>
        <button class="btn btn-small btn-danger" data-del="${i}">Delete</button>
      </div>
    </div>`;
  }).join('');
}

function renderRankings() {
  /* Per 13.6.3: RANKING SCORE = average RP. Sort: RS, avg (match points - fouls),
     avg TIPS, avg AUTO. A DISQUALIFIED match contributes 0 to all criteria. */
  const teams = new Map();
  const bump = (num, side, s, dq) => {
    if (!num) return;
    if (!teams.has(num)) teams.set(num, { team: num, n: 0, rp: 0, pts: 0, tips: 0, auto: 0, w: 0, l: 0, t: 0 });
    const r = teams.get(num);
    r.n++;
    if (dq) return;                       // DQ contributes 0 to every criterion
    r.rp += s.rp; r.pts += s.noFouls; r.tips += s.tips; r.auto += s.auto.total;
    if (s.resultRP === RP.win) r.w++; else if (s.resultRP === RP.tie) r.t++; else r.l++;
  };
  for (const m of state.history) {
    const s = scoreMatch(m);
    m.red.teams.forEach(t => bump(t.trim(), 'red', s.red, m.red.dq));
    m.blue.teams.forEach(t => bump(t.trim(), 'blue', s.blue, m.blue.dq));
  }
  const rows = [...teams.values()].map(r => ({
    ...r, rs: r.rp / r.n, aPts: r.pts / r.n, aTips: r.tips / r.n, aAuto: r.auto / r.n
  })).sort((a, b) =>
    b.rs - a.rs || b.aPts - a.aPts || b.aTips - a.aTips || b.aAuto - a.aAuto
  );

  const wrap = $('#rankingsTable');
  if (!rows.length) {
    wrap.innerHTML = `<div class="empty">No ranking data. Enter team numbers on the Match tab and save matches to build a ranking.</div>`;
    return;
  }
  const f = (n, d = 2) => n.toFixed(d);
  wrap.innerHTML = `<div class="table-wrap"><table>
    <thead><tr>
      <th>#</th><th>Team</th><th class="num">RS</th><th class="num">Pts&minus;Fouls</th>
      <th class="num">TIPS</th><th class="num">AUTO</th><th class="num">W&ndash;L&ndash;T</th><th class="num">Played</th>
    </tr></thead><tbody>
    ${rows.map((r, i) => `<tr>
      <td class="${i === 0 ? 'rank-1' : ''}">${i + 1}</td>
      <td><b>${esc(r.team)}</b></td>
      <td class="num ${i === 0 ? 'rank-1' : ''}">${f(r.rs)}</td>
      <td class="num">${f(r.aPts, 1)}</td>
      <td class="num">${f(r.aTips, 1)}</td>
      <td class="num">${f(r.aAuto, 1)}</td>
      <td class="num">${r.w}&ndash;${r.l}&ndash;${r.t}</td>
      <td class="num">${r.n}</td>
    </tr>`).join('')}
  </tbody></table></div>`;
}

function renderThresholds() {
  const box = $('#thresholdSettings');
  const item = (key, label, unit) => `<div class="setting">
    <label>${label} <span style="opacity:.7">(${unit})</span></label>
    ${stepper(`thresholds.${key}`, state.thresholds[key], 0, 99)}
  </div>`;
  box.innerHTML =
    item('swarm', 'SWARM RP threshold', 'LEAVE + PARK pts') +
    item('poll1', 'POLLINATOR 1 threshold', 'TIPS') +
    item('poll2', 'POLLINATOR 2 threshold', 'TIPS');
}

/* master render */
let currentScores = null;
function render() {
  currentScores = scoreMatch(state);
  $('#redPanel').innerHTML = renderAlliance('red');
  $('#bluePanel').innerHTML = renderAlliance('blue');
  renderFlowers();
  renderScorebar();
  renderFieldCheck();
  renderBreakdown();
  renderHistory();
  renderRankings();
  renderThresholds();
}

/* ============================================================
   STATE MUTATION VIA data-* PATHS
   ============================================================ */
function getRef(path) {
  const parts = path.split('.');
  let o = state;
  for (let i = 0; i < parts.length - 1; i++) o = o[parts[i]];
  return { obj: o, key: parts[parts.length - 1] };
}
function stepPath(path, d) {
  const { obj, key } = getRef(path);
  const max = path.includes('tips') || path.includes('fouls') || path.startsWith('thresholds') ? 99 : MAX_ELEMENTS;
  obj[key] = Math.max(0, Math.min(max, (obj[key] || 0) + d));
  if (path.startsWith('thresholds')) saveConfig();
  render();
}

document.addEventListener('click', e => {
  const t = e.target.closest('button');
  if (!t) return;

  if (t.dataset.step) return stepPath(t.dataset.step, Number(t.dataset.d));

  if (t.dataset.toggle) {                       // per-robot LEAVE / PARK
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
    saveHistory(); return render();
  }
  if (t.classList.contains('tab')) return switchView(t.dataset.view);
});

document.addEventListener('input', e => {
  const t = e.target;
  if (t.dataset.team) {
    const [color, i] = t.dataset.team.split('.');
    state[color].teams[Number(i)] = t.value;
    renderRankings();                            // cheap: avoid a full re-render while typing
  }
  if (t.id === 'matchLabel') state.label = t.value;
});

/* ============================================================
   VIEWS
   ============================================================ */
function switchView(v) {
  state.view = v;
  document.querySelectorAll('.tab').forEach(b => b.classList.toggle('active', b.dataset.view === v));
  document.querySelectorAll('.view').forEach(s => s.classList.toggle('active', s.id === 'view-' + v));
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

/* ============================================================
   MATCH SAVE / LOAD
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
  clearScores(true);
  switchView('history');
}
function loadMatch(i) {
  const m = state.history[i];
  if (!m) return;
  state.red = JSON.parse(JSON.stringify(m.red));
  state.blue = JSON.parse(JSON.stringify(m.blue));
  state.flowers = JSON.parse(JSON.stringify(m.flowers));
  state.label = m.label || '';
  $('#matchLabel').value = state.label;
  switchView('match');
  render();
}
function clearScores(keepTeams) {
  const t = { red: [...state.red.teams], blue: [...state.blue.teams] };
  state.red = blankAlliance();
  state.blue = blankAlliance();
  state.flowers = blankFlowers();
  if (keepTeams) { state.red.teams = t.red; state.blue.teams = t.blue; }
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
  if (T.phase === 'pre') return ['PRE-MATCH', ''];
  if (T.phase === 'auto') return ['AUTONOMOUS', 'auto'];
  if (T.phase === 'transition') return ['TRANSITION — PICK UP CONTROLLERS', 'transition'];
  if (T.phase === 'post') return ['MATCH OVER', 'post'];
  if (T.t <= T_FINAL) return ['FINAL 20 SECONDS', 'final'];
  if (T.t <= T_FLOWER) return ['TELEOP — FLOWERS UNLOCKED', 'unlocked'];
  return ['TELEOP', 'teleop'];
}
function paintTimer() {
  const T = state.timer;
  const [txt, cls] = phaseInfo();
  const pill = $('#phasePill');
  pill.textContent = txt;
  pill.className = 'phase-pill ' + cls;
  $('#clock').textContent = T.phase === 'transition' ? fmt(T.transitionLeft) : fmt(T.t);
  $('#clock').classList.toggle('warn', T.phase === 'teleop' && T.t <= T_FINAL);
  $('#btnStart').textContent = T.running ? 'Pause' : (T.phase === 'pre' ? 'Start' : 'Resume');
  $('#btnStart').classList.toggle('running', T.running);

  const unlocked = T.phase === 'teleop' && T.t <= T_FLOWER;
  const hint = $('#flowerHint');
  if (T.phase === 'post') { hint.textContent = 'Final assessment'; hint.className = 'hint'; }
  else if (unlocked) { hint.textContent = '● UNLOCKED'; hint.className = 'hint live'; }
  else { hint.textContent = 'Locked until 1:00'; hint.className = 'hint'; }
}

let lastTick = 0, rafId = null;
function tick(now) {
  const T = state.timer;
  if (!T.running) { rafId = null; return; }
  const dt = (now - lastTick) / 1000;
  lastTick = now;

  if (T.phase === 'transition') {
    T.transitionLeft -= dt;
    if (T.transitionLeft <= 0) { T.phase = 'teleop'; beep(3, 660); }
  } else {
    const prev = T.t;
    T.t -= dt;
    if (T.phase === 'auto' && T.t <= T_AUTO_END) {
      T.t = T_AUTO_END; T.phase = 'transition'; T.transitionLeft = TRANSITION; beep(3, 420);
    } else if (T.phase === 'teleop') {
      if (prev > T_FLOWER && T.t <= T_FLOWER) beep(2, 880);
      if (prev > T_FINAL && T.t <= T_FINAL) beep(1, 990);
      if (T.t <= 0) { T.t = 0; T.phase = 'post'; T.running = false; beep(1, 300, 0.9); }
    }
  }
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

/* short WebAudio cues — no assets, and silently a no-op if audio is unavailable */
let actx = null;
function beep(times, freq, dur = 0.14) {
  if (!state.sound) return;
  try {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    if (actx.state === 'suspended') actx.resume();
    for (let i = 0; i < times; i++) {
      const t0 = actx.currentTime + i * (dur + 0.07);
      const osc = actx.createOscillator(), g = actx.createGain();
      osc.type = 'square'; osc.frequency.value = freq;
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(0.16, t0 + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      osc.connect(g).connect(actx.destination);
      osc.start(t0); osc.stop(t0 + dur + 0.02);
    }
  } catch (e) { /* audio blocked — scoring is unaffected */ }
}

/* ============================================================
   WIRING
   ============================================================ */
$('#btnStart').addEventListener('click', startTimer);
$('#btnReset').addEventListener('click', resetTimer);
$('#btnSave').addEventListener('click', saveMatch);
$('#btnClear').addEventListener('click', () => {
  if (confirm('Clear all scores for the current match? Team numbers are kept.')) clearScores(true);
});
$('#btnSound').addEventListener('click', e => {
  state.sound = !state.sound;
  e.currentTarget.setAttribute('aria-pressed', String(state.sound));
  saveConfig();
});
$('#btnTheme').addEventListener('click', () => {
  const d = document.documentElement;
  // With no explicit choice stamped, fall back to what the OS is actually showing.
  const current = d.dataset.theme ||
    (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
  d.dataset.theme = current === 'dark' ? 'light' : 'dark';
  saveConfig();
});
$('#btnExport').addEventListener('click', async () => {
  if (!state.history.length) { alert('No saved matches to export yet.'); return; }
  const json = JSON.stringify(state.history, null, 2);
  const filename = `biobuzz-matches-${new Date().toISOString().slice(0, 10)}.json`;

  // Inside the Claude artifact viewer a plain download link is inert, so route
  // through the host's save flow when it is there and fall back everywhere else.
  try {
    const downloads = await window.claude?.use?.('downloads');
    if (downloads) { await downloads.save({ filename, data: json }); return; }
  } catch (err) {
    if (err && (err.code === 'declined' || err.code === 'rate_limited')) return;
    // any other failure: fall through to the ordinary download
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
});

/* keyboard shortcuts for a scorekeeper at a laptop */
document.addEventListener('keydown', e => {
  if (e.target.matches('input, textarea')) return;
  if (e.code === 'Space') { e.preventDefault(); startTimer(); }
  else if (e.key === 'r' || e.key === 'R') resetTimer();
  else if (e.key >= '1' && e.key <= '5') switchView(['match', 'breakdown', 'history', 'rankings', 'rules'][+e.key - 1]);
});

loadStore();
$('#btnSound').setAttribute('aria-pressed', String(state.sound));
render();
paintTimer();
