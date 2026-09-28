# Host tools for DigiISP (need libusb-1.0 development files)

CFLAGS  ?= -O2 -Wall -Wextra
LDLIBS  = $(shell pkg-config --libs libusb-1.0)

all: digiisp

digiisp: digiisp.c ../firmware/protocol.h
	$(CC) $(CFLAGS) -o $@ $< $(LDLIBS)

clean:
	rm -f digiisp

.PHONY: all clean
