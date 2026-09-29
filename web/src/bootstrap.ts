// Bootstrap tab: step 1 installs DigiISP through Micronucleus, step 2 uses
// that board to turn a second one into a programmer over ISP.

import { chipErase, hex2, readFlash, readTargetInfo, writeFlash, writeFuse } from './avr';
import { DIGISPARK_FUSES, digiIspApplication, fullImage, T85 } from './images';
import { Micronucleus } from './micronucleus';
import { $, ask, Checklist, chooseProgrammer, chooserCancelled, errorText, esc, log, programmer, status } from './ui';
import { onLang, t } from './i18n';
import type { UsbAsp } from './usbasp';
import { boardOptions, colorEditor, keepDrawn, remembered, renderWiring } from './wiring/widget';

const SCK_187K = 9; // safe for a factory fresh ATtiny85 at 1 MHz


// --- step 1: DigiISP over Micronucleus ---------------------------------------

async function step1() {
  const btn = $<HTMLButtonElement>('btn-step1');
  const bar = $<HTMLProgressElement>('step1-progress');
  const statusEl = $('step1-status');
  const list = new Checklist($('step1-steps'));
  list.clear();
  status(statusEl, '');
  btn.disabled = true;
  bar.hidden = true;
  let m: Micronucleus | null = null;
  try {
    const app = digiIspApplication();
    try {
      m = await Micronucleus.request();
    } catch (e) {
      if (chooserCancelled(e)) return;
      throw e;
    }
    const mn = m;
    const info = mn.info;
    const sig = info.signature ? t('step1.sig', { sig: `1E ${hex2(info.signature[0]).slice(2)} ${hex2(info.signature[1]).slice(2)}` }) : '';
    list.note(t('step1.info', { version: info.version, n: info.flashSize, sig }));
    if (info.signature && (info.signature[0] !== T85.signature[1] || info.signature[1] !== T85.signature[2])) {
      throw new Error(t('err.notT85'));
    }
    const image = mn.prepare(app);
    bar.hidden = false;
    bar.value = 0;
    await list.run(t('step1.erase'), () => mn.erase());
    await list.run(t('step1.write', { n: app.end }), () => mn.write(image, (f) => (bar.value = f)));
    await list.run(t('step1.start'), () => mn.run());
    status(statusEl, t('step1.done') + `<br><button id="btn-step1-next">${esc(t('step1.next'))}</button>`, 'ok-banner');
    $('btn-step1-next').onclick = () => goToStep(2);
  } catch (e) {
    log(`step 1: ${errorText(e)}`);
    // USB transfer errors usually mean the bootloader timed out and left
    const timeout = e instanceof DOMException ? ` ${t('step1.timeout')}` : '';
    status(statusEl, esc(errorText(e)) + timeout, 'error');
    await m?.close();
  } finally {
    btn.disabled = false;
  }
}

// --- step 2: complete image over ISP -------------------------------------------

function renderStep2Programmer(p: UsbAsp | null) {
  const el = $('step2-programmer');
  const btn = $<HTMLButtonElement>('btn-step2');
  const wiredRow = $('step2-wired-row');
  btn.disabled = !p;
  wiredRow.hidden = !p?.info?.resetControl;
  if (!p) {
    el.innerHTML = `<p>${esc(t('step2.noProg'))} <button id="btn-step2-connect" class="secondary">${esc(t('prog.connect'))}</button></p>`;
    $('btn-step2-connect').onclick = async () => {
      try {
        await chooseProgrammer();
      } catch (e) {
        status($('step2-status'), esc(errorText(e)), 'error');
      }
    };
    return;
  }
  const name = `${esc(p.device.productName ?? '?')} <span class="mono">${esc(p.device.serialNumber ?? '')}</span>`;
  const reset = t(p.info ? (p.info.resetControl ? 'step2.prog.driven' : 'step2.prog.manual') : 'step2.prog.usbasp');
  el.innerHTML = `<p>${t('step2.prog', { name, reset: esc(reset) })}</p>`;
}

async function step2() {
  const p = programmer.get();
  if (!p) return;
  const btn = $<HTMLButtonElement>('btn-step2');
  const bar = $<HTMLProgressElement>('step2-progress');
  const statusEl = $('step2-status');
  const list = new Checklist($('step2-steps'));
  const disableReset = $<HTMLInputElement>('step2-rstdisbl').checked;
  const manual = p.kind !== 'digiisp' ? false : !p.resetControl || !$<HTMLInputElement>('step2-wired').checked;
  const highFuse = disableReset ? DIGISPARK_FUSES.highNoReset : DIGISPARK_FUSES.highReset;

  list.clear();
  status(statusEl, '');
  btn.disabled = true;
  bar.hidden = true;
  let connected = false;
  let erased = false;
  let highWritten = false;
  try {
    const image = fullImage();

    await p.setSck(SCK_187K);
    await p.connect(manual);
    connected = true;
    if (manual) {
      if (!(await ask(t('step2.hold')))) {
        list.note(t('steps.cancelled'));
        return;
      }
    }

    await list.run(t('steps.progmode'), async () => {
      if (!(await p.enableProgramming())) throw new Error(t('err.secondNoAnswer'));
    });
    const before = await list.run(t('step2.readInfo'), () => readTargetInfo(p),
      (i) => t('step2.infoDetail', {
        sig: Array.from(i.signature, hex2).join(' '),
        fuses: `${hex2(i.fuses.low)} ${hex2(i.fuses.high)} ${hex2(i.fuses.extended)}`,
      }));
    if (!T85.signature.every((b, i) => before.signature[i] === b)) throw new Error(t('err.secondNotT85'));

    bar.hidden = false;
    erased = true;
    await list.run(t('steps.erase'), () => chipErase(p));
    await list.run(t('step2.write'), () =>
      writeFlash(p, image, T85.pageSize, (f) => (bar.value = f * 0.5)));
    await list.run(t('steps.verifyFlash'), async () => {
      const back = await readFlash(p, T85.flashSize, (f) => (bar.value = 0.5 + f * 0.5));
      const bad = back.findIndex((b, i) => b !== image[i]);
      if (bad >= 0) {
        throw new Error(t('err.mismatchAt', { addr: bad.toString(16), got: hex2(back[bad]), want: hex2(image[bad]) }));
      }
    });

    await list.run(t('step2.fuses', { low: hex2(DIGISPARK_FUSES.low), ext: hex2(DIGISPARK_FUSES.extended), high: hex2(highFuse) }),
      async () => {
        await writeFuse(p, 'low', DIGISPARK_FUSES.low);
        await writeFuse(p, 'extended', DIGISPARK_FUSES.extended);
        highWritten = true;
        await writeFuse(p, 'high', highFuse); // last: RSTDISBL takes effect on the next reset
      });
    await list.run(t('step2.verifyFuses'), async () => {
      const f = (await readTargetInfo(p)).fuses;
      // unused extended fuse bits may read back as 1 or 0 depending on the part
      if (f.low !== DIGISPARK_FUSES.low || f.high !== highFuse || (f.extended & 1) !== (DIGISPARK_FUSES.extended & 1)) {
        throw new Error(t('err.fusesBack', { values: `${hex2(f.low)} ${hex2(f.high)} ${hex2(f.extended)}` }));
      }
    });

    status(statusEl, t('step2.done', {
      action: t(manual ? 'step2.done.release' : 'step2.done.disconnect'),
      rest: t(disableReset ? 'step2.done.prog' : 'step2.done.reset'),
    }), 'ok-banner');
  } catch (e) {
    log(`step 2: ${errorText(e)}`);
    const safe = !erased ? ` ${t('step2.safe.nothing')}` : !highWritten ? ` ${t('step2.safe.reset')}` : '';
    status(statusEl, esc(errorText(e)) + safe, 'error');
  } finally {
    if (connected) {
      try {
        await p.disconnect();
      } catch (e) {
        log(`disconnect failed: ${errorText(e)}`);
      }
      if (manual) list.note(t('steps.release'), 'release');
    }
    btn.disabled = !programmer.get();
  }
}

// --- step navigation -----------------------------------------------------------

/** Collapse the steps before n, expand n and scroll it to the top. */
function goToStep(n: number) {
  document.querySelectorAll<HTMLElement>('#tab-bootstrap section.step').forEach((s) => {
    s.classList.toggle('collapsed', Number(s.dataset.step) < n);
  });
  document.querySelector(`#tab-bootstrap section.step[data-step="${n}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// --- step 2 wiring ------------------------------------------------------------------

function drawStep2Wiring() {
  const p = programmer.get();
  const wired = !!p?.info?.resetControl && $<HTMLInputElement>('step2-wired').checked;
  const second = $<HTMLSelectElement>('sel-second-board').value;
  const how = t(second === 'franzininho' ? 'step2.hold.button' : 'step2.hold.jumper');
  renderWiring($('step2-wiring'), $<HTMLSelectElement>('sel-first-board').value, second, {
    omit: wired ? [] : ['RESET'],
    notes: wired ? [] : [t('step2.noReset', { how })],
  });
}

function setupStep2Boards() {
  const first = $<HTMLSelectElement>('sel-first-board');
  const second = $<HTMLSelectElement>('sel-second-board');
  boardOptions(first, 'programmer', ['digispark', 'franzininho']);
  boardOptions(second, 'target', ['digispark', 'franzininho']);
  second.value = 'franzininho';
  first.onchange = () => {
    remembered.setProgrammerBoard(programmer.get()?.device.serialNumber, first.value);
    drawStep2Wiring();
  };
  second.onchange = drawStep2Wiring;
  $<HTMLInputElement>('step2-wired').addEventListener('change', drawStep2Wiring);
  programmer.subscribe((p) => {
    first.value = remembered.programmerBoard(p?.device.serialNumber) ?? 'digispark';
    drawStep2Wiring();
  });
  keepDrawn(drawStep2Wiring);
  colorEditor($('wire-colors-2'));
  onLang(() => {
    boardOptions(first, 'programmer', ['digispark', 'franzininho']);
    boardOptions(second, 'target', ['digispark', 'franzininho']);
  });
}

/** "✓ done (show)" on collapsed steps comes from a data attribute (see style.css). */
function markDone() {
  document.querySelectorAll<HTMLElement>('#tab-bootstrap section.step h2').forEach((h) => (h.dataset.done = t('step.done')));
}

export function initBootstrap() {
  setupStep2Boards();
  markDone();
  onLang(() => {
    markDone();
    renderStep2Programmer(programmer.get());
  });
  // a collapsed step opens again when its title is clicked
  document.querySelectorAll<HTMLElement>('#tab-bootstrap section.step h2').forEach((h) => {
    h.onclick = () => h.parentElement!.classList.remove('collapsed');
  });
  $('btn-step1').onclick = step1;
  $('btn-step2').onclick = step2;
  programmer.subscribe(renderStep2Programmer);
}
