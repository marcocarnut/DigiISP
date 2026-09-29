# Board drawings: sources

The wiring diagrams (`web/src/wiring/boards.ts`) are simplified top views drawn
by this project. Pin positions, outlines and silkscreen labels were measured
from each board's published design files:

| Board | Design file | Source | License |
|---|---|---|---|
| Digispark rev3 | `DIGISPARK_PRODUCTION_REV3.brd` (Eagle) | Digistump LLC, via [Ladvien/Ladviens-Eagle-Files](https://github.com/Ladvien/Ladviens-Eagle-Files/blob/master/DigiSpark/DIGISPARK_PRODUCTION_REV3.brd) | CC BY-SA 3.0 |
| Franzininho DIY V2RV3 | `Franzininho.kicad_pcb` (KiCad) | [Franzininho/franzininho-diy-board](https://github.com/Franzininho/franzininho-diy-board) | CC BY-SA 4.0 |
| Arduino Uno Rev3 | `UNO-TH_Rev3e.brd` (Eagle) | [docs.arduino.cc/hardware/uno-rev3](https://docs.arduino.cc/hardware/uno-rev3) (CAD files) | CC BY-SA |
| Arduino Nano 3.x | `NanoV3.3.brd` (Eagle) | [docs.arduino.cc/hardware/nano](https://docs.arduino.cc/hardware/nano) (CAD files) | CC BY-SA |
| Arduino Pro (SparkFun) | `Arduino-Pro-v16.brd` (Eagle) | [sparkfun/Arduino_Pro_328](https://github.com/sparkfun/Arduino_Pro_328) | CC BY-SA 4.0 |
| Arduino Pro Mini (SparkFun) | `Arduino-Pro-Mini.brd` (Eagle) | [sparkfun/Arduino_Pro_Mini_328](https://github.com/sparkfun/Arduino_Pro_Mini_328) | CC BY-SA 4.0 |
| Pro Micro (SparkFun v13; clones follow it) | `SparkFun_Pro_Micro.brd` (Eagle) | [sparkfun/Pro_Micro](https://github.com/sparkfun/Pro_Micro) | CC BY-SA 4.0 |

Bare chips follow the Microchip datasheets. The standard 6-pin and 10-pin ISP
header pinouts come from Atmel's application note AVR910.

## Findings worth knowing

- **Franzininho DIY V2RV3:** the header silkscreen labels 4 and 5 are swapped.
  The pin marked **4** is PB5 (RESET) and **5** is PB4.
- **Arduino Uno:** it has two 6-pin ICSP headers. The one for the ATmega328P
  is at the right edge next to the chip. `ICSP1`, next to the USB socket,
  belongs to the ATmega16U2 USB chip.
- **Pro Mini and Pro Micro:** all six ISP signals are on one side (RAW, GND,
  RST, VCC, ... 13/12/11 on the Pro Mini, 15/14/16 on the Pro Micro).
- **ICSP headers:** they agree on Uno, Nano and Pro: 1 MISO, 2 VCC, 3 SCK,
  4 MOSI, 5 RESET, 6 GND. The orientation on the board differs: the Nano's
  pin 1 is at the corner farthest from USB, on the outer column.

## Method

The Eagle `.brd` and KiCad `.kicad_pcb` files were parsed for pad positions,
their nets and nearby silkscreen text; the nets confirm which pin carries which
signal. Eagle coordinates (y up) were converted to the drawings' y-down
millimetres.
