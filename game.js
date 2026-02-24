/* ============================================================
   RUSSIAN ROULETTE ONLINE — game.js
   ============================================================ */

/* ── FIREBASE CONFIG ── */
const firebaseConfig = {
  apiKey: "AIzaSyAOqzh4tOPig70DwX2pWSPLU7kIL1yJ0cQ",
  authDomain: "rusianrouletegame.firebaseapp.com",
  databaseURL: "https://rusianrouletegame-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "rusianrouletegame",
  storageBucket: "rusianrouletegame.firebasestorage.app",
  messagingSenderId: "435877009050",
  appId: "1:435877009050:web:181f2c492bde4e386bf123"
};

try { firebase.initializeApp(firebaseConfig); } catch(e) { console.error(e); }
const db = firebase.database();

/* ============================================================
   STATE
============================================================ */
let myPid        = null;   // 'player1'..'player4'
let roomId       = null;
let myName       = '';
let roomRef      = null;
let chatRef      = null;
let lastData     = null;
let busy         = false;
let selectedN    = 2;      // jumlah pemain dipilih
let _firstRender = true;
let _prevRound   = null;

/* ============================================================
   KONSTANTA
============================================================ */
const ALL_PIDS = ['player1','player2','player3','player4'];
const AVATARS  = { player1:'🤠', player2:'😈', player3:'🦊', player4:'🐺' };
const P_COLORS = {
  player1:'var(--gold)',
  player2:'var(--red2)',
  player3:'var(--green2)',
  player4:'var(--purple)'
};

const ITEMS = {
  magnifier:{ e:'🔍', n:'Kaca Pembesar', d:'Lihat isi slot aktif (hanya kamu)' },
  rokok:    { e:'🚬', n:'Rokok',         d:'+1 HP (maks 5)' },
  silet:    { e:'🔪', n:'Silet',         d:'Tembakan berikutnya ×2 damage' },
  beer:     { e:'🍺', n:'Bir',           d:'Kocok ulang chamber + reset index' },
  handcuff: { e:'⛓️', n:'Borgol',        d:'Pemain berikutnya skip giliran' },
};

const ie    = i => ITEMS[i]?.e || '❓';
const iname = i => ITEMS[i]?.n || i;
const idesc = i => ITEMS[i]?.d || '';

/* ============================================================
   CHAMBER CONFIG
============================================================ */
function getCfg(round, pcount) {
  // 2P: 3→6 slots, 1→4 bullets  (max rasio 4:6)
  // 3P: 5→8 slots, 2→6 bullets  (max rasio 6:8)
  // 4P: 8→12 slots, 4→8 bullets (max rasio 8:12)
  const cfgMap = {
    2: [{slots:3,bullets:1},{slots:4,bullets:2},{slots:5,bullets:3},{slots:6,bullets:4}],
    3: [{slots:5,bullets:2},{slots:6,bullets:3},{slots:7,bullets:4},{slots:8,bullets:6}],
    4: [{slots:8,bullets:4},{slots:9,bullets:5},{slots:10,bullets:6},{slots:11,bullets:7},{slots:12,bullets:8}],
  };
  const c = cfgMap[pcount] || cfgMap[2];
  return c[Math.min(round - 1, c.length - 1)];
}

function genChamber(round, pcount) {
  const { slots, bullets } = getCfg(round, pcount);
  const a = Array(slots).fill(0);
  for (let i = 0; i < bullets; i++) a[i] = 1;
  return shuffle(a);
}

/* ============================================================
   BALANCING — ROUND STARTER
   roundStarterIdx terus naik (tidak pernah di-mod) agar
   rotasi berjalan konsisten lintas ronde dan rematch.
   Dari idx yang ditentukan, cari pemain pertama yg masih hidup.
============================================================ */
function getStarterForRound(roundStarterIdx, activePidsList, alivePidsList) {
  const n = activePidsList.length;
  for (let i = 0; i < n; i++) {
    const candidate = activePidsList[(roundStarterIdx + i) % n];
    if (alivePidsList.includes(candidate)) return candidate;
  }
  return alivePidsList[0]; // fallback
}

/* ============================================================
   TURN HELPERS
============================================================ */
function alivePids(players) {
  return ALL_PIDS.filter(pid => players[pid]?.name && players[pid]?.hp > 0);
}

function activePids(players) {
  return ALL_PIDS.filter(pid => players[pid]?.name);
}

// Hitung giliran berikutnya (hormati blockedPlayer)
function calcNext(data, shooterId, targetId, wasBullet) {
  const alive = alivePids(data.players);
  if (!wasBullet && targetId === shooterId) return { pid: shooterId, unblocked: false };
  const si = alive.indexOf(shooterId);
  let ni  = (si + 1) % alive.length;
  let unb = false;
  if (alive[ni] === data.blockedPlayer) { ni = (ni + 1) % alive.length; unb = true; }
  return { pid: alive[ni], unblocked: unb };
}

/* ============================================================
   UTILITY HELPERS
============================================================ */
function toArr(v) {
  if (!v) return [];
  if (Array.isArray(v)) return [...v];
  return Object.keys(v).map(Number).filter(k => !isNaN(k)).sort((a,b) => a-b).map(k => v[k]);
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function giveItems(inv, n) {
  const pool = ['magnifier','rokok','silet','beer','handcuff'];
  const a = [...inv];
  for (let i = 0; i < n; i++) a.push(pool[Math.floor(Math.random() * pool.length)]);
  return a;
}

function genCode() {
  const c = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({ length: 4 }, () => c[Math.floor(Math.random() * c.length)]).join('');
}

function esc(s) {
  return String(s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

/* ============================================================
   UI HELPERS
============================================================ */
function showErr(msg) {
  const el = document.getElementById('lb-err');
  el.textContent = msg;
  el.classList.remove('hidden');
  setTimeout(() => el.classList.add('hidden'), 3500);
}

let _tt = null;
function toast(html, cls = '', dur = 2400) {
  const t = document.getElementById('toast');
  t.innerHTML = html;
  t.className = 'show ' + cls;
  clearTimeout(_tt);
  _tt = setTimeout(() => t.className = '', dur);
}

function showScreen(id) {
  ['lobby','waiting','ready','game','finished'].forEach(s => {
    document.getElementById('screen-' + s).classList.toggle('hidden', s !== id);
  });
}

function flash() {
  const e = document.getElementById('flash');
  e.classList.add('on');
  setTimeout(() => e.classList.remove('on'), 160);
}

function shake() {
  const e = document.getElementById('screen-game');
  e.classList.add('do-shake');
  setTimeout(() => e.classList.remove('do-shake'), 440);
}

/* ============================================================
   NOTIF OVERLAY
============================================================ */
let _nt = null;
function showNotif(cfg) {
  const dur = cfg.duration || 3000;
  const o   = document.getElementById('no');
  const b   = document.getElementById('nb');
  const box = document.getElementById('nbox');
  const p   = document.getElementById('npb');

  document.getElementById('ni').textContent = cfg.icon  || '';
  document.getElementById('nt').textContent = cfg.title || '';
  document.getElementById('ns').innerHTML   = cfg.sub   || '';

  const el = document.getElementById('nitems');
  if (cfg.items && cfg.items.length) {
    el.innerHTML = cfg.items.map(it =>
      `<div class="nic"><div class="nie">${it.e}</div><div class="nin">${esc((it.n||'').slice(0,6))}</div></div>`
    ).join('');
    el.style.display = 'flex';
  } else {
    el.innerHTML = '';
    el.style.display = 'none';
  }

  const tc = {
    'ns-start':'var(--green)','ns-round':'var(--gold)',
    'ns-items':'var(--blue)','ns-dead':'var(--red)','ns-elim':'var(--orange)'
  };
  box.className    = cfg.theme || 'ns-round';
  p.style.color    = tc[cfg.theme || 'ns-round'] || 'var(--gold)';
  p.style.width    = '100%';
  p.style.transition = 'none';
  clearTimeout(_nt);
  o.classList.add('show');
  b.classList.add('show');
  requestAnimationFrame(() => requestAnimationFrame(() => {
    p.style.transition = `width ${dur}ms linear`;
    p.style.width      = '0%';
  }));
  _nt = setTimeout(() => {
    o.classList.remove('show');
    b.classList.remove('show');
  }, dur);
}

/* ============================================================
   PLAYER COUNT SELECTOR
============================================================ */
function selCount(n) {
  selectedN = n;
  document.querySelectorAll('.pc-btn').forEach(b =>
    b.classList.toggle('sel', parseInt(b.dataset.n) === n)
  );
}

/* ============================================================
   CREATE ROOM
============================================================ */
async function createRoom() {
  const name = document.getElementById('inp-name').value.trim();
  if (!name) { showErr('⚠️ Masukkan namamu dulu!'); return; }
  myName = name;
  roomId = genCode();
  myPid  = 'player1';

  const players = {};
  ALL_PIDS.forEach(pid => {
    players[pid] = { name: pid === 'player1' ? myName : '', hp: 5, inventory: [], ready: false, rematch: false };
  });

  try {
    await db.ref('rooms/' + roomId).set({
      status:'waiting', round:1,
      currentTurn:'player1', currentIndex:0,
      roundStarterIdx:0,        // Ronde 1 → player1 starter
      chamber:[0,0,0], doubleDamage:false, blockedPlayer:null, winner:null,
      playerCount:selectedN, players,
      log:['⏳ ' + myName + ' membuat room (' + selectedN + ' pemain). Menunggu...'],
      chat:[]
    });
    document.getElementById('disp-code').textContent = roomId;
    showScreen('waiting');
    startRoomListener();
  } catch(e) {
    showErr('❌ Gagal buat room. Cek Firebase!');
    console.error(e);
  }
}

/* ============================================================
   JOIN ROOM
============================================================ */
async function joinRoom() {
  const name = document.getElementById('inp-name').value.trim();
  const code = document.getElementById('inp-code').value.trim().toUpperCase();
  if (!name) { showErr('⚠️ Masukkan namamu dulu!'); return; }
  if (code.length !== 4) { showErr('⚠️ Kode harus 4 karakter!'); return; }
  myName = name;

  try {
    const snap = await db.ref('rooms/' + code).once('value');
    const data = snap.val();
    if (!data)                      { showErr('❌ Room tidak ditemukan!'); return; }
    if (data.status !== 'waiting')  { showErr('❌ Room sudah mulai atau penuh!'); return; }

    const pcount = data.playerCount || 2;
    const avail  = ALL_PIDS.slice(0, pcount).filter(pid => !data.players[pid]?.name);
    if (!avail.length) { showErr('❌ Room sudah penuh!'); return; }

    myPid = avail[0];
    roomId = code;
    const filledAfter = ALL_PIDS.slice(0, pcount).filter(pid => data.players[pid]?.name).length + 1;
    const allIn = filledAfter >= pcount;

    const upd = {
      ['players/' + myPid + '/name']:      myName,
      ['players/' + myPid + '/hp']:        5,
      ['players/' + myPid + '/inventory']: [],
      ['players/' + myPid + '/ready']:     false,
      ['players/' + myPid + '/rematch']:   false,
    };
    if (allIn) upd.status = 'lobby';
    await db.ref('rooms/' + code).update(upd);

    document.getElementById('g-code').textContent     = code;
    document.getElementById('ready-code').textContent = code;
    if (allIn) { showScreen('ready'); } else { showScreen('waiting'); }
    startRoomListener();
    startChatListener();
  } catch(e) {
    showErr('❌ Gagal join. Cek Firebase!');
    console.error(e);
  }
}

/* ============================================================
   READY SYSTEM
============================================================ */
async function setReady() {
  if (!roomId || !myPid) return;
  document.getElementById('btn-ready').disabled = true;
  await db.ref('rooms/' + roomId + '/players/' + myPid + '/ready').set(true);
  const snap = await db.ref('rooms/' + roomId).once('value');
  const data = snap.val();
  const pids = ALL_PIDS.slice(0, data.playerCount || 2);
  if (pids.every(pid => data.players[pid]?.ready)) await startGame(data);
}

async function startGame(data) {
  if (!data || data.status !== 'lobby') return;
  const pcount = data.playerCount || 2;
  const pids   = ALL_PIDS.slice(0, pcount);
  if (!pids.every(pid => data.players[pid]?.ready)) return;

  const chamber    = genChamber(1, pcount);
  const cfg        = getCfg(1, pcount);
  const starterIdx = 0;                   // Ronde 1 selalu mulai dari player1
  const starterPid = pids[starterIdx];

  const upd = {
    status:'playing', round:1,
    currentTurn: starterPid,
    currentIndex:0,
    roundStarterIdx: starterIdx,
    chamber, doubleDamage:false, blockedPlayer:null, winner:null
  };

  pids.forEach(pid => {
    const inv = giveItems([], 1);
    upd['players/' + pid + '/hp']        = 5;
    upd['players/' + pid + '/inventory'] = inv;
    data.players[pid]._inv = inv;
  });

  const invLine = pids.map(pid =>
    data.players[pid].name + ': ' + ((data.players[pid]._inv || []).map(ie).join(' '))
  ).join('  |  ');

  upd['log'] = [
    '🎮 Game dimulai! ' + pids.map(pid => data.players[pid].name).join(' vs '),
    '🔫 Chamber: ' + cfg.slots + ' slot — ' + cfg.bullets + ' peluru (' + cfg.bullets + ':' + cfg.slots + ')',
    '📦 ' + invLine,
    '🎯 ' + data.players[starterPid].name + ' memulai giliran pertama (Ronde 1)',
    '⚖️ Starter bergilir tiap ronde untuk balance!'
  ];
  await db.ref('rooms/' + roomId).update(upd);
}

/* ============================================================
   ROOM LISTENER
============================================================ */
function startRoomListener() {
  if (roomRef) db.ref('rooms/' + roomId).off('value', roomRef);
  roomRef = db.ref('rooms/' + roomId).on('value', snap => {
    const data = snap.val();
    if (!data) return;
    lastData = data;

    if (data.status === 'waiting') {
      showScreen('waiting');
      renderWaiting(data);

    } else if (data.status === 'lobby') {
      _firstRender = true;
      _prevRound   = null;
      document.getElementById('ready-code').textContent = roomId;
      showScreen('ready');
      renderReady(data);
      startChatListener();

    } else if (data.status === 'playing') {
      document.getElementById('g-code').textContent = roomId;
      showScreen('game');
      handleTransitions(data);
      renderGame(data);

    } else if (data.status === 'finished') {
      document.getElementById('g-code').textContent = roomId;
      const onFin = !document.getElementById('screen-finished').classList.contains('hidden');
      if (onFin) {
        updateRematchStatus(data);
      } else {
        showScreen('game');
        handleTransitions(data);
        renderGame(data);
        setTimeout(() => renderFinished(data), 1400);
      }
    }

    _prevRound   = data.round;
    _firstRender = false;
  });
}

/* ============================================================
   TRANSITIONS (notif antar ronde)
============================================================ */
function handleTransitions(data) {
  if (_firstRender && data.status === 'playing') {
    const pcount     = data.playerCount || 2;
    const cfg        = getCfg(1, pcount);
    const pids       = activePids(data.players);
    const starterName = data.players[data.currentTurn]?.name || '?';
    showNotif({
      icon:'🎮', title:'GAME DIMULAI!',
      sub: pids.map(pid => esc(data.players[pid].name))
            .join(' <span style="color:var(--text3)">vs</span> ')
        + '<br><span style="color:var(--green2)">Ronde 1 — ' + cfg.slots + ' slot, ' + cfg.bullets + ' peluru</span>'
        + '<br><span style="color:var(--gold)">⚖️ Starter: ' + esc(starterName) + '</span>',
      theme:'ns-start', duration:3500
    });
    return;
  }

  if (!_firstRender && data.round !== _prevRound && _prevRound !== null) {
    const pcount      = data.playerCount || 2;
    const r           = data.round;
    const cfg         = getCfg(r, pcount);
    const pc          = getCfg(r - 1, pcount);
    const added       = cfg.slots - pc.slots;
    const amt         = r >= 3 ? 2 : 1;
    const myInv       = toArr(data.players[myPid]?.inventory);
    const myNew       = myInv.slice(-amt).map(i => ({ e: ie(i), n: iname(i) }));
    const starterName = data.players[data.currentTurn]?.name || '?';

    showNotif({
      icon:'🔄', title:'RONDE ' + r + '!',
      sub:'Chamber: <strong style="color:var(--gold)">' + cfg.slots + ' slot</strong>'
        + (added > 0 ? ' (+' + added + ')' : '')
        + ' — Peluru: <strong style="color:var(--red2)">' + cfg.bullets + '</strong>'
        + '<br><span style="color:var(--gold)">⚖️ Starter ronde ini: ' + esc(starterName) + '</span>',
      theme:'ns-round', duration:3200
    });
    setTimeout(() => showNotif({
      icon:'📦', title:'ITEM DIBERIKAN!',
      sub:'Kamu mendapat ' + myNew.length + ' item baru',
      items:myNew, theme:'ns-items', duration:2600
    }), 3400);
  }
}

/* ============================================================
   RENDER: WAITING
============================================================ */
function renderWaiting(data) {
  const pcount = data.playerCount || 2;
  const pids   = ALL_PIDS.slice(0, pcount);
  const filled = pids.filter(pid => data.players[pid]?.name).length;

  document.getElementById('wt').textContent = '⏳ Menunggu Pemain (' + filled + '/' + pcount + ')';
  document.getElementById('join-slots').innerHTML = pids.map(pid => {
    const p   = data.players[pid];
    const has = !!p?.name;
    return '<div class="jslot ' + (has ? 'filled' : '') + '">'
      + '<div class="jsav">' + (has ? AVATARS[pid] : '👤') + '</div>'
      + '<div class="jsname">' + (has ? esc(p.name) : 'Menunggu...') + '</div>'
      + '</div>';
  }).join('');

  document.getElementById('wmsg').innerHTML = filled >= pcount
    ? '<span style="color:var(--green2)">✅ Semua terhubung!</span>'
    : '<span class="pulse-dot"></span>' + filled + '/' + pcount + ' pemain terhubung...';
}

/* ============================================================
   RENDER: READY
============================================================ */
function renderReady(data) {
  const pcount = data.playerCount || 2;
  const pids   = ALL_PIDS.slice(0, pcount);

  const cfgMap = {
    2: [{slots:3,bullets:1},{slots:4,bullets:2},{slots:5,bullets:3},{slots:6,bullets:4}],
    3: [{slots:5,bullets:2},{slots:6,bullets:3},{slots:7,bullets:4},{slots:8,bullets:6}],
    4: [{slots:8,bullets:4},{slots:9,bullets:5},{slots:10,bullets:6},{slots:11,bullets:7},{slots:12,bullets:8}],
  };
  const cfgs    = cfgMap[pcount] || cfgMap[2];
  const cfgCard = document.getElementById('ready-cfg-card');
  if (cfgCard) {
    const starterOrder = cfgs.map((_, i) => {
      const pid = pids[i % pcount];
      return '🎯 Ronde ' + (i+1) + ' starter: <span style="color:var(--gold)">'
        + esc(data.players[pid]?.name || 'P' + (i % pcount + 1)) + '</span>';
    }).join('<br>');

    cfgCard.innerHTML = cfgs.map((c, i) => {
      const isLast = i === cfgs.length - 1;
      return '<div>🔫 Ronde ' + (i+1) + (isLast ? '+' : '')
        + ' → <span style="color:var(--text)">' + c.slots + ' slot</span>, '
        + '<span style="color:var(--red2)">' + c.bullets + ' peluru</span> (' + c.bullets + ':' + c.slots + (isLast ? ' maks' : '') + ')</div>';
    }).join('')
    + '<div style="margin-top:8px;padding-top:8px;border-top:1px solid var(--border);color:var(--gold2)">⚖️ STARTER ORDER:<br>' + starterOrder + '</div>';
  }

  const grid = document.getElementById('ready-grid');
  grid.style.gridTemplateColumns = pcount <= 2 ? '1fr 1fr' : 'repeat(auto-fit,minmax(130px,1fr))';
  grid.innerHTML = pids.map(pid => {
    const p    = data.players[pid];
    const isMe = pid === myPid;
    const ready = !!p?.ready;
    const has   = !!p?.name;
    return '<div class="rcard' + (ready ? ' rdone' : '') + (isMe ? ' is-you-card' : '') + (has ? '' : ' empty') + '">'
      + '<div class="rav">' + AVATARS[pid] + '</div>'
      + '<div class="rname">' + esc(p?.name || 'Menunggu...') + (isMe ? '<span class="you-badge">KAMU</span>' : '') + '</div>'
      + '<div><span class="rbadge ' + (has ? (ready ? 'rb-yes' : 'rb-no') : 'rb-w') + '">'
      + (has ? (ready ? '✅ READY!' : '⬜ Belum') : '🔌 Kosong') + '</span></div>'
      + '</div>';
  }).join('');

  const btn = document.getElementById('btn-ready');
  const myR = !!data.players[myPid]?.ready;
  btn.disabled    = myR;
  btn.textContent = myR ? '✅ Sudah Ready!' : '✅ READY!';

  const allR = pids.every(pid => data.players[pid]?.ready);
  const foot = document.getElementById('rfoot');
  if (allR) {
    foot.innerHTML = '<span style="color:var(--green2)">🚀 Memulai game...</span>';
  } else {
    foot.innerHTML = pids.map(pid => {
      const p = data.players[pid];
      return (p?.ready
        ? '<span style="color:var(--green2)">✅</span>'
        : '<span style="color:var(--text3)">⬜</span>') + ' ' + esc(p?.name || '?');
    }).join(' &nbsp;|&nbsp; ');
  }
  if (allR && data.status === 'lobby') startGame(data);
}

/* ============================================================
   RENDER: GAME
============================================================ */
function renderGame(data) {
  if (!data?.players) return;
  const pcount = data.playerCount || 2;
  const active = activePids(data.players);
  const myTurn = data.currentTurn === myPid;
  const canAct = myTurn && data.status === 'playing';

  document.getElementById('g-round').textContent = data.round || 1;
  const tname = data.players[data.currentTurn]?.name || '?';
  document.getElementById('g-turn').innerHTML = myTurn
    ? '<span style="color:var(--red2);font-family:var(--fm);font-size:.7rem">🎯 GILIRAN KAMU</span>'
    : '<span style="color:var(--text3);font-family:var(--fm);font-size:.7rem">⏳ ' + esc(tname) + '</span>';

  const pg = document.getElementById('pgrid');
  pg.className = 'pgrid pg' + Math.min(pcount, 4);
  pg.innerHTML = active.map(pid => buildPlayerCard(pid, data, canAct)).join('');

  renderChamber(toArr(data.chamber), data.currentIndex || 0, data.round || 1, pcount);
  renderTargets(data, canAct);
  renderLog(toArr(data.log));
}

function buildPlayerCard(pid, data, canAct) {
  const p         = data.players[pid];
  const isMe      = pid === myPid;
  const isTurn    = data.currentTurn === pid;
  const isDead    = p.hp <= 0;
  const isBlocked = data.blockedPlayer === pid;

  // Tentukan round starter untuk badge ⚖️
  const active       = activePids(data.players);
  const starterIdx   = data.roundStarterIdx || 0;
  const roundStarter = active[starterIdx % active.length];
  const isRndStarter = pid === roundStarter;

  const fx = [];
  if (data.doubleDamage && isTurn) fx.push('<span class="fx-tag fx-double">🔪 DMG ×2</span>');
  if (isBlocked)                   fx.push('<span class="fx-tag fx-blocked">⛓️ BORGOL</span>');
  if (isRndStarter && !isDead)     fx.push('<span class="fx-tag fx-starter">⚖️ STARTER</span>');

  const inv     = toArr(p.inventory);
  const invHtml = isMe && !isDead ? buildInv(inv, canAct) : buildEInv(inv);
  const hearts  = Array.from({length:5}, (_, i) =>
    '<div class="heart ' + (i < p.hp ? 'alive' : 'dead') + '"></div>'
  ).join('');

  return '<div class="pcard' + (isMe ? ' is-you' : '') + (isTurn ? ' my-turn' : '') + (isDead ? ' dead-card' : '') + '">'
    + '<div class="ph">'
    + '<div class="pav">' + AVATARS[pid] + '</div>'
    + '<div class="pname">' + esc(p.name || '?') + '</div>'
    + (isMe ? '<span class="you-tag">KAMU</span>' : '')
    + '</div>'
    + '<div class="hp-row"><div class="hearts">' + hearts + '</div><div class="hp-num">' + p.hp + '/5</div></div>'
    + '<div class="inv-label">INV' + (isMe ? ' (KLIK PAKAI)' : '') + '</div>'
    + '<div class="inv-row">' + invHtml + '</div>'
    + '<div class="fx-row">' + fx.join('') + '</div>'
    + '</div>';
}

function buildInv(inv, active) {
  if (!inv.length) return '<span class="no-items">— kosong —</span>';
  return inv.map((item, i) => {
    const info = ITEMS[item] || {};
    return '<button class="ibtn"'
      + ' onclick="' + (active ? 'useItem(\'' + item + '\',' + i + ')' : '') + '"'
      + ' onmouseenter="showTip(event,\'' + item + '\')"'
      + ' onmouseleave="hideTip()"'
      + (active ? '' : ' disabled') + '>'
      + '<span>' + (info.e || '❓') + '</span>'
      + '<span class="itag">' + ((info.n || item).slice(0, 5).toUpperCase()) + '</span>'
      + '</button>';
  }).join('');
}

function buildEInv(inv) {
  if (!inv.length) return '<span class="no-items">— kosong —</span>';
  return inv.map(item => {
    const info = ITEMS[item] || {};
    return '<button class="ibtn enemy" disabled'
      + ' onmouseenter="showTip(event,\'' + item + '\')"'
      + ' onmouseleave="hideTip()">'
      + '<span>' + (info.e || '❓') + '</span>'
      + '<span class="itag">' + ((info.n || item).slice(0, 5).toUpperCase()) + '</span>'
      + '</button>';
  }).join('');
}

/* ============================================================
   RENDER: TARGETS
============================================================ */
function renderTargets(data, canAct) {
  const alive = alivePids(data.players);
  const panel = document.getElementById('tpanel');

  let html = '<button class="btn-tgt bt-self" onclick="handleShoot(\'' + myPid + '\')" ' + (canAct ? '' : 'disabled') + '>'
    + '<span class="bt-icon">🔫</span>'
    + '<span class="bt-name">Tembak Diri</span>'
    + '<span style="font-family:var(--fm);font-size:.52rem;color:rgba(212,168,67,.6)">' + esc(data.players[myPid]?.name || 'Kamu') + '</span>'
    + '</button>';

  alive.filter(pid => pid !== myPid).forEach(pid => {
    const name = data.players[pid]?.name || '?';
    html += '<button class="btn-tgt bt-enemy" onclick="handleShoot(\'' + pid + '\')" ' + (canAct ? '' : 'disabled') + '>'
      + '<span class="bt-icon">' + AVATARS[pid] + ' 💀</span>'
      + '<span class="bt-name">' + esc(name) + '</span>'
      + '</button>';
  });

  panel.innerHTML = html;
}

/* ============================================================
   RENDER: CHAMBER
============================================================ */
function renderChamber(chamber, idx, round, pcount) {
  const el    = document.getElementById('ch-slots');
  const total = chamber.length;
  const cfg   = getCfg(round, pcount);

  document.getElementById('ch-idx').textContent = Math.min(idx + 1, total);
  document.getElementById('ch-tot').textContent = total;
  document.getElementById('ch-ri').textContent  = 'RONDE ' + round;
  document.getElementById('ch-cfg').textContent = cfg.slots + ' SLOT — ' + cfg.bullets + ' PELURU';

  el.innerHTML = chamber.map((_, i) => {
    let cls, icon;
    if      (i < idx)  { cls = 'sf'; icon = '×'; }
    else if (i === idx) { cls = 'sc'; icon = '◆'; }
    else               { cls = 'su'; icon = '?'; }
    return '<div class="slot ' + cls + '">' + icon + '</div>'
      + (i < total - 1 ? '<div class="scon"></div>' : '');
  }).join('');

  const fired = chamber.slice(0, idx).filter(x => x === 1).length;
  const rb    = Math.max(0, cfg.bullets - fired);
  const rs    = Math.max(0, total - idx);
  document.getElementById('ratio-b').textContent = rb;
  document.getElementById('ratio-s').textContent = rs;

  const pct = rs > 0 ? (rb / rs) * 100 : 0;
  const bar = document.getElementById('ratio-bar');
  bar.style.width = pct + '%';
  if      (pct >= 65) bar.style.background = 'linear-gradient(90deg,#8e1f1f,var(--red2))';
  else if (pct >= 40) bar.style.background = 'linear-gradient(90deg,#8e4e00,var(--orange))';
  else                bar.style.background = 'linear-gradient(90deg,#1a5e30,var(--green))';
}

/* ============================================================
   RENDER: LOG
============================================================ */
function renderLog(logs) {
  const el  = document.getElementById('action-log');
  const bot = (el.scrollHeight - el.scrollTop - el.clientHeight) < 50;
  el.innerHTML = logs.map((e, i) =>
    '<div class="log-entry" style="animation-delay:' + (i * .02) + 's">' + e + '</div>'
  ).join('');
  if (bot) el.scrollTop = el.scrollHeight;
}

/* ============================================================
   CHAT
============================================================ */
function startChatListener() {
  if (chatRef) return;
  chatRef = db.ref('rooms/' + roomId + '/chat').on('value', snap => {
    renderChat(toArr(snap.val() || []));
  });
}

async function sendChat() {
  const inp  = document.getElementById('ci');
  const text = inp.value.trim();
  if (!text || !roomId || !myPid) return;
  const name = lastData?.players?.[myPid]?.name || myName;
  inp.value  = '';
  const snap = await db.ref('rooms/' + roomId + '/chat').once('value');
  const msgs = toArr(snap.val() || []);
  msgs.push({ pid: myPid, name, text, ts: Date.now() });
  if (msgs.length > 60) msgs.splice(0, msgs.length - 60);
  await db.ref('rooms/' + roomId + '/chat').set(msgs);
}

function renderChat(msgs) {
  const el  = document.getElementById('chat-body');
  if (!el) return;
  const bot = (el.scrollHeight - el.scrollTop - el.clientHeight) < 50;
  el.innerHTML = msgs.map(m => {
    if (m.system) return '<div class="chat-sys">— ' + esc(m.text) + ' —</div>';
    const mine = m.pid === myPid;
    const col  = P_COLORS[m.pid] || 'var(--text3)';
    return '<div class="chat-msg ' + (mine ? 'mine' : '') + '">'
      + '<div class="cm-av">' + (AVATARS[m.pid] || '👤') + '</div>'
      + '<div class="cm-bd">'
      + '<div class="cm-name" style="' + (mine ? 'color:var(--blue)' : 'color:' + col) + '">' + esc(m.name) + '</div>'
      + '<div class="cm-text">' + esc(m.text) + '</div>'
      + '</div></div>';
  }).join('');
  if (bot) el.scrollTop = el.scrollHeight;
}

/* ============================================================
   USE ITEM
============================================================ */
async function useItem(itemParam, itemIndex) {
  if (busy) return;
  const data = lastData;
  if (!data || data.currentTurn !== myPid || data.status !== 'playing') return;

  const inv = toArr(data.players[myPid].inventory);
  if (itemIndex >= inv.length) return;

  const item   = inv[itemIndex];
  const sn     = data.players[myPid].name;
  const newInv = [...inv];
  newInv.splice(itemIndex, 1);

  // Magnifier — hanya efek lokal, tidak perlu busy lock
  if (item === 'magnifier') {
    const sl = toArr(data.chamber)[data.currentIndex];
    await db.ref('rooms/' + roomId + '/players/' + myPid + '/inventory').set(newInv);
    toast(
      sl === 1
        ? '🔴 <strong>PELURU!</strong><br><span style="font-size:.74rem;color:var(--text3)">Slot aktif berisi peluru</span>'
        : '⚪ <strong>KOSONG</strong><br><span style="font-size:.74rem;color:var(--text3)">Slot aktif kosong</span>',
      sl === 1 ? '' : 'tb', 3400
    );
    return;
  }

  busy = true;
  try {
    const upd  = {};
    const logs = toArr(data.log);
    upd['players/' + myPid + '/inventory'] = newInv;

    if (item === 'rokok') {
      const hp = Math.min(5, data.players[myPid].hp + 1);
      upd['players/' + myPid + '/hp'] = hp;
      logs.push('🚬 ' + sn + ' merokok — HP +1 (' + hp + '/5)');
      toast('🚬 +1 HP!', 'tg', 1600);

    } else if (item === 'silet') {
      upd['doubleDamage'] = true;
      logs.push('🔪 ' + sn + ' menggunakan silet — damage berikutnya ×2!');
      toast('🔪 Damage ×2 aktif!', '', 1600);

    } else if (item === 'beer') {
      upd['chamber']      = shuffle(toArr(data.chamber));
      upd['currentIndex'] = 0;
      logs.push('🍺 ' + sn + ' minum bir — chamber dikocok, index reset ke 0');
      toast('🍺 Chamber dikocok!', '', 1600);

    } else if (item === 'handcuff') {
      const alive  = alivePids(data.players);
      const si     = alive.indexOf(myPid);
      const target = alive[(si + 1) % alive.length];
      upd['blockedPlayer'] = target;
      logs.push('⛓️ ' + sn + ' memasang borgol ke ' + data.players[target]?.name + ' — skip giliran berikutnya!');
      toast('⛓️ ' + esc(data.players[target]?.name) + ' di-borgol!', '', 1800);
    }

    if (logs.length > 40) logs.splice(0, logs.length - 40);
    upd['log'] = logs;
    await db.ref('rooms/' + roomId).update(upd);
  } finally {
    busy = false;
  }
}

/* ============================================================
   SHOOT
============================================================ */
async function handleShoot(targetId) {
  if (busy) return;
  const data = lastData;
  if (!data || data.currentTurn !== myPid || data.status !== 'playing') return;
  await pullTrigger(targetId);
}

async function pullTrigger(targetId) {
  busy = true;
  try {
    const snap = await db.ref('rooms/' + roomId).once('value');
    const data = snap.val();
    if (!data || data.currentTurn !== myPid || data.status !== 'playing') return;

    const chamber = toArr(data.chamber);
    const idx     = data.currentIndex || 0;
    const bullet  = chamber[idx];
    const ddmg    = data.doubleDamage || false;
    const sn      = data.players[myPid].name;
    const tn      = data.players[targetId]?.name || '?';
    const logs    = toArr(data.log);
    const upd     = {};

    if (bullet === 1) {
      flash(); shake();
      const dmg   = ddmg ? 2 : 1;
      const newHp = Math.max(0, data.players[targetId].hp - dmg);
      upd['players/' + targetId + '/hp'] = newHp;
      logs.push('💥 ' + sn + ' menembak ' + (targetId === myPid ? 'dirinya sendiri' : tn) + '!'
        + (ddmg ? ' (×2)' : '') + ' −' + dmg + ' HP → ' + newHp + ' HP');
      toast(ddmg ? '💥 BOOM! ×2 Damage!' : '💥 TERKENA!', '', 1600);

      if (newHp <= 0) {
        logs.push('💀 ' + tn + ' tereliminasi!');
        const afterPlayers = { ...data.players };
        afterPlayers[targetId] = { ...afterPlayers[targetId], hp: 0 };
        const stillAlive = alivePids(afterPlayers);

        if (stillAlive.length <= 1) {
          // Game over
          const wid   = stillAlive[0] || myPid;
          const wname = data.players[wid]?.name || '?';
          upd['status']       = 'finished';
          upd['winner']       = wid;
          upd['doubleDamage'] = false;
          upd['currentIndex'] = idx + 1;
          logs.push('🏆 ' + wname + ' menang! Terakhir bertahan!');
          if (logs.length > 40) logs.splice(0, logs.length - 40);
          upd['log'] = logs;
          await db.ref('rooms/' + roomId).update(upd);
          return;
        }

        // Lanjut ronde dalam satu chamber
        upd['doubleDamage'] = false;
        const newIdx = idx + 1;
        if (newIdx >= chamber.length) {
          await doNewRound(data, upd, logs, stillAlive);
        } else {
          upd['currentIndex'] = newIdx;
          const si  = stillAlive.indexOf(myPid);
          let ni    = (si + 1) % stillAlive.length;
          let unb   = false;
          if (stillAlive[ni] === data.blockedPlayer) { ni = (ni + 1) % stillAlive.length; unb = true; }
          if (unb) { upd['blockedPlayer'] = null; logs.push('⛓️ ' + data.players[data.blockedPlayer]?.name + ' skip giliran (borgol)!'); }
          upd['currentTurn'] = stillAlive[ni];
          logs.push('🎯 Giliran ' + data.players[stillAlive[ni]]?.name);
          if (logs.length > 40) logs.splice(0, logs.length - 40);
          upd['log'] = logs;
          await db.ref('rooms/' + roomId).update(upd);
        }
        return;
      }

    } else {
      logs.push('💨 Klik... ' + sn + ' menembak ' + (targetId === myPid ? 'dirinya sendiri' : tn) + ' — kosong!');
      toast('💨 Klik! Kosong.', 'tb', 1600);
    }

    upd['doubleDamage'] = false;
    const newIdx = idx + 1;

    if (newIdx >= chamber.length) {
      const alive = alivePids(data.players);
      await doNewRound(data, upd, logs, alive);
    } else {
      upd['currentIndex'] = newIdx;
      if (bullet === 0 && targetId === myPid) {
        upd['currentTurn'] = myPid;
        logs.push('↩️ ' + sn + ' tembak diri (kosong) — dapat giliran lagi!');
      } else {
        const res = calcNext(data, myPid, targetId, bullet === 1);
        if (res.unblocked) {
          upd['blockedPlayer'] = null;
          logs.push('⛓️ ' + data.players[data.blockedPlayer]?.name + ' skip giliran (borgol)!');
        }
        upd['currentTurn'] = res.pid;
        logs.push('🎯 Giliran ' + data.players[res.pid]?.name);
      }
      if (logs.length > 40) logs.splice(0, logs.length - 40);
      upd['log'] = logs;
      await db.ref('rooms/' + roomId).update(upd);
    }

  } catch(e) {
    console.error(e);
  } finally {
    busy = false;
  }
}

/* ============================================================
   NEW ROUND — dengan balancing starter
============================================================ */
async function doNewRound(data, upd, logs, alivePids_arr) {
  const pcount = data.playerCount || 2;
  const nr     = (data.round || 1) + 1;
  const nc     = genChamber(nr, pcount);
  const cfg    = getCfg(nr, pcount);
  const amt    = nr >= 3 ? 2 : 1;

  // Berikan item ke semua pemain yang masih hidup
  alivePids_arr.forEach(pid => {
    upd['players/' + pid + '/inventory'] = giveItems(toArr(data.players[pid].inventory), amt);
  });

  // ── BALANCING: hitung starter ronde baru ──
  // activePidsFull = semua pemain yang join (tetap), sebagai referensi rotasi
  const activePidsFull  = ALL_PIDS.filter(pid => data.players[pid]?.name);
  const prevStarterIdx  = data.roundStarterIdx ?? 0;
  const newStarterIdx   = prevStarterIdx + 1;   // geser 1, tidak pernah di-mod agar terus maju
  const newStarter      = getStarterForRound(newStarterIdx, activePidsFull, alivePids_arr);

  upd['round']          = nr;
  upd['currentIndex']   = 0;
  upd['chamber']        = nc;
  upd['blockedPlayer']  = null;
  upd['roundStarterIdx'] = newStarterIdx;
  upd['currentTurn']    = newStarter;

  logs.push('━━━━━━━━━━━━━━━━━━━━━━');
  logs.push('🔄 Ronde ' + nr + ' dimulai!');
  logs.push('🔫 Chamber: ' + cfg.slots + ' slot — ' + cfg.bullets + ' peluru (' + cfg.bullets + ':' + cfg.slots + ')');
  logs.push('📦 Item baru dibagikan (+' + amt + ' untuk pemain hidup)');
  logs.push('⚖️ Starter ronde ' + nr + ': ' + (data.players[newStarter]?.name || '?') + ' (giliran berimbang)');
  logs.push('🎯 ' + (data.players[newStarter]?.name || '?') + ' memulai ronde ini');

  if (logs.length > 40) logs.splice(0, logs.length - 40);
  upd['log'] = logs;
  await db.ref('rooms/' + roomId).update(upd);
}

/* ============================================================
   FINISHED SCREEN
============================================================ */
function renderFinished(data) {
  if (!data?.players) return;
  const w    = data.winner;
  const wObj = data.players[w];
  const iWon = w === myPid;
  const pcount = data.playerCount || 2;
  const pids   = ALL_PIDS.slice(0, pcount);

  document.getElementById('fin-trophy').textContent   = iWon ? '🏆' : '💀';
  document.getElementById('fin-title').textContent    = iWon ? wObj?.name + ' MENANG!' : wObj?.name + ' MENANG';
  document.getElementById('fin-title').style.color    = iWon ? 'var(--gold)' : 'var(--text2)';
  document.getElementById('fin-sub').textContent      = iWon
    ? 'Selamat! Kamu yang terakhir bertahan.'
    : 'Kamu tidak selamat kali ini...';

  document.getElementById('fin-stats').innerHTML =
    '<div class="stat-item"><div class="stat-lbl">RONDE</div><div class="stat-val">' + (data.round || 1) + '</div></div>'
    + pids.map(pid => {
      const p   = data.players[pid];
      const col = pid === w ? 'var(--green)' : 'var(--red2)';
      return '<div class="stat-item"><div class="stat-lbl">' + esc(p?.name || '?') + '</div>'
        + '<div class="stat-val" style="color:' + col + '">' + (p?.hp || 0) + ' HP</div></div>';
    }).join('');

  const btn = document.getElementById('btn-rm');
  btn.disabled    = false;
  btn.textContent = '🔄 MAIN LAGI (Room Sama)';

  updateRematchStatus(data);
  showNotif({
    icon:  iWon ? '🏆' : '💀',
    title: iWon ? 'KAMU MENANG!' : 'KAMU KALAH',
    sub:   iWon
      ? 'Selamat ' + esc(wObj?.name || '?') + '!<br>Bertahan hingga ronde ' + (data.round || 1)
      : esc(wObj?.name || '?') + ' menang dengan ' + (wObj?.hp || 0) + ' HP tersisa',
    theme: iWon ? 'ns-start' : 'ns-dead',
    duration: 4000
  });
  setTimeout(() => showScreen('finished'), 4200);
}

function updateRematchStatus(data) {
  const pcount = data.playerCount || 2;
  const pids   = ALL_PIDS.slice(0, pcount);
  const sel    = document.getElementById('rm-status');
  const msg    = document.getElementById('rm-msg');
  const btn    = document.getElementById('btn-rm');
  if (!sel) return;

  sel.innerHTML = pids.map(pid => {
    const p = data.players[pid];
    const r = !!p?.rematch;
    return '<div style="display:flex;align-items:center;gap:5px;font-family:var(--fm);font-size:.7rem;'
      + 'background:' + (r ? 'rgba(39,174,96,.12)' : 'rgba(90,90,90,.1)') + ';'
      + 'border:1px solid ' + (r ? 'rgba(39,174,96,.35)' : 'var(--border)') + ';'
      + 'border-radius:6px;padding:4px 9px;'
      + 'color:' + (r ? 'var(--green2)' : 'var(--text3)') + ';">'
      + (r ? '✅' : '⬜') + ' ' + esc(p?.name || '?') + '</div>';
  }).join('');

  const myR = !!data.players[myPid]?.rematch;
  if (myR) { btn.disabled = true; btn.textContent = '✅ Menunggu pemain lain...'; }

  const allR = pids.every(pid => data.players[pid]?.rematch);
  if (allR) {
    msg.innerHTML = '<span style="color:var(--green2)">🚀 Semua setuju! Memulai ulang...</span>';
    resetForRematch(data);
  } else if (myR) {
    msg.innerHTML = '<span class="pulse-dot"></span>Menunggu '
      + pids.filter(pid => !data.players[pid]?.rematch).map(pid => esc(data.players[pid]?.name || '?')).join(', ')
      + '...';
  } else {
    msg.textContent = '';
  }
}

async function requestRematch() {
  if (!roomId || !myPid) return;
  document.getElementById('btn-rm').disabled    = true;
  document.getElementById('btn-rm').textContent = '✅ Menunggu pemain lain...';
  await db.ref('rooms/' + roomId + '/players/' + myPid + '/rematch').set(true);
  const snap = await db.ref('rooms/' + roomId).once('value');
  const data = snap.val();
  const pids = ALL_PIDS.slice(0, data.playerCount || 2);
  if (pids.every(pid => data.players[pid]?.rematch)) await resetForRematch(data);
}

async function resetForRematch(data) {
  if (!data || !roomId) return;
  _firstRender = true;
  _prevRound   = null;
  const pcount = data.playerCount || 2;
  const pids   = ALL_PIDS.slice(0, pcount);

  // Rematch melanjutkan rotasi starter agar tetap fair antar game
  const lastStarterIdx  = data.roundStarterIdx ?? 0;
  const nextStarterIdx  = lastStarterIdx + 1;
  const nextStarterPid  = pids[nextStarterIdx % pcount];

  const upd = {
    status:'lobby', round:1,
    currentTurn:    nextStarterPid,
    currentIndex:   0,
    roundStarterIdx: nextStarterIdx,
    chamber:[0,0,0], doubleDamage:false, blockedPlayer:null, winner:null
  };
  pids.forEach(pid => {
    upd['players/' + pid + '/hp']        = 5;
    upd['players/' + pid + '/inventory'] = [];
    upd['players/' + pid + '/ready']     = false;
    upd['players/' + pid + '/rematch']   = false;
  });
  upd['log'] = [
    '🔄 Rematch! ' + pids.map(pid => esc(data.players[pid]?.name || '?')).join(' vs ') + ' — klik READY untuk mulai.',
    '⚖️ Starter pertama game ini: ' + esc(data.players[nextStarterPid]?.name || '?')
  ];
  await db.ref('rooms/' + roomId).update(upd);
}

/* ============================================================
   TOOLTIP
============================================================ */
const _tip = document.getElementById('tip');

function showTip(e, item) {
  _tip.innerHTML = '<strong style="color:var(--text)">' + ie(item) + ' ' + iname(item) + '</strong><br>' + idesc(item);
  _tip.style.display = 'block';
  posTip(e);
}

function posTip(e) {
  let x = e.clientX + 12, y = e.clientY - 52;
  if (x + 190 > window.innerWidth) x = e.clientX - 202;
  if (y < 4) y = e.clientY + 14;
  _tip.style.left = x + 'px';
  _tip.style.top  = y + 'px';
}

function hideTip() { _tip.style.display = 'none'; }

document.addEventListener('mousemove', e => {
  if (_tip.style.display !== 'none') posTip(e);
});

/* ============================================================
   EVENT BINDINGS
============================================================ */
document.getElementById('inp-name').focus();

document.getElementById('inp-name').addEventListener('keydown', e => {
  if (e.key === 'Enter') {
    const c = document.getElementById('inp-code').value.trim();
    c ? joinRoom() : createRoom();
  }
});

document.getElementById('inp-code').addEventListener('keydown', e => {
  if (e.key === 'Enter') joinRoom();
});

document.getElementById('inp-code').addEventListener('input', e => {
  e.target.value = e.target.value.toUpperCase();
});

document.getElementById('ci').addEventListener('keydown', e => {
  if (e.key === 'Enter') sendChat();
});
