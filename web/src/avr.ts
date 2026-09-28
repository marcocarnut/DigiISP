// AVR ISP helpers: signature lookup, fuse reading and decoding.
// A full part database (generated from avrdude.conf) comes in Phase 4.

import type { UsbAsp } from './usbasp';

const SIGNATURES: Record<string, string> = {
  '1e9007': 'ATtiny13',
  '1e9108': 'ATtiny25',
  '1e910a': 'ATtiny2313',
  '1e9206': 'ATtiny45',
  '1e9207': 'ATtiny44',
  '1e920d': 'ATtiny4313',
  '1e930b': 'ATtiny85',
  '1e930c': 'ATtiny84',
  '1e9307': 'ATmega8',
  '1e9406': 'ATmega168',
  '1e940b': 'ATmega168P',
  '1e950f': 'ATmega328P',
  '1e9514': 'ATmega328',
  '1e9587': 'ATmega32U4',
  '1e960a': 'ATmega644P',
  '1e9705': 'ATmega1284P',
  '1e9801': 'ATmega2560',
};

export function partName(sig: Uint8Array): string | undefined {
  return SIGNATURES[Array.from(sig, (b) => b.toString(16).padStart(2, '0')).join('')];
}

export interface Fuses {
  low: number;
  high: number;
  extended: number;
  lock: number;
}

export interface TargetInfo {
  signature: Uint8Array;
  fuses: Fuses;
}

/** Read signature, fuses and lock bits. Target must be in programming mode. */
export async function readTargetInfo(p: UsbAsp): Promise<TargetInfo> {
  const signature = new Uint8Array(3);
  for (let i = 0; i < 3; i++) signature[i] = (await p.spi([0x30, 0x00, i, 0x00]))[3];
  const fuses: Fuses = {
    low: (await p.spi([0x50, 0x00, 0x00, 0x00]))[3],
    high: (await p.spi([0x58, 0x08, 0x00, 0x00]))[3],
    extended: (await p.spi([0x50, 0x08, 0x00, 0x00]))[3],
    lock: (await p.spi([0x58, 0x00, 0x00, 0x00]))[3],
  };
  return { signature, fuses };
}

// Fuse bit meanings for the ATtiny25/45/85. A programmed fuse bit reads 0.

export interface FuseBit {
  name: string;
  mask: number;
  description: string;
  /** Programming this bit is dangerous (locks out ISP). */
  danger?: boolean;
}

export const TINYx5_FUSES: Record<keyof Omit<Fuses, 'lock'>, FuseBit[]> = {
  low: [
    { name: 'CKDIV8', mask: 0x80, description: 'divide clock by 8' },
    { name: 'CKOUT', mask: 0x40, description: 'clock output on PB4' },
    { name: 'SUT', mask: 0x30, description: 'start-up time' },
    { name: 'CKSEL', mask: 0x0f, description: 'clock source' },
  ],
  high: [
    { name: 'RSTDISBL', mask: 0x80, description: 'PB5 is I/O, not reset', danger: true },
    { name: 'DWEN', mask: 0x40, description: 'debugWIRE enabled', danger: true },
    { name: 'SPIEN', mask: 0x20, description: 'serial programming enabled' },
    { name: 'WDTON', mask: 0x10, description: 'watchdog always on' },
    { name: 'EESAVE', mask: 0x08, description: 'keep EEPROM on chip erase' },
    { name: 'BODLEVEL', mask: 0x07, description: 'brown-out detector level' },
  ],
  extended: [{ name: 'SELFPRGEN', mask: 0x01, description: 'self-programming enabled' }],
};

export function hex2(v: number): string {
  return '0x' + v.toString(16).toUpperCase().padStart(2, '0');
}

/** Human readable fuse fields. Single bits show "programmed"/"unprogrammed". */
export function describeFuse(value: number, bits: FuseBit[]): { bit: FuseBit; text: string; programmed: boolean }[] {
  return bits.map((bit) => {
    const field = value & bit.mask;
    const single = (bit.mask & (bit.mask - 1)) === 0;
    if (single) {
      const programmed = field === 0;
      return { bit, text: programmed ? 'programmed' : 'unprogrammed', programmed };
    }
    const shift = Math.log2(bit.mask & -bit.mask);
    return { bit, text: String(field >> shift), programmed: false };
  });
}

// --- programming ---------------------------------------------------------

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Poll RDY/BSY until the target is idle (timeout in ms). */
export async function waitReady(p: UsbAsp, timeout = 100): Promise<void> {
  const until = performance.now() + timeout;
  for (;;) {
    if (((await p.spi([0xf0, 0x00, 0x00, 0x00]))[3] & 1) === 0) return;
    if (performance.now() > until) throw new Error('target stays busy');
    await sleep(2);
  }
}

export async function chipErase(p: UsbAsp): Promise<void> {
  await p.spi([0xac, 0x80, 0x00, 0x00]);
  await sleep(10); // tWD_ERASE is 4.5 ms on the ATtiny25/45/85
  await waitReady(p);
}

type Progress = (fraction: number) => void;

/** Write every page that isn't blank. Assumes a chip erase before. */
export async function writeFlash(p: UsbAsp, image: Uint8Array, pageSize: number, progress: Progress): Promise<void> {
  for (let a = 0; a < image.length; a += pageSize) {
    const page = image.slice(a, a + pageSize);
    if (page.some((b) => b !== 0xff)) await p.writeFlashPage(a, page, pageSize);
    progress((a + pageSize) / image.length);
  }
}

export async function readFlash(p: UsbAsp, size: number, progress: Progress): Promise<Uint8Array> {
  const out = new Uint8Array(size);
  const block = 128;
  for (let a = 0; a < size; a += block) {
    out.set(await p.readFlash(a, Math.min(block, size - a)), a);
    progress(Math.min(a + block, size) / size);
  }
  return out;
}

const FUSE_WRITE: Record<keyof Omit<Fuses, 'lock'>, [number, number]> = {
  low: [0xac, 0xa0],
  high: [0xac, 0xa8],
  extended: [0xac, 0xa4],
};

export async function writeFuse(p: UsbAsp, which: keyof typeof FUSE_WRITE, value: number): Promise<void> {
  const [a, b] = FUSE_WRITE[which];
  await p.spi([a, b, 0x00, value]);
  await sleep(10); // tWD_FUSE is 4.5 ms
  await waitReady(p);
}
