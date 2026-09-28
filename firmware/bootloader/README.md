# Micronucleus bootloader

`micronucleus-2.6-t85_default.hex` is the unmodified ATtiny85 release of
[Micronucleus](https://github.com/micronucleus/micronucleus) v2.6
(`firmware/releases/t85_default.hex`, upstream commit 6dca90b, 2021-11-04),
GPLv2.

The web app's bootstrap uses it when it writes a complete image to a board
over ISP (chip erase, then Micronucleus at 0x1A00 plus DigiISP below it).

Configuration: bootloader at 0x1A00, entry on every reset (ENTRY_ALWAYS),
6 s timeout, OSCCAL saved at 0x19FA, fuses lfuse 0xE1, hfuse 0xDD (0x5D with
reset disabled), efuse 0xFE.
