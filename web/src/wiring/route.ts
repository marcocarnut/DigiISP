// Orthogonal wire routing between two boards: every wire leaves its pin,
// runs to its own lane in the gap between the boards, and reaches the other
// pin with horizontal and vertical segments only. Lane order is chosen by
// trying every permutation (at most six wires) and counting crossings.

export type Pt = [number, number];
export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface WireEnds {
  /** pin on the first board (left, or top when stacked) */
  a: Pt;
  /** pin on the second board */
  b: Pt;
}

export interface Routing {
  paths: Pt[][];
  crossings: number;
}

// Work in (u, v): u runs across the gap, v along it. Side by side u = x;
// stacked u = y.
type UV = { u: number; v: number };
type UVBox = { u0: number; u1: number; v0: number; v1: number };

const PITCH = 2.54;

interface Escape {
  /** points from the pin to where the wire turns towards its lane */
  path: UV[];
  /** v of the run towards the lane */
  v: number;
  /** needs a margin past a side edge (assigned after all escapes are known) */
  edge?: { side: -1 | 1; dist: number };
}

/**
 * How a wire leaves its pin towards the gap (dir +1: increasing u).
 * - a pin near the edge facing the gap runs straight out,
 * - if another pin is in the way (inner column of a 2x3 header) it jogs half
 *   a pitch first and passes between the pins,
 * - a pin near a side edge first leaves the board across that edge.
 */
function escape(pin: UV, box: UVBox, pins: UV[], dir: 1 | -1): Escape {
  const facing = dir > 0 ? box.u1 - pin.u : pin.u - box.u0;
  const toLow = pin.v - box.v0;
  const toHigh = box.v1 - pin.v;
  const blocked = (v: number) => pins.some((q) => Math.abs(q.v - v) < 1 && (q.u - pin.u) * dir > 0.5);
  if (facing <= Math.min(toLow, toHigh) + 6) {
    if (!blocked(pin.v)) return { path: [pin], v: pin.v };
    for (const dv of [PITCH / 2, -PITCH / 2, PITCH * 1.5, -PITCH * 1.5]) {
      if (!blocked(pin.v + dv)) return { path: [pin, { u: pin.u, v: pin.v + dv }], v: pin.v + dv };
    }
  }
  const side = toLow < toHigh ? -1 : 1;
  return { path: [pin], v: pin.v, edge: { side, dist: facing } };
}

type Seg = { h: boolean; c: number; lo: number; hi: number };

function segments(path: UV[]): Seg[] {
  const out: Seg[] = [];
  for (let i = 1; i < path.length; i++) {
    const p = path[i - 1];
    const q = path[i];
    if (Math.abs(p.v - q.v) < 1e-6 && Math.abs(p.u - q.u) > 1e-6) {
      out.push({ h: true, c: p.v, lo: Math.min(p.u, q.u), hi: Math.max(p.u, q.u) });
    } else if (Math.abs(p.u - q.u) < 1e-6 && Math.abs(p.v - q.v) > 1e-6) {
      out.push({ h: false, c: p.u, lo: Math.min(p.v, q.v), hi: Math.max(p.v, q.v) });
    }
  }
  return out;
}

/** Crossings between two wires; running along each other counts double. */
function crossings(a: Seg[], b: Seg[]): number {
  const e = 0.05;
  let n = 0;
  for (const s of a) {
    for (const t of b) {
      if (s.h !== t.h) {
        const [h, v] = s.h ? [s, t] : [t, s];
        if (v.c > h.lo + e && v.c < h.hi - e && h.c > v.lo + e && h.c < v.hi - e) n += 1;
      } else if (Math.abs(s.c - t.c) < 0.6 && Math.min(s.hi, t.hi) - Math.max(s.lo, t.lo) > 0.5) {
        n += 2;
      }
    }
  }
  return n;
}

function* permutations(n: number): Generator<number[]> {
  const p = [...Array(n).keys()];
  const c = new Array(n).fill(0);
  yield p.slice();
  let i = 0;
  while (i < n) {
    if (c[i] < i) {
      const j = i % 2 ? c[i] : 0;
      [p[j], p[i]] = [p[i], p[j]];
      yield p.slice();
      c[i]++;
      i = 0;
    } else {
      c[i] = 0;
      i++;
    }
  }
}

/**
 * Route wires between the first board (box a, left/top) and the second (box b).
 * pinsA/pinsB are all pins of each board (they block straight runs). k scales
 * the spacing of wires leaving across a side edge.
 */
export function route(wires: WireEnds[], boxA: Box, boxB: Box, pinsA: Pt[], pinsB: Pt[], horizontal: boolean, k: number): Routing {
  const toUV = ([x, y]: Pt): UV => (horizontal ? { u: x, v: y } : { u: y, v: x });
  const fromUV = ({ u, v }: UV): Pt => (horizontal ? [u, v] : [v, u]);
  const uvBox = (b: Box): UVBox => (horizontal
    ? { u0: b.x0, u1: b.x1, v0: b.y0, v1: b.y1 }
    : { u0: b.y0, u1: b.y1, v0: b.x0, v1: b.x1 });
  const A = uvBox(boxA);
  const B = uvBox(boxB);
  const pa = pinsA.map(toUV);
  const pb = pinsB.map(toUV);

  const escA = wires.map((w) => escape(toUV(w.a), A, pa, 1));
  const escB = wires.map((w) => escape(toUV(w.b), B, pb, -1));

  // wires leaving across the same side edge nest: the one nearest the gap
  // stays closest to the board, so they don't cross
  const margins = (esc: Escape[], box: UVBox) => {
    for (const side of [-1, 1] as const) {
      const group = esc.filter((e) => e.edge?.side === side).sort((x, y) => x.edge!.dist - y.edge!.dist);
      group.forEach((e, i) => {
        const v = side < 0 ? box.v0 - 1.6 * k * (i + 1) : box.v1 + 1.6 * k * (i + 1);
        const pin = e.path[0];
        e.path = [pin, { u: pin.u, v }];
        e.v = v;
      });
    }
  };
  margins(escA, A);
  margins(escB, B);

  const gap0 = A.u1;
  const gap1 = B.u0;
  const lane = (i: number) => gap0 + ((i + 1) * (gap1 - gap0)) / (wires.length + 1);

  const build = (order: number[]): UV[][] =>
    wires.map((_, w) => {
      const u = lane(order[w]);
      const ea = escA[w];
      const eb = escB[w];
      const pts = [...ea.path, { u, v: ea.v }, { u, v: eb.v }, ...[...eb.path].reverse()];
      // drop repeated points
      return pts.filter((p, i) => i === 0 || Math.abs(p.u - pts[i - 1].u) > 1e-6 || Math.abs(p.v - pts[i - 1].v) > 1e-6);
    });

  let best: { n: number; paths: UV[][] } | null = null;
  for (const order of permutations(wires.length)) {
    const paths = build(order);
    const segs = paths.map(segments);
    let n = 0;
    for (let i = 0; i < segs.length && (!best || n < best.n); i++) {
      for (let j = i + 1; j < segs.length; j++) n += crossings(segs[i], segs[j]);
    }
    if (!best || n < best.n) best = { n, paths };
    if (n === 0) break;
  }
  return { paths: best!.paths.map((p) => p.map(fromUV)), crossings: best!.n };
}
