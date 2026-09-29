# DigiISP USB protocol

DigiISP uses the **USBasp protocol** (Thomas Fischl, www.fischl.de), plus a
few extensions. The web app works with DigiISP and with any USBasp, and avrdude
works with DigiISP through `-c usbasp-clone`.

The protocol has no bulk or interrupt endpoints. Everything is a **vendor control
request to the device** on endpoint 0, so it maps directly onto WebUSB's
`controlTransferIn` and `controlTransferOut`.

## USB identity

| Field | Value |
|---|---|
| VID:PID | `16c0:05dc` (obdev's shared vendor-class ID, same as USBasp) |
| Manufacturer / Product | `digiisp.postcogito.org` / `DigiISP` (USBasp: `www.fischl.de` / `USBasp`) |
| Serial number | 8 hex digits, generated on first boot and kept in EEPROM (addresses 0x10–0x13) |
| bcdUSB | 2.10, so Windows asks for the BOS descriptor |
| Class | 0xFF (vendor) on device and interface; no endpoints besides EP0 |

Hosts must check the strings, because other V-USB gadgets share the VID:PID.
avrdude's `usbasp` entry requires the USBasp strings; `usbasp-clone` matches only
the VID:PID.

## Request format

`bmRequestType` = vendor | device, plus IN or OUT. `bRequest` = function number.
There are 4 parameter bytes `s[0..3]`, packed as avrdude does:
`wValue = s[0] | s[1] << 8` and `wIndex = s[2] | s[3] << 8`.
avrdude sends CONNECT, DISCONNECT and friends as IN requests with a 4-byte buffer
and ignores the reply.

## USBasp functions

| # | Name | Dir | Parameters | Reply / data |
|---|---|---|---|---|
| 1 | CONNECT | IN | s[0] bit 0 (DigiISP only): manual reset, leave PB5 alone | – (drives SCK/MOSI low; pulses and holds /RESET low) |
| 2 | DISCONNECT | IN | – | – (all ISP pins to inputs, releases /RESET) |
| 3 | TRANSMIT | IN | 4 ISP bytes | the 4 bytes shifted back |
| 4 | READFLASH | IN | s[0..1] address | wLength bytes of flash |
| 5 | ENABLEPROG | IN | – | 1 byte: 0 = OK, 1 = target didn't echo 0x53 in 32 tries |
| 6 | WRITEFLASH | OUT | s[0..1] address, s[2] page size low byte, s[3] = page size bits 11:8 in the high nibble, block flags in the low nibble (1 = first, 2 = last) | data |
| 7 | READEEPROM | IN | s[0..1] address | wLength bytes |
| 8 | WRITEEEPROM | OUT | s[0..1] address | data |
| 9 | SETLONGADDRESS | IN | s[0..3] 32-bit address | – (read and write functions then ignore their address parameter) |
| 10 | SETISPSCK | IN | s[0] SCK id | 1 byte: 0 = OK |
| 11–16 | TPI_* | | | not implemented yet |
| 127 | GETCAPABILITIES | IN | – | 4 bytes, a little-endian bitmap |

avrdude reads and writes in blocks of up to 200 bytes (`USBASP_READBLOCKSIZE`).

### SCK ids (SETISPSCK)

| id | nominal | DigiISP actual |
|---|---|---|
| 0 | auto | 175 kHz (USBasp: 375 kHz) |
| 1–7 | 0.5, 1, 2, 4, 8, 16, 32 kHz | same |
| 8 | 93.75 kHz | 91 kHz |
| 9 | 187.5 kHz | 175 kHz |
| 10 | 375 kHz | 359 kHz |
| 11 | 750 kHz | 750 kHz |
| 12 | 1.5 MHz | 1.03 MHz (fastest the USI loop can do) |
| 13 | 3 MHz (UsbAsp-flash only) | 1.03 MHz |

USB interrupts only ever stretch SCK phases, which is harmless for SPI. Rule of
thumb: SCK must be less than f_target / 4.

### Capabilities bitmap

| Bit | Meaning | Who |
|---|---|---|
| 0 | TPI supported | USBasp |
| 8 | we drive the target /RESET (our RSTDISBL fuse is programmed) | DigiISP |
| 15 | DigiISP extensions are available | DigiISP |
| 24 | 3 MHz SCK | UsbAsp-flash firmware |

avrdude only looks at bits 0 and 24.

## DigiISP extensions

| # | Name | Dir | Reply |
|---|---|---|---|
| 0x40 | INFO | IN | 12 bytes (10 before firmware v4): `'D' 'I'`, protocol version, firmware version, flags (bit 0 = reset control), OSCCAL, own low fuse, own high fuse, own extended fuse, own lock bits, then the board's Micronucleus version major and minor (0 0 if not found; the firmware finds Micronucleus' USB device descriptor, VID 16d0 PID 0753, in flash and reads its bcdDevice) |
| 0x41 | REBOOT | IN | – (about 50 ms later the device drops off the bus, and the watchdog resets it into Micronucleus) |
| 0x42 | PINS | IN | 3 bytes: PINB, DDRB, PORTB (for diagnostics, e.g. whether the reset wire has the target's pull-up) |
| 0x57 | WebUSB GET_URL | IN, wValue = 1, wIndex = 2 | the landing page URL descriptor: `https://digiisp.postcogito.org` |
| 0x4D | MS OS 2.0 | IN, wIndex = 7 | the Microsoft OS 2.0 descriptor set (162 bytes: WinUSB compatible ID plus a DeviceInterfaceGUIDs property) |

### Bootstrap mode (no reset control)

This mode applies when PB5 is still our reset pin, or when the host sets the
manual-reset flag in CONNECT. The flag is for when someone holds the target's
reset button, so PB5 never drives high against the button.

While PB5 is still the ATtiny85's own RESET pin, CONNECT and DISCONNECT don't
touch it, and the user holds the target in reset by hand. ENABLEPROG can't pulse
reset to resynchronise, so between retries it sends a single extra SCK pulse
instead. That shifts the target's serial programming logic by one bit, so it
realigns within 8 tries. If it still fails, the host asks the user to release
and press reset again.

## Serial number

Chrome only remembers a WebUSB permission across replugs when the device has a
serial number. The ATtiny85 has no unique ID, so on first boot the firmware
builds 32 random bits from the jitter between the watchdog oscillator and the
CPU clock (about 1 s, once) and stores them in EEPROM. Micronucleus never
erases EEPROM, so the serial number survives firmware updates.

## Descriptors

- **BOS** (type 0x0F): 5-byte header plus one Microsoft OS 2.0 platform
  capability (vendor code 0x4D, set length 162, Windows 8.1+).
- **WebUSB platform capability:** version 1.0, vendor code 0x57, landing page 1
  (`https://digiisp.postcogito.org`).
- **USB 2.0 extension capability:** no LPM (Linux warns if it is missing).
