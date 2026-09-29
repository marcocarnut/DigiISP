// Bootstrap tab: step 1 installs DigiISP through Micronucleus, step 2 uses
// that board to turn a second one into a programmer over ISP.

import { chipErase, hex2, readFlash, readTargetInfo, writeFlash, writeFuse } from './avr';
import { DIGISPARK_FUSES, digiIspApplication, fullImage, T85 } from './images';
import { Micronucleus } from './micronucleus';
import { $, ask, Checklist, chooseProgrammer, chooserCancelled, errorText, esc, log, programmer, status } from './ui';
import type { UsbAsp } from './usbasp';
import { boardOptions, keepDrawn, remembered, renderWiring } from './wiring/widget';

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
    const sig = info.signature ? `, signature 1E ${hex2(info.signature[0]).slice(2)} ${hex2(info.signature[1]).slice(2)}` : '';
    list.note(`Micronucleus ${info.version}: ${info.flashSize} bytes for the application${sig}`);
    if (info.signature && (info.signature[0] !== T85.signature[1] || info.signature[1] !== T85.signature[2])) {
      throw new Error('This board is not an ATtiny85; DigiISP is built for the ATtiny85.');
    }
    const image = mn.prepare(app);
    bar.hidden = false;
    bar.value = 0;
    await list.run('Erase application', () => mn.erase());
    await list.run(`Write DigiISP (${app.end} bytes)`, () => mn.write(image, (f) => (bar.value = f)));
    await list.run('Start DigiISP', () => mn.run());
    status(statusEl,
      '<b>Done.</b> The board now restarts as DigiISP. It generates its serial number on this first start, ' +
      'so Chrome asks for permission once: click <b>Connect programmer</b> in step 2 and pick DigiISP.' +
      '<br><button id="btn-step1-next">Go to step 2 →</button>', 'ok-banner');
    $('btn-step1-next').onclick = () => goToStep(2);
  } catch (e) {
    log(`step 1: ${errorText(e)}`);
    // USB transfer errors usually mean the bootloader timed out and left
    const timeout = e instanceof DOMException
      ? ' The bootloader gives up about 5 s after the board is plugged in; unplug it and try again.'
      : '';
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
    el.innerHTML = '<p>No programmer connected. <button id="btn-step2-connect" class="secondary">Connect programmer…</button></p>';
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
  const reset = p.info
    ? p.info.resetControl
      ? 'its reset pin is already I/O, so it could also drive the target reset from P5'
      : 'its reset pin is still reset, so you hold the target reset (bootstrap mode)'
    : 'a USBasp: it drives the target reset, so wire its RST to the second board';
  el.innerHTML = `<p>Programmer: ${name}, ${reset}.</p>`;
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
      const go = await ask(
        'Press and hold the RESET button of the second board (or short its P5 to GND), then click Continue. ' +
        'Keep holding until the page tells you to release it, about 15 seconds.');
      if (!go) {
        list.note('Cancelled.');
        return;
      }
    }

    await list.run('Enter programming mode', async () => {
      if (!(await p.enableProgramming())) {
        throw new Error('the second board does not answer: check the wiring, and that its RESET is held');
      }
    });
    const before = await list.run('Read signature and fuses', () => readTargetInfo(p),
      (t) => `signature ${Array.from(t.signature, hex2).join(' ')}, fuses ${hex2(t.fuses.low)} ${hex2(t.fuses.high)} ${hex2(t.fuses.extended)}`);
    if (!T85.signature.every((b, i) => before.signature[i] === b)) {
      throw new Error('the second board is not an ATtiny85 (signature 1E 93 0B)');
    }

    bar.hidden = false;
    erased = true;
    await list.run('Chip erase', () => chipErase(p));
    await list.run('Write Micronucleus 2.6 and DigiISP', () =>
      writeFlash(p, image, T85.pageSize, (f) => (bar.value = f * 0.5)));
    await list.run('Verify flash', async () => {
      const back = await readFlash(p, T85.flashSize, (f) => (bar.value = 0.5 + f * 0.5));
      const bad = back.findIndex((b, i) => b !== image[i]);
      if (bad >= 0) {
        throw new Error(`mismatch at 0x${bad.toString(16)}: read ${hex2(back[bad])}, expected ${hex2(image[bad])}`);
      }
    });

    await list.run(`Write fuses: low ${hex2(DIGISPARK_FUSES.low)}, extended ${hex2(DIGISPARK_FUSES.extended)}, high ${hex2(highFuse)}`,
      async () => {
        await writeFuse(p, 'low', DIGISPARK_FUSES.low);
        await writeFuse(p, 'extended', DIGISPARK_FUSES.extended);
        highWritten = true;
        await writeFuse(p, 'high', highFuse); // last: RSTDISBL takes effect on the next reset
      });
    await list.run('Verify fuses', async () => {
      const f = (await readTargetInfo(p)).fuses;
      // unused extended fuse bits may read back as 1 or 0 depending on the part
      if (f.low !== DIGISPARK_FUSES.low || f.high !== highFuse || (f.extended & 1) !== (DIGISPARK_FUSES.extended & 1)) {
        throw new Error(`read back ${hex2(f.low)} ${hex2(f.high)} ${hex2(f.extended)}`);
      }
    });

    status(statusEl,
      `<b>Done.</b> ${manual ? 'Release the RESET button and disconnect' : 'Disconnect'} the second board. Plugged into USB, it starts ` +
      'Micronucleus and after about 6 s DigiISP' +
      (disableReset ? ', ready to program other boards (and their reset pin, wired to its P5).' : ' (reset still enabled).'),
      'ok-banner');
  } catch (e) {
    log(`step 2: ${errorText(e)}`);
    const safe = !erased
      ? ' Nothing was written to the second board.'
      : !highWritten
        ? ' Its high fuse was not changed, so the second board still has its reset pin: fix the problem and run step 2 again.'
        : '';
    status(statusEl, esc(errorText(e)) + safe, 'error');
  } finally {
    if (connected) {
      try {
        await p.disconnect();
      } catch (e) {
        log(`disconnect failed: ${errorText(e)}`);
      }
      if (manual) list.note('You can release the RESET button now.', 'release');
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
  const hold = second === 'franzininho' ? 'press and hold its RESET button' : 'connect its P5 to GND with a jumper';
  renderWiring($('step2-wiring'), $<HTMLSelectElement>('sel-first-board').value, second, {
    omit: wired ? [] : ['RESET'],
    notes: wired ? [] : [`No RESET wire: when the page asks, hold the second board in reset: ${hold}.`],
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
}

export function initBootstrap() {
  setupStep2Boards();
  // a collapsed step opens again when its title is clicked
  document.querySelectorAll<HTMLElement>('#tab-bootstrap section.step h2').forEach((h) => {
    h.onclick = () => h.parentElement!.classList.remove('collapsed');
  });
  $('btn-step1').onclick = step1;
  $('btn-step2').onclick = step2;
  programmer.subscribe(renderStep2Programmer);
}
