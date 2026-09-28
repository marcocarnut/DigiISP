import './style.css';
import { describeFuse, Fuses, hex2, TINYx5_FUSES } from './avr';
import { initBootstrap } from './bootstrap';
import { CAP_TPI, SCK_OPTIONS, USB_PID, USB_VID } from './protocol';
import { initTarget } from './target';
import { $, chooseProgrammer, esc, log, programmer, showError } from './ui';
import { UsbAsp } from './usbasp';

const programmerEl = $('programmer');
const targetSection = $('target-section');
const btnConnect = $<HTMLButtonElement>('btn-connect');
const btnDisconnect = $<HTMLButtonElement>('btn-disconnect');
const btnReboot = $<HTMLButtonElement>('btn-reboot');
const sckSelect = $<HTMLSelectElement>('sck');

// --- tabs -----------------------------------------------------------------

const TABS = ['devices', 'bootstrap'] as const;

function showTab() {
  const name = location.hash.slice(1);
  const tab = (TABS as readonly string[]).includes(name) ? name : 'devices'; // also old #programmer links
  for (const t of TABS) {
    $(`tab-${t}`).hidden = t !== tab;
    document.querySelector(`nav a[href="#${t}"]`)?.classList.toggle('active', t === tab);
  }
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

function renderProgrammer(p: UsbAsp | null) {
  btnConnect.hidden = !!p;
  btnDisconnect.hidden = !p;
  btnReboot.hidden = p?.kind !== 'digiisp';
  targetSection.hidden = !p;
  if (!p) {
    programmerEl.innerHTML = '';
    return;
  }
  $('manual-reset-row').hidden = !(p.info?.resetControl ?? false);
  const d = p.device;
  const kinds = { digiisp: 'DigiISP', usbasp: 'USBasp', unknown: 'unknown (speaks USBasp?)' };
  const rows: [string, string][] = [
    ['Device', `${esc(d.manufacturerName ?? '?')} / ${esc(d.productName ?? '?')}`],
    ['Serial', d.serialNumber ? `<span class="mono">${esc(d.serialNumber)}</span>` : 'none (Chrome forgets permission on replug)'],
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
  const reset = p.info ? (p.info.resetControl ? 'drives target reset' : 'bootstrap mode') : '';
  const summary = [kinds[p.kind], d.serialNumber, reset].filter(Boolean).map((s) => esc(s!)).join(' · ');
  programmerEl.innerHTML =
    `<details class="section"><summary>${summary}</summary>` +
    `<table>${rows.map(([k, v]) => `<tr><th>${k}</th><td>${v}</td></tr>`).join('')}</table>${extra}</details>`;
}

// --- actions ------------------------------------------------------------------

async function connectProgrammer() {
  try {
    await chooseProgrammer();
  } catch (e) {
    showError(programmerEl, e);
  }
}

/** Open a device we already have permission for, e.g. after a replug or reload. */
async function autoConnect(device?: USBDevice) {
  if (programmer.get()) return;
  const candidates = device ? [device] : await UsbAsp.permitted();
  if (candidates.length !== 1) return;
  try {
    programmer.set(await UsbAsp.open(candidates[0], log));
  } catch (e) {
    log(`auto-connect failed: ${e instanceof Error ? e.message : e}`);
  }
}

async function rebootProgrammer() {
  const p = programmer.get();
  if (!p) return;
  try {
    await p.reboot();
    log('rebooting into bootloader');
  } catch (e) {
    showError(programmerEl, e);
  }
}

async function disconnectProgrammer() {
  await programmer.get()?.close();
  programmer.set(null);
}

// --- init ---------------------------------------------------------------------

for (const o of SCK_OPTIONS) {
  const opt = new Option(o.label, String(o.id), false, o.id === 9);
  sckSelect.add(opt);
}

window.addEventListener('hashchange', showTab);
showTab();

programmer.subscribe(renderProgrammer);
initBootstrap();
initTarget();

if (!('usb' in navigator)) {
  $('unsupported').hidden = false;
  btnConnect.disabled = true;
} else {
  navigator.usb.addEventListener('connect', (ev) => {
    if (ev.device.vendorId === USB_VID && ev.device.productId === USB_PID) {
      log('programmer plugged in');
      void autoConnect(ev.device);
    }
  });
  void autoConnect();
  navigator.usb.addEventListener('disconnect', (ev) => {
    if (ev.device === programmer.get()?.device) {
      log('programmer unplugged');
      programmer.set(null);
    }
  });
}

btnConnect.onclick = connectProgrammer;
btnDisconnect.onclick = disconnectProgrammer;
btnReboot.onclick = rebootProgrammer;
