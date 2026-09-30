// Firmware images bundled with the app: DigiISP, and Micronucleus for
// complete images written over ISP.

// the released firmware (make -C firmware release), so building the page needs no AVR toolchain
import digiIspHex from '../../firmware/release/digiisp.hex?raw';
import micronucleusHex from '../../firmware/bootloader/micronucleus-2.6-t85_default.hex?raw';
import upgradeHex from '../../firmware/bootloader/micronucleus-2.6-t85_default-upgrade.hex?raw';
import protocolH from '../../firmware/protocol.h?raw';
import { parseIntelHex } from './ihex';
import { layoutApplication } from './micronucleus';

/** ATtiny85 with Micronucleus 2.x t85_default. */
export const T85 = {
  signature: [0x1e, 0x93, 0x0b],
  flashSize: 8192,
  pageSize: 64,
  bootloaderStart: 0x1a00,
  appSize: 0x1a00 - 6, // minus Micronucleus' postscript
} as const;

/** Digispark fuses; hfuse 0xDD keeps reset, 0x5D turns PB5 into I/O. */
export const DIGISPARK_FUSES = { low: 0xe1, extended: 0xfe, highReset: 0xdd, highNoReset: 0x5d } as const;

/** The released firmware as Intel HEX text (for downloading). */
export const DIGIISP_HEX = digiIspHex;

export function digiIspApplication() {
  return parseIntelHex(digiIspHex, T85.flashSize);
}

/** Micronucleus plus DigiISP, laid out as a Micronucleus upload would leave it. */
export function fullImage(): Uint8Array {
  const boot = parseIntelHex(micronucleusHex, T85.flashSize);
  if (boot.used.subarray(0, T85.bootloaderStart).some((u) => u)) {
    throw new Error('bundled Micronucleus has data below 0x1A00');
  }
  const image = new Uint8Array(T85.flashSize).fill(0xff);
  image.set(layoutApplication(digiIspApplication(), T85.appSize, T85.bootloaderStart));
  image.set(boot.data.subarray(T85.bootloaderStart), T85.bootloaderStart);
  return image;
}

// --- firmware updates ---------------------------------------------------------------


/** The DigiISP firmware version bundled with this page (DIGIISP_FW_VERSION). */
export const FIRMWARE_VERSION = Number(/#define\s+DIGIISP_FW_VERSION\s+(\d+)/.exec(protocolH)?.[1] ?? 0);

/** Micronucleus 2.6 upgrader: an application that replaces the bootloader. */
export function upgradeApplication() {
  return parseIntelHex(upgradeHex, T85.flashSize);
}
