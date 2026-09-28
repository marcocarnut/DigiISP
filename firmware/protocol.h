/*
 * protocol.h - USB request numbers: USBasp protocol plus DigiISP extensions
 *
 * USBasp values from Thomas Fischl's USBasp (www.fischl.de). The web app
 * mirrors this file in web/src/protocol.ts; see docs/PROTOCOL.md.
 *
 * License: GNU GPL v2 (see LICENSE)
 */

#ifndef __protocol_h_included__
#define __protocol_h_included__

/* USBasp functions (bRequest of vendor requests to the device) */
#define USBASP_FUNC_CONNECT         1
#define USBASP_FUNC_DISCONNECT      2
#define USBASP_FUNC_TRANSMIT        3
#define USBASP_FUNC_READFLASH       4
#define USBASP_FUNC_ENABLEPROG      5
#define USBASP_FUNC_WRITEFLASH      6
#define USBASP_FUNC_READEEPROM      7
#define USBASP_FUNC_WRITEEEPROM     8
#define USBASP_FUNC_SETLONGADDRESS  9
#define USBASP_FUNC_SETISPSCK       10
#define USBASP_FUNC_TPI_CONNECT     11
#define USBASP_FUNC_TPI_DISCONNECT  12
#define USBASP_FUNC_TPI_RAWREAD     13
#define USBASP_FUNC_TPI_RAWWRITE    14
#define USBASP_FUNC_TPI_READBLOCK   15
#define USBASP_FUNC_TPI_WRITEBLOCK  16
#define USBASP_FUNC_GETCAPABILITIES 127

#define USBASP_BLOCKFLAG_FIRST      1
#define USBASP_BLOCKFLAG_LAST       2

/* GETCAPABILITIES reply, byte 0 (as USBasp) */
#define USBASP_CAP0_TPI             0x01

/* GETCAPABILITIES reply, byte 1: DigiISP bits. avrdude only looks at bit 0
 * of byte 0 (TPI) and bit 0 of byte 3 (3 MHz SCK, UsbAsp-flash). */
#define DIGIISP_CAP1_EXTENSIONS     0x80    /* DIGIISP_FUNC_* supported */
#define DIGIISP_FLAG_RESET_CONTROL  0x01    /* we drive the target /RESET */

/* DigiISP functions */
#define DIGIISP_FUNC_INFO           0x40    /* IN, DIGIISP_INFO_LEN bytes */
#define DIGIISP_FUNC_MS_OS_20       0x4D    /* IN, wIndex 7: MS OS 2.0 set */

/* DIGIISP_FUNC_INFO reply layout */
#define DIGIISP_INFO_LEN            10
#define DIGIISP_MAGIC0              'D'
#define DIGIISP_MAGIC1              'I'
#define DIGIISP_PROTOCOL_VERSION    1
#define DIGIISP_FW_VERSION          1

#endif /* __protocol_h_included__ */
