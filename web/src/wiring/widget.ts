// Wiring diagram on a page: drawing, notes and a checklist, redrawn when the
// screen turns; and the remembered board choices.

import { BOARDS, boardById, type Board, type Signal } from './boards';
import { drawWiring, type Orientation } from './draw';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** Portrait screens stack the boards. */
export function autoOrientation(): Orientation {
  return window.innerWidth < 640 || window.innerWidth < window.innerHeight ? 'vertical' : 'horizontal';
}

export interface WiringOptions {
  /** signals not wired, e.g. RESET when the target's reset is held by hand */
  omit?: Signal[];
  /** extra notes shown first */
  notes?: string[];
  orientation?: Orientation;
  highlight?: Signal;
}

/** Draw programmer -> target wiring with notes and a checklist into el. */
export function renderWiring(el: HTMLElement, programmerId: string, targetId: string, opt: WiringOptions = {}) {
  const prog = boardById(programmerId);
  const tgt = boardById(targetId);
  if (!prog || !tgt) {
    el.innerHTML = '';
    return;
  }
  const { svg, links, missing } = drawWiring(prog, tgt, opt.orientation ?? autoOrientation(), opt.highlight, opt.omit);
  const notes = [...(opt.notes ?? []), ...prog.notes, ...tgt.notes];
  el.innerHTML = svg +
    `<ul class="wiring-notes">${notes.map((n) => `<li>${esc(n)}</li>`).join('')}` +
    (missing.length ? `<li class="danger">Not connected: ${missing.join(', ')}</li>` : '') + '</ul>' +
    `<ol class="wiring-list">${links.map((l) =>
      `<li><span class="sig w-${l.signal}">${l.signal}</span> ${esc(prog.name)} <b>${esc(l.from.label)}</b> → ${esc(tgt.name)} <b>${esc(l.to.label)}</b></li>`,
    ).join('')}</ol>`;
}

const redraws = new Set<() => void>();
let resizeTimer = 0;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = window.setTimeout(() => redraws.forEach((r) => r()), 150);
});

/** Call redraw now and whenever the screen size or orientation changes. */
export function keepDrawn(redraw: () => void) {
  redraws.add(redraw);
  redraw();
}

/** Fill a select with boards that can take a role. */
export function boardOptions(sel: HTMLSelectElement, role: Board['roles'][number], only?: string[]) {
  sel.innerHTML = '';
  for (const b of BOARDS) {
    if (b.roles.includes(role) && (!only || only.includes(b.id))) sel.add(new Option(b.name, b.id));
  }
}

// --- remembered choices (browser storage may be unavailable: then nothing is remembered)

function load(key: string): string | null {
  try {
    return localStorage.getItem(`digiisp.${key}`);
  } catch {
    return null;
  }
}

function save(key: string, value: string) {
  try {
    localStorage.setItem(`digiisp.${key}`, value);
  } catch {
    // private window or blocked storage
  }
}

export const remembered = {
  /** which board a DigiISP with this serial number is (Digispark, Franzininho, ...) */
  programmerBoard: (serial: string | null | undefined) => (serial ? load(`board.${serial}`) : null),
  setProgrammerBoard: (serial: string | null | undefined, id: string) => serial && save(`board.${serial}`, id),
  target: () => load('target'),
  setTarget: (id: string) => save('target', id),
};
