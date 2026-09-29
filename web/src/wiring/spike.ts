// Spike page for the wiring diagrams (wiring.html).

import '../style.css';
import { BOARDS, boardById, type Signal } from './boards';
import { drawWiring, type Orientation } from './draw';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const selProg = $<HTMLSelectElement>('sel-programmer');
const selTgt = $<HTMLSelectElement>('sel-target');
const selOrient = $<HTMLSelectElement>('sel-orientation');
const selHl = $<HTMLSelectElement>('sel-highlight');

for (const b of BOARDS) {
  if (b.roles.includes('programmer')) selProg.add(new Option(b.name, b.id));
  if (b.roles.includes('target')) selTgt.add(new Option(b.name, b.id));
}

// state in the URL: #programmer/target[/orientation[/highlight]]
function fromHash() {
  const [p, t, o, h] = location.hash.slice(1).split('/');
  if (p && boardById(p)) selProg.value = p;
  if (t && boardById(t)) selTgt.value = t;
  if (o) selOrient.value = o;
  selHl.value = h ?? '';
}

function toHash() {
  const parts = [selProg.value, selTgt.value, selOrient.value, selHl.value].filter(Boolean);
  history.replaceState(null, '', '#' + parts.join('/'));
}

function orientation(): Orientation {
  if (selOrient.value === 'horizontal' || selOrient.value === 'vertical') return selOrient.value;
  // portrait screens stack the boards
  return window.innerWidth < 640 || window.innerWidth < window.innerHeight ? 'vertical' : 'horizontal';
}

function render() {
  const prog = boardById(selProg.value)!;
  const tgt = boardById(selTgt.value)!;
  const { svg, links, missing } = drawWiring(prog, tgt, orientation(), (selHl.value || undefined) as Signal | undefined);
  $('diagram').innerHTML = svg;
  $('wiring-notes').innerHTML = [...prog.notes, ...tgt.notes]
    .map((n) => `<li>${n}</li>`).join('') +
    (missing.length ? `<li class="danger">Not connected: ${missing.join(', ')}</li>` : '');
  $('wiring-list').innerHTML = links
    .map((l) => `<li><span class="sig w-${l.signal}">${l.signal}</span> ${prog.name} <b>${l.from.label}</b> → ${tgt.name} <b>${l.to.label}</b></li>`)
    .join('');
}

for (const s of [selProg, selTgt, selOrient, selHl]) {
  s.onchange = () => {
    toHash();
    render();
  };
}
window.addEventListener('resize', render);
window.addEventListener('hashchange', () => {
  fromHash();
  render();
});
fromHash();
render();
