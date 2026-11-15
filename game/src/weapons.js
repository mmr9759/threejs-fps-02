// weapons.js — everything that shoots, explodes or costs money.
// Firing is a raycast from the shooter's eye against body/head hitboxes;
// damage falls with range, heads pay more, and spread + recoil punish
// firing on the move — stopping to aim is the winning play.

import * as THREE from 'three';
import { WEAPONS, GRENADES, ARMOR_PRICE, MATCH, WORLD } from './state.js';

const _origin = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _ray = new THREE.Raycaster();
_ray.far = 200;

export function giveWeapon(a, id) {
  const w = WEAPONS[id];
  a.weapon = id; a.mag = w.mag; a.reserve = w.reserve;
  a.reloading = false; a.reloadT = 0;
  if (!a.owned.includes(id)) a.owned.push(id);
}

// Switch to a weapon the agent already owns (buy menu adds to owned).
export function selectWeapon(a, id) {
  if (!a.owned.includes(id) || a.weapon === id) return false;
  giveWeapon(a, id);
  return true;
}

// Distance from origin along dir to the nearest solid box, or Infinity.
// Used so bullets and tracers stop at walls instead of passing through them.
export function wallDist(origin, dir, colliders) {
  let best = Infinity;
  for (const b of colliders) {
    let t0 = 0, t1 = Infinity;
    const o = [origin.x, origin.y, origin.z];
    const d = [dir.x, dir.y, dir.z];
    const mn = [b.x0, b.y0, b.z0], mx = [b.x1, b.y1, b.z1];
    let ok = true;
    for (let i = 0; i < 3; i++) {
      if (Math.abs(d[i]) < 1e-9) { if (o[i] < mn[i] || o[i] > mx[i]) { ok = false; break; } }
      else {
        let ta = (mn[i] - o[i]) / d[i], tb = (mx[i] - o[i]) / d[i];
        if (ta > tb) { const tmp = ta; ta = tb; tb = tmp; }
        if (ta > t0) t0 = ta;
        if (tb < t1) t1 = tb;
        if (t0 > t1) { ok = false; break; }
      }
    }
    if (ok && t1 > 0 && t0 < best) best = t0;
  }
  return best;
}

export function currentWeapon(a) { return WEAPONS[a.weapon]; }

// One trigger pull (or one auto-fire tick). Returns true if a shot left the gun.
export function tryFire(G, a, now) {
  const w = currentWeapon(a);
  if (!a.alive || a.reloading) return false;
  if (now - a.lastShot < w.rofMs / 1000) return false;
  if (a.mag <= 0) { G.sfx.dry(); a.lastShot = now; return false; }
  a.lastShot = now;
  a.mag--;

  const moving = Math.hypot(a.vel.x, a.vel.z) > 1.2;
  const airborne = !a.onGround;
  let spread = w.spread + a.spreadBloom * 0.02;
  if (moving) spread += w.moveSpread;
  if (airborne) spread += 0.03;
  if (a.crouch) spread *= 0.6;

  // eye position + aim direction (bots aim at their target with error)
  const eyeY = a.pos.y + (a.crouch ? WORLD.crouchEye : WORLD.eyeHeight);
  _origin.set(a.pos.x, eyeY, a.pos.z);
  if (a.isPlayer) {
    _dir.set(-Math.sin(a.yaw) * Math.cos(a.pitch), Math.sin(a.pitch), -Math.cos(a.yaw) * Math.cos(a.pitch));
    _dir.x += (Math.random() - 0.5) * 2 * spread + a.recoil * 0.35;
    _dir.y += (Math.random() - 0.5) * 2 * spread + a.recoil * 0.6;
    _dir.z += (Math.random() - 0.5) * 2 * spread;
    _dir.normalize();
  } else {
    const tgt = a.aiTarget && a.aiTarget.alive ? a.aiTarget : null;
    if (tgt) {
      _dir.set(tgt.pos.x - a.pos.x, (tgt.pos.y + 1.25) - eyeY, tgt.pos.z - a.pos.z).normalize();
      const dist = Math.hypot(tgt.pos.x - a.pos.x, tgt.pos.z - a.pos.z);
      const err = 0.012 + dist * 0.00045 + (moving ? 0.02 : 0) + a.spreadBloom * 0.01;
      _dir.x += (Math.random() - 0.5) * 2 * err;
      _dir.y += (Math.random() - 0.5) * 2 * err;
      _dir.z += (Math.random() - 0.5) * 2 * err;
      _dir.normalize();
    } else {
      _dir.set(-Math.sin(a.yaw), 0, -Math.cos(a.yaw));
    }
  }

  const pellets = w.pellets || 1;
  let anyHit = false;
  const targetIsPlayer = !a.isPlayer && a.aiTarget && a.aiTarget.isPlayer;
  // walls stop bullets: cap the tracer at the first solid box
  const wall = wallDist(_origin, _dir, G.world.colliders);
  for (let p = 0; p < pellets; p++) {
    if (pellets > 1) {
      _dir.x += (Math.random() - 0.5) * 2 * w.spread;
      _dir.y += (Math.random() - 0.5) * 2 * w.spread;
      _dir.normalize();
    }
    // bots roll against the player (who has no hitbox meshes); everyone
    // else is hit by raycast against body / head boxes.
    if (targetIsPlayer) { if (p === 0) botShotAtPlayer(G, a, now); continue; }
    const hit = fireRay(G, a, _origin, _dir, w);
    if (hit) anyHit = true;
  }

  // recoil + bloom punish holding the trigger; the kick is a temporary
  // camera offset (main.js decays it), never a permanent pitch change.
  a.spreadBloom = Math.min(1, a.spreadBloom + (w.auto ? 0.09 : 0.16));
  a.recoil = Math.min(0.09, a.recoil + w.recoil);
  if (a.isPlayer) a.recoilKick = Math.min(0.1, (a.recoilKick || 0) + w.recoil * 0.55);

  // tracer + muzzle + sound, scaled by distance to the player
  const pd = Math.hypot(a.pos.x - G.state.player.pos.x, a.pos.z - G.state.player.pos.z);
  G.fx.muzzle(_origin, _dir);
  G.fx.tracer(_origin, _dir, w.tracer, Math.min(w.range, wall));
  G.sfx.shot(w.id, pd > 12);
  G.state.events.push({ kind: 'shot', x: a.pos.x, z: a.pos.z, t: now });
  if (G.state.events.length > 40) G.state.events.shift();
  return anyHit;
}

function fireRay(G, shooter, origin, dir, w) {
  _ray.set(origin, dir);
  const targets = [];
  for (const e of G.state.agents) {
    if (!e.alive || e === shooter || e.isPlayer) continue;
    if (e.headMesh) targets.push(e.headMesh);
    if (e.bodyMesh) targets.push(e.bodyMesh);
  }
  // the player can be shot by bots: test the camera as a small target
  const hits = _ray.intersectObjects(targets, false);
  if (!hits.length) return false;
  const h = hits[0];
  const victim = h.object.userData.agent;
  const dist = h.distance;
  if (dist > w.range) return false;
  // a wall between muzzle and target blocks the shot
  if (wallDist(origin, dir, G.world.colliders) < dist - 0.05) return false;
  const isHead = h.object.userData.part === 'head';
  const falloff = Math.max(0.45, 1 - (dist / w.range) * 0.5);
  const dmg = Math.round(w.damage * (isHead ? w.headMult : 1) * falloff);
  G.damageAgent(victim, dmg, shooter, isHead);
  if (shooter.isPlayer) {
    G.fx.hitmarker(isHead);
    if (isHead) G.sfx.headshot(); else G.sfx.hit();
    G.state.stats.damage += dmg;
    if (isHead) G.state.stats.headshots++;
  }
  G.fx.impact(h.point);
  return true;
}

// Bots shoot the player by direct damage roll (the player has no hitbox
// meshes); the ray is still traced for the tracer visual.
export function botShotAtPlayer(G, bot, now) {
  // called from tryFire when the bot's target is the player
  const p = G.state.player;
  if (!p.alive) return;
  const dist = Math.hypot(p.pos.x - bot.pos.x, p.pos.z - bot.pos.z);
  const w = currentWeapon(bot);
  const hitP = Math.max(0.12, 0.62 - dist * 0.007 - (Math.hypot(p.vel.x, p.vel.z) > 3 ? 0.18 : 0));
  if (Math.random() < hitP) {
    const head = Math.random() < 0.12;
    const dmg = Math.round(w.damage * (head ? 1.6 : 1) * Math.max(0.5, 1 - dist / (w.range * 1.4)));
    G.damageAgent(p, dmg, bot, head);
    G.fx.impact(new THREE.Vector3(p.pos.x, p.pos.y + 1.3, p.pos.z));
  }
}

export function startReload(G, a) {
  const w = currentWeapon(a);
  if (a.reloading || a.mag >= w.mag || a.reserve <= 0) return;
  a.reloading = true;
  a.reloadT = w.reloadMs / 1000;
  if (a.isPlayer) G.sfx.reload();
}

export function updateReload(G, a, dt) {
  if (!a.reloading) return;
  a.reloadT -= dt;
  if (a.reloadT <= 0) {
    const w = currentWeapon(a);
    const need = w.mag - a.mag;
    const take = Math.min(need, a.reserve);
    a.mag += take; a.reserve -= take;
    a.reloading = false;
  }
}

// ---------- grenades ----------
export function throwGrenade(G, a, kind) {
  if (!a.alive || a.grenades[kind] <= 0) { if (a.isPlayer) G.sfx.denied(); return false; }
  a.grenades[kind]--;
  const eyeY = a.pos.y + (a.crouch ? WORLD.crouchEye : WORLD.eyeHeight);
  const g = {
    kind, owner: a,
    pos: new THREE.Vector3(a.pos.x, eyeY - 0.1, a.pos.z),
    vel: new THREE.Vector3(
      -Math.sin(a.yaw) * 11 + a.vel.x * 0.4,
      3.2 + a.pitch * 6,
      -Math.cos(a.yaw) * 11 + a.vel.z * 0.4,
    ),
    t: kind === 'flash' ? 1.3 : kind === 'smoke' ? 1.6 : 2.0,
    bounced: false,
  };
  G.state.grenades.push(g);
  G.fx.grenadeMesh(g);
  return true;
}

export function updateGrenades(G, dt) {
  const S = G.state;
  for (let i = S.grenades.length - 1; i >= 0; i--) {
    const g = S.grenades[i];
    g.t -= dt;
    g.vel.y -= 12 * dt;
    g.pos.addScaledVector(g.vel, dt);
    if (g.pos.y < 0.12) {
      g.pos.y = 0.12;
      if (Math.abs(g.vel.y) > 2) G.sfx.bounce();
      g.vel.y *= -0.35; g.vel.x *= 0.7; g.vel.z *= 0.7;
    }
    if (g.mesh) { g.mesh.position.copy(g.pos); g.mesh.rotation.x += dt * 6; }
    if (g.t <= 0) {
      detonate(G, g);
      if (g.mesh) { G.scene.remove(g.mesh); }
      S.grenades.splice(i, 1);
    }
  }
}

function detonate(G, g) {
  const S = G.state;
  if (g.kind === 'frag') {
    G.fx.explosion(g.pos);
    G.sfx.explosion();
    for (const e of S.agents) {
      if (!e.alive) continue;
      const d = Math.hypot(e.pos.x - g.pos.x, e.pos.z - g.pos.z);
      if (d < 7) {
        const dmg = Math.round(105 * (1 - d / 7) + 15);
        G.damageAgent(e, dmg, g.owner, false);
      }
    }
  } else if (g.kind === 'smoke') {
    S.smokes.push({ x: g.pos.x, z: g.pos.z, until: S.time + 12 });
    G.fx.smokeCloud(g.pos);
  } else if (g.kind === 'flash') {
    G.fx.flashPop(g.pos);
    for (const e of S.agents) {
      if (!e.alive) continue;
      const d = Math.hypot(e.pos.x - g.pos.x, (e.pos.y + 1.5) - g.pos.y, e.pos.z - g.pos.z);
      if (d > 28) continue;
      // facing the pop + line of sight = blinded
      _dir.set(g.pos.x - e.pos.x, 0, g.pos.z - e.pos.z).normalize();
      const facing = -Math.sin(e.yaw) * _dir.x + -Math.cos(e.yaw) * _dir.z;
      if (facing > -0.2) {
        const dur = Math.max(0.6, 3.2 * (1 - d / 28) * (facing > 0.5 ? 1 : 0.45));
        e.blindUntil = S.time + dur; e.blindAmt = 1;
        if (e.isPlayer) { G.hud.flashScreen(dur); G.sfx.flashRing(); }
      }
    }
  }
}

// ---------- economy / buy menu ----------
export const BUY_LIST = [
  { key: '1', kind: 'weapon', id: 'vk47' },
  { key: '2', kind: 'weapon', id: 'hornet' },
  { key: '3', kind: 'weapon', id: 'longbow' },
  { key: '4', kind: 'weapon', id: 'm590' },
  { key: '5', kind: 'grenade', id: 'frag' },
  { key: '6', kind: 'grenade', id: 'smoke' },
  { key: '7', kind: 'grenade', id: 'flash' },
  { key: '8', kind: 'armor', id: 'armor' },
];

export function buyItem(G, a, entry) {
  if (entry.kind === 'weapon') {
    const w = WEAPONS[entry.id];
    if (a.money < w.price) { G.sfx.denied(); return false; }
    if (a.weapon === entry.id) { // top up reserve ammo instead
      if (a.money < 400) { G.sfx.denied(); return false; }
      a.money -= 400; a.reserve += w.mag * 2; G.sfx.buy(); return true;
    }
    a.money -= w.price;
    giveWeapon(a, entry.id);
    G.sfx.buy();
    return true;
  }
  if (entry.kind === 'grenade') {
    const g = GRENADES[entry.id];
    if (a.money < g.price || a.grenades[entry.id] >= 2) { G.sfx.denied(); return false; }
    a.money -= g.price; a.grenades[entry.id]++;
    G.sfx.buy();
    return true;
  }
  if (entry.kind === 'armor') {
    if (a.money < ARMOR_PRICE || a.armor >= 100) { G.sfx.denied(); return false; }
    a.money -= ARMOR_PRICE; a.armor = 100;
    G.sfx.buy();
    return true;
  }
  return false;
}

export function awardRoundMoney(G, winnerTeam) {
  for (const a of G.state.agents) {
    if (a.team === winnerTeam) {
      a.money += MATCH.winBonus;
      G.state.lossStreak[a.team] = 0;
    } else {
      const streak = ++G.state.lossStreak[a.team];
      a.money += Math.min(MATCH.lossBonusCap, MATCH.lossBonus + MATCH.lossStreakBonus * (streak - 1));
    }
    a.money = Math.min(a.money, 16000);
  }
}
