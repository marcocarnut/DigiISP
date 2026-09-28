# DigiISP firmware - ATtiny85 @ 16.5 MHz under Micronucleus 2.x
#
#   make            build digiisp.hex
#   make flash      upload with micronucleus (plug the board in when asked)
#
# Put local overrides (e.g. MICRONUCLEUS = /path/to/micronucleus) in local.mk.

-include local.mk

MCU          ?= attiny85
F_CPU        ?= 16500000
MICRONUCLEUS ?= micronucleus
# Micronucleus 2.x t85: bootloader at 0x1A00, minus 6 bytes of postscript
MAX_SIZE     ?= 6650

CC      = avr-gcc
OBJCOPY = avr-objcopy
SIZE    = avr-size

CFLAGS  = -mmcu=$(MCU) -DF_CPU=$(F_CPU) -Os -std=gnu11 -Wall -Wextra \
          -ffunction-sections -fdata-sections -I. -Iusbdrv
ASFLAGS = -mmcu=$(MCU) -DF_CPU=$(F_CPU) -x assembler-with-cpp -I. -Iusbdrv
LDFLAGS = -mmcu=$(MCU) -Wl,--gc-sections

OBJS = main.o isp.o usbdrv/usbdrv.o usbdrv/usbdrvasm.o

all: digiisp.hex size

digiisp.elf: $(OBJS)
	$(CC) $(LDFLAGS) -o $@ $^

digiisp.hex: digiisp.elf
	$(OBJCOPY) -j .text -j .data -O ihex $< $@

size: digiisp.elf
	@$(SIZE) $<
	@bytes=$$($(SIZE) -A $< | awk '/^\.(text|data) /{s+=$$2} END{print s}'); \
	echo "flash used: $$bytes of $(MAX_SIZE) bytes"; \
	test $$bytes -le $(MAX_SIZE) || { echo "ERROR: too big for Micronucleus"; exit 1; }

%.o: %.c usbconfig.h protocol.h isp.h
	$(CC) $(CFLAGS) -c -o $@ $<

%.o: %.S usbconfig.h
	$(CC) $(ASFLAGS) -c -o $@ $<

flash: digiisp.hex
	$(MICRONUCLEUS) --run $<

clean:
	rm -f $(OBJS) digiisp.elf digiisp.hex

.PHONY: all size flash clean
