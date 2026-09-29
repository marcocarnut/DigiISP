// Micronucleus bootloader client over WebUSB, following the upstream
// command line tool (commandline/library/micronucleus_lib.c). Speaks v2 and
// v1 (which new Digisparks still ship with).

import { t } from './i18n';
import type { MemoryImage } from './ihex';

export const MICRONUCLEUS_VID = 0x16d0;
export const MICRONUCLEUS_PID = 0x0753;

const CMD_INFO = 0;
const CMD_TRANSFER_PAGE = 1;
const CMD_ERASE = 2;
const CMD_WRITE_DATA = 3;
const CMD_RUN = 4;

export interface MicronucleusInfo {
  version: string;
  major: number;
  /** bcdDevice low byte, e.g. 6 for v1.06 */
  minor: number;
  /** Bytes available to the application (bootloader start minus postscript). */
  flashSize: number;
  pageSize: number;
  /** Where the bootloader starts: flashSize rounded up to a page. */
  bootloaderStart: number;
  /** ms to wait after writing a page / erasing. */
  writeSleep: number;
  eraseSleep: number;
  /** Signature bytes 2 and 3 (e.g. 0x93 0x0B for the ATtiny85); v1 doesn't report them. */
  signature: [number, number] | null;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** rjmp from word address `from` to word address `to` (12 bit, wraps around 8 KB). */
const rjmp = (from: number, to: number) => 0xc000 | ((to - from - 1) & 0x0fff);

/**
 * Lay out an application for Micronucleus, as its upload tool does: the reset
 * vector jumps to the bootloader, and the application's own reset target is
 * moved into an rjmp at bootloaderStart - 4, which the bootloader jumps to
 * when it exits. Returns bootloaderStart bytes. The OSCCAL byte at
 * bootloaderStart - 6 stays 0xFF (the bootloader fills it when it writes).
 */
export function layoutApplication(app: MemoryImage, flashSize: number, bootloaderStart: number): Uint8Array<ArrayBuffer> {
  if (bootloaderStart > 0x2000) throw new Error('only devices up to 8 KB are supported');
  if (app.end > flashSize) {
    throw new Error(t('err.mn.tooBig', { n: app.end, max: flashSize }));
  }
  const out = new Uint8Array(bootloaderStart).fill(0xff);
  out.set(app.data.subarray(0, app.end));

  const word0 = out[0] | (out[1] << 8);
  let userReset: number; // word address
  if (word0 === 0x940c) {
    userReset = out[2] | (out[3] << 8);
  } else if ((word0 & 0xf000) === 0xc000) {
    userReset = ((word0 & 0x0fff) + 1) & 0x0fff;
  } else {
    throw new Error(t('err.mn.noJump'));
  }
  const toBoot = rjmp(0, bootloaderStart / 2);
  out[0] = toBoot & 0xff;
  out[1] = toBoot >> 8;
  const at = bootloaderStart - 4;
  const toApp = rjmp(at / 2, userReset);
  out[at] = toApp & 0xff;
  out[at + 1] = toApp >> 8;
  return out;
}

export class Micronucleus {
  private constructor(
    readonly device: USBDevice,
    readonly info: MicronucleusInfo,
  ) {}

  /** Ask the user to pick the bootloader (must be called from a user gesture). */
  static async request(): Promise<Micronucleus> {
    const device = await navigator.usb.requestDevice({
      filters: [{ vendorId: MICRONUCLEUS_VID, productId: MICRONUCLEUS_PID }],
    });
    await device.open();
    if (device.configuration === null) await device.selectConfiguration(1);
    await device.claimInterface(0);
    // bcdDevice is major.minor as two bytes; WebUSB splits the minor byte in nibbles
    const major = device.deviceVersionMajor;
    const minor = (device.deviceVersionMinor << 4) | device.deviceVersionSubminor;
    const version = `${major}.${minor.toString().padStart(2, '0')}`;
    if (major < 1 || major > 2) {
      await device.close();
      throw new Error(t('err.mn.unsupported', { version }));
    }
    const r = await device.controlTransferIn(
      { requestType: 'vendor', recipient: 'device', request: CMD_INFO, value: 0, index: 0 },
      major >= 2 ? 8 : 4,
    );
    if (r.status !== 'ok' || !r.data || r.data.byteLength < (major >= 2 ? 6 : 4)) {
      await device.close();
      throw new Error(t('err.mn.noInfo'));
    }
    const b = new Uint8Array(r.data.buffer, r.data.byteOffset, r.data.byteLength);
    const flashSize = (b[0] << 8) | b[1];
    const pageSize = b[2];
    const pages = Math.ceil(flashSize / pageSize);
    // v2: the tool adds 2 ms unless in fast mode
    const writeSleep = (b[3] & 0x7f) + (major >= 2 ? 2 : 0);
    const info: MicronucleusInfo = {
      version,
      major,
      minor,
      flashSize,
      pageSize,
      bootloaderStart: pages * pageSize,
      writeSleep,
      eraseSleep: b[3] & 0x80 ? (writeSleep * pages) / 4 : writeSleep * pages,
      signature: major >= 2 ? [b[4], b[5]] : null,
    };
    return new Micronucleus(device, info);
  }

  private async out(request: number, value = 0, index = 0): Promise<void> {
    const r = await this.device.controlTransferOut({ requestType: 'vendor', recipient: 'device', request, value, index });
    if (r.status !== 'ok') throw new Error(`Micronucleus request ${request} failed: ${r.status}`);
  }

  async erase(): Promise<void> {
    try {
      await this.out(CMD_ERASE);
    } catch {
      // the device stops answering while it erases, as the upstream tool notes
    }
    await sleep(this.info.eraseSleep);
  }

  /** The flash image to write for an application: v2 needs the host to
   * relocate the reset vector, v1 bootloaders do that themselves. */
  prepare(app: MemoryImage): Uint8Array<ArrayBuffer> {
    const { flashSize, bootloaderStart } = this.info;
    if (this.info.major >= 2) return layoutApplication(app, flashSize, bootloaderStart);
    if (app.end > flashSize) {
      throw new Error(t('err.mn.tooBig', { n: app.end, max: flashSize }));
    }
    const out = new Uint8Array(bootloaderStart).fill(0xff);
    out.set(app.data.subarray(0, app.end));
    return out;
  }

  /** Write an image made by prepare(). */
  async write(image: Uint8Array<ArrayBuffer>, progress: (fraction: number) => void): Promise<void> {
    const { flashSize, pageSize, bootloaderStart, writeSleep, major, minor } = this.info;
    for (let address = 0; address < flashSize; address += pageSize) {
      const last = address >= bootloaderStart - pageSize;
      let length = pageSize;
      // like the upstream tool: v1.00-1.02 want a short last page
      if (major === 1 && minor <= 2 && last) length = flashSize % pageSize || pageSize;
      const page = image.slice(address, address + length);
      // page 0 carries the reset vector, the last page the application's entry jump
      if (address === 0 || last || page.some((x) => x !== 0xff)) {
        if (major >= 2) {
          await this.out(CMD_TRANSFER_PAGE, length, address);
          for (let i = 0; i < length; i += 4) {
            await this.out(CMD_WRITE_DATA, page[i] | (page[i + 1] << 8), page[i + 2] | (page[i + 3] << 8));
          }
        } else {
          const r = await this.device.controlTransferOut(
            { requestType: 'vendor', recipient: 'device', request: CMD_TRANSFER_PAGE, value: length, index: address },
            page,
          );
          if (r.status !== 'ok') throw new Error(`Micronucleus page write at 0x${address.toString(16)} failed: ${r.status}`);
        }
        await sleep(writeSleep);
      }
      progress((address + pageSize) / flashSize);
    }
  }

  /** Release the device without starting the application. Micronucleus
   * only exits by itself once the application's entry jump (written last)
   * is in place, so an interrupted upload stays in the bootloader. */
  async close(): Promise<void> {
    try {
      await this.device.close();
    } catch {
      // already gone
    }
  }

  /** Start the application; the bootloader disconnects. */
  async run(): Promise<void> {
    try {
      await this.out(CMD_RUN);
    } catch {
      // it may leave the bus before the status stage completes
    }
    try {
      await this.device.close();
    } catch {
      // already gone
    }
  }
}
