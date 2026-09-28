#!/usr/bin/env node
// Generate web/src/parts.json, the AVR part database, from avrdude (GPL):
//
//   avrdude -p '*/At' > parts.tsv          # expanded avrdude.conf, tab separated
//   node scripts/gen-parts.mjs parts.tsv path/to/avrdude/src/avrintel.c
//
// From the dump: ISP capable parts with signatures, memory sizes, page sizes
// and the SPI opcodes of the small memories (fuses, lock, signature, ...).
// From avrintel.c: fuse and lock bitfields with their named values.

import { readFileSync, writeFileSync } from 'node:fs';

const [dumpPath, avrintelPath, outPath = new URL('../src/parts.json', import.meta.url)] = process.argv.slice(2);
if (!dumpPath || !avrintelPath) {
  console.error('usage: gen-parts.mjs parts.tsv avrintel.c [out.json]');
  process.exit(2);
}

// --- avrdude -p '*/At' dump ---------------------------------------------------

const raw = new Map(); // part name -> { props, mems: Map(mem -> { props, ops }) }
for (const line of readFileSync(dumpPath, 'utf8').split('\n')) {
  const f = line.split('\t');
  if (f[0] === '.pt') {
    const [, name, key, value] = f;
    if (!raw.has(name)) raw.set(name, { props: {}, mems: new Map() });
    raw.get(name).props[key] = value;
  } else if (f[0] === '.ptmm' || f[0] === '.ptmmop') {
    const [kind, name, mem, key, value] = f;
    const part = raw.get(name);
    if (!part) continue;
    if (!part.mems.has(mem)) part.mems.set(mem, { props: {}, ops: {} });
    part.mems.get(mem)[kind === '.ptmm' ? 'props' : 'ops'][key] = value;
  }
}

const unquote = (s) => (s ?? '').replace(/^"|"$/g, '');
const int = (s) => (s === undefined ? undefined : Number(s));
/** "1010.1100--1010.0000--xxxx.xxxx--iiii.iiii" -> "10101100101000000xxxxxxxxiiiiiiii" (32 chars) */
const op = (s) => (s && s !== 'NULL' ? s.replace(/[.-]/g, '') : undefined);

const SMALL_MEMS = ['fuse', 'lfuse', 'hfuse', 'efuse', 'lock', 'signature', 'calibration'];

const parts = [];
for (const [name, p] of raw) {
  if (!/\bPM_ISP\b/.test(p.props.prog_modes ?? '')) continue;
  const sig = (p.props.signature ?? '').split(' ').map(Number);
  const flash = p.mems.get('flash');
  if (sig.length !== 3 || sig.every((b) => b === 0) || !flash) continue;

  const mem = (m) => ({ size: int(m.props.size), page: int(m.props.page_size), paged: m.props.paged === 'yes' });
  const eeprom = p.mems.get('eeprom');
  const small = {};
  for (const m of SMALL_MEMS) {
    const d = p.mems.get(m);
    if (!d) continue;
    small[m] = { size: int(d.props.size), read: op(d.ops.read), write: op(d.ops.write), delay: int(d.props.max_write_delay) };
  }
  parts.push({
    id: unquote(p.props.id),
    name,
    signature: sig,
    chipEraseDelay: int(p.props.chip_erase_delay),
    flash: { ...mem(flash), extAddr: !!op(flash.ops.load_ext_addr), delay: int(flash.props.max_write_delay) },
    eeprom: eeprom
      ? { ...mem(eeprom), read: op(eeprom.ops.read), write: op(eeprom.ops.write), delay: int(eeprom.props.max_write_delay) }
      : null,
    mems: small,
    config: null, // filled in from avrintel.c below
  });
}

// --- avrintel.c: fuse/lock bitfields -----------------------------------------------

const src = readFileSync(avrintelPath, 'utf8');
const cString = (s) => JSON.parse(s); // C string literals here are JSON compatible

// static const Configvalue _values_x[n] = { {v, "label", "comment"}, ... };
const valueLists = {};
for (const m of src.matchAll(/Configvalue\s+(_values_\w+)\[\d*\]\s*=\s*\{([\s\S]*?)\n\};/g)) {
  valueLists[m[1]] = [...m[2].matchAll(/\{\s*(-?(?:0x)?[0-9a-fA-F]+)\s*,\s*("(?:[^"\\]|\\.)*")\s*,\s*("(?:[^"\\]|\\.)*")\s*\}/g)]
    .map((v) => [Number(v[1]), cString(v[2]), cString(v[3])]);
}

// const Configitem cfgtab_x[n] = { {"name", n, _values_x, "mem", off, mask, lsh, init, "comment"}, ... };
const configTables = {};
for (const m of src.matchAll(/Configitem\s+(cfgtab_\w+)\[\d*\]\s*=\s*\{([\s\S]*?)\n\};/g)) {
  configTables[m[1]] = [...m[2].matchAll(
    /\{\s*("[^"]*")\s*,\s*\d+\s*,\s*(\w+)\s*,\s*("[^"]*")\s*,\s*\d+\s*,\s*((?:0x)?[0-9a-fA-F]+)\s*,\s*(\d+)\s*,\s*((?:0x)?[0-9a-fA-F]+)\s*,\s*("(?:[^"\\]|\\.)*")\s*\}/g,
  )].map((c) => ({
    name: cString(c[1]),
    values: c[2] === 'NULL' ? null : c[2],
    mem: cString(c[3]),
    mask: Number(c[4]),
    shift: Number(c[5]),
    initval: Number(c[6]),
    description: cString(c[7]),
  }));
}

// uP table rows: {"ATtiny85", ...  /*ATtiny85*/ ..., 11, cfgtab_attiny25, // ISRs, Config
const partConfig = {};
for (const m of src.matchAll(/\/\*([\w-]+)\*\/[^\n]*?,\s*(cfgtab_\w+|NULL)\s*,\s*\/\/ ISRs, Config/g)) {
  if (m[2] !== 'NULL') partConfig[m[1]] = m[2];
}

const usedTables = new Set();
for (const p of parts) {
  const t = partConfig[p.name];
  if (t && configTables[t]) {
    p.config = t;
    usedTables.add(t);
  }
}
const config = {};
const values = {};
for (const t of usedTables) {
  config[t] = configTables[t];
  for (const c of configTables[t]) if (c.values && valueLists[c.values]) values[c.values] = valueLists[c.values];
}

parts.sort((a, b) => a.name.localeCompare(b.name, 'en', { numeric: true }));
const db = { generated: 'by web/scripts/gen-parts.mjs from avrdude (GPLv2)', parts, config, values };
writeFileSync(outPath, JSON.stringify(db) + '\n');
console.error(`${parts.length} parts, ${parts.filter((p) => p.config).length} with fuse bitfields, ` +
  `${Object.keys(config).length} config tables, ${Object.keys(values).length} value lists`);
