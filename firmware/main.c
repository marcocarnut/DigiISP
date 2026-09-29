/*
 * main.c - DigiISP: USBasp compatible ISP programmer on an ATtiny85
 * (Digispark / Franzininho) with V-USB, usable from WebUSB.
 *
 * Request handling derived from USBasp's main.c by Thomas Fischl
 * (www.fischl.de). See docs/PROTOCOL.md.
 *
 * License: GNU GPL v2 (see LICENSE)
 */

#include <avr/io.h>
#include <avr/interrupt.h>
#include <avr/pgmspace.h>
#include <avr/boot.h>
#include <avr/wdt.h>
#include <avr/eeprom.h>
#include <util/delay.h>
#include <stdlib.h>

#include "usbdrv.h"
#include "isp.h"
#include "protocol.h"

#define PROG_STATE_IDLE         0
#define PROG_STATE_WRITEFLASH   1
#define PROG_STATE_READFLASH    2
#define PROG_STATE_READEEPROM   3
#define PROG_STATE_WRITEEEPROM  4

static uint8_t  replyBuffer[DIGIISP_INFO_LEN];
static uint8_t  prog_state = PROG_STATE_IDLE;
static uint8_t  prog_sck = ISP_SCK_AUTO;
static uint32_t prog_address;
static uint16_t prog_nbytes;
static uint16_t prog_pagesize;
static uint8_t  prog_blockflags;
static uint16_t prog_pagecounter;
static uint8_t  prog_address_newmode;
static uint8_t  rebootRequested;
static uint16_t bootloaderVersion;

/* ------------------------------------------------------------------------- */
/* Descriptors                                                               */
/* ------------------------------------------------------------------------- */

PROGMEM const char usbDescriptorDevice[18] = {
    18,                     /* bLength */
    USBDESCR_DEVICE,        /* bDescriptorType */
    0x10, 0x02,             /* bcdUSB 2.10: host may ask for the BOS */
    USB_CFG_DEVICE_CLASS,
    USB_CFG_DEVICE_SUBCLASS,
    0,                      /* bDeviceProtocol */
    8,                      /* bMaxPacketSize0 */
    USB_CFG_VENDOR_ID,
    USB_CFG_DEVICE_ID,
    USB_CFG_DEVICE_VERSION,
    1,                      /* iManufacturer */
    2,                      /* iProduct */
    3,                      /* iSerialNumber */
    1,                      /* bNumConfigurations */
};

#define USBDESCR_BOS            0x0F
#define MS_OS_20_SET_LEN        0xA2
#define MS_OS_20_DESCRIPTOR_INDEX 7

/* BOS with a Microsoft OS 2.0 platform capability, so Windows binds WinUSB
 * (needed for WebUSB) without any driver installation. */
static const PROGMEM uint8_t bosDescriptor[] = {
    5, USBDESCR_BOS, 40, 0, 2,
    /* USB 2.0 extension: no LPM (Linux warns if it's missing) */
    7, 0x10, 0x02, 0x00, 0x00, 0x00, 0x00,
    /* MS OS 2.0 platform capability */
    28, 0x10, 0x05, 0x00,
    0xDF, 0x60, 0xDD, 0xD8, 0x89, 0x45, 0xC7, 0x4C,     /* {D8DD60DF-4589- */
    0x9C, 0xD2, 0x65, 0x9D, 0x9E, 0x64, 0x8A, 0x9F,     /* 4CC7-9CD2-659D9E648A9F} */
    0x00, 0x00, 0x03, 0x06,                             /* Windows 8.1+ */
    MS_OS_20_SET_LEN, 0x00,
    DIGIISP_FUNC_MS_OS_20,                              /* bMS_VendorCode */
    0x00,                                               /* bAltEnumCode */
};
_Static_assert(sizeof(bosDescriptor) == 40, "BOS wTotalLength");

#define W(c) c, 0   /* UTF-16LE character */

static const PROGMEM uint8_t msOs20DescriptorSet[] = {
    /* set header */
    0x0A, 0x00, 0x00, 0x00, 0x00, 0x00, 0x03, 0x06, MS_OS_20_SET_LEN, 0x00,
    /* compatible ID: WinUSB */
    0x14, 0x00, 0x03, 0x00, 'W', 'I', 'N', 'U', 'S', 'B', 0, 0,
    0, 0, 0, 0, 0, 0, 0, 0,
    /* registry property: DeviceInterfaceGUIDs (REG_MULTI_SZ) */
    0x84, 0x00, 0x04, 0x00, 0x07, 0x00,
    0x2A, 0x00,
    W('D'), W('e'), W('v'), W('i'), W('c'), W('e'), W('I'), W('n'), W('t'),
    W('e'), W('r'), W('f'), W('a'), W('c'), W('e'), W('G'), W('U'), W('I'),
    W('D'), W('s'), W(0),
    0x50, 0x00,
    W('{'), W('A'), W('C'), W('0'), W('C'), W('7'), W('D'), W('D'), W('1'),
    W('-'), W('7'), W('0'), W('4'), W('B'), W('-'), W('4'), W('D'), W('6'),
    W('5'), W('-'), W('9'), W('C'), W('3'), W('D'), W('-'), W('1'), W('4'),
    W('D'), W('8'), W('6'), W('2'), W('D'), W('4'), W('E'), W('3'), W('4'),
    W('5'), W('}'), W(0), W(0),
};
_Static_assert(sizeof(msOs20DescriptorSet) == MS_OS_20_SET_LEN,
        "MS OS 2.0 descriptor set length");

usbMsgLen_t usbFunctionDescriptor(usbRequest_t *rq) {
    if (rq->wValue.bytes[1] == USBDESCR_BOS) {
        usbMsgPtr = (usbMsgPtr_t)bosDescriptor;
        return sizeof(bosDescriptor);
    }
    return 0;
}

/* ------------------------------------------------------------------------- */
/* Serial number                                                             */
/* ------------------------------------------------------------------------- */

#define EE_SERIAL   ((uint32_t *)0x10)
#define SERIAL_LEN  8

int usbDescriptorStringSerialNumber[1 + SERIAL_LEN] = {
    USB_STRING_DESCRIPTOR_HEADER(SERIAL_LEN),
};

/* Random bits from the watchdog oscillator's jitter against the CPU clock:
 * the two are independent RC oscillators, so the low bits of Timer0 at each
 * watchdog timeout are unpredictable. Takes ~1 s; runs only on first boot. */
static uint32_t entropy(void) {
    uint32_t s = OSCCAL;
    uint8_t i;

    TCCR0B = (1 << CS00);
    WDTCR = (1 << WDCE) | (1 << WDE);
    WDTCR = (1 << WDIF) | (1 << WDIE);  /* 16 ms, interrupt mode, no reset */
    for (i = 0; i < 64; i++) {
        while (!(WDTCR & (1 << WDIF)))
            ;
        WDTCR |= (1 << WDIF);
        s = ((s << 3) | (s >> 29)) ^ TCNT0;
    }
    wdt_disable();
    TCCR0B = 0;
    return s;
}

/* The serial lives in EEPROM, which Micronucleus never erases, so it
 * survives firmware updates. */
static void initSerial(void) {
    uint32_t serial = eeprom_read_dword(EE_SERIAL);
    uint8_t i;

    if (serial == 0xFFFFFFFF) {
        serial = entropy();
        eeprom_write_dword(EE_SERIAL, serial);
    }
    for (i = 0; i < SERIAL_LEN; i++) {
        uint8_t n = (serial >> (28 - 4 * i)) & 0x0F;
        usbDescriptorStringSerialNumber[1 + i] = n < 10 ? '0' + n : 'A' - 10 + n;
    }
}

/* ------------------------------------------------------------------------- */
/* Oscillator tuning                                                         */
/* ------------------------------------------------------------------------- */

/* Micronucleus hands over a calibrated OSCCAL; after each USB reset we only
 * refine it by walking to the neighbour that best matches the host's frame
 * timing. Stays within the current half of the ATtiny85's split OSCCAL range. */
static int16_t frameDeviation(void) {
    const int16_t target = (int16_t)(1499 * (double)F_CPU / 10.5e6 + 0.5);
    return abs((int16_t)usbMeasureFrameLength() - target);
}

void usbHadReset(void) {
    uint8_t best, i;
    int8_t  dir;
    int16_t bestDev, dev;

    cli();
    best = OSCCAL;
    bestDev = frameDeviation();
    for (dir = -1; dir <= 1; dir += 2) {
        for (i = 0; i < 16; i++) {
            uint8_t next = OSCCAL + dir;
            if ((next ^ best) & 0x80)
                break;
            OSCCAL = next;
            dev = frameDeviation();
            if (dev >= bestDev)
                break;
            best = next;
            bestDev = dev;
        }
        OSCCAL = best;
    }
    sei();
}

/* ------------------------------------------------------------------------- */
/* Requests                                                                  */
/* ------------------------------------------------------------------------- */

static uint8_t digiIspFlags(void) {
    return ispResetCapable ? DIGIISP_FLAG_RESET_CONTROL : 0;
}

usbMsgLen_t usbFunctionSetup(uchar data[8]) {
    usbRequest_t *rq = (usbRequest_t *)data;
    uint8_t len = 0;

    if (data[1] == USBASP_FUNC_CONNECT) {
        ispSetSCKOption(prog_sck);
        /* set compatibility mode of address delivering */
        prog_address_newmode = 0;
        ispConnect(data[2] & DIGIISP_CONNECT_MANUAL_RESET);

    } else if (data[1] == USBASP_FUNC_DISCONNECT) {
        ispDisconnect();

    } else if (data[1] == USBASP_FUNC_TRANSMIT) {
        replyBuffer[0] = ispTransmit(data[2]);
        replyBuffer[1] = ispTransmit(data[3]);
        replyBuffer[2] = ispTransmit(data[4]);
        replyBuffer[3] = ispTransmit(data[5]);
        len = 4;

    } else if (data[1] == USBASP_FUNC_READFLASH
            || data[1] == USBASP_FUNC_READEEPROM) {
        if (!prog_address_newmode)
            prog_address = (data[3] << 8) | data[2];
        prog_nbytes = (data[7] << 8) | data[6];
        prog_state = data[1] == USBASP_FUNC_READFLASH
                ? PROG_STATE_READFLASH : PROG_STATE_READEEPROM;
        len = USB_NO_MSG;

    } else if (data[1] == USBASP_FUNC_ENABLEPROG) {
        replyBuffer[0] = ispEnterProgrammingMode();
        len = 1;

    } else if (data[1] == USBASP_FUNC_WRITEFLASH) {
        if (!prog_address_newmode)
            prog_address = (data[3] << 8) | data[2];
        prog_pagesize = data[4];
        prog_blockflags = data[5] & 0x0F;
        prog_pagesize += (((uint16_t)data[5] & 0xF0) << 4);
        if (prog_blockflags & USBASP_BLOCKFLAG_FIRST)
            prog_pagecounter = prog_pagesize;
        prog_nbytes = (data[7] << 8) | data[6];
        prog_state = PROG_STATE_WRITEFLASH;
        len = USB_NO_MSG;

    } else if (data[1] == USBASP_FUNC_WRITEEEPROM) {
        if (!prog_address_newmode)
            prog_address = (data[3] << 8) | data[2];
        prog_pagesize = 0;
        prog_blockflags = 0;
        prog_nbytes = (data[7] << 8) | data[6];
        prog_state = PROG_STATE_WRITEEEPROM;
        len = USB_NO_MSG;

    } else if (data[1] == USBASP_FUNC_SETLONGADDRESS) {
        /* set new mode of address delivering (ignore address in commands) */
        prog_address_newmode = 1;
        prog_address = data[2] | ((uint32_t)data[3] << 8)
                | ((uint32_t)data[4] << 16) | ((uint32_t)data[5] << 24);

    } else if (data[1] == USBASP_FUNC_SETISPSCK) {
        prog_sck = data[2];
        replyBuffer[0] = 0;
        len = 1;

    } else if (data[1] == USBASP_FUNC_GETCAPABILITIES) {
        replyBuffer[0] = 0;     /* no TPI (yet) */
        replyBuffer[1] = DIGIISP_CAP1_EXTENSIONS | digiIspFlags();
        replyBuffer[2] = 0;
        replyBuffer[3] = 0;
        len = 4;

    } else if (data[1] == DIGIISP_FUNC_INFO) {
        replyBuffer[0] = DIGIISP_MAGIC0;
        replyBuffer[1] = DIGIISP_MAGIC1;
        replyBuffer[2] = DIGIISP_PROTOCOL_VERSION;
        replyBuffer[3] = DIGIISP_FW_VERSION;
        replyBuffer[4] = digiIspFlags();
        replyBuffer[5] = OSCCAL;
        replyBuffer[6] = boot_lock_fuse_bits_get(GET_LOW_FUSE_BITS);
        replyBuffer[7] = boot_lock_fuse_bits_get(GET_HIGH_FUSE_BITS);
        replyBuffer[8] = boot_lock_fuse_bits_get(GET_EXTENDED_FUSE_BITS);
        replyBuffer[9] = boot_lock_fuse_bits_get(GET_LOCK_BITS);
        replyBuffer[10] = bootloaderVersion >> 8;     /* Micronucleus major, 0: unknown */
        replyBuffer[11] = bootloaderVersion;          /* minor */
        len = DIGIISP_INFO_LEN;

    } else if (data[1] == DIGIISP_FUNC_REBOOT) {
        rebootRequested = 1;    /* after the status stage, see main() */

    } else if (data[1] == DIGIISP_FUNC_PINS) {
        replyBuffer[0] = PINB;
        replyBuffer[1] = DDRB;
        replyBuffer[2] = PORTB;
        len = 3;

    } else if (data[1] == DIGIISP_FUNC_MS_OS_20
            && rq->wIndex.word == MS_OS_20_DESCRIPTOR_INDEX) {
        usbMsgPtr = (usbMsgPtr_t)msOs20DescriptorSet;
        usbMsgFlags = USB_FLG_MSGPTR_IS_ROM;
        return sizeof(msOs20DescriptorSet);
    }

    usbMsgPtr = (usbMsgPtr_t)replyBuffer;
    return len;
}

uchar usbFunctionRead(uchar *data, uchar len) {
    uint8_t i;

    if (prog_state != PROG_STATE_READFLASH
            && prog_state != PROG_STATE_READEEPROM)
        return 0xff;

    for (i = 0; i < len; i++) {
        if (prog_state == PROG_STATE_READFLASH)
            data[i] = ispReadFlash(prog_address);
        else
            data[i] = ispReadEEPROM(prog_address);
        prog_address++;
    }

    /* last packet? */
    if (len < 8)
        prog_state = PROG_STATE_IDLE;

    return len;
}

uchar usbFunctionWrite(uchar *data, uchar len) {
    uint8_t retVal = 0;
    uint8_t i;

    if (prog_state != PROG_STATE_WRITEFLASH
            && prog_state != PROG_STATE_WRITEEEPROM)
        return 0xff;

    for (i = 0; i < len; i++) {
        if (prog_state == PROG_STATE_WRITEFLASH) {
            if (prog_pagesize == 0) {
                /* not paged */
                ispWriteFlash(prog_address, data[i], 1);
            } else {
                /* paged */
                ispWriteFlash(prog_address, data[i], 0);
                prog_pagecounter--;
                if (prog_pagecounter == 0) {
                    ispFlushPage(prog_address, data[i]);
                    prog_pagecounter = prog_pagesize;
                }
            }
        } else {
            ispWriteEEPROM(prog_address, data[i]);
        }

        prog_nbytes--;

        if (prog_nbytes == 0) {
            prog_state = PROG_STATE_IDLE;
            if ((prog_blockflags & USBASP_BLOCKFLAG_LAST)
                    && prog_pagecounter != prog_pagesize) {
                /* last block and page flush pending, so flush it now */
                ispFlushPage(prog_address, data[i]);
            }
            retVal = 1; /* no more data to receive */
        }

        prog_address++;
    }

    return retVal;
}

/* ------------------------------------------------------------------------- */

/* The bootloader's version: find Micronucleus' USB device descriptor
 * (VID 16d0, PID 0753) in flash and take its bcdDevice. 0 if not found. */
static uint16_t findBootloaderVersion(void) {
    uint16_t a;

    for (a = 0x1600; a < FLASHEND - 14; a++) {
        if (pgm_read_byte(a) == 18 && pgm_read_byte(a + 1) == USBDESCR_DEVICE
                && pgm_read_word(a + 8) == 0x16d0 && pgm_read_word(a + 10) == 0x0753)
            return pgm_read_word(a + 12);
    }
    return 0;
}

/* Detach from USB and let the watchdog reset us into Micronucleus, which
 * starts on every reset (ENTRY_ALWAYS) and disables the watchdog. */
static void reboot(void) {
    ispDisconnect();
    cli();
    usbDeviceDisconnect();
    wdt_enable(WDTO_15MS);
    for (;;)
        ;
}

int main(void) {
    uint8_t i;

    MCUSR = 0;
    wdt_disable();

    /* RSTDISBL programmed (0) means PB5 is ours to drive the target reset */
    ispResetCapable = !(boot_lock_fuse_bits_get(GET_HIGH_FUSE_BITS) & _BV(7));
    ispInit();
    ispDisconnect();
    initSerial();
    bootloaderVersion = findBootloaderVersion();

    usbInit();
    /* force re-enumeration after the bootloader */
    usbDeviceDisconnect();
    for (i = 0; i < 250; i++)
        _delay_ms(1);
    usbDeviceConnect();
    sei();

    for (;;) {
        usbPoll();
        if (rebootRequested) {
            /* keep serving USB for a moment so the host sees the request
             * complete before we drop off the bus */
            _delay_ms(1);
            if (++rebootRequested > 50)
                reboot();
        }
    }
}
