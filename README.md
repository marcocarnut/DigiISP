# DigiISP

*[Leia em português](README.pt-BR.md)*

**Turn a cheap Digispark or Franzininho into a USB programmer for AVR
microcontrollers, and program chips straight from your browser, on a computer
or a phone. Nothing to install.**

➡️ **https://digiisp.postcogito.org**

DigiISP is two things that work together:

- **Firmware** for ATtiny85 boards (Digispark, Franzininho DIY) that makes them
  an ISP programmer. It speaks the USBasp protocol, so avrdude and the Arduino
  IDE can use it too.
- **A web app** that drives the programmer over WebUSB: it identifies the chip,
  reads and writes flash and EEPROM, edits fuses and lock bits with plain
  language explanations, and shows how to wire everything. It also works with
  ordinary USBasp programmers. English and Brazilian Portuguese.

## The trick: two boards, no special programmer

An ATtiny85 board has too few free pins to be a programmer: USB takes two, ISP
needs four more, and the fourth one (the target's reset) can only come from the
ATtiny85's own RESET pin, once that pin is turned into a normal I/O pin. Doing
that normally takes a programmer, or a high-voltage one to undo.

DigiISP solves it with **two boards**:

1. The web page installs DigiISP on the **first board** over USB, through the
   Micronucleus bootloader the board comes with.
2. You wire the first board to a **second board** and hold the second board's
   RESET button (or a jumper). The first board writes the bootloader and
   DigiISP to it, checks them, and only then turns its RESET pin into I/O.

The second board is now a complete programmer, and can make more of them without
anyone holding a button. It still takes firmware updates over USB, from the page.

## What you need

- **Two** ATtiny85 boards with Micronucleus: Digispark (and clones) or
  Franzininho DIY. New Digisparks come with Micronucleus 1.x; the page can
  upgrade it to 2.6.
- A few female-to-female jumper wires (for a Digispark target without a reset
  button, a Y cable or two jumpers on one pin).
- A browser with WebUSB: Chrome, Edge or another Chromium based browser, or
  Chrome on Android with a USB OTG adapter. Firefox and Safari don't support
  WebUSB.
- On Linux, permission to use the device: see [udev](#linux-permissions).
  Windows installs the right driver (WinUSB) by itself.

## What it can program

About 160 AVRs with ISP: ATtiny (13/25/45/85, 24/44/84, 2313, and many more)
and ATmega (8, 168, 328P/PB, 32U4, 644, 1284, 2560, ...). The part database is
generated from [avrdude](https://github.com/avrdudes/avrdude)'s. The page draws
the wiring for:

- Digispark and Franzininho DIY (as programmer or target)
- Arduino Uno, Nano, Pro, Pro Mini and Pro Micro
- bare ATtiny12/13/15/25/45/85 in DIP-8
- any board with the standard 6-pin ISP header, and USBasp's 10-pin cable

Tested on real hardware so far: ATtiny85 (Digispark, Franzininho), ATmega328PB
(Arduino Nano clone). Not yet: flash above 64 KB (ATmega1280/2560).

## Using it with avrdude

DigiISP uses the USBasp protocol and USB IDs, so avrdude finds it as a USBasp
clone:

```sh
avrdude -c usbasp-clone -p m328p -U flash:w:sketch.hex:i
```

`-c usbasp-clone` matches any USBasp by its USB IDs; plain `-c usbasp` also
checks the vendor name, which is different for DigiISP.

## Linux permissions

```sh
sudo cp udev/60-digiisp.rules /etc/udev/rules.d/
sudo udevadm control --reload-rules
```

Then replug the board. (Installing the `avrdude` package gives an equivalent
rule.)

## Building from source

Everything is in this repository:

| Directory | What |
|---|---|
| `firmware/` | ATtiny85 firmware in C (V-USB), runs under Micronucleus |
| `firmware/bootloader/` | Micronucleus 2.6 images used by the bootstrap and the upgrade |
| `web/` | the web app (TypeScript, Vite, no framework) |
| `tools/` | `digiisp`: list boards, reboot them into the bootloader, check wiring (libusb) |
| `udev/` | Linux permissions |
| `docs/` | [USB protocol](docs/PROTOCOL.md), [board drawing sources](docs/BOARDS.md), [project plan and history](docs/PLAN.md) |

**Firmware** (needs `gcc-avr`, `avr-libc`, and the `micronucleus` command line
tool for uploading):

```sh
cd firmware
make                          # builds digiisp.hex
make flash                    # upload: plug the board in when asked
make upload                   # a DigiISP already running: reboot it into the bootloader and upload
make upload SERIAL=54F6894A   # the same, for one of several boards
make release                  # copy it to release/digiisp.hex, the firmware the web app ships
```

`firmware/release/digiisp.hex` is committed: it is the firmware the page
installs and compares boards against, so it is updated (with `make release`)
together with `DIGIISP_FW_VERSION` in `protocol.h`. It is also the file to use
with other upload tools.

If `micronucleus` isn't on your PATH, put `MICRONUCLEUS = /path/to/micronucleus`
in `firmware/local.mk`.

**Web app** (needs Node 18 or newer, nothing else):

```sh
cd web
npm install
npm run dev      # open the printed http://localhost address in Chrome
npm run build    # static site in web/dist, ready to copy to any web server
```

WebUSB only works on HTTPS or `localhost`. To try the development server from a
phone, enable `chrome://flags` → "Insecure origins treated as secure" for the
computer's address.

**Command line tool** (needs `libusb-1.0-0-dev`):

```sh
make -C tools
tools/digiisp list     # boards, their fuses, firmware and bootloader versions
tools/digiisp probe    # wiring check: pin levels and the target's answer
```

## License and credits

DigiISP is free software under the **GNU General Public License v2** (see
[LICENSE](LICENSE)). It builds on:

- [V-USB](https://www.obdev.at/products/vusb/) by Objective Development
  (GPLv2), the software USB driver in the firmware; the USB IDs are V-USB's
  shared ones, under its rules
- [USBasp](https://www.fischl.de/usbasp/) by Thomas Fischl (GPLv2): the USB
  protocol and the ISP code the firmware is derived from
- [Micronucleus](https://github.com/micronucleus/micronucleus) (GPLv2):
  bootloader and upgrade images, unmodified (source: upstream tag v2.6, see
  [firmware/bootloader](firmware/bootloader/README.md)), and the upload protocol
- [avrdude](https://github.com/avrdudes/avrdude) (GPLv2): part database and fuse
  descriptions
- the published design files of the Digispark (Digistump), Franzininho DIY,
  Arduino and SparkFun boards (CC BY-SA), which the wiring drawings were
  measured from; see [docs/BOARDS.md](docs/BOARDS.md)
