# Micronucleus bootloader

`micronucleus-2.6-t85_default.hex` is the unmodified ATtiny85 release of
[Micronucleus](https://github.com/micronucleus/micronucleus) v2.6
(`firmware/releases/t85_default.hex`, upstream commit 6dca90b, 2021-11-04),
GPLv2.

The web app's bootstrap uses it when it writes a complete image to a board
over ISP (chip erase, then Micronucleus at 0x1A00 plus DigiISP below it).

`micronucleus-2.6-t85_default-upgrade.hex` is the unmodified upstream upgrader
(`firmware/upgrades/upgrade-t85_default.hex`, same commit): an application,
uploaded through whatever Micronucleus a board has (1.x included), that
rewrites the bootloader area with Micronucleus 2.6, erases the "application
present" marker and reboots into the new bootloader. The web app uses it to
upgrade boards before installing DigiISP.

Configuration: bootloader at 0x1A00, entry on every reset (ENTRY_ALWAYS),
6 s timeout, OSCCAL saved at 0x19FA, fuses lfuse 0xE1, hfuse 0xDD (0x5D with
reset disabled), efuse 0xFE.

## License and source

Micronucleus is free software under the GNU GPL v2 (see its
[Readme](https://github.com/micronucleus/micronucleus/blob/master/Readme.md)
and [License.txt](https://github.com/micronucleus/micronucleus/blob/master/License.txt)),
like DigiISP. These images are unmodified builds from upstream; their
corresponding source is the upstream repository at tag **v2.6**
(commit 6dca90b):
https://github.com/micronucleus/micronucleus/tree/v2.6
