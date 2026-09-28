// AVR part database (generated from avrdude by scripts/gen-parts.mjs) and
// ISP commands built from avrdude's opcode strings.

export interface SmallMemory {
  size: number;
  /** avrdude opcode, 32 chars MSB first: 0/1 fixed, x don't care,
   * a address bit, i input bit, o output bit */
  read?: string;
  write?: string;
  /** µs to wait after a write */
  delay?: number;
}

export interface Part {
  id: string;
  name: string;
  signature: [number, number, number];
  /** µs */
  chipEraseDelay: number;
  flash: { size: number; page: number; paged: boolean; extAddr: boolean; delay?: number };
  eeprom: (SmallMemory & { page: number; paged: boolean }) | null;
  /** fuse, lfuse, hfuse, efuse, lock, signature, calibration (as the part has them) */
  mems: Record<string, SmallMemory>;
  /** key into PartDb.config */
  config: string | null;
}

export interface ConfigItem {
  name: string;
  /** key into PartDb.values */
  values: string | null;
  /** lfuse, hfuse, efuse, fuse or lock */
  mem: string;
  mask: number;
  shift: number;
  initval: number;
  description: string;
}

/** [value, label, comment] */
export type ConfigValue = [number, string, string];

export interface PartDb {
  parts: Part[];
  config: Record<string, ConfigItem[]>;
  values: Record<string, ConfigValue[]>;
}

let db: Promise<PartDb> | null = null;

/** The database is big, so it is loaded on first use. */
export function loadParts(): Promise<PartDb> {
  db ??= import('./parts.json').then((m) => m.default as unknown as PartDb);
  return db;
}

export async function partBySignature(sig: ArrayLike<number>): Promise<Part | undefined> {
  const { parts } = await loadParts();
  return parts.find((p) => p.signature.every((b, i) => b === sig[i]));
}

/** Fuse memories in display order. */
export function fuseMemories(part: Part): string[] {
  return ['lfuse', 'hfuse', 'efuse', 'fuse'].filter((m) => part.mems[m]);
}

// --- opcodes ------------------------------------------------------------------

/** Build the 4 command bytes of an opcode for an address and input byte. */
export function encodeOp(op: string, address = 0, input = 0): [number, number, number, number] {
  if (op.length !== 32) throw new Error(`bad opcode ${op}`);
  const cmd: [number, number, number, number] = [0, 0, 0, 0];
  for (let i = 0; i < 32; i++) {
    const pos = 31 - i; // bit position in the 32 bit command
    let bit = 0;
    switch (op[i]) {
      case '1':
        bit = 1;
        break;
      case 'a': // address bits live in bytes 2 and 3
        bit = (address >> (pos - 8)) & 1;
        break;
      case 'i':
        bit = (input >> pos) & 1;
        break;
    }
    if (bit) cmd[i >> 3] |= 0x80 >> (i & 7);
  }
  return cmd;
}

/** Collect the output bits of an opcode from the 4 bytes shifted back. */
export function decodeOp(op: string, reply: ArrayLike<number>): number {
  let value = 0;
  for (let i = 0; i < 32; i++) {
    if (op[i] === 'o' && reply[i >> 3] & (0x80 >> (i & 7))) value |= 1 << (31 - i);
  }
  return value;
}
