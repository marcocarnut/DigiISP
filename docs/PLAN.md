# DigiISP plan

Turn an ATtiny85 Digispark or Franzininho into a USB ISP programmer for AVRs,
driven from a web page over WebUSB.

## Key ideas

- **Hardware:** V-USB software USB runs on PB3 (D-) and PB4 (D+). That leaves
  PB0, PB1 and PB2 for MISO, MOSI and SCK through the USI. The target's /RESET
  needs a fourth pin, and the only one left is PB5, the ATtiny85's own RESET.
- **Two-board bootstrap:** board #1 still has its reset pin, so it programs
  board #2 over 3 wires while a person holds #2's reset button. The only change
  it makes to #2 is programming the RSTDISBL fuse (high fuse 0xDD → 0x5D). After
  that, #2's PB5 drives the target reset and #2 is a complete programmer. #2 can
  then convert further boards without anyone holding a button.
- **Firmware updates still work after the fuse change:** Micronucleus 2.x (t85
  default build) starts on every power-up (ENTRY_ALWAYS). So even with RSTDISBL
  programmed, firmware can still be updated over USB. A minipro is available as
  last-resort high-voltage recovery.
- **Protocol:** we use the USBasp protocol, so the web app also drives real
  USBasps, and avrdude drives DigiISP (`-c usbasp-clone`). See
  [PROTOCOL.md](PROTOCOL.md).
- **Division of work:** the firmware stays simple (ISP primitives, as in
  USBasp). The part database, hex parsing and verify logic live in the web app.

## Wiring

Programmer to target (the target's ISP pins are fixed: PB0 = MOSI, PB1 = MISO,
PB2 = SCK):

| Programmer | | Target (ATtiny85 board) |
|---|---|---|
| PB1 (USI DO) | → | PB0 (MOSI) |
| PB0 (USI DI) | ← | PB1 (MISO) |
| PB2 (USCK) | → | PB2 (SCK) |
| PB5 (only after bootstrap) | → | PB5 / RESET |
| 5V, GND | – | 5V, GND |

Watch the header labels: on the Franzininho, PB5/RESET is on the pin marked **4**,
not 5. A quick check is DigiISP's PINS request: with the programmer disconnected,
our PB5 must read 1 (the target's reset pull-up); if it reads 0, the wire isn't
on the target's reset.

During the bootstrap, hold the target's RESET low with its button (Franzininho)
or a jumper from P5 to GND (Digispark).

## Phases

The irreversible step (RSTDISBL) comes as late as possible, after everything
before it is proven.

### Phase 0: setup ✅
- Toolchain: avr-gcc 7.3, avr-libc, avrdude 7.1, Micronucleus 2.6 command-line tool.
- Both boards start Micronucleus on plug-in (checked by hand).
- Repo layout: `firmware/`, `web/`, `docs/`, `udev/`.

### Phase 1: USB and WebUSB "hello" (code done, needs a hardware test)
- V-USB firmware on the USBasp protocol, plus GETCAPABILITIES and DIGIISP INFO
  (the board's own fuses, OSCCAL, reset control).
- BOS plus MS OS 2.0 descriptors, so Windows binds WinUSB; udev rule for Linux.
- OSCCAL fine-tuning after each USB reset.
- Web page: connect, identify DigiISP vs USBasp, decode the board's own fuses.
- REBOOT request plus `make upload` (no replugging for firmware updates); serial
  number in EEPROM so Chrome keeps its permission; the page reconnects to
  permitted devices automatically.
- **Test:** flash board #1, check `lsusb`, open the page, and read the fuses.
  If the high fuse reads 0xDD, RSTDISBL is unprogrammed, as expected.

### Phase 2: ISP read-only ✅ (2026-09-28)
Tested: a Digispark (which shipped with hfuse 0x5D, so it already drives reset)
reads a Franzininho (hfuse 0xDD). The page reads signature and fuses
automatically, and avrdude `-c usbasp-clone` reads signature, fuses and all
8 KB of flash in 5 s. The raw ISP path also works with the reset button held.
Not yet tested: bootstrap mode on a board whose reset is still enabled (the
extra-SCK-pulse resync).

Original plan:
- The firmware already has the full USBasp ISP set (CONNECT, TRANSMIT,
  ENABLEPROG, READ/WRITE FLASH/EEPROM), ported to the USI.
- Web page: "Read signature and fuses", which prompts the user to hold reset.
- **Test:** #1 reads #2's signature (1E 93 0B) and fuses. Nothing is written.
- **Cross-check:** `avrdude -c usbasp-clone -p t85 -U hfuse:r:-:h` while holding reset.

### Phase 3: bootstrap (in progress)
Built as the page's **Bootstrap** tab (two labelled steps):
1. DigiISP onto the first board over WebUSB through its Micronucleus
   (port of the upstream uploader: reset vector patching, page writes).
2. The first board writes a complete image to the second one over ISP while
   the user holds its RESET: chip erase, Micronucleus 2.6 `t85_default` at
   0x1A00 plus DigiISP laid out as a Micronucleus upload leaves it, verify,
   then fuses E1/FE and high 0x5D last. Nothing after the erase is fatal
   until the high fuse is written, because the reset pin still works.

Original plan:
- Flash the DigiISP firmware onto #2 with Micronucleus while its reset still
  works, and check that it enumerates and reports "no reset control".
- Wizard: checklist (Micronucleus enters on power-up, target is a t25/45/85),
  read high fuse, compute value with only bit 7 cleared (refuse if DWEN or
  anything else would change), show before and after, confirm, write, verify.
- Replug #2: INFO must now report reset control.

### Phase 4: full programmer
- Part database generated from avrdude.conf (GPL; signatures, memory and page
  sizes, fuse layouts).
- Intel HEX parse and export; flash and EEPROM read, write and verify; chip
  erase; fuse editor with guards; lock bits.
- Block transfers using READFLASH/WRITEFLASH, with timing measured against avrdude.

### Phase 5: extras
- Micronucleus uploader in the web app (vendor requests too), so firmware
  updates need no command-line tools.
- WebUSB landing page descriptor once the app is hosted (GitHub Pages, HTTPS).
- TPI (ATtiny4/5/9/10) using the USBasp TPI requests.
- UPDI (a single wire; tinyAVR 0/1/2, AVR Dx) as an extension.

## Decisions

- License: GPLv2 (V-USB and USBasp code are GPL).
- Firmware: plain Makefile and avr-gcc; V-USB copied into `firmware/usbdrv`
  (see VERSION there).
- Web: TypeScript and Vite 5 (works with Ubuntu's Node 18), no framework.
- SCK: USI clocked by software strobe; "auto" is 175 kHz (safe for 1 MHz targets).

## Open questions

- USB vendor string: obdev's shared-ID rules want a domain or e-mail you
  control (e.g. the project URL). Currently the placeholder `DigiISP`.
- Hosting and project URL.
