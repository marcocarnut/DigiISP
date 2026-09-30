import './style.css';
import { describeFuse, Fuses, hex2, TINYx5_FUSES } from './avr';
import { initBootstrap } from './bootstrap';
import { initDownload } from './download';
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
/** The update's outcome is on screen (kept visible for a few seconds). */
let fwNotice = false;

/** Is the firmware older than the page's, or the bootloader older than 2.6? */
function needsUpdate(p: UsbAsp | null): boolean {
  if (p?.kind !== 'digiisp' || !p.info) return false;
  const b = p.info.bootloader;
  return p.info.firmwareVersion < FIRMWARE_VERSION || (!!b && (b.major < 2 || (b.major === 2 && b.minor < 6)));
}
const sckSelect = $<HTMLSelectElement>('sck');

// --- tabs -----------------------------------------------------------------

const TABS = ['devices', 'bootstrap', 'download'] as const;

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

function bootloaderText(b: { major: number; minor: number } | null): string {
  if (!b) return esc(t('boot.unknown'));
  const v = `${b.major}.${String(b.minor).padStart(2, '0')}`;
  return b.major > 2 || (b.major === 2 && b.minor >= 6)
    ? esc(t('boot.version', { v }))
    : `<span class="danger">${esc(t('boot.version.old', { v }))}</span>`;
}

function renderProgrammer(p: UsbAsp | null) {
  btnConnect.hidden = !!p;
  btnDisconnect.hidden = !p;
  btnReboot.hidden = p?.kind !== 'digiisp';
  btnFwUpdate.hidden = !needsUpdate(p);
  $('fw-update').hidden = !(fwBusy || fwNotice || needsUpdate(p));
  // the upgrade option only matters when the bootloader is old or unknown
  const bl = p?.info?.bootloader;
  $('fw-upgrade-row').hidden = !!bl && (bl.major > 2 || (bl.major === 2 && bl.minor >= 6));
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
      [t('prog.row.bootloader'), bootloaderText(i.bootloader)],
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

/** Open a device we already have permission for, e.g. after a replug or
 * reload. A freshly plugged device may not open at once (seen on Android),
 * so opening is retried a few times. Returns whether a programmer is open. */
async function autoConnect(device?: USBDevice): Promise<boolean> {
  for (let attempt = 0; attempt < 4; attempt++) {
    if (programmer.get()) return true;
    const candidates = device ? [device] : await UsbAsp.permitted();
    if (candidates.length !== 1) return false;
    try {
      programmer.set(await UsbAsp.open(candidates[0], log));
      return true;
    } catch (e) {
      log(`auto-connect failed: ${e instanceof Error ? e.message : e}`);
      try {
        await candidates[0].close();
      } catch {
        // not open
      }
      await sleep(700);
    }
  }
  return false;
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
      // DigiISP comes back with the same serial: wait for it (the connect
      // event may be missed, so also look for it every second)
      let back = false;
      for (let s = 0; s < 15 && !back; s++) {
        await sleep(1000);
        back = !!programmer.get() || (await autoConnect());
      }
      if (back) {
        list.clear();
        bar.hidden = true;
        status(statusEl, esc(t('fw.reconnected')), 'ok-banner');
        fwNotice = true;
        setTimeout(() => {
          fwNotice = false;
          status(statusEl, '');
          renderProgrammer(programmer.get());
        }, 6000);
      } else {
        status(statusEl, t('fw.reconnectManual'), 'prompt');
        fwNotice = true;
        setTimeout(() => {
          fwNotice = false;
          status(statusEl, '');
          renderProgrammer(programmer.get());
        }, 30000);
      }
    }
  } catch (e) {
    log(`firmware update: ${errorText(e)}`);
    status(statusEl, esc(errorText(e)), 'error');
  } finally {
    fwBusy = false;
    btnFwUpdate.disabled = false;
    renderProgrammer(programmer.get());
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
initDownload();

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
