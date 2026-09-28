// USBasp protocol client over WebUSB. Works with DigiISP and with original
// USBasp firmware (www.fischl.de) and its clones.

import {
  BLOCKFLAG_FIRST,
  BLOCKFLAG_LAST,
  CAP_DIGIISP_EXTENSIONS,
  DIGIISP_CONNECT_MANUAL_RESET,
  DIGIISP_FLAG_RESET_CONTROL,
  DIGIISP_INFO_LEN,
  Func,
  USB_PID,
  USB_VID,
} from './protocol';

export type ProgrammerKind = 'digiisp' | 'usbasp' | 'unknown';

export interface DigiIspInfo {
  protocolVersion: number;
  firmwareVersion: number;
  resetControl: boolean;
  osccal: number;
  fuses: { low: number; high: number; extended: number; lock: number };
}

export type TransferLogger = (line: string) => void;

const hex = (bytes: ArrayLike<number>) =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join(' ');

export class UsbAspError extends Error {}

export class UsbAsp {
  /** Capabilities bitmap, 0 if GETCAPABILITIES is not supported. */
  capabilities = 0;
  info: DigiIspInfo | null = null;
  /** After SETLONGADDRESS the firmware ignores 16 bit addresses until CONNECT. */
  private longAddressing = false;

  private constructor(
    readonly device: USBDevice,
    private readonly log: TransferLogger,
  ) {}

  /** Ask the user to pick a device (must be called from a user gesture). */
  /** Devices this origin already has permission for (no chooser needed). */
  static async permitted(): Promise<USBDevice[]> {
    const devices = await navigator.usb.getDevices();
    return devices.filter((d) => d.vendorId === USB_VID && d.productId === USB_PID);
  }

  static async open(device: USBDevice, log: TransferLogger): Promise<UsbAsp> {
    await device.open();
    if (device.configuration === null) await device.selectConfiguration(1);
    await device.claimInterface(0);
    const p = new UsbAsp(device, log);
    await p.identify();
    return p;
  }

  get kind(): ProgrammerKind {
    if (this.info) return 'digiisp';
    if (this.device.productName === 'USBasp') return 'usbasp';
    return 'unknown';
  }

  /** True if we can drive the target's reset; false means the user must hold it. */
  get resetControl(): boolean {
    return this.info ? this.info.resetControl : true; // USBasp always can
  }

  async close(): Promise<void> {
    try {
      await this.device.close();
    } catch {
      // already gone
    }
  }

  // --- raw transfers -----------------------------------------------------

  /** Vendor IN request; the 4 send bytes go in wValue/wIndex as avrdude does. */
  async controlIn(func: number, send: ArrayLike<number>, length: number): Promise<Uint8Array> {
    const setup = this.setup(func, send);
    const r = await this.device.controlTransferIn(setup, length);
    if (r.status !== 'ok' || !r.data) {
      throw new UsbAspError(`request ${func} failed: ${r.status}`);
    }
    const data = new Uint8Array(r.data.buffer, r.data.byteOffset, r.data.byteLength);
    this.log(`IN  ${func} [${hex(send)}] -> ${data.length > 16 ? `${data.length} bytes` : `[${hex(data)}]`}`);
    return data;
  }

  async controlOut(func: number, send: ArrayLike<number>, data: Uint8Array<ArrayBuffer>): Promise<void> {
    const setup = this.setup(func, send);
    const r = await this.device.controlTransferOut(setup, data);
    if (r.status !== 'ok') throw new UsbAspError(`request ${func} failed: ${r.status}`);
    this.log(`OUT ${func} [${hex(send)}] <- ${data.length} bytes`);
  }

  private setup(func: number, send: ArrayLike<number>): USBControlTransferParameters {
    const s = [0, 1, 2, 3].map((i) => send[i] ?? 0);
    return {
      requestType: 'vendor',
      recipient: 'device',
      request: func,
      value: s[0] | (s[1] << 8),
      index: s[2] | (s[3] << 8),
    };
  }

  // --- identification ----------------------------------------------------

  private async identify(): Promise<void> {
    try {
      const caps = await this.controlIn(Func.GetCapabilities, [], 4);
      this.capabilities = caps.length === 4
        ? (caps[0] | (caps[1] << 8) | (caps[2] << 16) | (caps[3] << 24)) >>> 0
        : 0;
    } catch {
      this.capabilities = 0; // old USBasp firmware stalls unknown requests
    }
    if (this.capabilities & CAP_DIGIISP_EXTENSIONS) {
      const d = await this.controlIn(Func.DigiIspInfo, [], DIGIISP_INFO_LEN);
      if (d.length === DIGIISP_INFO_LEN && d[0] === 0x44 && d[1] === 0x49) {
        this.info = {
          protocolVersion: d[2],
          firmwareVersion: d[3],
          resetControl: (d[4] & DIGIISP_FLAG_RESET_CONTROL) !== 0,
          osccal: d[5],
          fuses: { low: d[6], high: d[7], extended: d[8], lock: d[9] },
        };
      }
    }
  }

  /** DigiISP only: reset into the Micronucleus bootloader. The device
   * disconnects right after this. */
  async reboot(): Promise<void> {
    await this.controlIn(Func.DigiIspReboot, [], 0);
  }

  // --- ISP ---------------------------------------------------------------

  /** Returns false if the programmer doesn't support setting SCK (old USBasp firmware). */
  async setSck(optionId: number): Promise<boolean> {
    try {
      const r = await this.controlIn(Func.SetIspSck, [optionId], 1);
      return r.length === 1 && r[0] === 0;
    } catch {
      return false;
    }
  }

  /** manualReset (DigiISP only): don't drive the target reset, the user holds it. */
  async connect(manualReset = false): Promise<void> {
    this.longAddressing = false;
    await this.controlIn(Func.Connect, [manualReset ? DIGIISP_CONNECT_MANUAL_RESET : 0], 4);
  }

  async disconnect(): Promise<void> {
    await this.controlIn(Func.Disconnect, [], 4);
  }

  /** Programming Enable with retries in firmware. True if the target answered. */
  async enableProgramming(): Promise<boolean> {
    const r = await this.controlIn(Func.EnableProg, [], 4);
    return r.length >= 1 && r[0] === 0;
  }

  /** Set a 32 bit address for the following block reads and writes, which
   * then ignore their own 16 bit address (for flash beyond 64 KB). CONNECT
   * switches back to 16 bit addresses. */
  async setLongAddress(address: number): Promise<void> {
    this.longAddressing = true;
    await this.controlIn(Func.SetLongAddress, [address & 0xff, (address >> 8) & 0xff, (address >> 16) & 0xff, address >>> 24], 4);
  }

  /** Read a block of flash or EEPROM, at most 254 bytes. */
  private async readBlock(func: Func, address: number, length: number): Promise<Uint8Array> {
    if (address > 0xffff || this.longAddressing) await this.setLongAddress(address);
    const r = await this.controlIn(func, [address & 0xff, (address >> 8) & 0xff], length);
    if (r.length !== length) throw new UsbAspError(`short read at 0x${address.toString(16)}`);
    return r;
  }

  readFlash(address: number, length: number): Promise<Uint8Array> {
    return this.readBlock(Func.ReadFlash, address, length);
  }

  readEeprom(address: number, length: number): Promise<Uint8Array> {
    return this.readBlock(Func.ReadEeprom, address, length);
  }

  /** Load and write one flash page (pageSize 0: unpaged flash, byte by byte).
   * The firmware waits for or polls the write. */
  async writeFlashPage(address: number, data: Uint8Array, pageSize: number): Promise<void> {
    const block = 128; // one control transfer; pages of 256 bytes take two
    for (let off = 0; off < data.length; off += block) {
      const chunk = data.slice(off, Math.min(off + block, data.length));
      const a = address + off;
      const flags = (off === 0 ? BLOCKFLAG_FIRST : 0) | (off + block >= data.length ? BLOCKFLAG_LAST : 0);
      if (a > 0xffff || this.longAddressing) await this.setLongAddress(a);
      await this.controlOut(
        Func.WriteFlash,
        [a & 0xff, (a >> 8) & 0xff, pageSize & 0xff, ((pageSize >> 8) << 4) | flags],
        chunk,
      );
    }
  }

  /** One 4 byte ISP instruction; returns the 4 bytes shifted back. */
  async spi(cmd: [number, number, number, number]): Promise<Uint8Array> {
    const r = await this.controlIn(Func.Transmit, cmd, 4);
    if (r.length !== 4) throw new UsbAspError('short TRANSMIT reply');
    return r;
  }
}
