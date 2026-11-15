// agents.js — the people in the game: the player and nine bots.
// One shared mover (acceleration, gravity, crouch, AABB collision) drives
// both; bots add a brain on top: waypoint routes, hold positions, reactions
// to sight and sound, planting and defusing. No per-frame allocation in the
// hot paths — scratch vectors live at module scope.

import * as THREE from 'three';
import { WEAPONS, WORLD, BOT_NAMES } from './state.js';
import { hasLineOfSight } from './world.js';

const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _dir = new THREE.Vector3();

// ---------- construction ----------
export function createAgent(G, opts) {
  const w = WEAPONS[opts.weapon || 'vk47'];
  const a = {
    id: opts.id, name: opts.name, team: opts.team, isPlayer: !!opts.isPlayer,
    alive: true, hp: 100, armor: opts.armor || 0,
    pos: new THREE.Vector3(opts.x, 0, opts.z),
    vel: new THREE.Vector3(),
    yaw: opts.yaw || 0, pitch: 0,
    crouch: false, onGround: true,
    weapon: w.id, mag: w.mag, reserve: w.reserve,
    owned: [...new Set([w.id, 'p9'])], // weapons bought this match
    reloading: false, reloadT: 0, lastShot: -9, fireHeld: false,
    spreadBloom: 0, recoil: 0,
    money: opts.money ?? 800,
    grenades: { frag: 0, smoke: 0, flash: 0 },
    kills: 0, deaths: 0, hasCharge: false,
    blindUntil: 0, blindAmt: 0,
    // bot brain
    ai: opts.isPlayer ? null : {
      state: 'advance', path: [], pathI: 0, targetNode: -1, holdUntil: 0,
      holdYaw: 0, seenAt: -9, reaction: 0.45 + Math.random() * 0.35,
      burstLeft: 0, burstCool: 0, strafeDir: 1, strafeT: 0,
      thinkT: Math.random() * 0.12, investigate: null, site: null,
    },
    mesh: null, headMesh: null, bodyMesh: null,
    stepT: Math.random() * 0.4,
  };
  if (!a.isPlayer) buildBotMesh(G, a);
  return a;
}

function buildBotMesh(G, a) {
  const teamColor = a.team === 'atk' ? 0x8a5a1e : 0x14564a;
  const g = new THREE.Group();
  const torsoMat = new THREE.MeshStandardMaterial({ color: teamColor, roughness: 0.8 });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x1c1e22, roughness: 0.85 });
  const skinMat = new THREE.MeshStandardMaterial({ color: 0x9a7a5a, roughness: 0.9 });

  const legs = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.7, 0.28), darkMat);
  legs.position.y = 0.35; legs.castShadow = true; g.add(legs);
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.72, 0.34), torsoMat);
  torso.position.y = 1.06; torso.castShadow = true; g.add(torso);
  // bright team stripe so the two crews read at a glance in the dusk light
  const stripe = new THREE.Mesh(
    new THREE.BoxGeometry(0.58, 0.1, 0.36),
    new THREE.MeshStandardMaterial({ color: a.team === 'atk' ? 0xffb454 : 0x57e6c9 }),
  );
  stripe.material.emissive = new THREE.Color(a.team === 'atk' ? 0xffb454 : 0x57e6c9);
  stripe.material.emissiveIntensity = 0.9;
  stripe.position.y = 1.28; g.add(stripe);
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.34, 0.34), skinMat);
  head.position.y = 1.58; head.castShadow = true; g.add(head);
  const helmet = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.14, 0.38), darkMat);
  helmet.position.y = 1.76; g.add(helmet);
  const visor = new THREE.Mesh(
    new THREE.BoxGeometry(0.3, 0.06, 0.02),
    new THREE.MeshStandardMaterial({ color: 0x111111, emissive: a.team === 'atk' ? 0xff8833 : 0x33ffee, emissiveIntensity: 1.6 }),
  );
  visor.position.set(0, 1.6, 0.18); g.add(visor);
  const gun = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.14, 0.85), darkMat);
  gun.position.set(0.22, 1.18, 0.42); g.add(gun);

  a.bodyMesh = torso; a.headMesh = head;
  torso.userData.agent = a; torso.userData.part = 'body';
  head.userData.agent = a; head.userData.part = 'head';
  legs.userData.agent = a; legs.userData.part = 'body';
  a.mesh = g;
  G.scene.add(g);
}

// ---------- spawning ----------
export function spawnAgents(G) {
  const S = G.state;
  // remove the previous round's bot meshes before rebuilding
  for (const old of S.agents) if (old.mesh) G.scene.remove(old.mesh);
  S.agents = [];
  const atkSpawns = G.world.spawns.atk, defSpawns = G.world.spawns.def;
  const yawAtk = 0;         // attackers face north (towards -z, the sites)
  const yawDef = Math.PI;   // defenders face south (towards +z, the attackers)
  const player = createAgent(G, {
    id: 0, name: 'You', team: 'atk', isPlayer: true,
    x: atkSpawns[0][0], z: atkSpawns[0][1], yaw: yawAtk, weapon: 'vk47',
  });
  S.player = player;
  S.agents.push(player);
  let id = 1;
  BOT_NAMES.atk.forEach((n, i) => {
    const s = atkSpawns[i + 1];
    S.agents.push(createAgent(G, {
      id: id++, name: n, team: 'atk', x: s[0], z: s[1], yaw: yawAtk,
      weapon: i % 2 === 0 ? 'vk47' : 'hornet',
    }));
  });
  BOT_NAMES.def.forEach((n, i) => {
    const s = defSpawns[i];
    S.agents.push(createAgent(G, {
      id: id++, name: n, team: 'def', x: s[0], z: s[1], yaw: yawDef,
      weapon: i % 3 === 0 ? 'longbow' : i % 3 === 1 ? 'vk47' : 'm590',
    }));
  });
  // the charge starts with the player
  player.hasCharge = true;
  S.chargeCarrier = player;
  syncMeshes(G);
}

export function syncMeshes(G) {
  for (const a of G.state.agents) {
    if (a.isPlayer || !a.mesh) continue;
    a.mesh.visible = a.alive;
    if (!a.alive) continue;
    a.mesh.position.copy(a.pos);
    a.mesh.rotation.y = a.yaw;
  }
}

// ---------- movement: accel, friction, gravity, AABB collision ----------
export function moveAgent(G, a, input, dt) {
  const cols = G.world.colliders;
  const speed = input.crouch ? WORLD.crouchSpeed : input.quiet ? WORLD.quietSpeed : WORLD.walkSpeed;
  const sin = Math.sin(a.yaw), cos = Math.cos(a.yaw);
  // input.forward: +1 forward; input.strafe: +1 right
  const wx = (-sin * input.forward + cos * input.strafe);
  const wz = (-cos * input.forward - sin * input.strafe);
  const wl = Math.hypot(wx, wz) || 1;
  const moving = Math.abs(input.forward) + Math.abs(input.strafe) > 0.01;
  if (moving) {
    a.vel.x += (wx / wl) * WORLD.accel * dt;
    a.vel.z += (wz / wl) * WORLD.accel * dt;
  }
  // friction + clamp horizontal speed
  const hv = Math.hypot(a.vel.x, a.vel.z);
  const max = moving ? speed : 0;
  if (hv > max) {
    const f = Math.max(max, hv - WORLD.friction * speed * dt) / hv;
    a.vel.x *= f; a.vel.z *= f;
  }
  if (hv < 0.05 && !moving) { a.vel.x = 0; a.vel.z = 0; }

  // vertical: gravity + jump
  if (input.jump && a.onGround) { a.vel.y = WORLD.jumpVel; a.onGround = false; }
  a.vel.y -= WORLD.gravity * dt;

  const r = WORLD.playerRadius;
  const h = a.crouch ? 1.15 : WORLD.playerHeight;
  // X axis
  a.pos.x += a.vel.x * dt;
  resolveAxis(G, a, cols, r, h, 'x');
  // Z axis
  a.pos.z += a.vel.z * dt;
  resolveAxis(G, a, cols, r, h, 'z');
  // Y axis
  const oldY = a.pos.y;
  a.pos.y += a.vel.y * dt;
  a.onGround = false;
  if (a.pos.y <= 0) { a.pos.y = 0; a.vel.y = 0; a.onGround = true; }
  else if (a.vel.y <= 0) {
    for (const b of cols) {
      if (a.pos.x + r > b.x0 && a.pos.x - r < b.x1 && a.pos.z + r > b.z0 && a.pos.z - r < b.z1) {
        if (oldY >= b.y1 - 0.05 && a.pos.y <= b.y1 && a.pos.y > b.y1 - 1.2) {
          a.pos.y = b.y1; a.vel.y = 0; a.onGround = true; break;
        }
      }
    }
  }
  // world bounds
  a.pos.x = Math.max(-31.4, Math.min(31.4, a.pos.x));
  a.pos.z = Math.max(-31.4, Math.min(31.4, a.pos.z));
  return moving;
}

function resolveAxis(G, a, cols, r, h, axis) {
  for (const b of cols) {
    if (a.pos.y + h <= b.y0 + 0.02 || a.pos.y >= b.y1 - 0.02) continue;
    if (a.pos.x + r <= b.x0 || a.pos.x - r >= b.x1 || a.pos.z + r <= b.z0 || a.pos.z - r >= b.z1) continue;
    if (axis === 'x') {
      if (a.vel.x > 0) a.pos.x = b.x0 - r; else if (a.vel.x < 0) a.pos.x = b.x1 + r;
      a.vel.x = 0;
    } else {
      if (a.vel.z > 0) a.pos.z = b.z0 - r; else if (a.vel.z < 0) a.pos.z = b.z1 + r;
      a.vel.z = 0;
    }
  }
}

// ---------- bot brain ----------
export function thinkBot(G, a, dt) {
  const S = G.state, ai = a.ai;
  ai.thinkT -= dt;
  if (ai.thinkT > 0) return;
  ai.thinkT = 0.12;

  // pick a role target when the round (re)starts
  if (ai.state === 'advance' && ai.path.length === 0) choosePlan(G, a);
  if (S.phase !== 'live') { a.fireHeld = false; return; }

  const now = S.time;
  const enemy = nearestVisibleEnemy(G, a);
  if (enemy) {
    if (ai.seenAt < 0) ai.seenAt = now;
    if (now - ai.seenAt > ai.reaction) ai.state = 'engage';
  } else if (ai.state === 'engage') {
    ai.state = ai.path.length ? 'advance' : 'hold';
    ai.seenAt = -9;
  }

  // hearing: a gunshot nearby pulls the bot to look / investigate
  const ev = S.events[S.events.length - 1];
  if (ev && ev.kind === 'shot' && ev.t > now - 0.4) {
    const d = Math.hypot(ev.x - a.pos.x, ev.z - a.pos.z);
    if (d < 26 && (!enemy || d < 12)) {
      ai.investigate = nearestNode(G, ev.x, ev.z);
      if (ai.state === 'hold' || ai.state === 'advance') {
        ai.path = findPath(G, nearestNode(G, a.pos.x, a.pos.z), ai.investigate);
        ai.pathI = 0; ai.state = 'advance';
      }
    }
  }

  // planted charge changes everyone's job
  if (S.plantedAt) {
    if (a.team === 'def' && ai.state !== 'defuse' && ai.state !== 'engage') {
      const site = G.world.sites[S.plantedAt];
      ai.path = findPath(G, nearestNode(G, a.pos.x, a.pos.z), nearestNode(G, site.x, site.z));
      ai.pathI = 0; ai.state = 'advance'; ai.targetNode = -1;
    }
    if (a.team === 'atk' && ai.state === 'advance') { ai.state = 'hold'; ai.holdUntil = now + 6; }
  }

  // carrier plants when he reaches his site
  if (a.hasCharge && a.team === 'atk' && !S.plantedAt) {
    const site = G.world.sites[ai.site || 'A'];
    const d = Math.hypot(site.x - a.pos.x, site.z - a.pos.z);
    if (d < site.radius - 1 && !enemy) ai.state = 'plant';
  }
}

export function stepBot(G, a, dt) {
  const S = G.state, ai = a.ai;
  if (!a.alive) return;
  const input = { forward: 0, strafe: 0, jump: false, crouch: false, quiet: false };
  const now = S.time;

  if (S.phase === 'freeze') { moveAgent(G, a, input, dt); return; }
  if (S.phase !== 'live') { moveAgent(G, a, input, dt); return; }

  // blinded bots stand still and don't shoot
  if (now < a.blindUntil) {
    a.fireHeld = false;
    moveAgent(G, a, input, dt);
    return;
  }

  switch (ai.state) {
    case 'engage': {
      const e = nearestVisibleEnemy(G, a);
      if (!e) { ai.state = 'advance'; a.aiTarget = null; break; }
      a.aiTarget = e;
      // face the enemy, strafe, fire in bursts
      _v1.set(e.pos.x - a.pos.x, 0, e.pos.z - a.pos.z);
      a.yaw = Math.atan2(-_v1.x, -_v1.z);
      ai.strafeT -= dt;
      if (ai.strafeT <= 0) { ai.strafeDir *= -1; ai.strafeT = 0.5 + Math.random() * 0.9; }
      input.strafe = ai.strafeDir * 0.6;
      input.forward = Math.random() < 0.1 ? -0.4 : 0;
      ai.burstCool -= dt;
      if (ai.burstLeft <= 0 && ai.burstCool <= 0) { ai.burstLeft = 3 + (Math.random() * 3 | 0); ai.burstCool = 0.5 + Math.random() * 0.7; }
      a.fireHeld = ai.burstLeft > 0;
      if (a.fireHeld) ai.burstLeft -= dt * 8;
      break;
    }
    case 'plant': {
      a.fireHeld = false;
      const site = G.world.sites[ai.site || 'A'];
      a.yaw += dt * 0.8; // scanning while planting
      G.plantTick(a, site, dt);
      break;
    }
    case 'hold': {
      a.fireHeld = false;
      ai.holdYaw += dt * 0.45;
      a.yaw = ai.holdYaw;
      if (ai.holdUntil && now > ai.holdUntil) { ai.holdUntil = 0; choosePlan(G, a); }
      // defenders on a planted site defuse
      if (S.plantedAt && a.team === 'def') {
        const site = G.world.sites[S.plantedAt];
        if (Math.hypot(site.x - a.pos.x, site.z - a.pos.z) < site.radius - 0.5) {
          G.defuseTick(a, site, dt);
        }
      }
      break;
    }
    case 'advance':
    default: {
      a.fireHeld = false;
      if (ai.pathI < ai.path.length) {
        const n = G.world.waypoints[ai.path[ai.pathI]];
        _v1.set(n.x - a.pos.x, 0, n.z - a.pos.z);
        const d = Math.hypot(_v1.x, _v1.z);
        if (d < 1.2) { ai.pathI++; }
        else {
          a.yaw = Math.atan2(-_v1.x, -_v1.z);
          input.forward = 1;
          // crouch-walk the last stretch into a site, quietly
          if (a.team === 'atk' && ai.pathI >= ai.path.length - 2) input.quiet = true;
        }
      } else {
        ai.state = 'hold';
        ai.holdUntil = now + 3 + Math.random() * 5;
        ai.holdYaw = a.yaw;
      }
      // defenders arriving at the planted site switch to defuse
      if (S.plantedAt && a.team === 'def') {
        const site = G.world.sites[S.plantedAt];
        if (Math.hypot(site.x - a.pos.x, site.z - a.pos.z) < site.radius - 0.5) ai.state = 'hold';
      }
      break;
    }
  }
  const moving = moveAgent(G, a, input, dt);
  if (moving) {
    a.stepT -= dt;
    if (a.stepT <= 0) { a.stepT = 0.42; G.sfx.step(false); }
  }
  // decay bloom / recoil
  a.spreadBloom = Math.max(0, a.spreadBloom - dt * 1.8);
  a.recoil = Math.max(0, a.recoil - dt * 2.4);
}

function choosePlan(G, a) {
  const S = G.state, ai = a.ai;
  const from = nearestNode(G, a.pos.x, a.pos.z);
  if (a.team === 'atk') {
    ai.site = Math.random() < 0.55 ? 'A' : 'B';
    const site = G.world.sites[ai.site];
    const dest = nearestNode(G, site.x, site.z);
    ai.path = findPath(G, from, dest);
    ai.pathI = 0; ai.state = 'advance';
  } else {
    // defenders split: two hold sites, the rest hold mid / rotate
    const roll = Math.random();
    let dest;
    if (roll < 0.4) dest = nearestNode(G, G.world.sites.A.x, G.world.sites.A.z);
    else if (roll < 0.75) dest = nearestNode(G, G.world.sites.B.x, G.world.sites.B.z);
    else dest = 28; // centre booth
    ai.path = findPath(G, from, dest);
    ai.pathI = 0; ai.state = 'advance';
  }
}

export function nearestNode(G, x, z) {
  let best = 0, bd = Infinity;
  G.world.waypoints.forEach((n, i) => {
    const d = (n.x - x) ** 2 + (n.z - z) ** 2;
    if (d < bd) { bd = d; best = i; }
  });
  return best;
}

// BFS over the waypoint graph — short, deterministic, no allocation per call
// beyond the small queue arrays.
export function findPath(G, from, to) {
  if (from === to) return [to];
  const prev = new Int16Array(G.world.waypoints.length).fill(-1);
  const q = [from];
  prev[from] = from;
  while (q.length) {
    const n = q.shift();
    if (n === to) break;
    for (const m of G.world.edges[n]) {
      if (prev[m] === -1) { prev[m] = n; q.push(m); }
    }
  }
  if (prev[to] === -1) return [to];
  const path = [];
  let c = to;
  while (c !== from) { path.push(c); c = prev[c]; }
  path.reverse();
  return path;
}

// Visible enemy: alive, opposing team, within 48 m, line of sight, and not
// hidden inside a smoke cloud (either end inside smoke blocks the shot).
export function nearestVisibleEnemy(G, a) {
  const S = G.state;
  let best = null, bd = 48 * 48;
  for (const e of S.agents) {
    if (!e.alive || e.team === a.team || e === a) continue;
    const dx = e.pos.x - a.pos.x, dz = e.pos.z - a.pos.z;
    const d2 = dx * dx + dz * dz;
    if (d2 > bd) continue;
    const eyeY = a.pos.y + (a.crouch ? WORLD.crouchEye : WORLD.eyeHeight);
    const tgtY = e.pos.y + 1.3;
    if (!hasLineOfSight(a.pos.x, eyeY, a.pos.z, e.pos.x, tgtY, e.pos.z, G.world.colliders)) continue;
    if (inSmoke(G, a.pos.x, a.pos.z) || inSmoke(G, e.pos.x, e.pos.z)) continue;
    best = e; bd = d2;
  }
  return best;
}

export function inSmoke(G, x, z) {
  for (const s of G.state.smokes) {
    if (G.state.time < s.until && Math.hypot(s.x - x, s.z - z) < 5.5) return true;
  }
  return false;
}
