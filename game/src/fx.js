// fx.js — transient visuals: tracers, muzzle flashes, impact sparks,
// explosions, smoke clouds and flash pops. Everything is pooled: no mesh
// is created per shot, tracers are reused from a fixed ring buffer.

import * as THREE from 'three';

const TRACER_POOL = 24;

export class Fx {
  constructor(scene) {
    this.scene = scene;
    this.tracers = [];
    for (let i = 0; i < TRACER_POOL; i++) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
      const line = new THREE.Line(
        geo,
        new THREE.LineBasicMaterial({ color: 0xffb454, transparent: true, opacity: 0 }),
      );
      line.frustumCulled = false;
      scene.add(line);
      this.tracers.push({ line, until: 0 });
    }
    this.tracerI = 0;
    this.sparks = [];
    this.smokeMeshes = [];
    this._tmp = new THREE.Vector3();
  }

  // Short bright line from muzzle along the shot direction.
  tracer(origin, dir, color, range) {
    const t = this.tracers[this.tracerI];
    this.tracerI = (this.tracerI + 1) % TRACER_POOL;
    const pos = t.line.geometry.attributes.position.array;
    const len = Math.min(range, 42);
    this._tmp.copy(dir).multiplyScalar(len).add(origin);
    pos[0] = origin.x; pos[1] = origin.y; pos[2] = origin.z;
    pos[3] = this._tmp.x; pos[4] = this._tmp.y; pos[5] = this._tmp.z;
    t.line.geometry.attributes.position.needsUpdate = true;
    t.line.material.color.setHex(color);
    t.line.material.opacity = 0.9;
    t.until = performance.now() / 1000 + 0.09;
  }

  muzzle(origin, dir) {
    // small flash at the gun's muzzle: forward of the eye, down-right where
    // the viewmodel sits — never a blob in the middle of the screen.
    const up = new THREE.Vector3(0, 1, 0);
    const right = new THREE.Vector3().crossVectors(dir, up).normalize();
    const m = new THREE.Mesh(
      new THREE.SphereGeometry(0.045, 6, 6),
      new THREE.MeshBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 0.9 }),
    );
    this._tmp.copy(origin).addScaledVector(dir, 1.0).addScaledVector(right, 0.2);
    this._tmp.y -= 0.14;
    m.position.copy(this._tmp);
    this.scene.add(m);
    setTimeout(() => this.scene.remove(m), 45);
  }

  impact(point) {
    const s = new THREE.Mesh(
      new THREE.SphereGeometry(0.05, 6, 6),
      new THREE.MeshBasicMaterial({ color: 0xffe9a8 }),
    );
    s.position.copy(point);
    this.scene.add(s);
    this.sparks.push({ mesh: s, until: performance.now() / 1000 + 0.14 });
    setTimeout(() => { this.scene.remove(s); }, 160);
  }

  hitmarker(head) {
    const el = document.getElementById('hitmark');
    if (!el) return;
    el.classList.toggle('kill', !!head);
    el.style.display = 'block';
    clearTimeout(this._hmT);
    this._hmT = setTimeout(() => { el.style.display = 'none'; }, 130);
  }

  grenadeMesh(g) {
    const m = new THREE.Mesh(
      new THREE.SphereGeometry(0.11, 8, 8),
      new THREE.MeshStandardMaterial({ color: g.kind === 'frag' ? 0x3a4a2a : 0x888888, roughness: 0.5, metalness: 0.6 }),
    );
    m.position.copy(g.pos);
    m.castShadow = true;
    this.scene.add(m);
    g.mesh = m;
  }

  explosion(pos) {
    const flash = new THREE.PointLight(0xff8833, 900, 26, 1.6);
    flash.position.set(pos.x, pos.y + 0.6, pos.z);
    this.scene.add(flash);
    const ball = new THREE.Mesh(
      new THREE.SphereGeometry(1, 16, 12),
      new THREE.MeshBasicMaterial({ color: 0xffa040, transparent: true, opacity: 0.9 }),
    );
    ball.position.copy(pos); ball.position.y += 0.4;
    this.scene.add(ball);
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(1, 0.18, 8, 32),
      new THREE.MeshBasicMaterial({ color: 0xffcc66, transparent: true, opacity: 0.8 }),
    );
    ring.rotation.x = Math.PI / 2;
    ring.position.copy(pos); ring.position.y += 0.3;
    this.scene.add(ring);
    const t0 = performance.now();
    const tick = () => {
      const k = (performance.now() - t0) / 700;
      if (k >= 1) { this.scene.remove(flash); this.scene.remove(ball); this.scene.remove(ring); return; }
      ball.scale.setScalar(1 + k * 6);
      ball.material.opacity = 0.9 * (1 - k);
      ring.scale.setScalar(1 + k * 7);
      ring.material.opacity = 0.8 * (1 - k);
      flash.intensity = 900 * (1 - k);
      requestAnimationFrame(tick);
    };
    tick();
  }

  smokeCloud(pos) {
    const mat = new THREE.MeshBasicMaterial({ color: 0x9aa0a8, transparent: true, opacity: 0.5, depthWrite: false });
    const grp = new THREE.Group();
    for (let i = 0; i < 9; i++) {
      const s = new THREE.Mesh(new THREE.SphereGeometry(1.6 + Math.random() * 1.4, 10, 8), mat);
      s.position.set((Math.random() - 0.5) * 6, 0.8 + Math.random() * 2.2, (Math.random() - 0.5) * 6);
      grp.add(s);
    }
    grp.position.copy(pos);
    this.scene.add(grp);
    this.smokeMeshes.push({ grp, mat, until: performance.now() / 1000 + 12 });
  }

  flashPop(pos) {
    const li = new THREE.PointLight(0xffffff, 600, 20, 1.5);
    li.position.copy(pos);
    this.scene.add(li);
    setTimeout(() => this.scene.remove(li), 220);
  }

  update() {
    const now = performance.now() / 1000;
    for (const t of this.tracers) {
      if (t.until && now > t.until) { t.line.material.opacity = 0; t.until = 0; }
    }
    for (let i = this.smokeMeshes.length - 1; i >= 0; i--) {
      const s = this.smokeMeshes[i];
      if (now > s.until) {
        this.scene.remove(s.grp);
        s.mat.dispose();
        this.smokeMeshes.splice(i, 1);
      } else {
        s.grp.rotation.y += 0.0015;
      }
    }
  }
}
