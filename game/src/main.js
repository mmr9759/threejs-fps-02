// main.js — bootstrap and the fixed-step game loop.
// The simulation runs at a fixed 60 Hz, apart from rendering: input is
// sampled into a small struct, the sim steps it, and the renderer draws the
// result. Rounds, damage, planting and the economy live here; movement lives
// in agents.js, shooting in weapons.js, the map in world.js.

import * as THREE from 'three';
import { createState, MATCH, WEAPONS, WORLD } from './state.js';
import { buildWorld } from './world.js';
import { createAgent, spawnAgents, syncMeshes, thinkBot, stepBot, moveAgent, nearestVisibleEnemy } from './agents.js';
import { tryFire, startReload, updateReload, throwGrenade, updateGrenades, buyItem, awardRoundMoney, BUY_LIST, giveWeapon, selectWeapon, currentWeapon } from './weapons.js';
import { Fx } from './fx.js';
import { Hud } from './hud.js';
import { Sfx } from './audio.js';

const STEP = 1 / 60;

// ---------- renderer / scene ----------
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.35;
renderer.domElement.className = 'webgl';
document.getElementById('app').appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(74, innerWidth / innerHeight, 0.08, 220);
camera.rotation.order = 'YXZ';
scene.add(camera);

const world = buildWorld(scene);
const fx = new Fx(scene);
const sfx = new Sfx();
const hud = new Hud();
const state = createState();

// ---------- the shared game context (G) ----------
const G = {
  state, world, scene, fx, sfx, hud,
  damageAgent, plantTick, defuseTick, buy,
};
G.state.player = null;

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// ---------- viewmodel: the rifle the player sees ----------
const viewmodel = new THREE.Group();
{
  const dark = new THREE.MeshStandardMaterial({ color: 0x1e2126, roughness: 0.55, metalness: 0.7 });
  const amber = new THREE.MeshStandardMaterial({ color: 0x8a5a1e, roughness: 0.6, metalness: 0.5 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.13, 0.62), dark);
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.34, 8), dark);
  barrel.rotation.x = Math.PI / 2; barrel.position.set(0, 0.02, -0.44);
  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.16, 0.1), amber);
  grip.position.set(0, -0.12, 0.12); grip.rotation.x = 0.3;
  const sight = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.05, 0.12), amber);
  sight.position.set(0, 0.09, -0.08);
  const mag = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.18, 0.09), dark);
  mag.position.set(0, -0.13, -0.05); mag.rotation.x = 0.15;
  viewmodel.add(body, barrel, grip, sight, mag);
  viewmodel.position.set(0.26, -0.22, -0.42);
  camera.add(viewmodel);
}

// ---------- input ----------
const keys = {};
const input = { forward: 0, strafe: 0, jump: false, crouch: false, quiet: false };
let mouseDown = false, dragging = false, lastMX = 0, lastMY = 0;
let locked = false;
let grenadeSel = 'frag';

addEventListener('keydown', (e) => {
  if (e.repeat) return;
  keys[e.code] = true;
  if (state.phase === 'live' || state.phase === 'freeze') {
    if (e.code === 'KeyR') startReload(G, state.player);
    if (e.code === 'KeyG') throwGrenade(G, state.player, grenadeSel);
    if (e.code === 'KeyQ') {
      grenadeSel = grenadeSel === 'frag' ? 'smoke' : grenadeSel === 'smoke' ? 'flash' : 'frag';
      hud.hint(`Grenade: ${grenadeSel.toUpperCase()} — press G to throw`);
      setTimeout(() => hud.hint(''), 1600);
    }
    if (e.code === 'KeyB' && state.phase === 'freeze') hud.setBuyOpen(G, !hud.buyOpen);
    if (e.code === 'Digit1') selectWeapon(state.player, 'p9');
    if (e.code === 'Digit2') selectWeapon(state.player, 'vk47');
    if (e.code === 'Digit3') selectWeapon(state.player, 'hornet');
    if (hud.buyOpen && /^Digit[1-8]$/.test(e.code)) {
      const entry = BUY_LIST.find((x) => x.key === e.code.slice(5));
      if (entry) buy(entry);
    }
  }
});
addEventListener('keyup', (e) => { keys[e.code] = false; });
addEventListener('mousedown', (e) => {
  if (e.button === 0) {
    mouseDown = true;
    if (!locked && (state.phase === 'live' || state.phase === 'freeze')) {
      dragging = true; lastMX = e.clientX; lastMY = e.clientY;
    }
  }
});
addEventListener('mouseup', (e) => { if (e.button === 0) { mouseDown = false; dragging = false; } });
addEventListener('mousemove', (e) => {
  const p = state.player;
  if (!p || state.phase === 'menu') return;
  let dx = 0, dy = 0;
  if (locked) { dx = e.movementX; dy = e.movementY; }
  else if (dragging) { dx = e.clientX - lastMX; dy = e.clientY - lastMY; lastMX = e.clientX; lastMY = e.clientY; }
  else return;
  p.yaw -= dx * 0.0021;
  p.pitch = Math.max(-1.45, Math.min(1.45, p.pitch - dy * 0.0021));
});
document.addEventListener('pointerlockchange', () => {
  locked = document.pointerLockElement === renderer.domElement;
});
renderer.domElement.addEventListener('click', () => {
  if ((state.phase === 'live' || state.phase === 'freeze') && !locked) {
    renderer.domElement.requestPointerLock();
  }
});

// ---------- damage / death ----------
function damageAgent(victim, dmg, attacker, isHead) {
  if (!victim.alive || state.phase === 'menu') return;
  let rest = dmg;
  if (victim.armor > 0) {
    const absorbed = Math.min(victim.armor, Math.ceil(rest * 0.5));
    victim.armor -= absorbed;
    rest -= absorbed;
  }
  victim.hp -= rest;
  if (victim.isPlayer) {
    hud.damageFlash();
    sfx.hurt();
    if (attacker) {
      // face the attacker: show a hint with their direction
      const dx = attacker.pos.x - victim.pos.x, dz = attacker.pos.z - victim.pos.z;
      const ang = Math.atan2(-dx, -dz) - victim.yaw;
      const dir = Math.abs(ang) < 0.8 ? 'ahead' : Math.abs(ang) > 2.4 ? 'behind' : ang > 0 ? 'right' : 'left';
      hud.hint(`Hit from your ${dir} — ${attacker.name}`);
      setTimeout(() => hud.hint(''), 1200);
    }
  }
  if (victim.hp <= 0) killAgent(victim, attacker, isHead);
}

function killAgent(victim, attacker, isHead) {
  victim.hp = 0; victim.alive = false; victim.deaths++;
  if (victim.mesh) victim.mesh.visible = false;
  const atkName = attacker ? attacker.name : 'the quay';
  const color = attacker && attacker.team === 'atk' ? '#ffb454' : '#57e6c9';
  const vColor = victim.team === 'atk' ? '#ffb454' : '#57e6c9';
  state.killfeed.push({
    text: `<b style="color:${color}">${atkName}</b> ${isHead ? '◎ ' : '✕ '} <b style="color:${vColor}">${victim.name}</b>`,
    t: state.time,
  });
  if (state.killfeed.length > 12) state.killfeed.shift();
  if (attacker && attacker !== victim) {
    attacker.kills++;
    attacker.money = Math.min(16000, attacker.money + MATCH.killBonus);
    if (attacker.isPlayer) state.stats.kills++;
  }
  if (victim.isPlayer) state.stats.deaths++;
  // the charge drops to the nearest living teammate
  if (victim.hasCharge) {
    victim.hasCharge = false;
    state.chargeCarrier = null;
    let best = null, bd = Infinity;
    for (const a of state.agents) {
      if (!a.alive || a.team !== 'atk' || a === victim) continue;
      const d = (a.pos.x - victim.pos.x) ** 2 + (a.pos.z - victim.pos.z) ** 2;
      if (d < bd) { bd = d; best = a; }
    }
    if (best) {
      best.hasCharge = true;
      state.chargeCarrier = best;
      const site = best.ai ? best.ai.site || 'A' : 'A';
      if (best.ai) best.ai.site = site;
    }
  }
  checkRoundEnd();
}

function aliveCount(team) {
  let n = 0;
  for (const a of state.agents) if (a.alive && a.team === team) n++;
  return n;
}

function checkRoundEnd() {
  if (state.phase !== 'live') return;
  if (aliveCount('atk') === 0) endRound('def', 'Ember Crew eliminated');
  else if (aliveCount('def') === 0) endRound('atk', 'Quay Wardens eliminated');
}

// ---------- plant / defuse ----------
function plantTick(agent, site, dt) {
  if (state.plantedAt || state.phase !== 'live') return;
  if (!state.plantProgress) state.plantProgress = { kind: 'plant', t: 0, agent };
  state.plantProgress.t += dt / MATCH.plantTime;
  if (Math.random() < dt * 2) sfx.plantBeep();
  if (state.plantProgress.t >= 1) {
    state.plantProgress = null;
    state.plantedAt = site.id;
    state.planter = agent;
    state.fuse = MATCH.fuseTime;
    state.timer = MATCH.fuseTime;
    agent.hasCharge = false;
    state.chargeCarrier = null;
    state.stats.plants += agent.isPlayer ? 1 : 0;
    agent.money = Math.min(16000, agent.money + MATCH.plantBonus);
    sfx.plantDone();
    hud.banner('CHARGE PLANTED', `${site.name} — defend it for ${MATCH.fuseTime} seconds`, '#ffb454');
  }
}

function defuseTick(agent, site, dt) {
  if (!state.plantedAt || state.phase !== 'live') return;
  if (!state.plantProgress) state.plantProgress = { kind: 'defuse', t: 0, agent };
  state.plantProgress.t += dt / MATCH.defuseTime;
  if (Math.random() < dt * 2) sfx.defuseBeep();
  if (state.plantProgress.t >= 1) {
    state.plantProgress = null;
    state.stats.defuses += agent.isPlayer ? 1 : 0;
    agent.money = Math.min(16000, agent.money + MATCH.defuseBonus);
    endRound('def', `${agent.name} defused the charge`);
  }
}

// ---------- buy ----------
function buy(entry) {
  if (state.phase !== 'freeze') return;
  buyItem(G, state.player, entry);
}

// ---------- rounds ----------
function startMatch() {
  state.score = { atk: 0, def: 0 };
  state.lossStreak = { atk: 0, def: 0 };
  state.round = 1;
  state.stats = { kills: 0, deaths: 0, headshots: 0, plants: 0, defuses: 0, damage: 0 };
  for (const a of state.agents) { a.money = MATCH.startMoney; a.kills = 0; a.deaths = 0; }
  startRound();
}

function startRound() {
  // fresh positions, health and ammo; weapons and money carry over
  const spawns = { atk: world.spawns.atk, def: world.spawns.def };
  let ai = 0, di = 0;
  for (const a of state.agents) {
    const s = a.team === 'atk' ? spawns.atk[ai++ % spawns.atk.length] : spawns.def[di++ % spawns.def.length];
    a.pos.set(s[0], 0, s[1]);
    a.vel.set(0, 0, 0);
    a.yaw = a.team === 'atk' ? 0 : Math.PI;
    a.pitch = 0; a.recoilKick = 0;
    a.alive = true; a.hp = 100; a.armor = a.armor; // armor carries over
    a.mag = currentWeapon(a).mag;
    a.reserve = currentWeapon(a).reserve;
    a.reloading = false;
    a.hasCharge = false;
    a.grenades = { frag: 1, smoke: a.team === 'atk' ? 1 : 0, flash: 1 };
    a.blindUntil = 0;
    if (a.ai) {
      a.ai.state = 'advance'; a.ai.path = []; a.ai.pathI = 0;
      a.ai.seenAt = -9; a.aiTarget = null; a.ai.investigate = null;
      a.ai.site = null; a.ai.holdUntil = 0;
    }
  }
  const p = state.player;
  p.hasCharge = true;
  state.chargeCarrier = p;
  state.plantedAt = null;
  state.planter = null;
  state.plantProgress = null;
  state.fuse = 0;
  state.grenades = [];
  state.smokes = [];
  state.events = [];
  state.winner = null;
  state.phase = 'freeze';
  state.phaseT = 0;
  state.timer = MATCH.freezeTime;
  syncMeshes(G);
  hud.show();
  hud.setBuyOpen(G, true);
  hud.banner(`ROUND ${state.round}`, 'Buy up — freeze time', '#e8ecf1');
  hud.hint('B — buy menu · WASD move · click to aim');
  sfx.click();
}

function endRound(winnerTeam, reason) {
  if (state.phase !== 'live') return;
  state.phase = 'roundEnd';
  state.phaseT = 0;
  state.winner = winnerTeam;
  state.roundReason = reason;
  state.score[winnerTeam]++;
  state.plantProgress = null;
  awardRoundMoney(G, winnerTeam);
  const won = winnerTeam === 'atk';
  hud.banner(won ? 'EMBER CREW TAKES THE ROUND' : 'QUAY WARDENS HOLD THE LINE', reason, won ? '#ffb454' : '#57e6c9');
  if (won) sfx.roundWin(); else sfx.roundLose();
  if (state.score.atk >= MATCH.roundsToWin || state.score.def >= MATCH.roundsToWin || state.round >= MATCH.maxRounds) {
    setTimeout(() => endMatch(), 2600);
  }
}

function endMatch() {
  state.phase = 'matchEnd';
  state.matchWinner = state.score.atk > state.score.def ? 'atk' : 'def';
  const win = state.matchWinner === 'atk';
  document.getElementById('end').style.display = 'flex';
  document.getElementById('endTitle').textContent = win ? 'EMBER CREW WINS THE NIGHT' : 'QUAY WARDENS WIN THE NIGHT';
  document.getElementById('endTitle').style.color = win ? '#ffb454' : '#57e6c9';
  document.getElementById('endTag').textContent =
    `Final score ${state.score.atk} – ${state.score.def} after ${state.round} rounds at Ember Quay.`;
  const s = state.stats;
  document.getElementById('endStats').innerHTML =
    `Your line: <b>${s.kills} kills</b> · ${s.deaths} deaths · ${s.headshots} headshots · ` +
    `${s.damage} damage dealt · ${s.plants} plants · ${s.defuses} defuses.<br>` +
    `The terminal stays open — run it back and take the night.`;
  document.exitPointerLock?.();
}

// ---------- fixed-step simulation ----------
function readPlayerInput() {
  input.forward = (keys.KeyW || keys.ArrowUp ? 1 : 0) - (keys.KeyS || keys.ArrowDown ? 1 : 0);
  input.strafe = (keys.KeyD || keys.ArrowRight ? 1 : 0) - (keys.KeyA || keys.ArrowLeft ? 1 : 0);
  input.jump = !!keys.Space;
  input.crouch = !!keys.KeyC || !!keys.ControlLeft;
  input.quiet = !!keys.ShiftLeft || !!keys.ShiftRight;
}

function stepSim(dt) {
  const S = state;
  S.time += dt;
  S.phaseT += dt;
  const p = S.player;

  if (S.phase === 'freeze') {
    S.timer -= dt;
    if (S.timer <= 0) {
      S.phase = 'live';
      S.phaseT = 0;
      S.timer = MATCH.roundTime;
      hud.setBuyOpen(G, false);
      hud.banner(`ROUND ${S.round} — GO`, 'Plant the charge at A or B', '#ffb454');
    }
    return;
  }
  if (S.phase === 'roundEnd') {
    if (S.phaseT > 4) {
      S.round++;
      startRound();
    }
    return;
  }
  if (S.phase !== 'live') return;

  // round clock / fuse
  S.timer -= dt;
  if (S.plantedAt) {
    S.fuse -= dt;
    if (S.fuse <= 0) {
      fx.explosion(new THREE.Vector3(world.sites[S.plantedAt].x, 0, world.sites[S.plantedAt].z));
      endRound('atk', `The charge blew ${world.sites[S.plantedAt].name}`);
      return;
    }
  } else if (S.timer <= 0) {
    endRound('def', 'Time expired — the charge never went off');
    return;
  }

  // player: input + movement + fire + plant/defuse
  readPlayerInput();
  if (p.alive) {
    if (S.time < p.blindUntil) { input.forward = 0; input.strafe = 0; }
    moveAgent(G, p, input, dt);
    p.recoilKick = Math.max(0, (p.recoilKick || 0) - dt * 0.55);
    p.spreadBloom = Math.max(0, p.spreadBloom - dt * 1.8);
    if (mouseDown && !hud.buyOpen) tryFire(G, p, S.time);
    updateReload(G, p, dt);
    // plant / defuse with E
    if (keys.KeyE) {
      if (p.hasCharge && !S.plantedAt) {
        for (const id of ['A', 'B']) {
          const site = world.sites[id];
          if (Math.hypot(site.x - p.pos.x, site.z - p.pos.z) < site.radius - 0.5) {
            plantTick(p, site, dt);
            break;
          }
        }
      } else if (S.plantedAt) {
        const site = world.sites[S.plantedAt];
        if (Math.hypot(site.x - p.pos.x, site.z - p.pos.z) < site.radius - 0.5) defuseTick(p, site, dt);
      }
    } else if (S.plantProgress && S.plantProgress.agent === p) {
      S.plantProgress = null;
    }
    // footsteps
    if (Math.hypot(p.vel.x, p.vel.z) > 2) {
      p.stepT -= dt;
      if (p.stepT <= 0) { p.stepT = 0.38; sfx.step(input.quiet); }
    }
  }

  // bots: think, act, fire, reload
  for (const a of S.agents) {
    if (a.isPlayer || !a.alive) continue;
    thinkBot(G, a, dt);
    stepBot(G, a, dt);
    if (a.fireHeld) tryFire(G, a, S.time);
    updateReload(G, a, dt);
    if (a.mag === 0 && !a.reloading) startReload(G, a);
    // an attacker bot with a frag lobs it at a distant engaged enemy
    if (a.grenades.frag > 0 && a.aiTarget && Math.random() < dt * 0.02) {
      const d = Math.hypot(a.aiTarget.pos.x - a.pos.x, a.aiTarget.pos.z - a.pos.z);
      if (d > 14) throwGrenade(G, a, 'frag');
    }
  }

  updateGrenades(G, dt);
  syncMeshes(G);
}

// ---------- render ----------
let acc = 0, lastT = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  let dt = Math.min(0.1, (now - lastT) / 1000);
  lastT = now;
  acc += dt;
  let n = 0;
  while (acc >= STEP && n < 5) { stepSim(STEP); acc -= STEP; n++; }
  if (n === 5) acc = 0;

  const p = state.player;
  if (p) {
    const eyeY = p.pos.y + (p.crouch ? WORLD.crouchEye : WORLD.eyeHeight);
    camera.position.set(p.pos.x, eyeY, p.pos.z);
    camera.rotation.y = p.yaw;
    camera.rotation.x = p.pitch + (p.recoilKick || 0);
    // viewmodel bob + recoil kick
    const spd = Math.hypot(p.vel.x, p.vel.z);
    const bob = Math.min(1, spd / 5) * 0.012;
    viewmodel.position.y = -0.22 + Math.sin(state.time * 11) * bob;
    viewmodel.position.x = 0.26 + Math.cos(state.time * 5.5) * bob * 0.5;
    viewmodel.position.z = -0.42 + (p.recoilKick || 0) * 1.6;
    viewmodel.visible = p.alive;
  }
  fx.update();
  if (state.phase !== 'menu') hud.update(G, dt);
  renderer.render(scene, camera);
}

// ---------- boot / menus ----------
document.getElementById('deployBtn').addEventListener('click', () => {
  sfx.ensure();
  document.getElementById('start').style.display = 'none';
  spawnAgents(G);
  // bots get a small head start on the economy: sidearms first round
  startMatch();
  renderer.domElement.requestPointerLock();
  sfx.roundWin();
});
document.getElementById('againBtn').addEventListener('click', () => location.reload());

// menu backdrop: slow orbit around the quay before deploy
spawnAgents(G);
state.phase = 'menu';
{
  const p = state.player;
  camera.position.set(-26, 9, 26);
  camera.lookAt(0, 1, -6);
}
requestAnimationFrame(frame);

// ---------- dev hook for screenshots (used by the maker's own shot script) ----------
// window.EMBER lets the screenshot script stage a scene deterministically:
// teleport the player, aim the camera, and start a round. It is part of
// the shipped game and changes nothing about how it plays.
window.EMBER = {
  state, G,
  look(yaw, pitch) {
    const p = state.player;
    p.yaw = yaw; p.pitch = pitch;
  },
  teleport(x, z, yaw, pitch) {
    const p = state.player;
    p.pos.set(x, 0, z);
    if (yaw !== undefined) p.yaw = yaw;
    if (pitch !== undefined) p.pitch = pitch;
    camera.position.set(x, WORLD.eyeHeight, z);
  },
  deploy() { document.getElementById('deployBtn').click(); },
  buyOpen() { hud.setBuyOpen(G, true); },
  botsNear(x, z, n, team) {
    let placed = 0;
    for (const a of state.agents) {
      if (a.isPlayer || !a.alive || placed >= n) continue;
      if (team && a.team !== team) continue;
      a.pos.set(x + (Math.random() - 0.5) * 8, 0, z + (Math.random() - 0.5) * 8);
      a.yaw = Math.atan2(-(state.player.pos.x - a.pos.x), -(state.player.pos.z - a.pos.z));
      placed++;
    }
    syncMeshes(G);
  },
  // staging helper: bots stand still and hold fire for `seconds`
  calm(seconds) {
    for (const a of state.agents) if (!a.isPlayer) a.blindUntil = state.time + seconds;
  },
};
