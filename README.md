# DigiISP

A USB ISP programmer for AVR microcontrollers, made from an ATtiny85
Digispark or Franzininho and driven from a web page over WebUSB. It uses the
USBasp protocol, so the web app also drives USBasp programmers, and avrdude
drives DigiISP.

An ATtiny85 board only has enough spare pins for the target's reset once its
own reset pin becomes I/O. A two-board bootstrap does that without a
high-voltage programmer; see [docs/PLAN.md](docs/PLAN.md).

## Layout

- `firmware/`: ATtiny85 firmware (V-USB, runs under Micronucleus 2.x)
- `web/`: the web app (TypeScript, Vite)
- `docs/`: [plan](docs/PLAN.md) and [USB protocol](docs/PROTOCOL.md)
- `udev/`: Linux permissions for WebUSB

## Build and flash the firmware

Needs `gcc-avr`, `avr-libc` and the `micronucleus` command-line tool.

```sh
cd firmware
make                 # builds digiisp.hex
make flash           # then plug the board in when asked
```

If `micronucleus` isn't on your PATH, put `MICRONUCLEUS = /path/to/micronucleus`
in `firmware/local.mk`.

After flashing, the board enumerates as `16c0:05dc DigiISP` about 6 seconds
after plug-in (Micronucleus runs first).

## Run the web app

```sh
cd web
npm install
npm run dev          # open the printed http://localhost URL in Chrome/Edge
```

WebUSB needs a Chromium-based browser and a secure context (localhost or HTTPS).
On Linux, install `udev/60-digiisp.rules`; the `avrdude` package already ships
an equivalent rule.

## avrdude

```sh
avrdude -c usbasp-clone -p t85 -U hfuse:r:-:h
```

## License

GPLv2. Includes V-USB by Objective Development and code derived from USBasp by
Thomas Fischl.
