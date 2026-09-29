// Wiring diagrams: two boards (programmer and target) placed side by side or
// stacked, turned so their ISP pins face each other, joined by jumper wires.

import { SIGNALS, type Board, type Pin, type Shape, type Signal } from './boards';

export type Orientation = 'horizontal' | 'vertical';

export interface Connection {
  signal: Signal;
  from: Pin; // on the programmer
  to: Pin; // on the target
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
function layout(prog: Board, tgt: Board, links: Connection[], orientation: Orientation): [Placed, Placed] {
  const rots: Rot[] = [0, 90, 180, 270];
  let best: { score: number; placed: [Placed, Placed] } | null = null;
  const horizontal = orientation === 'horizontal';
  const sizeOf = (b: Board) => {
    const e = extent(b);
    return Math.max(...e.map((p) => p[0])) - Math.min(...e.map((p) => p[0])) + Math.max(...e.map((p) => p[1])) - Math.min(...e.map((p) => p[1]));
  };
  const turnCost = (b: Board, r: Rot) => (r ? (b.upright ? 1e6 : 0.12 * sizeOf(b)) : 0);
  for (const swap of [false, true]) {
    // first board goes left (or on top); the programmer normally
    const [firstB, secondB] = swap ? [tgt, prog] : [prog, tgt];
    const firstPins = links.map((l) => (swap ? l.to : l.from));
    const secondPins = links.map((l) => (swap ? l.from : l.to));
    for (const r1 of rots) {
      for (const r2 of rots) {
        const a = place(firstB, r1);
        const b0 = place(secondB, r2);
        const mean = (pl: Placed, pins: Pin[], axis: 0 | 1) =>
          pins.reduce((s, p) => s + pl.at([p.x, p.y])[axis], 0) / Math.max(pins.length, 1);
        // line the pin groups up across the gap
        const b = horizontal
          ? place(secondB, r2, a.box.x1 + GAP, mean(a, firstPins, 1) - mean(b0, secondPins, 1))
          : place(secondB, r2, mean(a, firstPins, 0) - mean(b0, secondPins, 0), a.box.y1 + GAP);
        let score = turnCost(firstB, r1) + turnCost(secondB, r2) + (swap ? 1 : 0);
        firstPins.forEach((p, i) => {
          const [ax, ay] = a.at([p.x, p.y]);
          const [bx, by] = b.at([secondPins[i].x, secondPins[i].y]);
          score += Math.hypot(bx - ax, by - ay);
          // pins far from the edge facing the other board mean wires across the board
          score += horizontal ? (a.box.x1 - ax) + (bx - b.box.x0) : (a.box.y1 - ay) + (by - b.box.y0);
        });
        if (!best || score < best.score) best = { score, placed: swap ? [b, a] : [a, b] };
      }
    }
  }
  return best!.placed;
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
function boardSvg(pl: Placed, role: 'programmer' | 'target', used: Set<Pin>, k: number, highlight?: Signal): [string, string] {
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
    if (!s.label) continue;
    const [x, y] = pl.at([s.x + s.w / 2, s.y + s.h / 2]);
    labels += text(x, y, s.label, s.kind === 'header' ? 'wd-shape-label wd-header-label' : 'wd-shape-label');
  }
  const [nx, ny] = [(pl.box.x0 + pl.box.x1) / 2, pl.box.y0 - 1.5 - 1.5 * k];
  labels += text(nx, ny, b.name, 'wd-name');
  return [`${g}${outline}${shapes}${pins}</g>`, labels];
}

export interface Diagram {
  svg: string;
  links: Connection[];
  /** signals the target needs that the boards can't connect */
  missing: Signal[];
}

export function drawWiring(prog: Board, tgt: Board, orientation: Orientation, highlight?: Signal): Diagram {
  const links = connections(prog, tgt);
  const missing = SIGNALS.filter((s) => !links.some((l) => l.signal === s));
  const [a, b] = layout(prog, tgt, links, orientation);
  const horizontal = orientation === 'horizontal';
  // text and wires grow with the drawing, so they stay readable when it is scaled down
  const size = Math.max(a.box.x1, b.box.x1) - Math.min(a.box.x0, b.box.x0);
  const k = Math.min(Math.max(size / 100, 1), 2.4);

  // jumper wires: leave each pin towards the other board, then curve across
  let wires = '';
  let tags = '';
  const pts: Pt[] = [];
  const placedTags: { x: number; y: number; w: number }[] = [];
  links.forEach((l, i) => {
    const p0 = a.at([l.from.x, l.from.y]);
    const p3 = b.at([l.to.x, l.to.y]);
    const span = horizontal ? Math.abs(p3[0] - p0[0]) : Math.abs(p3[1] - p0[1]);
    const reach = Math.max(8, span * 0.45);
    // the programmer may sit on either side of the target
    const s = horizontal ? Math.sign(b.box.x0 - a.box.x0) || 1 : Math.sign(b.box.y0 - a.box.y0) || 1;
    const p1: Pt = horizontal ? [p0[0] + s * reach, p0[1]] : [p0[0], p0[1] + s * reach];
    const p2: Pt = horizontal ? [p3[0] - s * reach, p3[1]] : [p3[0], p3[1] - s * reach];
    const d = `M${f(p0[0])},${f(p0[1])} C${f(p1[0])},${f(p1[1])} ${f(p2[0])},${f(p2[1])} ${f(p3[0])},${f(p3[1])}`;
    const cls = `wd-wire w-${l.signal}${highlight && l.signal !== highlight ? ' dim' : ''}${l.signal === highlight ? ' hl' : ''}`;
    wires += `<path class="wd-wire-under" d="${d}"/><path class="${cls}" d="${d}"/>` +
      `<circle class="wd-end w-${l.signal}" cx="${f(p0[0])}" cy="${f(p0[1])}" r="0.9"/>` +
      `<circle class="wd-end w-${l.signal}" cx="${f(p3[0])}" cy="${f(p3[1])}" r="0.9"/>`;
    // name tag on the wire: slide along it until it clears the tags placed so far
    const bez = (u: number, q0: number, q1: number, q2: number, q3: number) =>
      (1 - u) ** 3 * q0 + 3 * (1 - u) ** 2 * u * q1 + 3 * (1 - u) * u * u * q2 + u ** 3 * q3;
    const w = (l.signal.length * 1.05 + 1.6) * k;
    const at = (u: number): Pt => [bez(u, p0[0], p1[0], p2[0], p3[0]), bez(u, p0[1], p1[1], p2[1], p3[1])];
    const free = ([x, y]: Pt) => placedTags.every((q) => Math.abs(q.x - x) > (q.w + w) / 2 + 0.3 * k || Math.abs(q.y - y) > 2.8 * k);
    const tries = [0.5, 0.42, 0.58, 0.34, 0.66, 0.28, 0.72];
    const [tx, ty] = at(tries.find((u) => free(at(u))) ?? 0.5 + ((i % 2 ? 1 : -1) * (i + 1)) * 0.04);
    placedTags.push({ x: tx, y: ty, w });
    tags += `<g class="wd-tag w-${l.signal}${highlight && l.signal !== highlight ? ' dim' : ''}">` +
      `<rect x="${f(tx - w / 2)}" y="${f(ty - 1.25 * k)}" width="${f(w)}" height="${f(2.5 * k)}" rx="${f(1.25 * k)}"/>` +
      text(tx, ty, l.signal, 'wd-tag-text') + '</g>';
    pts.push(p0, p1, p2, p3);
  });

  const used = new Set(links.flatMap((l) => [l.from, l.to]));
  // board names are centered above each board and may be wider than it
  const nameHalf = (pl: Placed) => pl.board.name.length * 0.6 * 2.4 * k / 2;
  for (const pl of [a, b]) {
    const cx = (pl.box.x0 + pl.box.x1) / 2;
    pts.push([cx - nameHalf(pl), pl.box.y0], [cx + nameHalf(pl), pl.box.y0]);
  }
  const x0 = Math.min(a.box.x0, b.box.x0, ...pts.map((p) => p[0])) - 10 * k;
  const y0 = Math.min(a.box.y0, b.box.y0, ...pts.map((p) => p[1])) - 5 * k;
  const x1 = Math.max(a.box.x1, b.box.x1, ...pts.map((p) => p[0])) + 10 * k;
  const y1 = Math.max(a.box.y1, b.box.y1, ...pts.map((p) => p[1])) + 3 * k;
  const [aShapes, aText] = boardSvg(a, 'programmer', used, k, highlight);
  const [bShapes, bText] = boardSvg(b, 'target', used, k, highlight);
  const svg =
    `<svg class="wiring" xmlns="http://www.w3.org/2000/svg" viewBox="${f(x0)} ${f(y0)} ${f(x1 - x0)} ${f(y1 - y0)}" role="img" ` +
    `aria-label="Wiring from ${esc(prog.name)} to ${esc(tgt.name)}" style="--k:${f(k)}">` +
    aShapes + bShapes + wires + aText + bText + tags + '</svg>';
  return { svg, links, missing };
}
