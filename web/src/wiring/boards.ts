// Board database for wiring diagrams: simplified top views, in mm, x to the
// right and y down. Pin positions come from the boards' published design
// files (see docs/BOARDS.md for sources); the artwork is our own.

export type Signal = 'MOSI' | 'MISO' | 'SCK' | 'RESET' | 'VCC' | 'GND';

export const SIGNALS: Signal[] = ['MOSI', 'MISO', 'SCK', 'RESET', 'VCC', 'GND'];

export interface Pin {
  x: number;
  y: number;
  /** what is printed on the board next to the pin */
  label: string;
  /** where the label goes relative to the pin */
  side?: 'left' | 'right' | 'up' | 'down';
  /** the pin's ISP role when the board is the target */
  target?: Signal;
  /** the pin's ISP role when the board is the programmer (DigiISP pins) */
  programmer?: Signal;
  /** pin 1 of a header (drawn square) */
  first?: boolean;
}

export interface Shape {
  kind: 'usb' | 'chip' | 'reg' | 'button' | 'jack' | 'header' | 'led' | 'fingers';
  x: number;
  y: number;
  w: number;
  h: number;
  /** degrees, around the shape's center */
  rot?: number;
  label?: string;
  /** chip: where pin 1 is marked */
  notch?: 'left' | 'right' | 'top' | 'bottom';
}

export interface Board {
  id: string;
  name: string;
  /** can be the programmer (runs DigiISP, or is a USBasp) and/or the target */
  roles: ('programmer' | 'target')[];
  /** polygon, mm */
  outline: [number, number][];
  color: string;
  shapes: Shape[];
  pins: Pin[];
  /** avrdude part ids of the chips this board carries (to check Identify) */
  parts: string[];
  /** shown next to the drawing */
  notes: string[];
  /** never drawn turned (chips: notch up, as on a breadboard) */
  upright?: boolean;
}

const rect = (w: number, h: number): [number, number][] => [[0, 0], [w, 0], [w, h], [0, h]];

/** Pins of a 1-row header, from (x, y) stepping 2.54 mm in (dx, dy). */
function row(x: number, y: number, dx: number, dy: number, labels: string[], side: Pin['side'],
  roles: Record<string, Partial<Pick<Pin, 'target' | 'programmer'>>> = {}): Pin[] {
  return labels.map((label, i) => ({ x: x + i * dx * 2.54, y: y + i * dy * 2.54, label, side, ...roles[label] }));
}

function sideOf(x: number, y: number): Pin['side'] {
  return x > 0 ? 'right' : x < 0 ? 'left' : y > 0 ? 'down' : 'up';
}

/** 6-pin ISP header: pin 1 at (x, y), odd pins stepping (dx, dy) down the
 * first column, even pins offset by (cx, cy). Pin 1 MISO, 2 VCC, 3 SCK,
 * 4 MOSI, 5 RESET, 6 GND. */
function icsp6(x: number, y: number, dx: number, dy: number, cx: number, cy: number): Pin[] {
  const signals: Signal[] = ['MISO', 'VCC', 'SCK', 'MOSI', 'RESET', 'GND'];
  return signals.map((target, i) => {
    const r = i >> 1;
    const odd = (i & 1) === 0;
    return {
      x: x + r * dx * 2.54 + (odd ? 0 : cx * 2.54),
      y: y + r * dy * 2.54 + (odd ? 0 : cy * 2.54),
      label: `${i + 1}`,
      // numbers on the outside of each column, clear of the wires
      side: sideOf(odd ? -cx : cx, odd ? -cy : cy),
      target,
      first: i === 0,
    };
  });
}

// ATtiny85 based boards: as the target, PB0 = MOSI in and PB1 = MISO out;
// running DigiISP they are the programmer, with PB1 = MOSI out, PB0 = MISO in.
const tinyRoles = {
  PB0: { target: 'MOSI', programmer: 'MISO' },
  PB1: { target: 'MISO', programmer: 'MOSI' },
  PB2: { target: 'SCK', programmer: 'SCK' },
  PB5: { target: 'RESET', programmer: 'RESET' },
  VCC: { target: 'VCC', programmer: 'VCC' },
  GND: { target: 'GND', programmer: 'GND' },
} as const;

export const BOARDS: Board[] = [
  {
    // Digispark rev3, Digistump (DIGISPARK_PRODUCTION_REV3.brd), 26.5 x 19 mm
    id: 'digispark',
    name: 'Digispark',
    roles: ['programmer', 'target'],
    outline: [[0, 3.47], [9, 3.47], [9, 0], [26.5, 0], [26.5, 19], [9, 19], [9, 15.5], [0, 15.5]],
    color: '#1d4f91',
    shapes: [
      { kind: 'fingers', x: 0.6, y: 5.2, w: 7.6, h: 8.6 },
      { kind: 'chip', x: 15.3, y: 1.3, w: 4.4, h: 4.2, label: 'ATtiny85', notch: 'left' },
      { kind: 'reg', x: 12.9, y: 8.4, w: 5.6, h: 5.3 },
    ],
    pins: [
      ...['P0', 'P1', 'P2', 'P3', 'P4', 'P5'].map((label, i) => ({
        x: 24.75, y: 14.75 - i * 2.54, label, side: 'left' as const,
        ...(label === 'P0' ? tinyRoles.PB0 : label === 'P1' ? tinyRoles.PB1 : label === 'P2' ? tinyRoles.PB2 : label === 'P5' ? tinyRoles.PB5 : {}),
      })),
      { x: 11.92, y: 17.25, label: '5V', side: 'up', ...tinyRoles.VCC },
      { x: 14.46, y: 17.25, label: 'GND', side: 'up', ...tinyRoles.GND },
      { x: 17.0, y: 17.25, label: 'VIN', side: 'up' },
    ],
    parts: ['t85'],
    notes: ['P5 is the RESET pin (unless its RSTDISBL fuse is set).'],
  },
  {
    // Franzininho DIY V2RV3 (Franzininho.kicad_pcb), 51.1 x 30 mm
    id: 'franzininho',
    name: 'Franzininho DIY',
    roles: ['programmer', 'target'],
    outline: rect(51.07, 30.03),
    color: '#1f6b45',
    shapes: [
      { kind: 'usb', x: -10.5, y: 9.1, w: 16, h: 12 },
      { kind: 'chip', x: 32.6, y: 12.3, w: 9.4, h: 5.3, label: 'ATtiny85', notch: 'right' },
      { kind: 'button', x: 34.6, y: 1.3, w: 6, h: 6, label: 'RESET' },
      { kind: 'header', x: 44.6, y: 4.7, w: 2.6, h: 20.3 },
      { kind: 'led', x: 20.3, y: 25, w: 2, h: 2 },
      { kind: 'led', x: 25.4, y: 25, w: 2, h: 2 },
    ],
    pins: [
      { x: 45.91, y: 23.77, label: '0', side: 'right', ...tinyRoles.PB0 },
      { x: 45.91, y: 21.23, label: '1', side: 'right', ...tinyRoles.PB1 },
      { x: 45.91, y: 18.69, label: '2', side: 'right', ...tinyRoles.PB2 },
      { x: 45.91, y: 16.15, label: '3', side: 'right' },
      // the silkscreen swaps 4 and 5: "4" is PB5 (RESET), "5" is PB4
      { x: 45.91, y: 13.61, label: '4', side: 'right', ...tinyRoles.PB5 },
      { x: 45.91, y: 11.07, label: '5', side: 'right' },
      { x: 45.91, y: 8.53, label: 'VCC', side: 'right', ...tinyRoles.VCC },
      { x: 45.91, y: 5.99, label: 'GND', side: 'right', ...tinyRoles.GND },
    ],
    parts: ['t85'],
    notes: ['RESET (PB5) is the header pin marked 4: the board labels 4 and 5 swapped.'],
  },
  {
    // Arduino Uno Rev3 (UNO-TH_Rev3e.brd), 68.6 x 53.3 mm
    id: 'uno',
    name: 'Arduino Uno',
    roles: ['target'],
    outline: [[1, 0], [64.52, 0], [66.04, 1.52], [66.04, 12.95], [68.58, 15.49], [68.58, 48.26], [66.04, 50.8], [66.04, 52.34], [65.04, 53.34], [1, 53.34], [0, 52.34], [0, 1]],
    color: '#00797e',
    shapes: [
      { kind: 'usb', x: -6.4, y: 9.2, w: 16.3, h: 12.1, label: 'USB' },
      { kind: 'jack', x: -1.9, y: 40.5, w: 13.5, h: 9, label: 'DC' },
      { kind: 'chip', x: 28.6, y: 34.4, w: 35.5, h: 5.2, label: 'ATmega328P', notch: 'right' },
      { kind: 'header', x: 17.5, y: 1.3, w: 25.4, h: 2.5 },
      { kind: 'header', x: 44.5, y: 1.3, w: 20.3, h: 2.5 },
      { kind: 'header', x: 26.7, y: 49.5, w: 20.3, h: 2.5 },
      { kind: 'header', x: 49.5, y: 49.5, w: 15.2, h: 2.5 },
      { kind: 'header', x: 14.5, y: 4.6, w: 7.6, h: 5, label: 'ICSP1: USB chip, not this one' },
      { kind: 'header', x: 62.4, y: 21.6, w: 5, h: 7.6, label: 'ICSP' },
    ],
    // ICSP next to the ATmega328P: pin 1 top left, odd pins down the left column
    pins: icsp6(63.63, 22.86, 0, 1, 1, 0),
    parts: ['m328p'],
    notes: [
      'Use the 6-pin ICSP header next to the ATmega328P (right edge), not ICSP1 next to the USB socket, which belongs to the USB chip.',
      'Pin 1 (MISO) is the pin marked with a dot or a "1".',
    ],
  },
  {
    // Arduino Nano 3.x (NanoV3.3.brd), 43.2 x 17.8 mm
    id: 'nano',
    name: 'Arduino Nano',
    roles: ['target'],
    outline: rect(43.18, 17.78),
    color: '#1b4f8c',
    shapes: [
      { kind: 'usb', x: -1.2, y: 4.4, w: 8.6, h: 9, label: 'USB' },
      { kind: 'chip', x: 12.9, y: 6.4, w: 5.2, h: 5.2, rot: 45, label: '328P' },
      { kind: 'header', x: 2.5, y: 0, w: 38.2, h: 2.5 },
      { kind: 'header', x: 2.5, y: 15.3, w: 38.2, h: 2.5 },
    ],
    // ICSP at the far end from USB: pin 1 bottom right, odd pins up the outer column
    pins: icsp6(41.81, 11.43, 0, -1, -1, 0),
    parts: ['m328p', 'm328pb', 'm168'],
    notes: [
      'Use the 6 pins at the end opposite the USB socket (ICSP). Pin 1 (MISO) is marked "1".',
      'Many Nano clones carry an ATmega328PB or an ATmega168.',
    ],
  },
  {
    // SparkFun Arduino Pro v16 (Arduino-Pro-v16.brd), 52.1 x 53.3 mm
    id: 'pro',
    name: 'Arduino Pro',
    roles: ['target'],
    outline: rect(52.07, 53.34),
    color: '#b3242e',
    shapes: [
      { kind: 'jack', x: -5, y: 8.9, w: 9, h: 8.9, label: 'DC' },
      { kind: 'chip', x: 33.3, y: 33.3, w: 7, h: 7, label: '328P' },
      { kind: 'header', x: 6, y: 1.3, w: 42.2, h: 2.5 },
      { kind: 'header', x: 15.2, y: 49.5, w: 15.2, h: 2.5 },
      { kind: 'header', x: 33, y: 49.5, w: 15.2, h: 2.5 },
      { kind: 'header', x: 45.7, y: 21.6, w: 5, h: 7.6, label: 'ISP' },
    ],
    pins: icsp6(46.99, 22.86, 0, 1, 1, 0),
    parts: ['m328p', 'm168'],
    notes: ['The 6-pin ISP header is on the right. Pin 1 (MISO) is marked. 3.3 V boards: see the voltage note.'],
  },
  {
    // SparkFun Pro Mini (Arduino-Pro-Mini.brd), 17.8 x 33 mm
    id: 'promini',
    name: 'Arduino Pro Mini',
    roles: ['target'],
    outline: rect(17.78, 33.02),
    color: '#b3242e',
    shapes: [
      { kind: 'chip', x: 6.4, y: 16.6, w: 5, h: 5, rot: 45, label: '328P' },
      { kind: 'header', x: 1.3, y: 0, w: 15.2, h: 2.5 },
    ],
    // every ISP pin is on the right hand column
    pins: row(16.51, 3.81, 0, 1, ['RAW', 'GND', 'RST', 'VCC', 'A3', 'A2', 'A1', 'A0', '13', '12', '11', '10'], 'left', {
      GND: { target: 'GND' }, RST: { target: 'RESET' }, VCC: { target: 'VCC' },
      13: { target: 'SCK' }, 12: { target: 'MISO' }, 11: { target: 'MOSI' },
    }),
    parts: ['m328p', 'm168'],
    notes: ['All ISP pins are on one side: GND, RST, VCC at the top, 13 (SCK), 12 (MISO), 11 (MOSI) at the bottom.'],
  },
  {
    // SparkFun Pro Micro v13 (SparkFun_Pro_Micro.brd), 17.8 x 33 mm; clones follow it
    id: 'promicro',
    name: 'Pro Micro (ATmega32U4)',
    roles: ['target'],
    outline: rect(17.78, 33.02),
    color: '#b3242e',
    shapes: [
      { kind: 'usb', x: 5.2, y: -1, w: 7.4, h: 5.3, label: 'USB' },
      { kind: 'chip', x: 5.9, y: 16.1, w: 6, h: 6, rot: 45, label: '32U4' },
    ],
    pins: row(16.51, 3.81, 0, 1, ['RAW', 'GND', 'RST', 'VCC', 'A3', 'A2', 'A1', 'A0', '15', '14', '16', '10'], 'left', {
      GND: { target: 'GND' }, RST: { target: 'RESET' }, VCC: { target: 'VCC' },
      15: { target: 'SCK' }, 14: { target: 'MISO' }, 16: { target: 'MOSI' },
    }),
    parts: ['m32u4'],
    notes: [
      'All ISP pins are on one side: GND, RST, VCC at the top, 15 (SCK), 14 (MISO), 16 (MOSI) at the bottom.',
      'Programming over ISP erases the USB bootloader (Caterina); write it back to use the USB port for uploads again.',
    ],
  },
  {
    // bare chip: DIP-8, top view, pin 1 top left
    id: 'tiny-dip8',
    name: 'ATtiny12/13/15/25/45/85 (DIP-8)',
    roles: ['target'],
    outline: [[1.4, 0], [6.22, 0], [6.22, 10.16], [1.4, 10.16]],
    color: '#222',
    shapes: [{ kind: 'chip', x: 1.4, y: 0, w: 4.82, h: 10.16, label: '', notch: 'top' }],
    pins: [
      { x: 0, y: 1.27, label: '1 RESET', side: 'left', target: 'RESET', first: true },
      { x: 0, y: 3.81, label: '2 PB3', side: 'left' },
      { x: 0, y: 6.35, label: '3 PB4', side: 'left' },
      { x: 0, y: 8.89, label: '4 GND', side: 'left', target: 'GND' },
      { x: 7.62, y: 8.89, label: '5 MOSI', side: 'right', target: 'MOSI' },
      { x: 7.62, y: 6.35, label: '6 MISO', side: 'right', target: 'MISO' },
      { x: 7.62, y: 3.81, label: '7 SCK', side: 'right', target: 'SCK' },
      { x: 7.62, y: 1.27, label: '8 VCC', side: 'right', target: 'VCC' },
    ],
    parts: ['t12', 't13', 't13a', 't15', 't25', 't45', 't85'],
    notes: ['Pin 1 is next to the notch or dot. The ATtiny11 has no ISP (high voltage only).'],
    upright: true,
  },
  {
    // any board with the standard 6-pin ISP header, seen from above, pin 1 top left
    id: 'icsp6',
    name: 'Other board with a 6-pin ISP header',
    roles: ['target'],
    outline: rect(10, 12.6),
    color: '#555',
    shapes: [{ kind: 'header', x: 1.93, y: 2.77, w: 6.14, h: 8.66, label: 'ISP' }],
    pins: icsp6(3.73, 4.37, 0, 1, 1, 0),
    parts: [],
    notes: ['Pin 1 (MISO) is usually marked with a dot, a triangle or a "1", or has a square pad.'],
  },
  {
    // USBasp with the standard 10-pin ISP connector (ribbon cable end, seen from above)
    id: 'usbasp',
    name: 'USBasp (10-pin cable)',
    roles: ['programmer'],
    outline: rect(60, 19),
    color: '#1d4f91',
    shapes: [
      { kind: 'usb', x: -12, y: 3.5, w: 16, h: 12 },
      { kind: 'chip', x: 20, y: 5.5, w: 8, h: 8, label: 'ATmega8' },
      { kind: 'header', x: 47.5, y: 2.8, w: 9, h: 13.4, label: 'ISP' },
    ],
    pins: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => {
      const sig: Record<number, Signal> = { 1: 'MOSI', 2: 'VCC', 4: 'GND', 5: 'RESET', 7: 'SCK', 9: 'MISO' };
      return {
        x: n % 2 ? 50.73 : 53.27,
        y: 4.42 + ((n - 1) >> 1) * 2.54,
        label: `${n}`,
        programmer: sig[n],
        first: n === 1,
      };
    }),
    parts: [],
    notes: ['The 10-pin connector: 1 MOSI, 2 VCC, 4/6/8/10 GND, 5 RESET, 7 SCK, 9 MISO. Pin 1 is marked with a triangle on the cable.'],
  },
];

export const boardById = (id: string) => BOARDS.find((b) => b.id === id);
