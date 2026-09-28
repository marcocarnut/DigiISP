// Intel HEX parsing into a flat memory image.

export interface MemoryImage {
  /** Memory contents, unused bytes are 0xFF. */
  data: Uint8Array;
  /** Which bytes were set by the hex file. */
  used: Uint8Array;
  /** One past the highest address set. */
  end: number;
}

export function emptyImage(size: number): MemoryImage {
  return { data: new Uint8Array(size).fill(0xff), used: new Uint8Array(size), end: 0 };
}

/** Parse Intel HEX (record types 00, 01, 02, 04) into an image of `size` bytes. */
export function parseIntelHex(text: string, size: number): MemoryImage {
  const img = emptyImage(size);
  let base = 0;
  const lines = text.split(/\r?\n/);
  for (let n = 0; n < lines.length; n++) {
    const line = lines[n].trim();
    if (!line) continue;
    if (line[0] !== ':' || line.length < 11 || line.length % 2 !== 1) {
      throw new Error(`hex line ${n + 1}: malformed`);
    }
    const bytes = new Uint8Array((line.length - 1) / 2);
    for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(line.substr(1 + 2 * i, 2), 16);
    const len = bytes[0];
    if (bytes.length !== len + 5) throw new Error(`hex line ${n + 1}: length mismatch`);
    if (bytes.reduce((a, b) => a + b, 0) & 0xff) throw new Error(`hex line ${n + 1}: bad checksum`);
    const addr = (bytes[1] << 8) | bytes[2];
    const type = bytes[3];
    const payload = bytes.subarray(4, 4 + len);
    if (type === 0x00) {
      for (let i = 0; i < len; i++) {
        const a = base + addr + i;
        if (a >= size) throw new Error(`hex line ${n + 1}: address 0x${a.toString(16)} beyond 0x${size.toString(16)}`);
        img.data[a] = payload[i];
        img.used[a] = 1;
        img.end = Math.max(img.end, a + 1);
      }
    } else if (type === 0x01) {
      break;
    } else if (type === 0x02) {
      base = ((payload[0] << 8) | payload[1]) << 4;
    } else if (type === 0x04) {
      base = ((payload[0] << 8) | payload[1]) << 16;
    }
    // 03/05 (start address) don't matter for AVR flash
  }
  return img;
}
