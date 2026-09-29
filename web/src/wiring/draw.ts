// Wiring diagrams: two boards (programmer and target) placed side by side or
// stacked, turned so their ISP pins face each other, joined by jumper wires.

import { boardName, SIGNALS, type Board, type Pin, type Shape, type Signal } from './boards';
import { t } from '../i18n';
import { route } from './route';

export type Orientation = 'horizontal' | 'vertical';

export interface Connection {
  signal: Signal;
  from: Pin; // on the programmer
  to: Pin; // on the target
  /** tag text instead of the signal name */
  tag?: string;
  /** a jumper holding the target's RESET at GND: from a spare GND pin, or a
   * Y cable sharing the GND wire's pin */
  jumper?: 'spare' | 'y';
}

type Rot = 0 | 90 | 180 | 270;
type Pt = [number, number];

const GAP = 24; // mm between the boards
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const f = (n: number) => +n.toFixed(2);

/** Which pin of each board carries each signal. A signal missing on either side is left out. */
export function connections(programmer: Board, target: Board): Connection[] {
  const out: Connection[] = [];
  for (const signal of SIGNALS) {
    const from = programmer.pins.filter((p) => p.programmer === signal);
    const to = target.pins.filter((p) => p.target === signal);
    if (from.length && to.length) out.push({ signal, from: from[0], to: to[0] });
  }
  return out;
}

// --- geometry -----------------------------------------------------------------

function rotate([x, y]: Pt, r: Rot): Pt {
  switch (r) {
    case 90: return [-y, x];
    case 180: return [-x, -y];
    case 270: return [y, -x];
    default: return [x, y];
  }
}

/** Everything a board occupies, in its own coordinates. */
function extent(b: Board): Pt[] {
  const pts: Pt[] = [...b.outline];
  for (const s of b.shapes) pts.push([s.x, s.y], [s.x + s.w, s.y + s.h]);
  for (const p of b.pins) pts.push([p.x, p.y]);
  return pts;
}

interface Placed {
  board: Board;
  rot: Rot;
  dx: number;
  dy: number;
  /** board coordinates to drawing coordinates */
  at(p: Pt): Pt;
  box: { x0: number; y0: number; x1: number; y1: number };
}

function place(board: Board, rot: Rot, dx = 0, dy = 0): Placed {
  const r = extent(board).map((p) => rotate(p, rot));
  const x0 = Math.min(...r.map((p) => p[0]));
  const y0 = Math.min(...r.map((p) => p[1]));
  const x1 = Math.max(...r.map((p) => p[0]));
  const y1 = Math.max(...r.map((p) => p[1]));
  const at = (p: Pt): Pt => {
    const [x, y] = rotate(p, rot);
    return [x - x0 + dx, y - y0 + dy];
  };
  return { board, rot, dx: dx - x0, dy: dy - y0, at, box: { x0: dx, y0: dy, x1: x1 - x0 + dx, y1: y1 - y0 + dy } };
}

/** Try all rotations of both boards and both sides, keep the layout with the
 * shortest wires. Turning a board costs in proportion to its size, so big
 * boards stay the way people usually hold them. */
function layouts(prog: Board, tgt: Board, links: Connection[], orientation: Orientation): { score: number; placed: [Placed, Placed] }[] {
  const rots: Rot[] = [0, 90, 180, 270];
  const all: { score: number; placed: [Placed, Placed] }[] = [];
  const horizontal = orientation === 'horizontal';
  const sizeOf = (b: Board) => {
    const e = extent(b);
    return Math.max(...e.map((p) => p[0])) - Math.min(...e.map((p) => p[0])) + Math.max(...e.map((p) => p[1])) - Math.min(...e.map((p) => p[1]));
  };
  const turnCost = (b: Board, r: Rot) => (r ? (b.upright ? 1e6 : 0.25 * sizeOf(b)) : 0);
  for (const swap of [false, true]) {
    // first board goes left (or on top); the programmer normally
    const [firstB, secondB] = swap ? [tgt, prog] : [prog, tgt];
    const firstPins = links.map((l) => (swap ? l.to : l.from));
    const secondPins = links.map((l) => (swap ? l.from : l.to));
    for (const r1 of rots) {
      for (const r2 of rots) {
        const a = place(firstB, r1);
        const b0 = place(secondB, r2);
        // slide the second board along the gap so that the most wires run
        // straight across; ties go to the smallest total offset
        const axis = horizontal ? 1 : 0;
        const va = firstPins.map((p) => a.at([p.x, p.y])[axis]);
        const vb = secondPins.map((p) => b0.at([p.x, p.y])[axis]);
        let shift = 0;
        let bestFit = -Infinity;
        for (let i = 0; i < va.length; i++) {
          const d = va[i] - vb[i];
          const straight = va.filter((v, j) => Math.abs(v - vb[j] - d) < 0.05).length;
          const spread = va.reduce((s, v, j) => s + Math.abs(v - vb[j] - d), 0);
          const fit = straight * 1000 - spread;
          if (fit > bestFit) {
            bestFit = fit;
            shift = d;
          }
        }
        const b = horizontal
          ? place(secondB, r2, a.box.x1 + GAP, shift)
          : place(secondB, r2, shift, a.box.y1 + GAP);
        let score = turnCost(firstB, r1) + turnCost(secondB, r2) + (swap ? 1 : 0);
        firstPins.forEach((p, i) => {
          const [ax, ay] = a.at([p.x, p.y]);
          const [bx, by] = b.at([secondPins[i].x, secondPins[i].y]);
          score += Math.hypot(bx - ax, by - ay);
          // pins far from the edge facing the other board mean wires across the board
          score += horizontal ? (a.box.x1 - ax) + (bx - b.box.x0) : (a.box.y1 - ay) + (by - b.box.y0);
        });
        all.push({ score, placed: swap ? [b, a] : [a, b] });
      }
    }
  }
  return all.sort((x, y) => x.score - y.score);
}

// --- drawing --------------------------------------------------------------------

function shapeSvg(s: Shape): string {
  const c = [s.x + s.w / 2, s.y + s.h / 2];
  const t = s.rot ? ` transform="rotate(${s.rot} ${f(c[0])} ${f(c[1])})"` : '';
  const r = (cls: string, x = s.x, y = s.y, w = s.w, h = s.h, rx = 0.4) =>
    `<rect class="${cls}" x="${f(x)}" y="${f(y)}" width="${f(w)}" height="${f(h)}" rx="${rx}"${t}/>`;
  switch (s.kind) {
    case 'usb':
      return r('wd-usb') + r('wd-usb-in', s.x + s.w * 0.12, s.y + s.h * 0.2, s.w * 0.6, s.h * 0.6, 0.2);
    case 'fingers':
      return [0, 1, 2, 3].map((i) => r('wd-finger', s.x, s.y + i * (s.h / 4) + 0.35, s.w, s.h / 4 - 0.7, 0.2)).join('');
    case 'chip': {
      const n = s.notch;
      const notch = n
        ? `<circle class="wd-notch" cx="${f(n === 'left' ? s.x : n === 'right' ? s.x + s.w : c[0])}" cy="${f(n === 'top' ? s.y : n === 'bottom' ? s.y + s.h : c[1])}" r="0.7"${t}/>`
        : '';
      return r('wd-chip') + notch;
    }
    case 'reg':
      return r('wd-reg');
    case 'jack':
      return r('wd-jack');
    case 'button':
      return r('wd-button') + `<circle class="wd-button-cap" cx="${f(c[0])}" cy="${f(c[1])}" r="${f(Math.min(s.w, s.h) * 0.3)}"/>`;
    case 'header':
      return r('wd-header', s.x, s.y, s.w, s.h, 0.3);
    case 'led':
      return r('wd-led', s.x, s.y, s.w, s.h, 0.3);
  }
}

/** Text is drawn upright in drawing coordinates, whatever the board rotation. */
function text(x: number, y: number, s: string, cls: string, anchor = 'middle') {
  return `<text class="${cls}" x="${f(x)}" y="${f(y)}" text-anchor="${anchor}" dominant-baseline="central">${esc(s)}</text>`;
}

const SIDE: Record<NonNullable<Pin['side']>, Pt> = { left: [-1, 0], right: [1, 0], up: [0, -1], down: [0, 1] };

/** The board itself, and its text (drawn later, on top of the wires). k scales text for big drawings. */
/** The board's name with its role, so two boards of the same kind can be told apart. */
function titled(b: Board, role: 'programmer' | 'target'): string {
  return `${boardName(b)} · ${t(role === 'programmer' ? 'role.programmer' : 'role.target')}`;
}

/** Does the axis-aligned segment p-q pass through the box? */
function segHitsBox(p: Pt, q: Pt, x0: number, y0: number, x1: number, y1: number): boolean {
  return Math.max(p[0], q[0]) >= x0 && Math.min(p[0], q[0]) <= x1 && Math.max(p[1], q[1]) >= y0 && Math.min(p[1], q[1]) <= y1;
}

function boardSvg(pl: Placed, role: 'programmer' | 'target', used: Set<Pin>, k: number, wirePaths: Pt[][], highlight?: Signal): [string, string] {
  const b = pl.board;
  const g = `<g transform="translate(${f(pl.dx)} ${f(pl.dy)}) rotate(${pl.rot})">`;
  const outline = `<polygon class="wd-pcb" style="fill:${b.color}" points="${b.outline.map((p) => p.join(',')).join(' ')}"/>`;
  const shapes = b.shapes.map(shapeSvg).join('');
  const pins = b.pins.map((p) => {
    const sig = role === 'programmer' ? p.programmer : p.target;
    const cls = `wd-pin${used.has(p) ? ' used' : ''}${sig && sig === highlight ? ' hl' : ''}`;
    return p.first
      ? `<rect class="${cls}" x="${f(p.x - 0.75)}" y="${f(p.y - 0.75)}" width="1.5" height="1.5"/>`
      : `<circle class="${cls}" cx="${f(p.x)}" cy="${f(p.y)}" r="0.75"/>`;
  }).join('');
  let labels = '';
  for (const p of b.pins) {
    const [x, y] = pl.at([p.x, p.y]);
    const dir = rotate(SIDE[p.side ?? 'up'], pl.rot);
    const lx = x + dir[0] * (1 + 0.8 * k);
    const ly = y + dir[1] * (1 + 0.8 * k);
    const anchor = dir[0] > 0.5 ? 'start' : dir[0] < -0.5 ? 'end' : 'middle';
    labels += text(lx, ly, p.label, `wd-label${used.has(p) ? ' used' : ''}`, anchor);
  }
  for (const s of b.shapes) {
    const label = s.labelKey ? t(s.labelKey) : s.label;
    if (!label) continue;
    const [x, y] = pl.at([s.x + s.w / 2, s.y + s.h / 2]);
    labels += text(x, y, label, s.kind === 'header' ? 'wd-shape-label wd-header-label' : 'wd-shape-label');
  }
  // the name goes above the board, or below it if a wire runs through that spot
  const nx = (pl.box.x0 + pl.box.x1) / 2;
  const name = titled(b, role);
  const half = (name.length * 0.6 * 2.4 * k) / 2;
  const clear = (y: number) => !wirePaths.some((path) => path.some((q, i) => i > 0 && segHitsBox(path[i - 1], q, nx - half, y - 1.5 * k, nx + half, y + 1.5 * k)));
  const above = pl.box.y0 - 1.5 - 1.5 * k;
  const below = pl.box.y1 + 1.5 + 1.5 * k;
  labels += text(nx, clear(above) || !clear(below) ? above : below, name, 'wd-name');
  return [`${g}${outline}${shapes}${pins}</g>`, labels];
}

export interface Diagram {
  svg: string;
  links: Connection[];
  /** signals the target needs that the boards can't connect */
  missing: Signal[];
  /** wire crossings left in the drawing */
  crossings: number;
  /** the reset jumper drawn, if any */
  jumper?: 'spare' | 'y';
}

/** With RESET not driven by the programmer and no reset button on the target,
 * a jumper holds the target's RESET at GND: from a spare GND pin of the
 * programmer if it has one, else as a Y cable from the GND wire's pin. */
function resetJumper(prog: Board, tgt: Board, links: Connection[]): Connection | null {
  const rst = tgt.pins.find((p) => p.target === 'RESET');
  if (!rst || tgt.resetButton) return null;
  const spare = prog.pins.find((p) => p.spareGnd);
  const gnd = links.find((l) => l.signal === 'GND')?.from;
  if (spare) return { signal: 'GND', from: spare, to: rst, tag: 'RST→GND', jumper: 'spare' };
  if (gnd) return { signal: 'GND', from: gnd, to: rst, tag: 'RST→GND', jumper: 'y' };
  return null;
}

/** omit: signals not wired (e.g. RESET when the user holds the target's reset) */
export function drawWiring(prog: Board, tgt: Board, orientation: Orientation, highlight?: Signal, omit: Signal[] = []): Diagram {
  const links = connections(prog, tgt).filter((l) => !omit.includes(l.signal));
  const jumper = omit.includes('RESET') ? resetJumper(prog, tgt, links) : null;
  if (jumper) links.push(jumper);
  const missing = SIGNALS.filter((s) => !omit.includes(s) && !links.some((l) => l.signal === s));
  const horizontal = orientation === 'horizontal';
  const scale = (a: Placed, b: Placed) => {
    // text and wires grow with the drawing, so they stay readable when it is scaled down
    const size = Math.max(a.box.x1, b.box.x1) - Math.min(a.box.x0, b.box.x0);
    return Math.min(Math.max(size / 100, 1), 2.4);
  };

  // route the most promising layouts; a crossing costs as much as 25 mm of wire
  let best: { cost: number; a: Placed; b: Placed; k: number; paths: Pt[][]; crossings: number } | null = null;
  for (const cand of layouts(prog, tgt, links, orientation).slice(0, 12)) {
    const [a, b] = cand.placed;
    const k = scale(a, b);
    const aFirst = horizontal ? a.box.x0 <= b.box.x0 : a.box.y0 <= b.box.y0;
    const [first, second] = aFirst ? [a, b] : [b, a];
    const pinsOf = (pl: Placed) => pl.board.pins.map((p) => pl.at([p.x, p.y]));
    const ends = links.map((l) => {
      const pa = a.at([l.from.x, l.from.y]);
      const pb = b.at([l.to.x, l.to.y]);
      return aFirst ? { a: pa, b: pb } : { a: pb, b: pa };
    });
    const r = route(ends, first.box, second.box, pinsOf(first), pinsOf(second), horizontal, k);
    // paths run from the programmer to the target
    const paths = aFirst ? r.paths : r.paths.map((p) => [...p].reverse());
    const length = paths.reduce((s, p) => s + p.slice(1).reduce((t, q, i) => t + Math.abs(q[0] - p[i][0]) + Math.abs(q[1] - p[i][1]), 0), 0);
    const cost = cand.score + 6 * r.crossings + 0.3 * length;
    if (!best || cost < best.cost) best = { cost, a, b, k, paths, crossings: r.crossings };
  }
  const { a, b, k, paths, crossings } = best!;

  let wires = '';
  let tags = '';
  const pts: Pt[] = paths.flat();
  const placedTags: { x: number; y: number; w: number; h: number }[] = [];
  links.forEach((l, i) => {
    const path = paths[i];
    const d = 'M' + path.map((p) => `${f(p[0])},${f(p[1])}`).join(' L');
    const dim = highlight && l.signal !== highlight ? ' dim' : '';
    const cls = `wd-wire w-${l.signal}${dim}${l.signal === highlight ? ' hl' : ''}`;
    const p0 = path[0];
    const p3 = path[path.length - 1];
    wires += `<path class="wd-wire-under" d="${d}"/><path class="${cls}" d="${d}"/>` +
      `<circle class="wd-end w-${l.signal}" cx="${f(p0[0])}" cy="${f(p0[1])}" r="0.9"/>` +
      `<circle class="wd-end w-${l.signal}" cx="${f(p3[0])}" cy="${f(p3[1])}" r="0.9"/>`;

    // name tag on the wire: longest segments first, sliding along each until
    // it clears the tags placed so far
    const label = l.tag ?? l.signal;
    const w = (label.length * 1.05 + 1.6) * k;
    const h = 2.5 * k;
    const segs = path.slice(1).map((q, j) => [path[j], q] as [Pt, Pt])
      .sort((u, v) => Math.hypot(v[1][0] - v[0][0], v[1][1] - v[0][1]) - Math.hypot(u[1][0] - u[0][0], u[1][1] - u[0][1]));
    const free = ([x, y]: Pt) => placedTags.every((q) => Math.abs(q.x - x) > (q.w + w) / 2 + 0.3 * k || Math.abs(q.y - y) > (q.h + h) / 2 + 0.3 * k);
    const tries = [0.5, 0.35, 0.65, 0.2, 0.8, 0.1, 0.9];
    const spots = segs.flatMap(([s0, s1]) => tries.map((t): Pt => [s0[0] + (s1[0] - s0[0]) * t, s0[1] + (s1[1] - s0[1]) * t]));
    const [tx, ty] = spots.find(free) ?? spots[0];
    placedTags.push({ x: tx, y: ty, w, h });
    tags += `<g class="wd-tag w-${l.signal}${dim}">` +
      `<rect x="${f(tx - w / 2)}" y="${f(ty - h / 2)}" width="${f(w)}" height="${f(h)}" rx="${f(h / 2)}"/>` +
      text(tx, ty, label, 'wd-tag-text') + '</g>';
  });

  const used = new Set(links.flatMap((l) => [l.from, l.to]));
  // board names are centered above each board and may be wider than it
  const nameHalf = (pl: Placed) => titled(pl.board, pl === a ? 'programmer' : 'target').length * 0.6 * 2.4 * k / 2;
  for (const pl of [a, b]) {
    const cx = (pl.box.x0 + pl.box.x1) / 2;
    pts.push([cx - nameHalf(pl), pl.box.y0 - 3 * k], [cx + nameHalf(pl), pl.box.y1 + 3 * k]);
  }
  const x0 = Math.min(a.box.x0, b.box.x0, ...pts.map((p) => p[0])) - 10 * k;
  const y0 = Math.min(a.box.y0, b.box.y0, ...pts.map((p) => p[1])) - 3 * k;
  const x1 = Math.max(a.box.x1, b.box.x1, ...pts.map((p) => p[0])) + 10 * k;
  const y1 = Math.max(a.box.y1, b.box.y1, ...pts.map((p) => p[1])) + 3 * k;
  const [aShapes, aText] = boardSvg(a, 'programmer', used, k, paths, highlight);
  const [bShapes, bText] = boardSvg(b, 'target', used, k, paths, highlight);
  const svg =
    `<svg class="wiring" xmlns="http://www.w3.org/2000/svg" viewBox="${f(x0)} ${f(y0)} ${f(x1 - x0)} ${f(y1 - y0)}" role="img" ` +
    `aria-label="${esc(boardName(prog))} → ${esc(boardName(tgt))}" style="--k:${f(k)}">` +
    aShapes + bShapes + wires + aText + bText + tags + '</svg>';
  return { svg, links, missing, crossings, jumper: jumper?.jumper };
}
