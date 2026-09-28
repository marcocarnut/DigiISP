/*
 * isp.c - AVR serial (ISP) programming over the ATtiny85 USI
 *
 * Derived from USBasp's isp.c by Thomas Fischl (www.fischl.de): same
 * programming algorithms, with the ATmega SPI/timer code replaced by the
 * ATtiny85 USI (software clock strobe) and busy-wait delays.
 *
 * License: GNU GPL v2 (see LICENSE)
 */

#include <avr/io.h>
#include <avr/pgmspace.h>
#include <util/delay.h>
#include <util/delay_basic.h>
#include "isp.h"

uint8_t ispResetCapable;
uint8_t ispResetControl;

static uint16_t sck_delay;  /* _delay_loop_2() count per SCK half period */
static uint8_t  isp_hiaddr;

/* Cycles spent per SCK half period outside the delay loop (USICR write,
 * USISR poll, loop). Underestimating only makes SCK slower than nominal. */
#define SCK_LOOP_CYCLES 7
#define SCK_DELAY(hz)   ((F_CPU / (2UL * (hz)) > SCK_LOOP_CYCLES) ? \
        (uint16_t)((F_CPU / (2UL * (hz)) - SCK_LOOP_CYCLES + 3) / 4) : 0)

static const uint16_t sckDelays[ISP_SCK_MAX + 1] PROGMEM = {
    SCK_DELAY(187500),  /*  0 auto: safe for targets running at >= 1 MHz */
    SCK_DELAY(500),     /*  1 */
    SCK_DELAY(1000),    /*  2 */
    SCK_DELAY(2000),    /*  3 */
    SCK_DELAY(4000),    /*  4 */
    SCK_DELAY(8000),    /*  5 */
    SCK_DELAY(16000),   /*  6 */
    SCK_DELAY(32000),   /*  7 */
    SCK_DELAY(93750),   /*  8 */
    SCK_DELAY(187500),  /*  9 */
    SCK_DELAY(375000),  /* 10 */
    SCK_DELAY(750000),  /* 11 */
    SCK_DELAY(1500000), /* 12: actually ~1 MHz, the loop can't go faster */
    SCK_DELAY(1500000), /* 13: 3 MHz not supported, fall back to 12 */
};

static inline __attribute__((always_inline)) void sckDelay(uint16_t d) {
    if (d)
        _delay_loop_2(d);
}

/* Reset pulse delay: at least 2 target clocks; also used between retries. */
static void ispDelay(void) {
    _delay_us(320);
}

void ispInit(void) {
    ispSetSCKOption(ISP_SCK_AUTO);
}

void ispSetSCKOption(uint8_t option) {
    if (option > ISP_SCK_MAX)
        option = ISP_SCK_AUTO;
    sck_delay = pgm_read_word(&sckDelays[option]);
}

static void rstHigh(void) {
    if (ispResetControl)
        PORTB |= (1 << ISP_RST);
}

static void rstLow(void) {
    if (ispResetControl)
        PORTB &= ~(1 << ISP_RST);
}

void ispConnect(uint8_t manualReset) {
    ispResetControl = ispResetCapable && !manualReset;
    if (ispResetCapable && !ispResetControl) {
        /* user holds reset: PB5 must not fight the button */
        DDRB &= ~(1 << ISP_RST);
        PORTB &= ~(1 << ISP_RST);
    }

    /* SCK and MOSI low, then outputs */
    PORTB &= ~((1 << ISP_SCK) | (1 << ISP_MOSI) | (1 << ISP_MISO));
    DDRB |= (1 << ISP_SCK) | (1 << ISP_MOSI);
    DDRB &= ~(1 << ISP_MISO);

    if (ispResetControl) {
        PORTB &= ~(1 << ISP_RST);
        DDRB |= (1 << ISP_RST);
        /* positive reset pulse > 2 SCK (target) */
        ispDelay();
        rstHigh();
        ispDelay();
        rstLow();
    }

    /* USI three-wire mode, clock by software strobe */
    USICR = (1 << USIWM0);
    isp_hiaddr = 0;
}

void ispDisconnect(void) {
    USICR = 0;
    /* all ISP pins inputs, no pullups: releases the target's reset */
    DDRB &= ~((1 << ISP_SCK) | (1 << ISP_MOSI) | (1 << ISP_MISO));
    PORTB &= ~((1 << ISP_SCK) | (1 << ISP_MOSI) | (1 << ISP_MISO));
    if (ispResetCapable) {
        DDRB &= ~(1 << ISP_RST);
        PORTB &= ~(1 << ISP_RST);
    }
}

/* SPI mode 0, MSB first: each USITC write toggles USCK, the USI shifts on
 * the rising edge and the 4 bit counter overflows after 16 edges. */
uint8_t ispTransmit(uint8_t send_byte) {
    uint16_t d = sck_delay;

    USIDR = send_byte;
    USISR = (1 << USIOIF);
    do {
        sckDelay(d);
        USICR = (1 << USIWM0) | (1 << USICS1) | (1 << USICLK) | (1 << USITC);
    } while (!(USISR & (1 << USIOIF)));
    sckDelay(d);
    return USIDR;
}

/* One extra SCK pulse: shifts the target's serial programming logic by one
 * bit, to regain sync when we can't pulse its reset. */
static void sckPulse(void) {
    PORTB |= (1 << ISP_SCK);
    sckDelay(sck_delay);
    PORTB &= ~(1 << ISP_SCK);
    sckDelay(sck_delay);
}

uint8_t ispEnterProgrammingMode(void) {
    uint8_t check;
    uint8_t count = 32;

    while (count--) {
        ispTransmit(0xAC);
        ispTransmit(0x53);
        check = ispTransmit(0);
        ispTransmit(0);

        if (check == 0x53)
            return 0;

        if (ispResetControl) {
            /* pulse RST */
            ispDelay();
            rstHigh();
            ispDelay();
            rstLow();
            ispDelay();
        } else {
            sckPulse();
        }
    }
    return 1; /* error: device doesn't answer */
}

static void ispUpdateExtended(uint32_t address) {
    uint8_t curr_hiaddr = address >> 17;

    /* check if extended address byte is changed */
    if (isp_hiaddr != curr_hiaddr) {
        isp_hiaddr = curr_hiaddr;
        /* Load Extended Address byte */
        ispTransmit(0x4D);
        ispTransmit(0x00);
        ispTransmit(isp_hiaddr);
        ispTransmit(0x00);
    }
}

uint8_t ispReadFlash(uint32_t address) {
    ispUpdateExtended(address);
    ispTransmit(0x20 | ((address & 1) << 3));
    ispTransmit(address >> 9);
    ispTransmit(address >> 1);
    return ispTransmit(0);
}

/* Poll until reading address returns something other than busyValue.
 * Gives up after ~10 ms. Returns 0 on success. */
static uint8_t ispPollFlash(uint32_t address, uint8_t busyValue) {
    uint8_t retries = 30;

    while (retries--) {
        if (ispReadFlash(address) != busyValue)
            return 0;
        ispDelay();
    }
    return 1;
}

uint8_t ispWriteFlash(uint32_t address, uint8_t data, uint8_t pollmode) {
    ispUpdateExtended(address);
    ispTransmit(0x40 | ((address & 1) << 3));
    ispTransmit(address >> 9);
    ispTransmit(address >> 1);
    ispTransmit(data);

    if (pollmode == 0)
        return 0;

    if (data == 0x7F) {
        _delay_us(4800);
        return 0;
    }
    return ispPollFlash(address, 0x7F);
}

uint8_t ispFlushPage(uint32_t address, uint8_t pollvalue) {
    ispUpdateExtended(address);
    ispTransmit(0x4C);
    ispTransmit(address >> 9);
    ispTransmit(address >> 1);
    ispTransmit(0);

    if (pollvalue == 0xFF) {
        _delay_us(4800);
        return 0;
    }
    return ispPollFlash(address, 0xFF);
}

uint8_t ispReadEEPROM(uint16_t address) {
    ispTransmit(0xA0);
    ispTransmit(address >> 8);
    ispTransmit(address);
    return ispTransmit(0);
}

uint8_t ispWriteEEPROM(uint16_t address, uint8_t data) {
    ispTransmit(0xC0);
    ispTransmit(address >> 8);
    ispTransmit(address);
    ispTransmit(data);
    _delay_ms(9.6);
    return 0;
}
