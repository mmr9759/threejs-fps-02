// state.js — one place for every constant and the single game state store.
// Nothing here touches the renderer; main.js owns the loop, agents.js owns
// movement, weapons.js owns combat. Every module reads the same state object.

// ---- match rules ----
export const MATCH = {
  roundsToWin: 7,
  maxRounds: 13,
  roundTime: 100,      // seconds of live play per round
  freezeTime: 12,      // seconds of buy / freeze time (buy menu open)
  plantTime: 3.5,      // seconds holding E to plant
  defuseTime: 5.0,     // seconds holding E to defuse
  fuseTime: 35,        // seconds from plant to detonation
  startMoney: 800,
  winBonus: 3250,
  lossBonus: 1900,
  lossStreakBonus: 500, // per consecutive loss, capped
  lossBonusCap: 2900,
  killBonus: 300,
  plantBonus: 300,
  defuseBonus: 300,
};

// ---- weapons: price, damage, headshot multiplier, fire rate, spread, recoil ----
// Spread is in radians of cone half-angle at rest; moving / airborne widens it.
export const WEAPONS = {
  p9: {
    id: 'p9', name: 'P9 SIDEARM', price: 0, mag: 12, reserve: 48, damage: 26,
    headMult: 3.0, rofMs: 170, auto: false, spread: 0.011, moveSpread: 0.030,
    recoil: 0.011, range: 60, reloadMs: 1400, tracer: 0xffd27a, autoName: 'P9',
  },
  vk47: {
    id: 'vk47', name: 'VK-47 RIFLE', price: 2700, mag: 30, reserve: 90, damage: 33,
    headMult: 3.2, rofMs: 100, auto: true, spread: 0.006, moveSpread: 0.026,
    recoil: 0.016, range: 120, reloadMs: 2200, tracer: 0xffb454, autoName: 'VK-47',
  },
  hornet: {
    id: 'hornet', name: 'HORNET SMG', price: 1500, mag: 25, reserve: 100, damage: 22,
    headMult: 2.8, rofMs: 75, auto: true, spread: 0.013, moveSpread: 0.024,
    recoil: 0.010, range: 45, reloadMs: 1900, tracer: 0x8ef0ff, autoName: 'Hornet',
  },
  longbow: {
    id: 'longbow', name: 'LONGBOW DMR', price: 3100, mag: 10, reserve: 30, damage: 78,
    headMult: 3.5, rofMs: 650, auto: false, spread: 0.0012, moveSpread: 0.05,
    recoil: 0.05, range: 160, reloadMs: 2800, tracer: 0xffe9a8, autoName: 'Longbow',
  },
  m590: {
    id: 'm590', name: 'M590 BREACHER', price: 1800, mag: 6, reserve: 24, damage: 15,
    headMult: 2.0, rofMs: 800, auto: false, spread: 0.045, moveSpread: 0.06,
    recoil: 0.055, range: 26, pellets: 8, reloadMs: 2600, tracer: 0xff9a5a, autoName: 'M590',
  },
};

// ---- grenades sold in the buy menu ----
export const GRENADES = {
  frag: { id: 'frag', name: 'FRAG GRENADE', price: 300, desc: 'Timed blast · heavy damage in 6 m' },
  smoke: { id: 'smoke', name: 'SMOKE CANISTER', price: 300, desc: 'Thick grey cloud · blocks sight for 12 s' },
  flash: { id: 'flash', name: 'FLASH CANISTER', price: 250, desc: 'White-out anyone looking at the pop' },
};

export const ARMOR_PRICE = 650;

// ---- teams ----
export const TEAMS = {
  atk: { id: 'atk', name: 'Ember Crew', color: 0xffb454, css: '#ffb454' },
  def: { id: 'def', name: 'Quay Wardens', color: 0x57e6c9, css: '#57e6c9' },
};

// ---- bot names (original, harbour-night flavour) ----
export const BOT_NAMES = {
  atk: ['Rust', 'Mara', 'Kestrel', 'Dune'],
  def: ['Harbor', 'Vega', 'Onyx', 'Sable', 'Tide'],
};

// ---- world constants shared by world.js / agents.js ----
export const WORLD = {
  half: 32,            // playable square is [-32, 32] on x and z
  eyeHeight: 1.62,
  crouchEye: 1.08,
  playerRadius: 0.42,
  playerHeight: 1.72,
  gravity: 15,
  jumpVel: 5.4,
  walkSpeed: 5.4,
  crouchSpeed: 2.7,
  quietSpeed: 3.4,
  accel: 46,
  friction: 9,
};

// createState() — the single store. main.js creates it once; modules mutate
// only through the helpers they own (rounds in main.js, money in weapons.js).
export function createState() {
  return {
    phase: 'menu',       // menu | freeze | live | roundEnd | matchEnd
    phaseT: 0,           // seconds in current phase
    round: 1,
    score: { atk: 0, def: 0 },
    lossStreak: { atk: 0, def: 0 },
    timer: MATCH.roundTime,
    fuse: 0,             // counts down after a plant
    plantedAt: null,     // 'A' | 'B' | null
    planter: null,
    chargeCarrier: null, // agent id holding the charge
    agents: [],          // player + 9 bots, in spawn order
    player: null,
    grenades: [],        // live grenade entities
    smokes: [],          // active smoke clouds {pos, until}
    flashes: [],         // pending flash pops
    events: [],          // {kind, pos, t} — gunshots etc. bots can hear
    killfeed: [],        // {text, head, t}
    stats: { kills: 0, deaths: 0, headshots: 0, plants: 0, defuses: 0, damage: 0 },
    winner: null,        // round winner team id
    roundReason: '',
    matchWinner: null,
    time: 0,             // total sim seconds
  };
}
