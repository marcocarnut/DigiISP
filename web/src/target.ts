// Programmer tab, target section: identify the part, read and write flash,
// EEPROM, fuses and lock bits.

import {
  chipErasePart,
  hex2,
  readConfig,
  readEeprom,
  readFlash,
  readSignature,
  writeEeprom,
  writeFlash,
  writeMemory,
} from './avr';
import { parseIntelHex, toIntelHex, type MemoryImage } from './ihex';
import { fuseMemories, loadParts, partBySignature, type ConfigItem, type ConfigValue, type Part } from './parts';
import { onLang, t } from './i18n';
import { $, ask, Checklist, errorText, esc, log, programmer, status } from './ui';
import type { UsbAsp } from './usbasp';
import { boardById, boardName } from './wiring/boards';
import { boardOptions, colorEditor, keepDrawn, remembered, renderWiring } from './wiring/widget';

const list = () => new Checklist($('target-steps'));
const bar = () => $<HTMLProgressElement>('target-progress');
const progress = (f: number) => (bar().value = f);

/** The part identified last, with the fuse and lock values read then. */
let target: { part: Part; config: Record<string, number> } | null = null;
/** Fuse and lock values being edited, by memory name. */
let edited: Record<string, number> = {};
/** The error of the last failed session, for the Identify result. */
let lastError = '';

// --- sessions ---------------------------------------------------------------------

/**
 * Connect to the target, run an action, disconnect. Handles the manual reset
 * prompt, programming mode and the check that the target is still the part
 * identified before.
 */
async function withTarget<T>(action: (p: UsbAsp, part: Part, steps: Checklist) => Promise<T>): Promise<T | undefined> {
  const p = programmer.get();
  if (!p) return undefined;
  const steps = list();
  steps.clear();
  status($('target-status'), '');
  bar().hidden = true;
  bar().value = 0;
  setBusy(true);
  let connected = false;
  let manual = false;
  try {
    if (!(await p.setSck(Number($<HTMLSelectElement>('sck').value)))) {
      log('programmer did not accept SCK setting, using its default');
    }
    manual = !p.resetControl || (p.kind === 'digiisp' && $<HTMLInputElement>('manual-reset').checked);
    await p.connect(manual);
    connected = true;
    lastError = '';
    if (manual && !(await ask(t('target.holdReset')))) {
      steps.note(t('steps.cancelled'));
      lastError = t('steps.cancelled');
      return undefined;
    }
    await steps.run(t('steps.progmode'), async () => {
      if (!(await p.enableProgramming())) throw new Error(t('err.noAnswer'));
    });
    const sig = await readSignature(p);
    const part = await partBySignature(sig);
    const sigText = Array.from(sig, hex2).join(' ');
    if (!part) throw new Error(t('err.unknownSig', { sig: sigText }));
    if (target && target.part !== part) {
      throw new Error(t('err.otherPart', { part: part.name, sig: sigText, old: target.part.name }));
    }
    return await action(p, part, steps);
  } catch (e) {
    lastError = errorText(e);
    log(`target: ${lastError}`);
    status($('target-status'), esc(lastError), 'error');
    return undefined;
  } finally {
    if (connected) {
      try {
        await p.disconnect();
      } catch (e) {
        log(`disconnect failed: ${errorText(e)}`);
      }
      if (manual) steps.note(t('steps.release'), 'release');
    }
    setBusy(false);
  }
}

function setBusy(busy: boolean) {
  document.querySelectorAll<HTMLButtonElement | HTMLInputElement>('#target-section button, #target-section input[type=file]')
    .forEach((b) => (b.disabled = busy));
}

function save(name: string, text: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

async function readHexFile(input: HTMLInputElement, size: number): Promise<{ name: string; image: MemoryImage } | null> {
  const file = input.files?.[0];
  input.value = ''; // so picking the same file again fires change
  if (!file) return null;
  return { name: file.name, image: parseIntelHex(await file.text(), size) };
}

// --- identify -------------------------------------------------------------------

/** The outcome of the last Identify, kept so it can be redrawn in another language. */
type Result = { kind: 'fail'; error: string } | { kind: 'ok' | 'mismatch'; part: Part; boardId?: string; expected?: string[] };
let result: Result | null = null;

/** The big result shown after Identify. */
function renderResult() {
  const el = $('target-result');
  if (!result) {
    el.innerHTML = '';
    return;
  }
  const box = (ok: boolean, title: string, text: string) =>
    `<div class="result ${ok ? 'good' : 'bad'}" role="status"><span class="result-icon">${ok ? '✓' : '✗'}</span>` +
    `<div><div class="result-title">${esc(title)}</div><div>${text}</div></div></div>`;
  if (result.kind === 'fail') {
    el.innerHTML = box(false, t('target.fail'), esc(result.error));
    return;
  }
  const part = `<b>${esc(result.part.name)}</b>`;
  const board = result.boardId ? boardById(result.boardId) : undefined;
  if (result.kind === 'mismatch' && board) {
    el.innerHTML = box(false, t('target.mismatch'), t('target.mismatch.text', {
      part, board: `<b>${esc(boardName(board))}</b>`, expected: (result.expected ?? []).map(esc).join(` ${t('or')} `),
    }));
  } else {
    el.innerHTML = box(true, t('target.ok'), board
      ? t('target.ok.board', { part, board: esc(boardName(board)) })
      : t('target.ok.plain', { part }));
  }
}

async function identify() {
  target = null;
  $<HTMLDetailsElement>('fuse-section').open = false;
  $('target').innerHTML = '';
  result = null;
  renderResult();
  $('target-ops').hidden = true;
  const found = await withTarget(async (p, part, steps) => {
    const config = await steps.run(t('steps.readConfig'), () => readConfig(p, part), () => part.name);
    target = { part, config };
    edited = { ...config };
    renderPart();
    renderFuses();
    $('target-ops').hidden = false;
    return part;
  });
  if (!found) {
    result = { kind: 'fail', error: lastError };
  } else {
    // does the chip match the board picked for the wiring?
    const board = boardById($<HTMLSelectElement>('sel-target-board').value);
    if (board?.parts.length && !board.parts.includes(found.id)) {
      const { parts } = await loadParts();
      const expected = board.parts.map((id) => parts.find((q) => q.id === id)?.name ?? id);
      result = { kind: 'mismatch', part: found, boardId: board.id, expected };
    } else {
      result = { kind: 'ok', part: found, boardId: board?.parts.length ? board.id : undefined };
    }
  }
  renderResult();
}

function renderPart() {
  if (!target) return;
  const { part } = target;
  const kb = (n: number) => (n >= 1024 ? `${n / 1024} KB` : t('bytes', { n }));
  const rows: [string, string][] = [
    [t('part.row.part'), `<b>${esc(part.name)}</b> <span class="hint">(avrdude -p ${esc(part.id)})</span>`],
    [t('part.row.sig'), `<span class="mono">${part.signature.map(hex2).join(' ')}</span>`],
    [t('part.row.flash'), `${kb(part.flash.size)}${part.flash.paged ? t('part.pages', { n: part.flash.page }) : ''}`],
    [t('part.row.eeprom'), part.eeprom ? kb(part.eeprom.size) : t('part.none')],
  ];
  $('target').innerHTML = `<table>${rows.map(([k, v]) => `<tr><th>${k}</th><td>${v}</td></tr>`).join('')}</table>`;
  $<HTMLButtonElement>('btn-ee-read').hidden = !part.eeprom;
  $('ee-write-label').hidden = !part.eeprom;
}

// --- flash and EEPROM ------------------------------------------------------------

async function flashRead() {
  await withTarget(async (p, part, steps) => {
    bar().hidden = false;
    const data = await steps.run(t('steps.readFlash', { n: part.flash.size }), () => readFlash(p, part.flash.size, progress));
    save(`${part.id}-flash.hex`, toIntelHex(data));
    steps.note(t('steps.saved', { name: `${part.id}-flash.hex` }));
  });
}

async function flashWrite(verifyOnly: boolean) {
  const input = $<HTMLInputElement>(verifyOnly ? 'file-flash-verify' : 'file-flash-write');
  const part = target?.part;
  if (!part) return;
  let file: { name: string; image: MemoryImage } | null;
  try {
    file = await readHexFile(input, part.flash.size);
  } catch (e) {
    status($('target-status'), esc(errorText(e)), 'error');
    return;
  }
  if (!file) return;
  const { name, image } = file;
  await withTarget(async (p, part, steps) => {
    bar().hidden = false;
    steps.note(t('steps.fileBytes', { name, n: image.end }));
    const end = Math.ceil(image.end / Math.max(part.flash.page, 1)) * Math.max(part.flash.page, 1);
    if (!verifyOnly) {
      await steps.run(t('steps.eraseFull'), () => chipErasePart(p, part));
      await refreshConfig(p, part); // the erase cleared the lock bits
      await steps.run(t('steps.writeFlash'), () =>
        writeFlash(p, image.data.subarray(0, end), part.flash.paged ? part.flash.page : 0, (f) => progress(f * 0.5)));
    }
    await steps.run(t('steps.verifyFlash'), async () => {
      const back = await readFlash(p, image.end, (f) => progress(verifyOnly ? f : 0.5 + f * 0.5));
      for (let a = 0; a < image.end; a++) {
        if (image.used[a] && back[a] !== image.data[a]) {
          throw new Error(t('err.mismatchAt', { addr: a.toString(16), got: hex2(back[a]), want: hex2(image.data[a]) }));
        }
      }
    });
    status($('target-status'), `<b>${esc(t(verifyOnly ? 'done.verified' : 'done.written'))}</b> ${esc(name)}`, 'ok-banner');
  });
}

async function chipErase() {
  if (!(await ask(t('erase.confirm')))) return;
  await withTarget(async (p, part, steps) => {
    await steps.run(t('steps.erase'), () => chipErasePart(p, part));
    await refreshConfig(p, part); // the erase cleared the lock bits
  });
}

/** Re-read fuses and lock bits into the editor, e.g. after a chip erase. */
async function refreshConfig(p: UsbAsp, part: Part) {
  if (!target) return;
  target.config = await readConfig(p, part);
  edited = { ...target.config };
  await renderFuses();
}

async function eepromRead() {
  await withTarget(async (p, part, steps) => {
    if (!part.eeprom) return;
    bar().hidden = false;
    const data = await steps.run(t('steps.readEeprom', { n: part.eeprom.size }), () => readEeprom(p, part.eeprom!.size, progress));
    save(`${part.id}-eeprom.hex`, toIntelHex(data));
    steps.note(t('steps.saved', { name: `${part.id}-eeprom.hex` }));
  });
}

async function eepromWrite() {
  const part = target?.part;
  if (!part?.eeprom) return;
  let file: { name: string; image: MemoryImage } | null;
  try {
    file = await readHexFile($<HTMLInputElement>('file-ee-write'), part.eeprom.size);
  } catch (e) {
    status($('target-status'), esc(errorText(e)), 'error');
    return;
  }
  if (!file) return;
  const { name, image } = file;
  await withTarget(async (p, part, steps) => {
    bar().hidden = false;
    const n = await steps.run(t('steps.writeEeprom', { name }), () => writeEeprom(p, part, image, progress),
      (n) => t('steps.changed', { n }));
    await steps.run(t('steps.verifyEeprom'), async () => {
      const back = await readEeprom(p, part.eeprom!.size, () => undefined);
      for (let a = 0; a < image.end; a++) {
        if (image.used[a] && back[a] !== image.data[a]) {
          throw new Error(t('err.mismatchAt', { addr: a.toString(16), got: hex2(back[a]), want: hex2(image.data[a]) }));
        }
      }
    });
    status($('target-status'), `<b>${esc(t('done.eeprom'))}</b> ${esc(t('steps.changed', { n }))}`, 'ok-banner');
  });
}

// --- fuses and lock bits ---------------------------------------------------------

interface Field {
  item: ConfigItem;
  values: ConfigValue[];
}

async function fields(part: Part): Promise<Field[]> {
  const db = await loadParts();
  return (part.config ? db.config[part.config] : [])
    .filter((item) => item.mem in target!.config)
    .map((item) => ({ item, values: item.values ? db.values[item.values] ?? [] : [] }));
}

const fieldValue = (byte: number, item: ConfigItem) => (byte & item.mask) >> item.shift;

function describe(f: Field, byte: number): string {
  const v = fieldValue(byte, f.item);
  const named = f.values.find(([value]) => value === v);
  return named ? named[2] : t('fuses.value', { value: v });
}

/** Why a change needs care, or null. Blocking problems throw. */
function risk(f: Field, from: number, to: number): string | null {
  const name = f.item.name;
  const v = fieldValue(to, f.item);
  if (fieldValue(from, f.item) === v) return null;
  if (name === 'spien' && v === 1) throw new Error(t('risk.spien'));
  if (name === 'rstdisbl' && v === 0) return t('risk.rstdisbl');
  if (name === 'dwen' && v === 0) return t('risk.dwen');
  if (/cksel|ckopt|clksel/.test(name)) return t('risk.clock', { value: describe(f, to) });
  if (name === 'ckdiv8' && v === 0) return t('risk.ckdiv8');
  if (f.item.mem === 'lock' && v !== fieldValue(0xff, f.item)) return t('risk.lock');
  return null;
}

async function renderFuses() {
  const el = $('fuse-editor');
  if (!target) {
    el.innerHTML = '';
    return;
  }
  const { part, config } = target;
  const all = await fields(part);
  const mems = [...fuseMemories(part), 'lock'].filter((m) => m in config);
  el.innerHTML = mems.map((mem) => {
    const changed = edited[mem] !== config[mem];
    const rows = all.filter((f) => f.item.mem === mem).map((f, i) => {
      const cur = fieldValue(edited[mem], f.item);
      const options = f.values.length
        ? f.values.map(([v, , comment]) => `<option value="${v}"${v === cur ? ' selected' : ''}>${esc(comment)}</option>`).join('') +
          (f.values.some(([v]) => v === cur) ? '' : `<option value="${cur}" selected>${esc(t('fuses.value', { value: cur }))}</option>`)
        : '';
      const input = f.values.length
        ? `<select data-mem="${mem}" data-field="${i}">${options}</select>`
        : `<input class="mono" size="4" data-mem="${mem}" data-field="${i}" value="${cur}">`;
      const wasValue = fieldValue(config[mem], f.item);
      const was = wasValue !== cur ? `<div class="hint">${esc(t('fuses.was', { value: describe(f, config[mem]) }))}</div>` : '';
      // a select shows long values cut off, so the full text goes below it
      const text = describe(f, edited[mem]);
      const full = f.values.length && text.length > 36 ? `<div class="value-text">${esc(text)}</div>` : '';
      return `<div class="field${wasValue !== cur ? ' changed' : ''}">` +
        `<div class="field-head"><b title="${esc(f.item.name)}">${esc(f.item.name.toUpperCase())}</b> <span class="hint">${esc(f.item.description)}</span></div>` +
        `${input}${full}${was}</div>`;
    }).join('');
    const title = mem === 'lock' ? t('fuse.lockbits') : `${mem}`;
    return `<div class="fuse-mem"><h4>${esc(title)} <input class="mono" size="4" data-hex="${mem}" value="${hex2(edited[mem])}">` +
      `${changed ? ` <span class="hint">${esc(t('fuses.wasHex', { value: hex2(config[mem]) }))}</span>` : ''}</h4>${rows}</div>`;
  }).join('');
  const anyChange = mems.some((m) => edited[m] !== config[m]);
  $('fuse-summary').textContent =
    mems.map((m) => `${m} ${hex2(edited[m])}`).join(' · ') + (anyChange ? ` ${t('fuses.changed')}` : '');

  // editing a field updates the byte, editing the byte updates the fields
  const memFields = (mem: string) => all.filter((f) => f.item.mem === mem);
  el.querySelectorAll<HTMLSelectElement | HTMLInputElement>('[data-field]').forEach((c) => {
    c.onchange = () => {
      const mem = c.dataset.mem!;
      const f = memFields(mem)[Number(c.dataset.field)];
      const v = Number(c.value);
      edited[mem] = (edited[mem] & ~f.item.mask) | ((v << f.item.shift) & f.item.mask);
      void renderFuses();
    };
  });
  el.querySelectorAll<HTMLInputElement>('[data-hex]').forEach((c) => {
    c.onchange = () => {
      const v = parseInt(c.value.replace(/^0x/i, ''), 16);
      if (Number.isInteger(v) && v >= 0 && v <= 0xff) edited[c.dataset.hex!] = v;
      void renderFuses();
    };
  });
  const fuseChanged = fuseMemories(part).some((m) => m in config && edited[m] !== config[m]);
  $<HTMLButtonElement>('btn-fuses-write').disabled = !fuseChanged;
  $<HTMLButtonElement>('btn-lock-write').disabled = !('lock' in config) || edited.lock === config.lock;
  $<HTMLButtonElement>('btn-fuses-reset').disabled = mems.every((m) => edited[m] === config[m]);
}

async function writeConfig(which: 'fuses' | 'lock') {
  if (!target) return;
  const { part, config } = target;
  const mems = (which === 'lock' ? ['lock'] : fuseMemories(part)).filter((m) => m in config && edited[m] !== config[m]);
  if (!mems.length) return;
  const all = await fields(part);
  const changes: string[] = [];
  const risks: string[] = [];
  try {
    for (const mem of mems) {
      changes.push(`${mem}: ${hex2(config[mem])} → ${hex2(edited[mem])}`);
      for (const f of all.filter((f) => f.item.mem === mem)) {
        if (fieldValue(config[mem], f.item) === fieldValue(edited[mem], f.item)) continue;
        changes.push(`– ${f.item.name.toUpperCase()}: ${describe(f, config[mem])} → ${describe(f, edited[mem])}`);
        const r = risk(f, config[mem], edited[mem]);
        if (r) risks.push(r);
      }
    }
  } catch (e) {
    status($('target-status'), esc(errorText(e)), 'error');
    return;
  }
  const text = `${t('fuses.confirm')}\n\n${changes.join('\n')}` + (risks.length ? `\n\n${t('fuses.careful')}\n• ${risks.join('\n• ')}` : '');
  if (!(await ask(text))) return;

  // the byte with RSTDISBL or DWEN goes last, so everything else is in place first
  const dangerous = (mem: string) => all.some((f) => f.item.mem === mem && /rstdisbl|dwen/.test(f.item.name));
  mems.sort((a, b) => Number(dangerous(a)) - Number(dangerous(b)));
  await withTarget(async (p, part, steps) => {
    for (const mem of mems) {
      await steps.run(t('steps.writeMem', { mem, value: hex2(edited[mem]) }), () => writeMemory(p, part, mem, edited[mem]));
    }
    const back = await steps.run(t('steps.readBack'), () => readConfig(p, part));
    target!.config = back;
    // unused bits can read back differently: compare what the fields cover
    const bad = mems.filter((m) => {
      const used = all.filter((f) => f.item.mem === m).reduce((a, f) => a | f.item.mask, 0) || 0xff;
      return (back[m] & used) !== (edited[m] & used);
    });
    edited = { ...back };
    await renderFuses();
    if (bad.length) throw new Error(t('err.readBack', { mems: bad.join(', '), values: bad.map((m) => hex2(back[m])).join(', ') }));
    status($('target-status'), esc(which === 'lock' ? t('done.lock') : t('done.fuses', { mems: mems.join(', ') })), 'ok-banner');
  });
}

// --- init -------------------------------------------------------------------------

// --- wiring ---------------------------------------------------------------------

/** Whether this programmer will leave RESET to the user. */
function manualReset(p: UsbAsp | null): boolean {
  return !!p && (!p.resetControl || (p.kind === 'digiisp' && $<HTMLInputElement>('manual-reset').checked));
}

function drawTargetWiring() {
  const p = programmer.get();
  if (!p) return;
  const manual = manualReset(p);
  const target = $<HTMLSelectElement>('sel-target-board').value;
  // boards without a reset button get a RST→GND jumper, explained by its own note
  const button = boardById(target)?.resetButton;
  renderWiring($('wiring'), $<HTMLSelectElement>('sel-prog-board').value, target, {
    omit: manual ? ['RESET'] : [],
    notes: manual && button ? [t('wiring.noReset')] : [],
  });
}

/** The programmer board choice depends on what is connected. */
function setupProgrammerBoard(p: UsbAsp | null) {
  const sel = $<HTMLSelectElement>('sel-prog-board');
  if (p?.kind === 'digiisp') {
    boardOptions(sel, 'programmer', ['digispark', 'franzininho']);
    sel.value = remembered.programmerBoard(p.device.serialNumber) ?? 'digispark';
    $('prog-board-row').hidden = false;
  } else {
    boardOptions(sel, 'programmer', ['usbasp']);
    $('prog-board-row').hidden = true;
  }
}

export function initTarget() {
  const selTarget = $<HTMLSelectElement>('sel-target-board');
  boardOptions(selTarget, 'target');
  selTarget.value = remembered.target() ?? 'icsp6';
  if (!selTarget.value) selTarget.value = 'icsp6';
  selTarget.onchange = () => {
    remembered.setTarget(selTarget.value);
    drawTargetWiring();
  };
  $<HTMLSelectElement>('sel-prog-board').onchange = () => {
    remembered.setProgrammerBoard(programmer.get()?.device.serialNumber, $<HTMLSelectElement>('sel-prog-board').value);
    drawTargetWiring();
  };
  $<HTMLInputElement>('manual-reset').addEventListener('change', drawTargetWiring);
  keepDrawn(drawTargetWiring);
  colorEditor($('wire-colors'));
  onLang(() => {
    // board names in the selects, and the identified part's panels
    boardOptions(selTarget, 'target');
    setupProgrammerBoard(programmer.get());
    renderPart();
    renderResult();
    void renderFuses();
  });

  $('btn-read-target').onclick = identify;
  $('btn-flash-read').onclick = flashRead;
  $<HTMLInputElement>('file-flash-write').onchange = () => flashWrite(false);
  $<HTMLInputElement>('file-flash-verify').onchange = () => flashWrite(true);
  $('btn-erase').onclick = chipErase;
  $('btn-ee-read').onclick = eepromRead;
  $<HTMLInputElement>('file-ee-write').onchange = eepromWrite;
  $('btn-fuses-write').onclick = () => writeConfig('fuses');
  $('btn-lock-write').onclick = () => writeConfig('lock');
  $('btn-fuses-reset').onclick = () => {
    if (target) edited = { ...target.config };
    void renderFuses();
  };
  programmer.subscribe((p) => {
    setupProgrammerBoard(p);
    drawTargetWiring();
    target = null;
    result = null;
    renderResult();
    $('target').innerHTML = '';
    $('target-ops').hidden = true;
    list().clear();
    status($('target-status'), '');
  });
}
