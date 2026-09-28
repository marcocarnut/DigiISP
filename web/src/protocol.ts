// USB request numbers: USBasp protocol plus DigiISP extensions.
// Mirrors firmware/protocol.h; see docs/PROTOCOL.md.

export const USB_VID = 0x16c0; // VOTI, shared by obdev's free IDs
export const USB_PID = 0x05dc; // obdev's shared PID for vendor class devices

export enum Func {
  Connect = 1,
  Disconnect = 2,
  Transmit = 3,
  ReadFlash = 4,
  EnableProg = 5,
  WriteFlash = 6,
  ReadEeprom = 7,
  WriteEeprom = 8,
  SetLongAddress = 9,
  SetIspSck = 10,
  TpiConnect = 11,
  TpiDisconnect = 12,
  TpiRawRead = 13,
  TpiRawWrite = 14,
  TpiReadBlock = 15,
  TpiWriteBlock = 16,
  GetCapabilities = 127,
  // DigiISP extensions
  DigiIspInfo = 0x40,
}

export const BLOCKFLAG_FIRST = 1;
export const BLOCKFLAG_LAST = 2;

// GETCAPABILITIES reply, as a little-endian 32 bit value
export const CAP_TPI = 1 << 0;
export const CAP_DIGIISP_RESET_CONTROL = 1 << 8;
export const CAP_DIGIISP_EXTENSIONS = 1 << 15;
export const CAP_3MHZ = 1 << 24; // UsbAsp-flash firmware

export const DIGIISP_FLAG_RESET_CONTROL = 0x01;
export const DIGIISP_INFO_LEN = 10;

// SETISPSCK option ids and their nominal frequencies in Hz
export const SCK_OPTIONS: ReadonlyArray<{ id: number; hz: number; label: string }> = [
  { id: 1, hz: 500, label: '500 Hz' },
  { id: 2, hz: 1000, label: '1 kHz' },
  { id: 3, hz: 2000, label: '2 kHz' },
  { id: 4, hz: 4000, label: '4 kHz' },
  { id: 5, hz: 8000, label: '8 kHz' },
  { id: 6, hz: 16000, label: '16 kHz' },
  { id: 7, hz: 32000, label: '32 kHz' },
  { id: 8, hz: 93750, label: '93.75 kHz' },
  { id: 9, hz: 187500, label: '187.5 kHz' },
  { id: 10, hz: 375000, label: '375 kHz' },
  { id: 11, hz: 750000, label: '750 kHz' },
  { id: 12, hz: 1500000, label: '1.5 MHz' },
];
