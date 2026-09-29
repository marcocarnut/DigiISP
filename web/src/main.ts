import './style.css';
import { describeFuse, Fuses, hex2, TINYx5_FUSES } from './avr';
import { initBootstrap } from './bootstrap';
import { installDigiIsp, pickBootloader } from './firmware';
import { FIRMWARE_VERSION } from './images';
import { applyStatic, languageSelect, onLang, t } from './i18n';
import { CAP_TPI, SCK_OPTIONS, USB_PID, USB_VID } from './protocol';
import { initTarget } from './target';
import { $, Checklist, chooseProgrammer, errorText, esc, expandHint, log, programmer, showError, status } from './ui';
import { UsbAsp } from './usbasp';

const programmerEl = $('programmer');
const targetSection = $('target-section');
const btnConnect = $<HTMLButtonElement>('btn-connect');
const btnDisconnect = $<HTMLButtonElement>('btn-disconnect');
const btnReboot = $<HTMLButtonElement>('btn-reboot');
const btnFwUpdate = $<HTMLButtonElement>('btn-fw-update');
/** A firmware update is running (the programmer is away in its bootloader meanwhile). */
let fwBusy = false;
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
        return `<tr><th>${bit.name}</th><td class="${cls}">${text}</td><td class="hint">${esc(t(bit.description))}</td></tr>`;
      })
      .join('');
    const name = { low: 'lfuse', high: 'hfuse', extended: 'efuse' }[title];
    return `<div><h3>${esc(t('fuse.table.title', { name }))} <span class="mono">${hex2(value)}</span></h3><table>${rows}</table></div>`;
  };
  return `<div class="fuses">${table('low', f.low)}${table('high', f.high)}${table('extended', f.extended)}
    <div><h3>${esc(t('fuse.lockbits'))} <span class="mono">${hex2(f.lock)}</span></h3></div></div>`;
}

function renderProgrammer(p: UsbAsp | null) {
  btnConnect.hidden = !!p;
  btnDisconnect.hidden = !p;
  btnReboot.hidden = p?.kind !== 'digiisp';
  btnFwUpdate.hidden = p?.kind !== 'digiisp';
  $('fw-update').hidden = !(fwBusy || p?.kind === 'digiisp');
  targetSection.hidden = !p;
  if (!p) {
    programmerEl.innerHTML = '';
    return;
  }
  $('manual-reset-row').hidden = !(p.info?.resetControl ?? false);
  const d = p.device;
  const kinds = { digiisp: 'DigiISP', usbasp: 'USBasp', unknown: t('prog.kind.unknown') };
  const rows: [string, string][] = [
    [t('prog.row.device'), `${esc(d.manufacturerName ?? '?')} / ${esc(d.productName ?? '?')}`],
    [t('prog.row.serial'), d.serialNumber ? `<span class="mono">${esc(d.serialNumber)}</span>` : esc(t('prog.serial.none'))],
    [t('prog.row.type'), esc(kinds[p.kind])],
    [t('prog.row.caps'), p.capabilities ? hex2(p.capabilities) + (p.capabilities & CAP_TPI ? ' (TPI)' : '') : esc(t('prog.caps.none'))],
  ];
  let extra = '';
  if (p.info) {
    const i = p.info;
    rows.push(
      [t('prog.row.firmware'), i.firmwareVersion >= FIRMWARE_VERSION
        ? esc(t('fw.version.latest', { fw: i.firmwareVersion, proto: i.protocolVersion }))
        : `<span class="danger">${esc(t('fw.version.old', { fw: i.firmwareVersion, proto: i.protocolVersion, latest: FIRMWARE_VERSION }))}</span>`],
      [t('prog.row.reset'), i.resetControl
        ? `<span class="ok">${esc(t('prog.reset.driven'))}</span>`
        : esc(t('prog.reset.manual'))],
      ['OSCCAL', hex2(i.osccal)],
    );
    extra = `<h3>${esc(t('prog.ownFuses'))}</h3>${fuseTables(i.fuses)}`;
  }
  const reset = p.info ? t(p.info.resetControl ? 'prog.summary.driven' : 'prog.summary.bootstrap') : '';
  const summary = [kinds[p.kind], d.serialNumber, reset].filter(Boolean).map((s) => esc(s!)).join(' · ');
  const open = programmerEl.querySelector('details')?.open ? ' open' : '';
  programmerEl.innerHTML =
    `<details class="section"${open}><summary>${summary} ${expandHint()}</summary>` +
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

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Reboot the DigiISP into Micronucleus and install the bundled firmware. */
async function updateFirmware() {
  const p = programmer.get();
  if (!p) return;
  const list = new Checklist($('fw-steps'));
  const bar = $<HTMLProgressElement>('fw-progress');
  const statusEl = $('fw-status');
  list.clear();
  bar.hidden = true;
  fwBusy = true;
  btnFwUpdate.disabled = true;
  $('fw-update').hidden = false;
  try {
    await p.reboot();
    status(statusEl, esc(t('fw.updating')), 'prompt');
    // the bootloader enumerates within a second; the picker still counts as
    // opened by the click (Chrome allows about 5 s)
    await sleep(1500);
    const m = await pickBootloader();
    status(statusEl, '');
    if (!m) {
      status(statusEl, esc(t('fw.noBootloader')), 'error');
      return;
    }
    if (await installDigiIsp(m, $<HTMLInputElement>('fw-upgrade').checked, list, bar)) {
      status(statusEl, t('fw.done'), 'ok-banner');
    }
  } catch (e) {
    log(`firmware update: ${errorText(e)}`);
    status(statusEl, esc(errorText(e)), 'error');
  } finally {
    fwBusy = false;
    btnFwUpdate.disabled = false;
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

languageSelect($<HTMLSelectElement>('lang'));
applyStatic();
onLang(() => renderProgrammer(programmer.get()));

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
btnFwUpdate.onclick = updateFirmware;
