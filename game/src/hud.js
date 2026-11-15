// hud.js — every DOM overlay: health/ammo/timer/score, killfeed, crosshair,
// minimap, buy menu, banners and the plant/defuse progress bar. The HUD
// reads the state store each frame; it never owns game logic.

import { WEAPONS, GRENADES, ARMOR_PRICE } from './state.js';
import { BUY_LIST } from './weapons.js';

export class Hud {
  constructor() {
    this.el = (id) => document.getElementById(id);
    this.mm = this.el('minimap').getContext('2d');
    this.flashT = 0;
    this.buyOpen = false;
  }

  show() { this.el('hud').classList.add('on'); }
  hide() { this.el('hud').classList.remove('on'); }

  update(G, dt) {
    const S = G.state, p = S.player;
    if (!p) return;
    // timer
    const t = Math.max(0, Math.ceil(S.timer));
    const timerEl = this.el('timer');
    timerEl.textContent = `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
    timerEl.classList.toggle('low', S.timer <= 10 && S.phase === 'live');
    this.el('score').textContent = `${S.score.atk} : ${S.score.def}`;
    this.el('roundlbl').textContent = `R${S.round}/13${S.plantedAt ? ' · PLANTED' : ''}`;
    // health / armor
    this.el('hp').textContent = Math.max(0, Math.ceil(p.hp));
    this.el('hpfill').style.width = `${Math.max(0, p.hp)}%`;
    this.el('arfill').style.width = `${Math.max(0, p.armor)}%`;
    // weapon / ammo / money
    const w = WEAPONS[p.weapon];
    this.el('wname').textContent = w.name + (p.reloading ? ' — RELOADING…' : '');
    this.el('ammo').innerHTML = `${p.mag} <span class="res">/ ${p.reserve}</span>`;
    this.el('money').textContent = `$${p.money}`;
    // alive counts
    let atk = 0, def = 0;
    for (const a of S.agents) if (a.alive) (a.team === 'atk' ? atk++ : def++);
    this.el('aliveAtk').textContent = atk;
    this.el('aliveDef').textContent = def;
    // crosshair gap grows with spread + movement
    const spread = w.spread + p.spreadBloom * 0.02 + (Math.hypot(p.vel.x, p.vel.z) > 1.2 ? w.moveSpread : 0);
    const gap = 4 + spread * 900;
    const len = 9;
    const set = (id, x, y, ww, hh) => {
      const e = this.el(id);
      e.style.left = `${x}px`; e.style.top = `${y}px`;
      e.style.width = `${ww}px`; e.style.height = `${hh}px`;
    };
    set('cxT', -1, -gap - len, 2, len); set('cxB', -1, gap, 2, len);
    set('cxL', -gap - len, -1, len, 2); set('cxR', gap, -1, len, 2);
    // killfeed (last 5, fade old)
    const kf = this.el('killfeed');
    const now = S.time;
    kf.innerHTML = S.killfeed.slice(-5).map((k) => {
      const age = now - k.t;
      const op = age > 4 ? 0.35 : 1;
      return `<div style="opacity:${op}">${k.text}</div>`;
    }).join('');
    // plant / defuse bar
    const pb = this.el('plantbar');
    if (S.plantProgress) {
      pb.style.display = 'block';
      this.el('plantcap').textContent = S.plantProgress.kind === 'plant' ? 'PLANTING CHARGE…' : 'DEFUSING CHARGE…';
      this.el('plantfill').style.width = `${Math.min(100, S.plantProgress.t * 100)}%`;
    } else pb.style.display = 'none';
    // flash overlay decay
    if (this.flashT > 0) {
      this.flashT -= dt;
      this.el('flash').style.opacity = String(Math.max(0, this.flashT / 2.2));
    }
    this.drawMinimap(G);
  }

  drawMinimap(G) {
    const c = this.mm, S = G.state;
    const W = 172, H = 172;
    const toX = (x) => ((x + 32) / 64) * W;
    const toY = (z) => ((z + 32) / 64) * H;
    c.clearRect(0, 0, W, H);
    c.fillStyle = 'rgba(20,26,36,0.9)';
    c.fillRect(0, 0, W, H);
    // colliders as walls
    c.fillStyle = 'rgba(140,150,165,0.75)';
    for (const b of G.world.colliders) {
      if (b.y1 > 3) continue; // tall crane legs etc. clutter the map; skip
      c.fillRect(toX(b.x0), toY(b.z0), Math.max(2, toX(b.x1) - toX(b.x0)), Math.max(2, toY(b.z1) - toY(b.z0)));
    }
    // sites
    for (const id of ['A', 'B']) {
      const s = G.world.sites[id];
      c.fillStyle = id === 'A' ? '#ffb454' : '#57e6c9';
      c.beginPath(); c.arc(toX(s.x), toY(s.z), 7, 0, Math.PI * 2); c.fill();
      c.fillStyle = '#0b0e13'; c.font = 'bold 9px sans-serif';
      c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillText(id, toX(s.x), toY(s.z));
    }
    // agents
    for (const a of S.agents) {
      if (!a.alive) continue;
      c.fillStyle = a.isPlayer ? '#ffffff' : a.team === 'atk' ? '#ffb454' : '#57e6c9';
      c.beginPath(); c.arc(toX(a.pos.x), toY(a.pos.z), a.isPlayer ? 4 : 3, 0, Math.PI * 2); c.fill();
      if (a.isPlayer) {
        c.strokeStyle = '#fff'; c.beginPath();
        c.moveTo(toX(a.pos.x), toY(a.pos.z));
        c.lineTo(toX(a.pos.x) - Math.sin(a.yaw) * 9, toY(a.pos.z) - Math.cos(a.yaw) * 9);
        c.stroke();
      }
    }
    // planted charge marker
    if (S.plantedAt) {
      const s = G.world.sites[S.plantedAt];
      c.strokeStyle = '#ff5a4e'; c.lineWidth = 2;
      c.beginPath(); c.arc(toX(s.x), toY(s.z), 11, 0, Math.PI * 2); c.stroke();
    }
  }

  banner(big, sub, color = '#e8ecf1') {
    const b = this.el('banner');
    this.el('bannerBig').textContent = big;
    this.el('bannerBig').style.color = color;
    this.el('bannerSub').textContent = sub;
    b.style.display = 'block';
    clearTimeout(this._bT);
    this._bT = setTimeout(() => { b.style.display = 'none'; }, 3600);
  }

  hint(text) { this.el('hint').textContent = text || ''; }

  flashScreen(dur) { this.flashT = Math.max(this.flashT, dur); }

  damageFlash() {
    const d = this.el('dmg');
    d.style.opacity = '1';
    setTimeout(() => { d.style.opacity = '0'; }, 130);
  }

  // ---- buy menu ----
  buildBuyMenu(G) {
    const grid = this.el('buygrid');
    grid.innerHTML = BUY_LIST.map((e) => {
      let nm, ds, pr;
      if (e.kind === 'weapon') {
        const w = WEAPONS[e.id]; nm = w.name; pr = `$${w.price}`;
        ds = `${w.mag} rounds · dmg ${w.damage}${w.pellets ? ` ×${w.pellets}` : ''} · ${w.auto ? 'auto' : 'semi'}`;
      } else if (e.kind === 'grenade') {
        const g = GRENADES[e.id]; nm = g.name; pr = `$${g.price}`; ds = g.desc;
      } else {
        nm = 'KEVLAR ARMOR'; pr = `$${ARMOR_PRICE}`; ds = 'Absorbs half of incoming damage';
      }
      return `<div class="item" data-key="${e.key}"><span class="key">[${e.key}]</span><span class="pr">${pr}</span><div class="nm">${nm}</div><div class="ds">${ds}</div></div>`;
    }).join('');
    grid.querySelectorAll('.item').forEach((el) => {
      el.addEventListener('click', () => {
        const e = BUY_LIST.find((x) => x.key === el.dataset.key);
        G.buy(e);
      });
    });
    this.el('buyfoot').textContent = 'Tip: same weapon again tops up reserve ammo for $400. Grenades stack to 2.';
  }

  setBuyOpen(G, open) {
    this.buyOpen = open;
    this.el('buy').style.display = open ? 'block' : 'none';
    if (open) this.buildBuyMenu(G);
  }
}
