// Micronucleus v2 bootloader client over WebUSB, following the upstream
// command line tool (commandline/library/micronucleus_lib.c).

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
  /** Bytes available to the application (bootloader start minus postscript). */
  flashSize: number;
  pageSize: number;
  /** Where the bootloader starts: flashSize rounded up to a page. */
  bootloaderStart: number;
  /** ms to wait after writing a page / erasing. */
  writeSleep: number;
  eraseSleep: number;
  /** Signature bytes 2 and 3 (e.g. 0x93 0x0B for the ATtiny85). */
  signature: [number, number];
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
export function layoutApplication(app: MemoryImage, flashSize: number, bootloaderStart: number): Uint8Array {
  if (bootloaderStart > 0x2000) throw new Error('only devices up to 8 KB are supported');
  if (app.end > flashSize) {
    throw new Error(`firmware is ${app.end} bytes, only ${flashSize} fit next to the bootloader`);
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
    throw new Error('the firmware reset vector is not a jump, the bootloader can not be inserted');
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
    if (device.deviceVersionMajor < 2) {
      await device.close();
      throw new Error(`Micronucleus ${device.deviceVersionMajor}.${device.deviceVersionMinor} is too old, v2 is needed`);
    }
    const r = await device.controlTransferIn(
      { requestType: 'vendor', recipient: 'device', request: CMD_INFO, value: 0, index: 0 },
      8,
    );
    if (r.status !== 'ok' || !r.data || r.data.byteLength < 6) {
      await device.close();
      throw new Error('Micronucleus did not answer the info request, replug the board and try again');
    }
    const b = new Uint8Array(r.data.buffer, r.data.byteOffset, r.data.byteLength);
    const flashSize = (b[0] << 8) | b[1];
    const pageSize = b[2];
    const pages = Math.ceil(flashSize / pageSize);
    const writeSleep = (b[3] & 0x7f) + 2; // the tool adds 2 ms unless in fast mode
    const info: MicronucleusInfo = {
      version: `${device.deviceVersionMajor}.${device.deviceVersionMinor}`,
      flashSize,
      pageSize,
      bootloaderStart: pages * pageSize,
      writeSleep,
      eraseSleep: b[3] & 0x80 ? (writeSleep * pages) / 4 : writeSleep * pages,
      signature: [b[4], b[5]],
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

  /** Write an image laid out by layoutApplication(). */
  async write(image: Uint8Array, progress: (fraction: number) => void): Promise<void> {
    const { flashSize, pageSize, bootloaderStart, writeSleep } = this.info;
    for (let address = 0; address < flashSize; address += pageSize) {
      const page = image.subarray(address, address + pageSize);
      const last = address >= bootloaderStart - pageSize;
      // page 0 carries the reset vector, the last page the application's entry jump
      if (address === 0 || last || page.some((x) => x !== 0xff)) {
        await this.out(CMD_TRANSFER_PAGE, pageSize, address);
        for (let i = 0; i < pageSize; i += 4) {
          await this.out(CMD_WRITE_DATA, page[i] | (page[i + 1] << 8), page[i + 2] | (page[i + 3] << 8));
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
