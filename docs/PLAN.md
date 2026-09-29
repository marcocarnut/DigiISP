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
Tested: a Digispark (whose RSTDISBL the user had set with a minipro, so it drives reset)
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

### Phase 3: bootstrap ✅ (2026-09-28)
Verified on hardware: a brand new Digispark (Micronucleus 1.x, reset
enabled) got DigiISP through step 1, then, in bootstrap mode with the
Franzininho's RESET held by hand, wrote Micronucleus 2.6 plus DigiISP
and hfuse 0x5D to the Franzininho. The Franzininho came up as Micronucleus
2.06, then DigiISP, reporting fuses E1/5D/FE and reset control, and still
takes firmware updates (`make upload`: reboot and upload in 2.8 s).

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

### Phase 4: full programmer (in progress)
Done and tested on hardware (2026-09-28; Franzininho DigiISP programming a
Digispark, reset wired): part identification from the database, flash read,
erase+write+verify and verify from .hex (6000 random bytes in ~11 s, same as
avrdude), EEPROM write of changed bytes and read, fuse editor (BODLEVEL change
read back; the RSTDISBL warning shown and cancelled), lock bits set and then
cleared by chip erase. avrdude `-c usbasp-clone` writes and verifies flash and
EEPROM through the same firmware.
Also tested on an Arduino Nano clone, which turned out to be an ATmega328PB
(1E 95 16), over its ICSP header: full config editor (BOOTSZ, BOOTRST,
BLB0/BLB1, CFD), 32 KB flash read in 19 s at 187.5 kHz, 7.4 s at 750 kHz and
6.4 s at the fastest setting (~1 MHz, USB bound); 30 KB of random data
erased, written and verified in 18.5 s; then the backed-up bootloader,
sketch, EEPROM and lock bits restored through the page, confirmed by avrdude.
Not yet tested: flash beyond 64 KB (ATmega1280/2560, coming), unpaged flash
(AT90S).

Original plan:
- Part database generated from avrdude.conf (GPL; signatures, memory and page
  sizes, fuse layouts).
- Intel HEX parse and export; flash and EEPROM read, write and verify; chip
  erase; fuse editor with guards; lock bits.
- Block transfers using READFLASH/WRITEFLASH, with timing measured against avrdude.

### Phase 5: extras
- Done, not yet tested on hardware (2026-09-29): firmware updates from the
  page. "Update firmware…" on a connected DigiISP reboots it into
  Micronucleus, the device picker opens within Chrome's user-activation window,
  and the bundled firmware is installed; the board comes back with the same
  serial and reconnects. The programmer panel compares the firmware version
  with the bundled one (DIGIISP_FW_VERSION, now 3).
- Done, not yet tested on hardware: bootloader upgrade. With the option on
  (default), an older Micronucleus (1.x on new Digisparks) is first replaced by
  2.6 using upstream's upgrade image, then DigiISP goes into the new bootloader
  (the user picks it again: the prompt's click opens the picker). Available in
  Bootstrap step 1 and in the firmware update.
- WebUSB landing page descriptor once the app is hosted (GitHub Pages, HTTPS).
- TPI (ATtiny4/5/9/10) using the USBasp TPI requests.
- UPDI (a single wire; tinyAVR 0/1/2, AVR Dx) as an extension.

### Phase 6: UI overhaul
Round 1 done (2026-09-28): Devices tab, collapsible sections, centered
modal prompts, fuse editor usable at phone width.

Round 2 in progress: wiring diagrams. A spike page (`web/wiring.html`)
draws programmer and target as SVG top views, placed side by side or stacked
depending on the screen, turned so their ISP pins face each other, with
colored jumper wires. Boards: Digispark, Franzininho, Uno, Nano, Pro, Pro
Mini, Pro Micro, bare DIP-8 ATtiny, generic 6-pin header, USBasp 10-pin.
Wires are routed orthogonally in lanes, with crossings minimized.
Sources: docs/BOARDS.md. Integrated (2026-09-29): the Devices tab asks for the
programmer board (remembered per DigiISP serial) and the target board
(remembered), shows the wiring before Identify, leaves out the RESET wire when
it is held by hand, and warns when the chip found doesn't match the board.
Bootstrap step 2 shows the same diagram. wiring.html remains as a gallery of
all combinations. Next: bare chip pinouts from Microchip ATDF files.

Round 3 done (2026-09-29): English / Brazilian Portuguese with a selector top
right (src/i18n.ts; static text via data-i18n attributes, code via t(); fuse
bitfield texts from avrdude stay English); wire colors editable per signal
and saved in the browser (tag text switches black/white for contrast); a
big green "Checks out" / red "Mismatch" or "Failure" result after Identify;
"show / hide" pills on collapsible sections.

Make it very beginner friendly (for students and hobbyists without a
high-voltage programmer or command-line experience):
- Graphical wiring diagrams on the page (bootstrap, and programmer to common
  targets), matching the real boards' header labels (the Franzininho's RESET
  on the pin marked 4).
- Responsive layout that works on phones: Chrome on Android has WebUSB, with a
  USB-C to USB-A OTG adapter for the board. To test on a real phone.
- Plain-language steps and errors, and safe defaults throughout.

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
