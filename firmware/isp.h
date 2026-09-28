/*
 * isp.h - AVR serial (ISP) programming over the ATtiny85 USI
 *
 * Derived from USBasp's isp.h by Thomas Fischl (www.fischl.de).
 * License: GNU GPL v2 (see LICENSE)
 */

#ifndef __isp_h_included__
#define __isp_h_included__

#include <stdint.h>

/* Pin mapping (ATtiny85 USI in three-wire mode):
 *   PB0  DI    <- target MISO
 *   PB1  DO    -> target MOSI   (onboard LED, doubles as activity light)
 *   PB2  USCK  -> target SCK
 *   PB5        -> target /RESET (only when our RSTDISBL fuse is programmed)
 */
#define ISP_MISO    PB0
#define ISP_MOSI    PB1
#define ISP_SCK     PB2
#define ISP_RST     PB5

/* SCK option ids, same values as USBASP_ISP_SCK_* */
#define ISP_SCK_AUTO    0
#define ISP_SCK_MAX     13

/* Nonzero when PB5 is an I/O pin, i.e. we can drive the target's reset.
 * Otherwise the user holds the target in reset (bootstrap mode). */
extern uint8_t ispResetControl;

void    ispInit(void);
void    ispSetSCKOption(uint8_t option);
void    ispConnect(void);
void    ispDisconnect(void);
uint8_t ispTransmit(uint8_t send_byte);
uint8_t ispEnterProgrammingMode(void);
uint8_t ispReadFlash(uint32_t address);
uint8_t ispWriteFlash(uint32_t address, uint8_t data, uint8_t pollmode);
uint8_t ispFlushPage(uint32_t address, uint8_t pollvalue);
uint8_t ispReadEEPROM(uint16_t address);
uint8_t ispWriteEEPROM(uint16_t address, uint8_t data);

#endif /* __isp_h_included__ */
