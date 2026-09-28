// Shared page helpers and state: log, prompts, and the connected programmer.

import { USB_PID, USB_VID } from './protocol';
import { UsbAsp } from './usbasp';

export const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

export function log(line: string) {
  const el = $<HTMLPreElement>('log');
  el.textContent += line + '\n';
  el.scrollTop = el.scrollHeight;
}

export function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}

export function errorText(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  if (e instanceof DOMException && e.name === 'SecurityError') {
    return `${msg} On Linux, install udev/60-digiisp.rules and replug the device.`;
  }
  return msg;
}

export function showError(el: HTMLElement, e: unknown) {
  const msg = errorText(e);
  log(`error: ${msg}`);
  el.innerHTML = `<p class="banner error">${esc(msg)}</p>`;
}

/** True if the user closed the WebUSB chooser without picking a device. */
export function chooserCancelled(e: unknown): boolean {
  return e instanceof DOMException && e.name === 'NotFoundError';
}

/** Show an instruction with Continue/Cancel; resolves true on Continue. */
export function ask(text: string): Promise<boolean> {
  const box = $('prompt');
  $('prompt-text').textContent = text;
  box.hidden = false;
  box.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
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

// --- the connected programmer ---------------------------------------------

type Listener = (p: UsbAsp | null) => void;
let current: UsbAsp | null = null;
const listeners = new Set<Listener>();

export const programmer = {
  get: () => current,
  set(p: UsbAsp | null) {
    current = p;
    if (p) log(`opened ${p.device.manufacturerName} / ${p.device.productName} ${p.device.serialNumber ?? ''}`);
    for (const l of listeners) l(p);
  },
  subscribe(l: Listener) {
    listeners.add(l);
    l(current);
  },
};

/** Let the user pick a programmer. Returns false if they cancelled. */
export async function chooseProgrammer(): Promise<boolean> {
  let device: USBDevice;
  try {
    device = await navigator.usb.requestDevice({ filters: [{ vendorId: USB_VID, productId: USB_PID }] });
  } catch (e) {
    if (chooserCancelled(e)) return false;
    throw e;
  }
  const cur = programmer.get();
  if (cur?.device === device) return true;
  await cur?.close();
  programmer.set(await UsbAsp.open(device, log));
  return true;
}
