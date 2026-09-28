import { describeFuse, Fuses, hex2, partName, readTargetInfo, TINYx5_FUSES } from './avr';
import { CAP_TPI, SCK_OPTIONS } from './protocol';
import { UsbAsp } from './usbasp';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const logEl = $<HTMLPreElement>('log');
const programmerEl = $('programmer');
const targetEl = $('target');
const targetSection = $('target-section');
const btnConnect = $<HTMLButtonElement>('btn-connect');
const btnDisconnect = $<HTMLButtonElement>('btn-disconnect');
const btnReadTarget = $<HTMLButtonElement>('btn-read-target');
const sckSelect = $<HTMLSelectElement>('sck');

let programmer: UsbAsp | null = null;

function log(line: string) {
  logEl.textContent += line + '\n';
  logEl.scrollTop = logEl.scrollHeight;
}

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}

function showError(el: HTMLElement, e: unknown) {
  const msg = e instanceof Error ? e.message : String(e);
  log(`error: ${msg}`);
  let hint = '';
  if (e instanceof DOMException && e.name === 'SecurityError') {
    hint = ' On Linux, install udev/60-digiisp.rules and replug the device.';
  }
  el.innerHTML = `<p class="banner error">${esc(msg)}${hint}</p>`;
}

// --- prompt for manual steps ----------------------------------------------

function ask(text: string): Promise<boolean> {
  const box = $('prompt');
  $('prompt-text').textContent = text;
  box.hidden = false;
  return new Promise((resolve) => {
    const done = (ok: boolean) => {
      box.hidden = true;
      $('btn-prompt-ok').onclick = null;
      $('btn-prompt-cancel').onclick = null;
      resolve(ok);
    };
    $('btn-prompt-ok').onclick = () => done(true);
    $('btn-prompt-cancel').onclick = () => done(false);
  });
}

// --- rendering --------------------------------------------------------------

function fuseTables(f: Fuses): string {
  const table = (title: keyof typeof TINYx5_FUSES, value: number) => {
    const rows = describeFuse(value, TINYx5_FUSES[title])
      .map(({ bit, text, programmed }) => {
        const cls = bit.danger && programmed ? 'danger' : '';
        return `<tr><th>${bit.name}</th><td class="${cls}">${text}</td><td class="hint">${esc(bit.description)}</td></tr>`;
      })
      .join('');
    return `<div><h3>${title} fuse <span class="mono">${hex2(value)}</span></h3><table>${rows}</table></div>`;
  };
  return `<div class="fuses">${table('low', f.low)}${table('high', f.high)}${table('extended', f.extended)}
    <div><h3>lock bits <span class="mono">${hex2(f.lock)}</span></h3></div></div>`;
}

function renderProgrammer(p: UsbAsp) {
  const d = p.device;
  const kinds = { digiisp: 'DigiISP', usbasp: 'USBasp', unknown: 'unknown (speaks USBasp?)' };
  const rows: [string, string][] = [
    ['Device', `${esc(d.manufacturerName ?? '?')} / ${esc(d.productName ?? '?')}`],
    ['Type', kinds[p.kind]],
    ['Capabilities', p.capabilities ? hex2(p.capabilities) + (p.capabilities & CAP_TPI ? ' (TPI)' : '') : 'not reported (old firmware?)'],
  ];
  let extra = '';
  if (p.info) {
    const i = p.info;
    rows.push(
      ['Firmware', `v${i.firmwareVersion}, protocol v${i.protocolVersion}`],
      ['Target reset', i.resetControl
        ? '<span class="ok">driven by PB5</span>'
        : 'not controllable (bootstrap mode): you hold the target in reset'],
      ['OSCCAL', hex2(i.osccal)],
    );
    extra = `<h3>This board's own fuses</h3>${fuseTables(i.fuses)}`;
  }
  programmerEl.innerHTML =
    `<table>${rows.map(([k, v]) => `<tr><th>${k}</th><td>${v}</td></tr>`).join('')}</table>${extra}`;
}

// --- actions ------------------------------------------------------------------

async function connectProgrammer() {
  try {
    programmer = await UsbAsp.request(log);
    log(`opened ${programmer.device.manufacturerName} / ${programmer.device.productName}`);
    renderProgrammer(programmer);
    btnConnect.hidden = true;
    btnDisconnect.hidden = false;
    targetSection.hidden = false;
    targetEl.innerHTML = '';
  } catch (e) {
    if (e instanceof DOMException && e.name === 'NotFoundError') return; // chooser cancelled
    showError(programmerEl, e);
  }
}

async function disconnectProgrammer() {
  await programmer?.close();
  forgetProgrammer();
}

function forgetProgrammer() {
  programmer = null;
  programmerEl.innerHTML = '';
  targetEl.innerHTML = '';
  targetSection.hidden = true;
  btnConnect.hidden = false;
  btnDisconnect.hidden = true;
}

async function readTarget() {
  const p = programmer;
  if (!p) return;
  btnReadTarget.disabled = true;
  targetEl.innerHTML = '';
  let connected = false;
  try {
    if (!(await p.setSck(Number(sckSelect.value)))) {
      log('programmer did not accept SCK setting, using its default');
    }
    await p.connect();
    connected = true;

    if (!p.resetControl) {
      const go = await ask('Press and hold the RESET button of the target (or short its PB5 to GND), then click Continue. Keep holding until told to release.');
      if (!go) return;
    }

    if (!(await p.enableProgramming())) {
      throw new Error('Target does not answer. Check wiring, power and reset, or try a lower SCK.');
    }
    const t = await readTargetInfo(p);
    const sig = Array.from(t.signature, hex2).join(' ');
    const name = partName(t.signature);
    const tiny = name && /^ATtiny[248]5$/.test(name);
    targetEl.innerHTML =
      `<table><tr><th>Signature</th><td class="mono">${sig}</td></tr>` +
      `<tr><th>Part</th><td>${name ?? 'unknown'}</td></tr></table>` +
      (tiny
        ? fuseTables(t.fuses)
        : `<p class="mono">low ${hex2(t.fuses.low)} high ${hex2(t.fuses.high)} ext ${hex2(t.fuses.extended)} lock ${hex2(t.fuses.lock)}</p>`);
  } catch (e) {
    showError(targetEl, e);
  } finally {
    if (connected) {
      try {
        await p.disconnect();
      } catch (e) {
        log(`disconnect failed: ${e}`);
      }
      if (!p.resetControl) targetEl.insertAdjacentHTML('afterbegin', '<p class="banner prompt">You can release the target\'s RESET now.</p>');
    }
    btnReadTarget.disabled = false;
  }
}

// --- init ---------------------------------------------------------------------

for (const o of SCK_OPTIONS) {
  const opt = new Option(o.label, String(o.id), false, o.id === 9);
  sckSelect.add(opt);
}

if (!('usb' in navigator)) {
  $('unsupported').hidden = false;
  btnConnect.disabled = true;
} else {
  navigator.usb.addEventListener('disconnect', (ev) => {
    if (programmer && ev.device === programmer.device) {
      log('programmer unplugged');
      forgetProgrammer();
    }
  });
}

btnConnect.onclick = connectProgrammer;
btnDisconnect.onclick = disconnectProgrammer;
btnReadTarget.onclick = readTarget;
