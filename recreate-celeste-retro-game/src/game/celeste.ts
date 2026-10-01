// @ts-nocheck
// Celeste Classic - port fiel del codigo Lua original de Matt Thorson + Noel Berry (PICO-8)
import { GFX_ROWS, GFX_LOWER_ROWS, MAP_UPPER_ROWS, GFF_HEX } from './data';
import { MAP_TAIL } from './maptail';
import { P8Audio } from './audio';

/* ------------------------------------------------------------------ */
/* Mini "PICO-8": framebuffer 128x128, paleta, sprites, mapa, texto    */
/* ------------------------------------------------------------------ */

const COLORS = [
  0x000000, 0x1d2b53, 0x7e2553, 0x008751, 0xab5236, 0x5f574f, 0xc2c3c7, 0xfff1e8,
  0xff004d, 0xffa300, 0xffec27, 0x00e436, 0x29adff, 0x83769c, 0xff77a8, 0xffccaa,
];
const PAL32 = COLORS.map((c) => (0xff000000 | ((c & 0xff) << 16) | (c & 0xff00) | ((c >> 16) & 0xff)) >>> 0);

const fb = new Uint8Array(128 * 128);
const dpal = new Uint8Array(16);
let camX = 0;
let camY = 0;

// hoja de sprites 128x128 (solo la mitad superior contiene sprites)
const sheet = new Uint8Array(128 * 128);
for (let y = 0; y < 64; y++) {
  const row = GFX_ROWS[y] || '';
  for (let x = 0; x < 128; x++) sheet[y * 128 + x] = parseInt(row[x] || '0', 16) || 0;
}

// mapa 128x64
const mapData = new Uint8Array(128 * 64);
for (let y = 0; y < 32; y++) {
  const row = MAP_UPPER_ROWS[y] || '';
  for (let x = 0; x < 128; x++) mapData[y * 128 + x] = parseInt(row.substr(x * 2, 2) || '00', 16) || 0;
}
for (let y = 32; y < 64; y++) {
  for (let x = 0; x < 128; x++) {
    const row = GFX_LOWER_ROWS[(y - 32) * 2 + (x >> 6)] || '';
    const col = (x & 63) * 2;
    const a = parseInt(row[col] || '0', 16) || 0;
    const b = parseInt(row[col + 1] || '0', 16) || 0;
    mapData[y * 128 + x] = b * 16 + a;
  }
}
// la parte final del mapa (filas inferiores) se superpone, alineada desde el final
{
  const start = 128 * 64 - MAP_TAIL.length;
  for (let k = 0; k < MAP_TAIL.length; k++) {
    const idx = start + k;
    if (idx >= 128 * 32 && idx < 128 * 64) mapData[idx] = MAP_TAIL[k] || 0;
  }
}
const flags = new Uint8Array(256);
for (let i = 0; i < 128; i++) flags[i] = parseInt(GFF_HEX.substr(i * 2, 2) || '00', 16) || 0;

const keys = [false, false, false, false, false, false];
const audio = new P8Audio();

function resetPal() {
  for (let i = 0; i < 16; i++) dpal[i] = i;
}
resetPal();
function pal(a?: number, b?: number) {
  if (a === undefined) return resetPal();
  dpal[Math.floor(a) & 15] = Math.floor(b) & 15;
}
function camera(x = 0, y = 0) {
  camX = Math.floor(x);
  camY = Math.floor(y);
}
function pset(x: number, y: number, c: number) {
  x -= camX;
  y -= camY;
  if (x < 0 || y < 0 || x > 127 || y > 127) return;
  fb[y * 128 + x] = dpal[c & 15];
}
function rectfill(x0: number, y0: number, x1: number, y1: number, c: number) {
  x0 = Math.floor(x0);
  y0 = Math.floor(y0);
  x1 = Math.floor(x1);
  y1 = Math.floor(y1);
  if (x1 < x0) [x0, x1] = [x1, x0];
  if (y1 < y0) [y0, y1] = [y1, y0];
  c = dpal[Math.floor(c) & 15];
  x0 -= camX;
  x1 -= camX;
  y0 -= camY;
  y1 -= camY;
  if (x0 < 0) x0 = 0;
  if (y0 < 0) y0 = 0;
  if (x1 > 127) x1 = 127;
  if (y1 > 127) y1 = 127;
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) fb[y * 128 + x] = c;
}
function circfill(cx: number, cy: number, r: number, c: number) {
  cx = Math.floor(cx);
  cy = Math.floor(cy);
  r = Math.floor(r);
  c = Math.floor(c);
  const lim = (r + 0.5) * (r + 0.5) - 0.5;
  for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (dx * dx + dy * dy <= lim) pset(cx + dx, cy + dy, c);
}
function line(x0: number, y0: number, x1: number, y1: number, c: number) {
  x0 = Math.floor(x0);
  y0 = Math.floor(y0);
  x1 = Math.floor(x1);
  y1 = Math.floor(y1);
  c = Math.floor(c);
  const dx = Math.abs(x1 - x0);
  const dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  for (let i = 0; i < 400; i++) {
    pset(x0, y0, c);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x0 += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y0 += sy;
    }
  }
}
function spr(n: number, x: number, y: number, w = 1, h = 1, flipx = false, flipy = false) {
  n = Math.floor(n);
  if (n < 0 || n > 127) return;
  x = Math.floor(x);
  y = Math.floor(y);
  const sx = (n % 16) * 8;
  const sy = Math.floor(n / 16) * 8;
  for (let j = 0; j < 8; j++) {
    for (let i = 0; i < 8; i++) {
      const px = flipx ? 7 - i : i;
      const py = flipy ? 7 - j : j;
      const col = sheet[(sy + py) * 128 + sx + px];
      if (col !== 0) pset(x + i, y + j, col);
    }
  }
}
function mget(x: number, y: number) {
  x = Math.floor(x);
  y = Math.floor(y);
  if (x < 0 || y < 0 || x > 127 || y > 63) return 0;
  return mapData[y * 128 + x];
}
function fget(n: number, f: number) {
  return ((flags[Math.floor(n) & 255] >> f) & 1) === 1;
}
function map(celx: number, cely: number, sx: number, sy: number, celw: number, celh: number, layer = 0) {
  for (let ty = 0; ty < celh; ty++) {
    for (let tx = 0; tx < celw; tx++) {
      const t = mget(celx + tx, cely + ty);
      if (t === 0) continue;
      if (layer !== 0 && (flags[t] & layer) !== layer) continue;
      spr(t, sx + tx * 8, sy + ty * 8);
    }
  }
}

// fuente 3x5 (mayusculas, como la fuente de PICO-8)
const FONT: Record<string, number[]> = {
  a: [2, 5, 7, 5, 5], b: [6, 5, 6, 5, 6], c: [3, 4, 4, 4, 3], d: [6, 5, 5, 5, 6], e: [7, 4, 6, 4, 7],
  f: [7, 4, 6, 4, 4], g: [3, 4, 5, 5, 3], h: [5, 5, 7, 5, 5], i: [7, 2, 2, 2, 7], j: [1, 1, 1, 5, 2],
  k: [5, 5, 6, 5, 5], l: [4, 4, 4, 4, 7], m: [5, 7, 7, 5, 5], n: [6, 5, 5, 5, 5], o: [2, 5, 5, 5, 2],
  p: [6, 5, 6, 4, 4], q: [2, 5, 5, 6, 3], r: [6, 5, 6, 5, 5], s: [3, 4, 2, 1, 6], t: [7, 2, 2, 2, 2],
  u: [5, 5, 5, 5, 7], v: [5, 5, 5, 5, 2], w: [5, 5, 7, 7, 5], x: [5, 5, 2, 5, 5], y: [5, 5, 2, 2, 2],
  z: [7, 1, 2, 4, 7],
  '0': [7, 5, 5, 5, 7], '1': [2, 6, 2, 2, 7], '2': [6, 1, 2, 4, 7], '3': [6, 1, 2, 1, 6], '4': [5, 5, 7, 1, 1],
  '5': [7, 4, 6, 1, 6], '6': [3, 4, 7, 5, 7], '7': [7, 1, 2, 2, 2], '8': [7, 5, 7, 5, 7], '9': [7, 5, 7, 1, 6],
  ':': [0, 2, 0, 2, 0], '-': [0, 0, 7, 0, 0], '+': [0, 2, 7, 2, 0], '.': [0, 0, 0, 0, 2], '?': [6, 1, 2, 0, 2],
  ' ': [0, 0, 0, 0, 0],
};
function print(str: any, x: number, y: number, c: number) {
  str = String(str).toLowerCase();
  x = Math.floor(x);
  y = Math.floor(y);
  c = Math.floor(c);
  for (const ch of str) {
    const g = FONT[ch];
    if (g) {
      for (let j = 0; j < 5; j++) for (let i = 0; i < 3; i++) if (g[j] & (4 >> i)) pset(x + i, y + j, c);
    }
    x += 4;
  }
}

const flr = Math.floor;
const abs = Math.abs;
const max = Math.max;
const min = Math.min;
const sin = (x: number) => -Math.sin(x * Math.PI * 2);
const cos = (x: number) => Math.cos(x * Math.PI * 2);
const rnd = (x = 1) => Math.random() * x;
const mod = (a: number, b: number) => a - Math.floor(a / b) * b;
const btn = (i: number) => keys[i];
const sfx = (n: number) => audio.sfx(n);
const music = (n: number, fade = 0, mask = 7) => audio.music(n, fade, mask);

/* ------------------------------------------------------------------ */
/* Codigo del juego (traduccion directa del Lua original)              */
/* ------------------------------------------------------------------ */

const room = { x: 0, y: 0 };
let objects: any[] = [];
const types: any[] = [];
let freeze = 0;
let shake = 0;
let will_restart = false;
let delay_restart = 0;
let got_fruit: boolean[] = [];
let has_dashed = false;
let sfx_timer = 0;
let has_key = false;
let pause_player = false;
let flash_bg = false;
let music_timer = 0;
let new_bg: any = undefined;
let frames = 0;
let seconds = 0;
let minutes = 0;
let deaths = 0;
let max_djump = 1;
let start_game = false;
let start_game_flash = 0;

const k_left = 0;
const k_right = 1;
const k_up = 2;
const k_down = 3;
const k_jump = 4;
const k_dash = 5;

function title_screen() {
  got_fruit = [];
  for (let i = 0; i <= 29; i++) got_fruit.push(false);
  frames = 0;
  deaths = 0;
  max_djump = 1;
  start_game = false;
  start_game_flash = 0;
  music(40, 0, 7);
  load_room(7, 3);
}

function begin_game() {
  frames = 0;
  seconds = 0;
  minutes = 0;
  music_timer = 0;
  start_game = false;
  music(0, 0, 7);
  load_room(0, 0);
}

function level_index() {
  return (room.x % 8) + room.y * 8;
}
function is_title() {
  return level_index() === 31;
}

// efectos
const clouds: any[] = [];
for (let i = 0; i <= 16; i++) clouds.push({ x: rnd(128), y: rnd(128), spd: 1 + rnd(4), w: 32 + rnd(32) });
const particles: any[] = [];
for (let i = 0; i <= 24; i++)
  particles.push({ x: rnd(128), y: rnd(128), s: 0 + flr(rnd(5) / 4), spd: 0.25 + rnd(5), off: rnd(1), c: 6 + flr(0.5 + rnd(1)) });
let dead_particles: any[] = [];

// jugador
const player: any = {
  init(me: any) {
    me.p_jump = false;
    me.p_dash = false;
    me.grace = 0;
    me.jbuffer = 0;
    me.djump = max_djump;
    me.dash_time = 0;
    me.dash_effect_time = 0;
    me.dash_target = { x: 0, y: 0 };
    me.dash_accel = { x: 0, y: 0 };
    me.hitbox = { x: 1, y: 3, w: 6, h: 5 };
    me.spr_off = 0;
    me.was_on_ground = false;
    create_hair(me);
  },
  update(me: any) {
    if (pause_player) return;
    const input = btn(k_right) ? 1 : btn(k_left) ? -1 : 0;

    // pinchos
    if (spikes_at(me.x + me.hitbox.x, me.y + me.hitbox.y, me.hitbox.w, me.hitbox.h, me.spd.x, me.spd.y)) kill_player(me);

    // muerte por caida
    if (me.y > 128) kill_player(me);

    const on_ground = me.is_solid(0, 1);
    const on_ice = me.is_ice(0, 1);

    // humo al aterrizar
    if (on_ground && !me.was_on_ground) init_object(smoke, me.x, me.y + 4);

    const jump = btn(k_jump) && !me.p_jump;
    me.p_jump = btn(k_jump);
    if (jump) me.jbuffer = 4;
    else if (me.jbuffer > 0) me.jbuffer -= 1;

    const dash = btn(k_dash) && !me.p_dash;
    me.p_dash = btn(k_dash);

    if (on_ground) {
      me.grace = 6;
      if (me.djump < max_djump) {
        psfx(54);
        me.djump = max_djump;
      }
    } else if (me.grace > 0) {
      me.grace -= 1;
    }

    me.dash_effect_time -= 1;
    if (me.dash_time > 0) {
      init_object(smoke, me.x, me.y);
      me.dash_time -= 1;
      me.spd.x = appr(me.spd.x, me.dash_target.x, me.dash_accel.x);
      me.spd.y = appr(me.spd.y, me.dash_target.y, me.dash_accel.y);
    } else {
      // movimiento
      const maxrun = 1;
      let accel = 0.6;
      const deccel = 0.15;

      if (!on_ground) {
        accel = 0.4;
      } else if (on_ice) {
        accel = 0.05;
        if (input === (me.flip.x ? -1 : 1)) accel = 0.05;
      }

      if (abs(me.spd.x) > maxrun) me.spd.x = appr(me.spd.x, sign(me.spd.x) * maxrun, deccel);
      else me.spd.x = appr(me.spd.x, input * maxrun, accel);

      // orientacion
      if (me.spd.x !== 0) me.flip.x = me.spd.x < 0;

      // gravedad
      let maxfall = 2;
      let gravity = 0.21;
      if (abs(me.spd.y) <= 0.15) gravity *= 0.5;

      // deslizar por pared
      if (input !== 0 && me.is_solid(input, 0) && !me.is_ice(input, 0)) {
        maxfall = 0.4;
        if (rnd(10) < 2) init_object(smoke, me.x + input * 6, me.y);
      }

      if (!on_ground) me.spd.y = appr(me.spd.y, maxfall, gravity);

      // salto
      if (me.jbuffer > 0) {
        if (me.grace > 0) {
          psfx(1);
          me.jbuffer = 0;
          me.grace = 0;
          me.spd.y = -2;
          init_object(smoke, me.x, me.y + 4);
        } else {
          const wall_dir = me.is_solid(-3, 0) ? -1 : me.is_solid(3, 0) ? 1 : 0;
          if (wall_dir !== 0) {
            psfx(2);
            me.jbuffer = 0;
            me.spd.y = -2;
            me.spd.x = -wall_dir * (maxrun + 1);
            if (!me.is_ice(wall_dir * 3, 0)) init_object(smoke, me.x + wall_dir * 6, me.y);
          }
        }
      }

      // dash
      const d_full = 5;
      const d_half = d_full * 0.70710678118;

      if (me.djump > 0 && dash) {
        init_object(smoke, me.x, me.y);
        me.djump -= 1;
        me.dash_time = 4;
        has_dashed = true;
        me.dash_effect_time = 10;
        const v_input = btn(k_up) ? -1 : btn(k_down) ? 1 : 0;
        if (input !== 0) {
          if (v_input !== 0) {
            me.spd.x = input * d_half;
            me.spd.y = v_input * d_half;
          } else {
            me.spd.x = input * d_full;
            me.spd.y = 0;
          }
        } else if (v_input !== 0) {
          me.spd.x = 0;
          me.spd.y = v_input * d_full;
        } else {
          me.spd.x = me.flip.x ? -1 : 1;
          me.spd.y = 0;
        }

        psfx(3);
        freeze = 2;
        shake = 6;
        me.dash_target.x = 2 * sign(me.spd.x);
        me.dash_target.y = 2 * sign(me.spd.y);
        me.dash_accel.x = 1.5;
        me.dash_accel.y = 1.5;

        if (me.spd.y < 0) me.dash_target.y *= 0.75;
        if (me.spd.y !== 0) me.dash_accel.x *= 0.70710678118;
        if (me.spd.x !== 0) me.dash_accel.y *= 0.70710678118;
      } else if (dash && me.djump <= 0) {
        psfx(9);
        init_object(smoke, me.x, me.y);
      }
    }

    // animacion
    me.spr_off += 0.25;
    if (!on_ground) {
      if (me.is_solid(input, 0)) me.spr = 5;
      else me.spr = 3;
    } else if (btn(k_down)) {
      me.spr = 6;
    } else if (btn(k_up)) {
      me.spr = 7;
    } else if (me.spd.x === 0 || (!btn(k_left) && !btn(k_right))) {
      me.spr = 1;
    } else {
      me.spr = 1 + mod(me.spr_off, 4);
    }

    // siguiente nivel
    if (me.y < -4 && level_index() < 30) next_room();

    me.was_on_ground = on_ground;
  },
  draw(me: any) {
    // limitar a la pantalla
    if (me.x < -1 || me.x > 121) {
      me.x = clamp(me.x, -1, 121);
      me.spd.x = 0;
    }
    set_hair_color(me.djump);
    draw_hair(me, me.flip.x ? -1 : 1);
    spr(me.spr, me.x, me.y, 1, 1, me.flip.x, me.flip.y);
    unset_hair_color();
  },
};

function psfx(num: number) {
  if (sfx_timer <= 0) sfx(num);
}

function create_hair(obj: any) {
  obj.hair = [];
  for (let i = 0; i <= 4; i++) obj.hair.push({ x: obj.x, y: obj.y, size: max(1, min(2, 3 - i)) });
}
function set_hair_color(djump: number) {
  pal(8, djump === 1 ? 8 : djump === 2 ? 7 + flr(mod(frames / 3, 2)) * 4 : 12);
}
function draw_hair(obj: any, facing: number) {
  let last = { x: obj.x + 4 - facing * 2, y: obj.y + (btn(k_down) ? 4 : 3) };
  for (const h of obj.hair) {
    h.x += (last.x - h.x) / 1.5;
    h.y += (last.y + 0.5 - h.y) / 1.5;
    circfill(h.x, h.y, h.size, 8);
    last = h;
  }
}
function unset_hair_color() {
  pal(8, 8);
}

const player_spawn: any = {
  tile: 1,
  init(me: any) {
    sfx(4);
    me.spr = 3;
    me.target = { x: me.x, y: me.y };
    me.y = 128;
    me.spd.y = -4;
    me.state = 0;
    me.delay = 0;
    me.solids = false;
    create_hair(me);
  },
  update(me: any) {
    if (me.state === 0) {
      // saltando hacia arriba
      if (me.y < me.target.y + 16) {
        me.state = 1;
        me.delay = 3;
      }
    } else if (me.state === 1) {
      // cayendo
      me.spd.y += 0.5;
      if (me.spd.y > 0 && me.delay > 0) {
        me.spd.y = 0;
        me.delay -= 1;
      }
      if (me.spd.y > 0 && me.y > me.target.y) {
        me.y = me.target.y;
        me.spd = { x: 0, y: 0 };
        me.state = 2;
        me.delay = 5;
        shake = 5;
        init_object(smoke, me.x, me.y + 4);
        sfx(5);
      }
    } else if (me.state === 2) {
      // aterrizaje
      me.delay -= 1;
      me.spr = 6;
      if (me.delay < 0) {
        destroy_object(me);
        init_object(player, me.x, me.y);
      }
    }
  },
  draw(me: any) {
    set_hair_color(max_djump);
    draw_hair(me, 1);
    spr(me.spr, me.x, me.y, 1, 1, me.flip.x, me.flip.y);
    unset_hair_color();
  },
};
types.push(player_spawn);

const spring: any = {
  tile: 18,
  init(me: any) {
    me.hide_in = 0;
    me.hide_for = 0;
  },
  update(me: any) {
    if (me.hide_for > 0) {
      me.hide_for -= 1;
      if (me.hide_for <= 0) {
        me.spr = 18;
        me.delay = 0;
      }
    } else if (me.spr === 18) {
      const hit = me.collide(player, 0, 0);
      if (hit != null && hit.spd.y >= 0) {
        me.spr = 19;
        hit.y = me.y - 4;
        hit.spd.x *= 0.2;
        hit.spd.y = -3;
        hit.djump = max_djump;
        me.delay = 10;
        init_object(smoke, me.x, me.y);

        // suelo que se rompe debajo
        const below = me.collide(fall_floor, 0, 1);
        if (below != null) break_fall_floor(below);

        psfx(8);
      }
    } else if (me.delay > 0) {
      me.delay -= 1;
      if (me.delay <= 0) me.spr = 18;
    }
    // empezar a esconderse
    if (me.hide_in > 0) {
      me.hide_in -= 1;
      if (me.hide_in <= 0) {
        me.hide_for = 60;
        me.spr = 0;
      }
    }
  },
};
types.push(spring);

function break_spring(obj: any) {
  obj.hide_in = 15;
}

const balloon: any = {
  tile: 22,
  init(me: any) {
    me.offset = rnd(1);
    me.start = me.y;
    me.timer = 0;
    me.hitbox = { x: -1, y: -1, w: 10, h: 10 };
  },
  update(me: any) {
    if (me.spr === 22) {
      me.offset += 0.01;
      me.y = me.start + sin(me.offset) * 2;
      const hit = me.collide(player, 0, 0);
      if (hit != null && hit.djump < max_djump) {
        psfx(6);
        init_object(smoke, me.x, me.y);
        hit.djump = max_djump;
        me.spr = 0;
        me.timer = 60;
      }
    } else if (me.timer > 0) {
      me.timer -= 1;
    } else {
      psfx(7);
      init_object(smoke, me.x, me.y);
      me.spr = 22;
    }
  },
  draw(me: any) {
    if (me.spr === 22) {
      spr(13 + mod(me.offset * 8, 3), me.x, me.y + 6);
      spr(me.spr, me.x, me.y);
    }
  },
};
types.push(balloon);

const fall_floor: any = {
  tile: 23,
  init(me: any) {
    me.state = 0;
    me.solid = true;
  },
  update(me: any) {
    if (me.state === 0) {
      // inactivo
      if (me.check(player, 0, -1) || me.check(player, -1, 0) || me.check(player, 1, 0)) break_fall_floor(me);
    } else if (me.state === 1) {
      // temblando
      me.delay -= 1;
      if (me.delay <= 0) {
        me.state = 2;
        me.delay = 60; // cuanto tiempo desaparece
        me.collideable = false;
      }
    } else if (me.state === 2) {
      // invisible, esperando a reaparecer
      me.delay -= 1;
      if (me.delay <= 0 && !me.check(player, 0, 0)) {
        psfx(7);
        me.state = 0;
        me.collideable = true;
        init_object(smoke, me.x, me.y);
      }
    }
  },
  draw(me: any) {
    if (me.state !== 2) {
      if (me.state !== 1) spr(23, me.x, me.y);
      else spr(23 + (15 - me.delay) / 5, me.x, me.y);
    }
  },
};
types.push(fall_floor);

function break_fall_floor(obj: any) {
  if (obj.state === 0) {
    psfx(15);
    obj.state = 1;
    obj.delay = 15; // cuanto tarda en caer
    init_object(smoke, obj.x, obj.y);
    const hit = obj.collide(spring, 0, -1);
    if (hit != null) break_spring(hit);
  }
}

const smoke: any = {
  init(me: any) {
    me.spr = 29;
    me.spd.y = -0.1;
    me.spd.x = 0.3 + rnd(0.2);
    me.x += -1 + rnd(2);
    me.y += -1 + rnd(2);
    me.flip.x = maybe();
    me.flip.y = maybe();
    me.solids = false;
  },
  update(me: any) {
    me.spr += 0.2;
    if (me.spr >= 32) destroy_object(me);
  },
};

const fruit: any = {
  tile: 26,
  if_not_fruit: true,
  init(me: any) {
    me.start = me.y;
    me.off = 0;
  },
  update(me: any) {
    const hit = me.collide(player, 0, 0);
    if (hit != null) {
      hit.djump = max_djump;
      sfx_timer = 20;
      sfx(13);
      got_fruit[1 + level_index()] = true;
      init_object(lifeup, me.x, me.y);
      destroy_object(me);
    }
    me.off += 1;
    me.y = me.start + sin(me.off / 40) * 2.5;
  },
};
types.push(fruit);

const fly_fruit: any = {
  tile: 28,
  if_not_fruit: true,
  init(me: any) {
    me.start = me.y;
    me.fly = false;
    me.step = 0.5;
    me.solids = false;
    me.sfx_delay = 8;
  },
  update(me: any) {
    // huye volando
    if (me.fly) {
      if (me.sfx_delay > 0) {
        me.sfx_delay -= 1;
        if (me.sfx_delay <= 0) {
          sfx_timer = 20;
          sfx(14);
        }
      }
      me.spd.y = appr(me.spd.y, -3.5, 0.25);
      if (me.y < -16) destroy_object(me);
    } else {
      // espera
      if (has_dashed) me.fly = true;
      me.step += 0.05;
      me.spd.y = sin(me.step) * 0.5;
    }
    // recoger
    const hit = me.collide(player, 0, 0);
    if (hit != null) {
      hit.djump = max_djump;
      sfx_timer = 20;
      sfx(13);
      got_fruit[1 + level_index()] = true;
      init_object(lifeup, me.x, me.y);
      destroy_object(me);
    }
  },
  draw(me: any) {
    let off = 0;
    if (!me.fly) {
      const dir = sin(me.step);
      if (dir < 0) off = 1 + max(0, sign(me.y - me.start));
    } else {
      off = mod(off + 0.25, 3);
    }
    spr(45 + off, me.x - 6, me.y - 2, 1, 1, true, false);
    spr(me.spr, me.x, me.y);
    spr(45 + off, me.x + 6, me.y - 2);
  },
};
types.push(fly_fruit);

const lifeup: any = {
  init(me: any) {
    me.spd.y = -0.25;
    me.duration = 30;
    me.x -= 2;
    me.y -= 4;
    me.flash = 0;
    me.solids = false;
  },
  update(me: any) {
    me.duration -= 1;
    if (me.duration <= 0) destroy_object(me);
  },
  draw(me: any) {
    me.flash += 0.5;
    print('1000', me.x - 2, me.y, 7 + mod(me.flash, 2));
  },
};

const fake_wall: any = {
  tile: 64,
  if_not_fruit: true,
  update(me: any) {
    me.hitbox = { x: -1, y: -1, w: 18, h: 18 };
    const hit = me.collide(player, 0, 0);
    if (hit != null && hit.dash_effect_time > 0) {
      hit.spd.x = -sign(hit.spd.x) * 1.5;
      hit.spd.y = -1.5;
      hit.dash_time = -1;
      sfx_timer = 20;
      sfx(16);
      destroy_object(me);
      init_object(smoke, me.x, me.y);
      init_object(smoke, me.x + 8, me.y);
      init_object(smoke, me.x, me.y + 8);
      init_object(smoke, me.x + 8, me.y + 8);
      init_object(fruit, me.x + 4, me.y + 4);
    }
    me.hitbox = { x: 0, y: 0, w: 16, h: 16 };
  },
  draw(me: any) {
    spr(64, me.x, me.y);
    spr(65, me.x + 8, me.y);
    spr(80, me.x, me.y + 8);
    spr(81, me.x + 8, me.y + 8);
  },
};
types.push(fake_wall);

const key: any = {
  tile: 8,
  if_not_fruit: true,
  update(me: any) {
    const was = flr(me.spr);
    me.spr = 9 + (sin(frames / 30) + 0.5) * 1;
    const is = flr(me.spr);
    if (is === 10 && is !== was) me.flip.x = !me.flip.x;
    if (me.check(player, 0, 0)) {
      sfx(23);
      sfx_timer = 10;
      destroy_object(me);
      has_key = true;
    }
  },
};
types.push(key);

const chest: any = {
  tile: 20,
  if_not_fruit: true,
  init(me: any) {
    me.x -= 4;
    me.start = me.x;
    me.timer = 20;
  },
  update(me: any) {
    if (has_key) {
      me.timer -= 1;
      me.x = me.start - 1 + rnd(3);
      if (me.timer <= 0) {
        sfx_timer = 20;
        sfx(16);
        init_object(fruit, me.x, me.y - 4);
        destroy_object(me);
      }
    }
  },
};
types.push(chest);

const platform: any = {
  init(me: any) {
    me.x -= 4;
    me.solids = false;
    me.hitbox.w = 16;
    me.last = me.x;
  },
  update(me: any) {
    me.spd.x = me.dir * 0.65;
    if (me.x < -16) me.x = 128;
    else if (me.x > 128) me.x = -16;
    if (!me.check(player, 0, 0)) {
      const hit = me.collide(player, 0, -1);
      if (hit != null) hit.move_x(me.x - me.last, 1);
    }
    me.last = me.x;
  },
  draw(me: any) {
    spr(11, me.x, me.y - 1);
    spr(12, me.x + 8, me.y - 1);
  },
};

const message: any = {
  tile: 86,
  last: 0,
  draw(me: any) {
    me.text = '-- celeste mountain --#this memorial to those# perished on the climb';
    if (me.check(player, 4, 0)) {
      if (me.index === undefined) me.index = 0;
      if (me.last === undefined) me.last = 0;
      if (me.index < me.text.length) {
        me.index += 0.5;
        if (me.index >= me.last + 1) {
          me.last += 1;
          sfx(35);
        }
      }
      me.off = { x: 8, y: 96 };
      for (let i = 1; i <= me.index; i++) {
        const chr = me.text.substr(i - 1, 1);
        if (chr !== '#') {
          rectfill(me.off.x - 2, me.off.y - 2, me.off.x + 7, me.off.y + 6, 7);
          print(chr, me.off.x, me.off.y, 0);
          me.off.x += 5;
        } else {
          me.off.x = 8;
          me.off.y += 7;
        }
      }
    } else {
      me.index = 0;
      me.last = 0;
    }
  },
};
types.push(message);

const big_chest: any = {
  tile: 96,
  init(me: any) {
    me.state = 0;
    me.hitbox.w = 16;
  },
  draw(me: any) {
    if (me.state === 0) {
      const hit = me.collide(player, 0, 8);
      if (hit != null && hit.is_solid(0, 1)) {
        music(-1, 500, 7);
        sfx(37);
        pause_player = true;
        hit.spd.x = 0;
        hit.spd.y = 0;
        me.state = 1;
        init_object(smoke, me.x, me.y);
        init_object(smoke, me.x + 8, me.y);
        me.timer = 60;
        me.particles = [];
      }
      spr(96, me.x, me.y);
      spr(97, me.x + 8, me.y);
    } else if (me.state === 1) {
      me.timer -= 1;
      shake = 5;
      flash_bg = true;
      if (me.timer <= 45 && me.particles.length < 50) {
        me.particles.push({ x: 1 + rnd(14), y: 0, h: 32 + rnd(32), spd: 8 + rnd(8) });
      }
      if (me.timer < 0) {
        me.state = 2;
        me.particles = [];
        flash_bg = false;
        new_bg = true;
        init_object(orb, me.x + 4, me.y + 4);
        pause_player = false;
      }
      for (const p of me.particles.slice()) {
        p.y += p.spd;
        line(me.x + p.x, me.y + 8 - p.y, me.x + p.x, min(me.y + 8 - p.y + p.h, me.y + 8), 7);
      }
    }
    spr(112, me.x, me.y + 8);
    spr(113, me.x + 8, me.y + 8);
  },
};
types.push(big_chest);

const orb: any = {
  init(me: any) {
    me.spd.y = -4;
    me.solids = false;
    me.particles = [];
  },
  draw(me: any) {
    me.spd.y = appr(me.spd.y, 0, 0.5);
    const hit = me.collide(player, 0, 0);
    if (me.spd.y === 0 && hit != null) {
      music_timer = 45;
      sfx(51);
      freeze = 10;
      shake = 10;
      destroy_object(me);
      max_djump = 2;
      hit.djump = 2;
    }

    spr(102, me.x, me.y);
    const off = frames / 30;
    for (let i = 0; i <= 7; i++) {
      circfill(me.x + 4 + cos(off + i / 8) * 8, me.y + 4 + sin(off + i / 8) * 8, 1, 7);
    }
  },
};

const flag: any = {
  tile: 118,
  init(me: any) {
    me.x += 5;
    me.score = 0;
    me.show = false;
    for (let i = 1; i <= 30; i++) {
      if (got_fruit[i]) me.score += 1;
    }
  },
  draw(me: any) {
    me.spr = 118 + mod(frames / 5, 3);
    spr(me.spr, me.x, me.y);
    if (me.show) {
      rectfill(32, 2, 96, 31, 0);
      spr(26, 55, 6);
      print('x' + me.score, 64, 9, 7);
      draw_time(49, 16);
      print('deaths:' + deaths, 48, 24, 7);
    } else if (me.check(player, 0, 0)) {
      sfx(55);
      sfx_timer = 30;
      me.show = true;
    }
  },
};
types.push(flag);

const room_title: any = {
  init(me: any) {
    me.delay = 5;
  },
  draw(me: any) {
    me.delay -= 1;
    if (me.delay < -30) {
      destroy_object(me);
    } else if (me.delay < 0) {
      rectfill(24, 58, 104, 70, 0);
      if (room.x === 3 && room.y === 1) {
        print('old site', 48, 62, 7);
      } else if (level_index() === 30) {
        print('summit', 52, 62, 7);
      } else {
        const level = (1 + level_index()) * 100;
        print(level + ' m', 52 + (level < 1000 ? 2 : 0), 62, 7);
      }
      draw_time(4, 4);
    }
  },
};

// funciones de objetos
function init_object(type: any, x: number, y: number): any {
  if (type.if_not_fruit !== undefined && got_fruit[1 + level_index()]) return undefined;
  const obj: any = {};
  obj.type = type;
  obj.collideable = true;
  obj.solids = true;

  obj.spr = type.tile;
  obj.flip = { x: false, y: false };

  obj.x = x;
  obj.y = y;
  obj.hitbox = { x: 0, y: 0, w: 8, h: 8 };

  obj.spd = { x: 0, y: 0 };
  obj.rem = { x: 0, y: 0 };

  obj.is_solid = (ox: number, oy: number) => {
    if (oy > 0 && !obj.check(platform, ox, 0) && obj.check(platform, ox, oy)) return true;
    return (
      solid_at(obj.x + obj.hitbox.x + ox, obj.y + obj.hitbox.y + oy, obj.hitbox.w, obj.hitbox.h) ||
      obj.check(fall_floor, ox, oy) ||
      obj.check(fake_wall, ox, oy)
    );
  };

  obj.is_ice = (ox: number, oy: number) =>
    ice_at(obj.x + obj.hitbox.x + ox, obj.y + obj.hitbox.y + oy, obj.hitbox.w, obj.hitbox.h);

  obj.collide = (type: any, ox: number, oy: number) => {
    const n = objects.length;
    for (let i = 0; i < n; i++) {
      const other = objects[i];
      if (
        other != null &&
        other.type === type &&
        other !== obj &&
        other.collideable &&
        other.x + other.hitbox.x + other.hitbox.w > obj.x + obj.hitbox.x + ox &&
        other.y + other.hitbox.y + other.hitbox.h > obj.y + obj.hitbox.y + oy &&
        other.x + other.hitbox.x < obj.x + obj.hitbox.x + obj.hitbox.w + ox &&
        other.y + other.hitbox.y < obj.y + obj.hitbox.y + obj.hitbox.h + oy
      ) {
        return other;
      }
    }
    return null;
  };

  obj.check = (type: any, ox: number, oy: number) => obj.collide(type, ox, oy) != null;

  obj.move = (ox: number, oy: number) => {
    let amount;
    // [x]
    obj.rem.x += ox;
    amount = flr(obj.rem.x + 0.5);
    obj.rem.x -= amount;
    obj.move_x(amount, 0);

    // [y]
    obj.rem.y += oy;
    amount = flr(obj.rem.y + 0.5);
    obj.rem.y -= amount;
    obj.move_y(amount);
  };

  obj.move_x = (amount: number, start: number) => {
    if (obj.solids) {
      const step = sign(amount);
      for (let i = start; i <= abs(amount); i++) {
        if (!obj.is_solid(step, 0)) {
          obj.x += step;
        } else {
          obj.spd.x = 0;
          obj.rem.x = 0;
          break;
        }
      }
    } else {
      obj.x += amount;
    }
  };

  obj.move_y = (amount: number) => {
    if (obj.solids) {
      const step = sign(amount);
      for (let i = 0; i <= abs(amount); i++) {
        if (!obj.is_solid(0, step)) {
          obj.y += step;
        } else {
          obj.spd.y = 0;
          obj.rem.y = 0;
          break;
        }
      }
    } else {
      obj.y += amount;
    }
  };

  objects.push(obj);
  if (obj.type.init !== undefined) obj.type.init(obj);
  return obj;
}

function destroy_object(obj: any) {
  const i = objects.indexOf(obj);
  if (i >= 0) objects.splice(i, 1);
  obj.dead = true;
}

function kill_player(obj: any) {
  sfx_timer = 12;
  sfx(0);
  deaths += 1;
  shake = 10;
  destroy_object(obj);
  dead_particles = [];
  for (let dir = 0; dir <= 7; dir++) {
    const angle = dir / 8;
    dead_particles.push({
      x: obj.x + 4,
      y: obj.y + 4,
      t: 10,
      spd: { x: sin(angle) * 3, y: cos(angle) * 3 },
    });
    restart_room();
  }
}

// funciones de sala
function restart_room() {
  will_restart = true;
  delay_restart = 15;
}

function next_room() {
  if (room.x === 2 && room.y === 1) music(30, 500, 7);
  else if (room.x === 3 && room.y === 1) music(20, 500, 7);
  else if (room.x === 4 && room.y === 2) music(30, 500, 7);
  else if (room.x === 5 && room.y === 3) music(30, 500, 7);

  if (room.x === 7) load_room(0, room.y + 1);
  else load_room(room.x + 1, room.y);
}

function load_room(x: number, y: number) {
  has_dashed = false;
  has_key = false;

  // eliminar objetos existentes
  for (const o of objects.slice()) destroy_object(o);

  room.x = x;
  room.y = y;

  // entidades
  for (let tx = 0; tx <= 15; tx++) {
    for (let ty = 0; ty <= 15; ty++) {
      const tile = mget(room.x * 16 + tx, room.y * 16 + ty);
      if (tile === 11) {
        init_object(platform, tx * 8, ty * 8).dir = -1;
      } else if (tile === 12) {
        init_object(platform, tx * 8, ty * 8).dir = 1;
      } else {
        for (const type of types) {
          if (type.tile === tile) init_object(type, tx * 8, ty * 8);
        }
      }
    }
  }

  if (!is_title()) init_object(room_title, 0, 0);
}

// actualizacion
function _update() {
  frames = (frames + 1) % 30;
  if (frames === 0 && level_index() < 30) {
    seconds = (seconds + 1) % 60;
    if (seconds === 0) minutes += 1;
  }

  if (music_timer > 0) {
    music_timer -= 1;
    if (music_timer <= 0) music(10, 0, 7);
  }

  if (sfx_timer > 0) sfx_timer -= 1;

  // cancelar si hay freeze
  if (freeze > 0) {
    freeze -= 1;
    return;
  }

  // temblor de pantalla
  if (shake > 0) {
    shake -= 1;
    camera();
    if (shake > 0) camera(-2 + rnd(5), -2 + rnd(5));
  }

  // reiniciar (pronto)
  if (will_restart && delay_restart > 0) {
    delay_restart -= 1;
    if (delay_restart <= 0) {
      will_restart = false;
      load_room(room.x, room.y);
    }
  }

  // actualizar cada objeto
  for (const obj of objects.slice()) {
    if (obj.dead) continue;
    obj.move(obj.spd.x, obj.spd.y);
    if (obj.type.update !== undefined) obj.type.update(obj);
  }

  // empezar juego
  if (is_title()) {
    if (!start_game && (btn(k_jump) || btn(k_dash))) {
      music(-1);
      start_game_flash = 50;
      start_game = true;
      sfx(38);
    }
    if (start_game) {
      start_game_flash -= 1;
      if (start_game_flash <= -30) begin_game();
    }
  }
}

// dibujo
function _draw() {
  if (freeze > 0) return;

  // restablecer paleta
  pal();

  // destello al empezar
  if (start_game) {
    let c = 10;
    if (start_game_flash > 10) {
      if (frames % 10 < 5) c = 7;
    } else if (start_game_flash > 5) {
      c = 2;
    } else if (start_game_flash > 0) {
      c = 1;
    } else {
      c = 0;
    }
    if (c < 10) {
      pal(6, c);
      pal(12, c);
      pal(13, c);
      pal(5, c);
      pal(1, c);
      pal(7, c);
    }
  }

  // limpiar pantalla
  let bg_col = 0;
  if (flash_bg) bg_col = frames / 5;
  else if (new_bg !== undefined) bg_col = 2;
  rectfill(0, 0, 128, 128, bg_col);

  // nubes
  if (!is_title()) {
    for (const c of clouds) {
      c.x += c.spd;
      rectfill(c.x, c.y, c.x + c.w, c.y + 4 + (1 - c.w / 64) * 12, new_bg !== undefined ? 14 : 1);
      if (c.x > 128) {
        c.x = -c.w;
        c.y = rnd(128 - 8);
      }
    }
  }

  // terreno de fondo
  map(room.x * 16, room.y * 16, 0, 0, 16, 16, 4);

  // plataformas / cofre grande
  for (const o of objects.slice()) {
    if (o.type === platform || o.type === big_chest) draw_object(o);
  }

  // terreno
  const off = is_title() ? -4 : 0;
  map(room.x * 16, room.y * 16, off, 0, 16, 16, 2);

  // objetos
  for (const o of objects.slice()) {
    if (o.type !== platform && o.type !== big_chest) draw_object(o);
  }

  // terreno frontal
  map(room.x * 16, room.y * 16, 0, 0, 16, 16, 8);

  // particulas
  for (const p of particles) {
    p.x += p.spd;
    p.y += sin(p.off);
    p.off += min(0.05, p.spd / 32);
    rectfill(p.x, p.y, p.x + p.s, p.y + p.s, p.c);
    if (p.x > 128 + 4) {
      p.x = -4;
      p.y = rnd(128);
    }
  }

  // particulas de muerte
  for (const p of dead_particles.slice()) {
    p.x += p.spd.x;
    p.y += p.spd.y;
    p.t -= 1;
    if (p.t <= 0) {
      const i = dead_particles.indexOf(p);
      if (i >= 0) dead_particles.splice(i, 1);
    }
    rectfill(p.x - p.t / 5, p.y - p.t / 5, p.x + p.t / 5, p.y + p.t / 5, 14 + mod(p.t, 2));
  }

  // dibujar fuera de la pantalla para el temblor
  rectfill(-5, -5, -1, 133, 0);
  rectfill(-5, -5, 133, -1, 0);
  rectfill(-5, 128, 133, 133, 0);
  rectfill(128, -5, 133, 133, 0);

  // creditos
  if (is_title()) {
    print('x+c', 58, 80, 5);
    print('matt thorson', 42, 96, 5);
    print('noel berry', 46, 102, 5);
  }

  if (level_index() === 30) {
    let p;
    for (let i = 0; i < objects.length; i++) {
      if (objects[i].type === player) {
        p = objects[i];
        break;
      }
    }
    if (p !== undefined) {
      const diff = min(24, 40 - abs(p.x + 4 - 64));
      rectfill(0, 0, diff, 128, 0);
      rectfill(128 - diff, 0, 128, 128, 0);
    }
  }
}

function draw_object(obj: any) {
  if (obj.type.draw !== undefined) obj.type.draw(obj);
  else if (obj.spr > 0) spr(obj.spr, obj.x, obj.y, 1, 1, obj.flip.x, obj.flip.y);
}

function draw_time(x: number, y: number) {
  const s = seconds;
  const m = minutes % 60;
  const h = flr(minutes / 60);

  rectfill(x, y, x + 32, y + 6, 0);
  print(
    (h < 10 ? '0' + h : h) + ':' + (m < 10 ? '0' + m : m) + ':' + (s < 10 ? '0' + s : s),
    x + 1,
    y + 1,
    7
  );
}

// funciones auxiliares
function clamp(val: number, a: number, b: number) {
  return max(a, min(b, val));
}
function appr(val: number, target: number, amount: number) {
  return val > target ? max(val - amount, target) : min(val + amount, target);
}
function sign(v: number) {
  return v > 0 ? 1 : v < 0 ? -1 : 0;
}
function maybe() {
  return rnd(1) < 0.5;
}
function solid_at(x: number, y: number, w: number, h: number) {
  return tile_flag_at(x, y, w, h, 0);
}
function ice_at(x: number, y: number, w: number, h: number) {
  return tile_flag_at(x, y, w, h, 4);
}
function tile_flag_at(x: number, y: number, w: number, h: number, flag: number) {
  for (let i = max(0, flr(x / 8)); i <= min(15, (x + w - 1) / 8); i++) {
    for (let j = max(0, flr(y / 8)); j <= min(15, (y + h - 1) / 8); j++) {
      if (fget(tile_at(i, j), flag)) return true;
    }
  }
  return false;
}
function tile_at(x: number, y: number) {
  return mget(room.x * 16 + x, room.y * 16 + y);
}
function spikes_at(x: number, y: number, w: number, h: number, xspd: number, yspd: number) {
  for (let i = max(0, flr(x / 8)); i <= min(15, (x + w - 1) / 8); i++) {
    for (let j = max(0, flr(y / 8)); j <= min(15, (y + h - 1) / 8); j++) {
      const tile = tile_at(i, j);
      if (tile === 17 && (mod(y + h - 1, 8) >= 6 || y + h === j * 8 + 8) && yspd >= 0) return true;
      else if (tile === 27 && mod(y, 8) <= 2 && yspd <= 0) return true;
      else if (tile === 43 && mod(x, 8) <= 2 && xspd <= 0) return true;
      else if (tile === 59 && (mod(x + w - 1, 8) >= 6 || x + w === i * 8 + 8) && xspd >= 0) return true;
    }
  }
  return false;
}

/* ------------------------------------------------------------------ */
/* Bucle principal y entrada                                           */
/* ------------------------------------------------------------------ */

export interface GameHandle {
  stop: () => void;
  setButton: (i: number, down: boolean) => void;
  setMuted: (m: boolean) => void;
  resumeAudio: () => void;
}

const KEYMAP: Record<string, number> = {
  ArrowLeft: 0, ArrowRight: 1, ArrowUp: 2, ArrowDown: 3,
  KeyA: 0, KeyD: 1, KeyW: 2, KeyS: 3,
  KeyZ: 4, KeyC: 4, KeyN: 4, KeyY: 4,
  KeyX: 5, KeyV: 5, KeyM: 5,
};

export function createGame(canvas: HTMLCanvasElement): GameHandle {
  const ctx = canvas.getContext('2d')!;
  canvas.width = 128;
  canvas.height = 128;
  const img = ctx.createImageData(128, 128);
  const px = new Uint32Array(img.data.buffer);

  // estado inicial
  objects = [];
  title_screen();

  const onKeyDown = (e: KeyboardEvent) => {
    const b = KEYMAP[e.code];
    if (b !== undefined) {
      keys[b] = true;
      audio.resume();
      e.preventDefault();
    }
  };
  const onKeyUp = (e: KeyboardEvent) => {
    const b = KEYMAP[e.code];
    if (b !== undefined) {
      keys[b] = false;
      e.preventDefault();
    }
  };
  const onBlur = () => {
    for (let i = 0; i < 6; i++) keys[i] = false;
  };
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', onBlur);
  const onPointer = () => audio.resume();
  window.addEventListener('pointerdown', onPointer);

  const STEP = 1000 / 30;
  let last = performance.now();
  let acc = 0;
  let raf = 0;
  let running = true;

  const blit = () => {
    for (let i = 0; i < 128 * 128; i++) px[i] = PAL32[fb[i]];
    ctx.putImageData(img, 0, 0);
  };

  const frame = (t: number) => {
    if (!running) return;
    acc += t - last;
    last = t;
    if (acc > 250) acc = 250;
    let drew = false;
    while (acc >= STEP) {
      _update();
      _draw();
      drew = true;
      acc -= STEP;
    }
    if (drew) blit();
    raf = requestAnimationFrame(frame);
  };
  _draw();
  blit();
  raf = requestAnimationFrame(frame);

  return {
    stop() {
      running = false;
      cancelAnimationFrame(raf);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('pointerdown', onPointer);
      audio.music(-1);
    },
    setButton(i: number, down: boolean) {
      keys[i] = down;
      if (down) audio.resume();
    },
    setMuted(m: boolean) {
      audio.setMuted(m);
    },
    resumeAudio() {
      audio.resume();
    },
  };
}
