# EMBER QUAY — Night Shift

A round-based tactical FPS in the browser, built on three.js 0.187.0.
Counter-Strike-style, never a copy: an original dusk container-terminal map,
two crews of five, and a Core Charge to plant or defuse.

## Play

Serve `game/` with any static file server and open `index.html`:

```sh
node serve.ts   # serves game/ on http://localhost:8080
```

Or: `npx serve game` / `python3 -m http.server -d game`.

- **Attackers — Ember Crew:** plant the Core Charge at Site A (Crane Deck)
  or Site B (Pump House), then defend it until it blows.
- **Defenders — Quay Wardens:** hold the sites, defuse the charge, or wipe
  the crew before the clock dies.
- First crew to 7 rounds takes the night (max 13 rounds).

## Controls

WASD move · mouse aim · click fire · R reload · Shift walk quietly ·
C crouch · Space jump · E plant / defuse · G grenade · Q cycle grenade ·
1 / 2 / 3 weapons · B buy menu (freeze time).

## Economy

Kills pay $300, plants and defuses $300, round wins $3250, losses $1900+
with a loss-streak bonus. Spend it on rifles, a DMR, a shotgun, grenades
and Kevlar.

## Structure

- `game/index.html` — page, HUD, import map for three.js
- `game/src/main.js` — fixed-step loop, rounds, damage, plant/defuse
- `game/src/world.js` — the Ember Quay map, collision, waypoint graph
- `game/src/agents.js` — player movement + bot AI (routes, holds, hearing)
- `game/src/weapons.js` — raycast gunplay, recoil/spread, grenades, economy
- `game/src/hud.js` — HUD, minimap, killfeed, buy menu
- `game/src/fx.js` — tracers, muzzle, explosions, smoke
- `game/src/audio.js` — synthesized WebAudio sound effects
- `main.ts` — the make.fun entrypoint: copies `game/` + `screenshots/`
  to `/output` and writes `dossier.json`

Everything runs offline from static files — no network, no build step.
All art is procedural (canvas textures, three.js geometry) and all sounds
are synthesized. Made for the make.fun threejs-fps-02 bounty.
