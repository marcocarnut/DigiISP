// Spike page for the wiring diagrams (wiring.html).

import '../style.css';
import { applyStatic, languageSelect, onLang } from '../i18n';
import { boardById, type Signal } from './boards';
import { boardOptions, colorEditor, keepDrawn, renderWiring } from './widget';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const selProg = $<HTMLSelectElement>('sel-programmer');
const selTgt = $<HTMLSelectElement>('sel-target');
const selOrient = $<HTMLSelectElement>('sel-orientation');
const selHl = $<HTMLSelectElement>('sel-highlight');

const fillBoards = () => {
  boardOptions(selProg, 'programmer');
  boardOptions(selTgt, 'target');
};
fillBoards();
languageSelect($<HTMLSelectElement>('lang'));
applyStatic();
onLang(fillBoards);
colorEditor($('wire-colors'));

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

function render() {
  const o = selOrient.value;
  renderWiring($('diagram'), selProg.value, selTgt.value, {
    orientation: o === 'horizontal' || o === 'vertical' ? o : undefined, // auto follows the screen
    highlight: (selHl.value || undefined) as Signal | undefined,
  });
}

for (const s of [selProg, selTgt, selOrient, selHl]) {
  s.onchange = () => {
    toHash();
    render();
  };
}
window.addEventListener('hashchange', () => {
  fromHash();
  render();
});
fromHash();
keepDrawn(render);
