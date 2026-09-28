# Host tools for DigiISP (need libusb-1.0 development files)

CFLAGS  ?= -O2 -Wall -Wextra
LDLIBS  = $(shell pkg-config --libs libusb-1.0)

all: digiisp-reboot

digiisp-reboot: digiisp-reboot.c ../firmware/protocol.h
	$(CC) $(CFLAGS) -o $@ $< $(LDLIBS)

clean:
	rm -f digiisp-reboot

.PHONY: all clean
