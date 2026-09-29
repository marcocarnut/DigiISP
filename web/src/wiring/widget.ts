// Wiring diagram on a page: drawing, notes and a checklist, redrawn when the
// screen turns; wire colors the user can match to their own jumpers; and the
// remembered board choices.

import { onLang, t } from '../i18n';
import { BOARDS, boardById, boardName, SIGNALS, type Board, type Signal } from './boards';
import { drawWiring, type Orientation } from './draw';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** Portrait screens stack the boards. */
export function autoOrientation(): Orientation {
  return window.innerWidth < 640 || window.innerWidth < window.innerHeight ? 'vertical' : 'horizontal';
}

export interface WiringOptions {
  /** signals not wired, e.g. RESET when the target's reset is held by hand */
  omit?: Signal[];
  /** extra notes shown first (already translated) */
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
  const { svg, links, missing, jumper } = drawWiring(prog, tgt, opt.orientation ?? autoOrientation(), opt.highlight, opt.omit);
  // a Set: the same board on both ends would repeat its notes
  const notes = [...new Set([
    ...(opt.notes ?? []),
    ...(jumper ? [t(jumper === 'spare' ? 'wiring.jumper.spare' : 'wiring.jumper.y')] : []),
    ...prog.notes.map((k) => t(k)),
    ...tgt.notes.map((k) => t(k)),
  ])];
  // the same kind of board on both ends: say which is which
  const same = prog.id === tgt.id;
  const pn = esc(same ? `${boardName(prog)} (${t('role.programmer')})` : boardName(prog));
  const tn = esc(same ? `${boardName(tgt)} (${t('role.target')})` : boardName(tgt));
  el.innerHTML = svg +
    `<ul class="wiring-notes">${notes.map((n) => `<li>${esc(n)}</li>`).join('')}` +
    (missing.length ? `<li class="danger">${esc(t('wiring.notConnected', { signals: missing.join(', ') }))}</li>` : '') + '</ul>' +
    `<ol class="wiring-list">${links.map((l) =>
      `<li><span class="sig w-${l.signal}">${esc(l.tag ?? l.signal)}</span> ${pn} <b>${esc(l.from.label)}</b> → ${tn} <b>${esc(l.to.label)}</b></li>`,
    ).join('')}</ol>`;
}

const redraws = new Set<() => void>();
let resizeTimer = 0;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = window.setTimeout(() => redraws.forEach((r) => r()), 150);
});

/** Call redraw now and whenever the screen size, orientation or language changes. */
export function keepDrawn(redraw: () => void) {
  redraws.add(redraw);
  onLang(redraw);
  redraw();
}

/** Fill a select with boards that can take a role (keeps the selection). */
export function boardOptions(sel: HTMLSelectElement, role: Board['roles'][number], only?: string[]) {
  const keep = sel.value;
  sel.innerHTML = '';
  for (const b of BOARDS) {
    if (b.roles.includes(role) && (!only || only.includes(b.id))) sel.add(new Option(boardName(b), b.id));
  }
  if (keep && [...sel.options].some((o) => o.value === keep)) sel.value = keep;
}

// --- browser storage (may be unavailable: then nothing is remembered) ----------

function load(key: string): string | null {
  try {
    return localStorage.getItem(`digiisp.${key}`);
  } catch {
    return null;
  }
}

function save(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(`digiisp.${key}`);
    else localStorage.setItem(`digiisp.${key}`, value);
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

// --- wire colors ---------------------------------------------------------------------

type Colors = Partial<Record<Signal, string>>;

function customColors(): Colors {
  try {
    return JSON.parse(load('colors') ?? '{}') as Colors;
  } catch {
    return {};
  }
}

/** Black or white, whichever reads better on the color. */
function textOn(color: string): string {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(color.trim());
  if (!m) return '#fff';
  const [r, g, b] = [m[1], m[2], m[3]].map((h) => {
    const c = parseInt(h, 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.35 ? '#111' : '#fff';
}

const cssVar = (s: Signal) => `--w-${s.toLowerCase()}`;

/** Set the wire color variables: the user's colors over the stylesheet's defaults. */
export function applyColors() {
  const root = document.documentElement;
  const custom = customColors();
  for (const s of SIGNALS) {
    if (custom[s]) root.style.setProperty(cssVar(s), custom[s]!);
    else root.style.removeProperty(cssVar(s));
    const c = getComputedStyle(root).getPropertyValue(cssVar(s));
    root.style.setProperty(`${cssVar(s)}-fg`, textOn(c));
  }
  // keep every editor in sync without rebuilding it (that would close an open color picker)
  const now = getComputedStyle(root);
  editors.forEach((el) => el.querySelectorAll<HTMLInputElement>('input[type=color]').forEach((input) => {
    if (input !== document.activeElement) input.value = now.getPropertyValue(cssVar(input.dataset.sig as Signal)).trim();
  }));
}

const editors = new Set<HTMLElement>();

function fillEditor(el: HTMLElement) {
  const root = getComputedStyle(document.documentElement);
  el.innerHTML = SIGNALS.map((s) =>
    `<label class="wire-color"><input type="color" data-sig="${s}" value="${root.getPropertyValue(cssVar(s)).trim()}"> ${s}</label>`,
  ).join('') + `<button type="button" class="secondary small" data-reset>${esc(t('wiring.colors.reset'))}</button>`;
  el.querySelectorAll<HTMLInputElement>('input[type=color]').forEach((input) => {
    input.oninput = () => {
      const custom = customColors();
      custom[input.dataset.sig as Signal] = input.value;
      save('colors', JSON.stringify(custom));
      applyColors();
    };
  });
  el.querySelector<HTMLButtonElement>('[data-reset]')!.onclick = () => {
    save('colors', null);
    applyColors();
  };
}

/** A set of color pickers, one per signal (all editors stay in sync). */
export function colorEditor(el: HTMLElement) {
  editors.add(el);
  onLang(() => fillEditor(el));
  fillEditor(el);
}

applyColors();
window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener?.('change', applyColors);
