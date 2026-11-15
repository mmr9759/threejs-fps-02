// world.js — the Ember Quay map: a dusk container terminal with two lanes,
// a mid yard, and two plant sites. Own art: every texture is drawn on a
// canvas at runtime, every mesh is built from boxes and cylinders here.
// Exports colliders (plain AABBs for the sim), sites, spawns and a waypoint
// graph the bots walk. No network, no loaded assets.

import * as THREE from 'three';

// ---------- procedural textures (canvas-drawn, no files) ----------
function canvasTex(w, h, draw, repeat = 1) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.anisotropy = 4;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function speckle(g, w, h, n, alpha, light) {
  for (let i = 0; i < n; i++) {
    const v = Math.random();
    g.fillStyle = light ? `rgba(255,255,255,${alpha * v})` : `rgba(0,0,0,${alpha * v})`;
    g.fillRect(Math.random() * w, Math.random() * h, 1 + Math.random() * 2, 1 + Math.random() * 2);
  }
}

function asphaltTex() {
  return canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = '#2e3238'; g.fillRect(0, 0, w, h);
    speckle(g, w, h, 2600, 0.16, false); speckle(g, w, h, 900, 0.10, true);
    g.strokeStyle = 'rgba(0,0,0,0.35)'; g.lineWidth = 2;
    for (let i = 0; i < 7; i++) {
      g.beginPath(); g.moveTo(Math.random() * w, 0); g.lineTo(Math.random() * w, h); g.stroke();
    }
    g.fillStyle = 'rgba(255,180,84,0.55)';
    g.fillRect(0, 124, w, 5); g.fillRect(0, 132, w, 2);
  }, 10);
}

function concreteTex() {
  return canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = '#5a5e64'; g.fillRect(0, 0, w, h);
    speckle(g, w, h, 2200, 0.14, false); speckle(g, w, h, 700, 0.08, true);
    g.fillStyle = 'rgba(0,0,0,0.18)';
    for (let i = 0; i < 5; i++) g.fillRect(0, Math.random() * h, w, 2 + Math.random() * 4);
  }, 4);
}

function containerTex(base, stripe) {
  return canvasTex(256, 128, (g, w, h) => {
    g.fillStyle = base; g.fillRect(0, 0, w, h);
    for (let x = 0; x < w; x += 16) {
      g.fillStyle = 'rgba(0,0,0,0.22)'; g.fillRect(x, 0, 5, h);
      g.fillStyle = 'rgba(255,255,255,0.07)'; g.fillRect(x + 5, 0, 3, h);
    }
    g.fillStyle = stripe; g.fillRect(0, 8, w, 14);
    g.fillStyle = 'rgba(0,0,0,0.5)'; g.font = 'bold 20px monospace';
    g.fillText('EMBER', 14, 52); g.font = '12px monospace'; g.fillText('QUAY · 07', 14, 72);
    speckle(g, w, h, 500, 0.2, false);
  });
}

function hazardTex() {
  return canvasTex(128, 128, (g, w, h) => {
    g.fillStyle = '#c9a227'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#151515';
    for (let i = -h; i < w; i += 32) {
      g.beginPath(); g.moveTo(i, h); g.lineTo(i + 16, 0); g.lineTo(i + 32, 0); g.lineTo(i + 16, h); g.fill();
    }
  });
}

function siteTex(letter, color) {
  return canvasTex(256, 256, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    g.strokeStyle = color; g.lineWidth = 10;
    g.beginPath(); g.arc(128, 128, 104, 0, Math.PI * 2); g.stroke();
    g.setLineDash([18, 12]); g.lineWidth = 5;
    g.beginPath(); g.arc(128, 128, 84, 0, Math.PI * 2); g.stroke();
    g.setLineDash([]);
    g.fillStyle = color; g.font = 'bold 120px system-ui, sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(letter, 128, 134);
  });
}

// ---------- map build ----------
export function buildWorld(scene) {
  const colliders = [];   // {x0,y0,z0,x1,y1,z1} plain objects for the sim
  const group = new THREE.Group();
  scene.add(group);

  const texAsphalt = asphaltTex();
  const texConcrete = concreteTex();
  const texHazard = hazardTex();

  const matGround = new THREE.MeshStandardMaterial({ map: texAsphalt, roughness: 0.95, metalness: 0.05 });
  const matConcrete = new THREE.MeshStandardMaterial({ map: texConcrete, roughness: 0.9, metalness: 0.05 });
  const matDark = new THREE.MeshStandardMaterial({ color: 0x2b2e33, roughness: 0.85, metalness: 0.3 });
  const matRust = new THREE.MeshStandardMaterial({ color: 0x6e3b22, roughness: 0.8, metalness: 0.4 });
  const matYellow = new THREE.MeshStandardMaterial({ color: 0xb98a1e, roughness: 0.7, metalness: 0.35 });
  const matHazard = new THREE.MeshStandardMaterial({ map: texHazard, roughness: 0.8 });

  function addBox(x, y, z, w, h, d, mat, solid = true, ry = 0) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y + h / 2, z);
    m.rotation.y = ry;
    m.castShadow = true; m.receiveShadow = true;
    group.add(m);
    if (solid) {
      const hw = (Math.abs(Math.cos(ry)) * w + Math.abs(Math.sin(ry)) * d) / 2;
      const hd = (Math.abs(Math.sin(ry)) * w + Math.abs(Math.cos(ry)) * d) / 2;
      colliders.push({ x0: x - hw, y0: y, z0: z - hd, x1: x + hw, y1: y + h, z1: z + hd });
    }
    return m;
  }

  function container(x, z, ry, color, stack = 1) {
    const mat = new THREE.MeshStandardMaterial({ map: containerTex(color, 'rgba(20,20,24,0.85)'), roughness: 0.75, metalness: 0.35 });
    for (let s = 0; s < stack; s++) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(6.1, 2.6, 2.6), mat);
      m.position.set(x, 1.3 + s * 2.6, z);
      m.rotation.y = ry;
      m.castShadow = true; m.receiveShadow = true;
      group.add(m);
    }
    const w = Math.abs(Math.cos(ry)) * 6.1 + Math.abs(Math.sin(ry)) * 2.6;
    const d = Math.abs(Math.sin(ry)) * 6.1 + Math.abs(Math.cos(ry)) * 2.6;
    colliders.push({ x0: x - w / 2, y0: 0, z0: z - d / 2, x1: x + w / 2, y1: stack * 2.6, z1: z + d / 2 });
  }

  // ----- ground & sky -----
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(90, 90), matGround);
  ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true;
  group.add(ground);

  scene.background = new THREE.Color(0x1a2233);
  scene.fog = new THREE.Fog(0x1a2233, 34, 88);

  // harbour water beyond the north fence
  const water = new THREE.Mesh(
    new THREE.PlaneGeometry(90, 26),
    new THREE.MeshStandardMaterial({ color: 0x0d2733, roughness: 0.15, metalness: 0.85 }),
  );
  water.rotation.x = -Math.PI / 2; water.position.set(0, -0.4, -45);
  group.add(water);

  // stars
  const starGeo = new THREE.BufferGeometry();
  const starPos = new Float32Array(420 * 3);
  for (let i = 0; i < 420; i++) {
    const a = Math.random() * Math.PI * 2, e = 0.25 + Math.random() * 1.2, r = 120;
    starPos[i * 3] = Math.cos(a) * Math.cos(e) * r;
    starPos[i * 3 + 1] = Math.sin(e) * r;
    starPos[i * 3 + 2] = Math.sin(a) * Math.cos(e) * r;
  }
  starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
  group.add(new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xcfe0ff, size: 0.7, sizeAttenuation: false })));

  // ----- lighting: dusk sky, cold moon, warm sodium lamps -----
  scene.add(new THREE.HemisphereLight(0x8fa3c7, 0x2a2018, 1.6));
  const moon = new THREE.DirectionalLight(0xbfd0ff, 1.7);
  moon.position.set(-24, 38, -18);
  moon.castShadow = true;
  moon.shadow.mapSize.set(1024, 1024);
  moon.shadow.camera.left = -40; moon.shadow.camera.right = 40;
  moon.shadow.camera.top = 40; moon.shadow.camera.bottom = -40;
  moon.shadow.camera.far = 120;
  scene.add(moon);
  // warm bounce fill from the south-east so shadowed faces still read
  const fill = new THREE.DirectionalLight(0xffc890, 0.5);
  fill.position.set(30, 20, 30);
  scene.add(fill);
  // cool fill from the north-west so the moon side never goes black
  const fill2 = new THREE.DirectionalLight(0x8fb0ff, 0.4);
  fill2.position.set(-30, 18, -30);
  scene.add(fill2);

  const lampLights = [];
  function sodiumLamp(x, z) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.12, 5.4, 8), matDark);
    pole.position.set(x, 2.7, z); pole.castShadow = true; group.add(pole);
    const head = new THREE.Mesh(
      new THREE.BoxGeometry(0.7, 0.18, 0.35),
      new THREE.MeshStandardMaterial({ color: 0x332211, emissive: 0xffb454, emissiveIntensity: 2.4 }),
    );
    head.position.set(x, 5.45, z); group.add(head);
    const li = new THREE.PointLight(0xff9a3c, 42, 20, 1.8);
    li.position.set(x, 5.2, z);
    group.add(li);
    lampLights.push(li);
    colliders.push({ x0: x - 0.15, y0: 0, z0: z - 0.15, x1: x + 0.15, y1: 5.4, z1: z + 0.15 });
  }
  sodiumLamp(-12, 12); sodiumLamp(12, 12); sodiumLamp(-12, -12); sodiumLamp(12, -12);
  sodiumLamp(0, -24); sodiumLamp(0, 24);

  // ----- perimeter fence walls -----
  addBox(0, 0, -32, 66, 6, 1, matConcrete);          // north
  addBox(0, 0, 32, 66, 6, 1, matConcrete);           // south
  addBox(-32, 0, 0, 1, 6, 66, matConcrete);          // west
  addBox(32, 0, 0, 1, 6, 66, matConcrete);           // east
  addBox(0, 6, -32, 66, 0.5, 1.4, matHazard, false); // hazard trim, north
  addBox(0, 6, 32, 66, 0.5, 1.4, matHazard, false);

  // ----- site A: Crane Deck (NE) — containers + gantry crane silhouette -----
  container(20, -20, 0, '#7a4a28');            // long rust container, site cover
  container(24, -14, Math.PI / 2, '#2e5a66');  // teal, turned
  container(14, -24, Math.PI / 2, '#5a2e3e', 2); // stacked pair, tall sightline block
  addBox(20, 0, -26, 8, 1.2, 1.2, matYellow);   // low crane-rail block
  // gantry crane: two legs + beam + jib (silhouette, solid legs only)
  addBox(26, 0, -26, 1.2, 13, 1.2, matRust);
  addBox(26, 0, -14, 1.2, 13, 1.2, matRust);
  const beam = new THREE.Mesh(new THREE.BoxGeometry(1.4, 1.4, 14), matRust);
  beam.position.set(26, 13.4, -20); beam.castShadow = true; group.add(beam);
  const jib = new THREE.Mesh(new THREE.BoxGeometry(10, 0.9, 0.9), matDark);
  jib.position.set(20, 14.4, -20); jib.castShadow = true; group.add(jib);
  const hook = new THREE.Mesh(new THREE.BoxGeometry(0.8, 1.6, 0.8), matYellow);
  hook.position.set(15, 12.6, -20); group.add(hook);

  // ----- site B: Pump House (NW) — small building + tanks -----
  addBox(-24, 0, -22, 10, 4.5, 0.8, matConcrete);       // back wall
  addBox(-28.6, 0, -18, 0.8, 4.5, 8, matConcrete);      // west wall
  addBox(-19.4, 0, -18, 0.8, 4.5, 8, matConcrete);      // east wall (door gap left open south)
  addBox(-24, 4.5, -18, 10, 0.5, 8.8, matDark);         // roof
  const tankMat = new THREE.MeshStandardMaterial({ color: 0x3d6b5a, roughness: 0.5, metalness: 0.6 });
  for (const [tx, tz] of [[-26, -14], [-22, -14]]) {
    const tank = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.6, 3.4, 18), tankMat);
    tank.position.set(tx, 1.7, tz); tank.castShadow = true; tank.receiveShadow = true;
    group.add(tank);
    colliders.push({ x0: tx - 1.6, y0: 0, z0: tz - 1.6, x1: tx + 1.6, y1: 3.4, z1: tz + 1.6 });
  }
  container(-16, -24, 0, '#31456b'); // navy container guarding B approach

  // ----- mid yard: container maze + customs booth -----
  container(-6, 2, 0, '#7a4a28');
  container(6, -2, 0, '#2e5a66');
  container(0, 8, Math.PI / 2, '#5a2e3e');
  container(-2, -8, Math.PI / 2, '#31456b', 2);
  container(10, 8, 0, '#6b5a31');
  container(-12, -4, 0, '#3d6b5a');
  addBox(0, 0, 0, 3.4, 2.6, 3.4, matConcrete); // customs booth, centre
  addBox(0, 2.6, 0, 4.2, 0.3, 4.2, matDark, false); // booth roof lip
  // crates as low cover across the lanes
  const crateMat = new THREE.MeshStandardMaterial({ color: 0x8a6b3a, roughness: 0.9 });
  const crates = [
    [-20, 8, 1.2], [-18.5, 8, 1.2], [20, 6, 1.2], [18.5, 6, 1.2],
    [-8, 18, 1.4], [8, -16, 1.4], [-24, -6, 1.2], [24, -6, 1.2],
    [12, 20, 1.2], [-12, -18, 1.2], [4, 14, 1.0], [-4, -14, 1.0],
  ];
  for (const [cx, cz, s] of crates) addBox(cx, 0, cz, s, s, s, crateMat);
  addBox(-20, 0, 14, 4, 1.1, 1.1, matYellow); // low barrier, west lane
  addBox(20, 0, -8, 4, 1.1, 1.1, matYellow);  // low barrier, east lane

  // ----- south spawn yard (attackers) -----
  container(-20, 26, 0, '#2e5a66');
  container(18, 26, 0, '#7a4a28');
  addBox(0, 0, 27, 6, 2.2, 1.2, matConcrete);

  // ----- site markers: ground ring + light column -----
  function siteMarker(x, z, letter, color) {
    const ring = new THREE.Mesh(
      new THREE.PlaneGeometry(9, 9),
      new THREE.MeshBasicMaterial({ map: siteTex(letter, color), transparent: true, depthWrite: false }),
    );
    ring.rotation.x = -Math.PI / 2; ring.position.set(x, 0.06, z);
    group.add(ring);
    const col = new THREE.Mesh(
      new THREE.CylinderGeometry(2.6, 2.6, 9, 24, 1, true),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.07, side: THREE.DoubleSide, depthWrite: false }),
    );
    col.position.set(x, 4.5, z); group.add(col);
  }
  siteMarker(20, -20, 'A', '#ffb454');
  siteMarker(-20, -18, 'B', '#57e6c9');

  // ----- waypoints: hand-placed nodes, edges auto-linked by clear sight -----
  const wp = [
    [-24, 26], [-12, 26], [0, 26], [12, 26], [24, 26],       // 0-4 attacker spawn line
    [-24, 14], [-12, 14], [0, 18], [12, 14], [24, 14],       // 5-9 south yard
    [-24, 2], [-12, 2], [12, 2], [24, 2],                    // 10-13 mid-south
    [-24, -10], [-12, -12], [0, -12], [12, -12], [24, -10],  // 14-18 mid-north
    [-24, -20], [-14, -24], [0, -24], [14, -24], [24, -20],  // 19-23 north / sites
    [-8, -20], [8, -20], [-20, -26], [20, -26],              // 24-27 site pockets
    [0, 0], [-18, -14], [18, -14],                            // 28-30 centre + flanks
  ].map(([x, z]) => ({ x, z }));
  const edges = wp.map(() => []);
  for (let i = 0; i < wp.length; i++) {
    for (let j = i + 1; j < wp.length; j++) {
      const dx = wp[j].x - wp[i].x, dz = wp[j].z - wp[i].z;
      const d = Math.hypot(dx, dz);
      if (d > 15) continue;
      if (segmentBlocked(wp[i].x, 1.2, wp[i].z, wp[j].x, 1.2, wp[j].z, colliders)) continue;
      edges[i].push(j); edges[j].push(i);
    }
  }

  return {
    group, colliders, lampLights,
    sites: {
      A: { id: 'A', name: 'Crane Deck', x: 20, z: -20, radius: 5 },
      B: { id: 'B', name: 'Pump House', x: -20, z: -18, radius: 5 },
    },
    spawns: {
      atk: [[-26, 26], [-20, 27], [-14, 26], [-8, 27], [-2, 26]],
      def: [[-26, -26], [-18, -26], [-8, -26], [2, -26], [12, -26], [22, -26]],
    },
    waypoints: wp,
    edges,
  };

  // Segment vs AABB test at a fixed height — used for nav edges and bot LOS.
  function segmentBlocked(ax, ay, az, bx, by, bz, boxes) {
    for (const b of boxes) {
      if (b.y1 < Math.min(ay, by) || b.y0 > Math.max(ay, by)) continue;
      if (segmentHitsBox(ax, az, bx, bz, b)) return true;
    }
    return false;
  }
  function segmentHitsBox(ax, az, bx, bz, b) {
    // Slab test in 2D (x,z) for the segment against the box footprint.
    let t0 = 0, t1 = 1;
    const dx = bx - ax, dz = bz - az;
    const tests = [
      [-dx, ax - b.x0], [dx, b.x1 - ax],
      [-dz, az - b.z0], [dz, b.z1 - az],
    ];
    for (const [p, q] of tests) {
      if (p === 0) { if (q < 0) return false; }
      else {
        const r = q / p;
        if (p < 0) { if (r > t1) return false; if (r > t0) t0 = r; }
        else { if (r < t0) return false; if (r < t1) t1 = r; }
      }
    }
    return true;
  }
}

// LOS check shared by bots: true when the straight line at eye height is clear.
export function hasLineOfSight(ax, ay, az, bx, by, bz, colliders) {
  for (const b of colliders) {
    if (b.y1 < Math.min(ay, by) || b.y0 > Math.max(ay, by)) continue;
    if (segHits(ax, az, bx, bz, b)) return false;
  }
  return true;
}

function segHits(ax, az, bx, bz, b) {
  let t0 = 0, t1 = 1;
  const dx = bx - ax, dz = bz - az;
  const tests = [
    [-dx, ax - b.x0], [dx, b.x1 - ax],
    [-dz, az - b.z0], [dz, b.z1 - az],
  ];
  for (const [p, q] of tests) {
    if (p === 0) { if (q < 0) return false; }
    else {
      const r = q / p;
      if (p < 0) { if (r > t1) return false; if (r > t0) t0 = r; }
      else { if (r < t0) return false; if (r < t1) t1 = r; }
    }
  }
  return true;
}
