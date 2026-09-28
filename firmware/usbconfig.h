/*
 * usbconfig.h - V-USB configuration for DigiISP
 *
 * Target: ATtiny85 @ 16.5 MHz (PLL, OSCCAL tuned) on a Digispark/Franzininho,
 * running under the Micronucleus 2.x bootloader.
 *
 * License: GNU GPL v2 (see LICENSE)
 */

#ifndef __usbconfig_h_included__
#define __usbconfig_h_included__

/* ---------------------------- Hardware Config ---------------------------- */

#define USB_CFG_IOPORTNAME      B
#define USB_CFG_DMINUS_BIT      3
#define USB_CFG_DPLUS_BIT       4
#define USB_CFG_CLOCK_KHZ       (F_CPU/1000)
#define USB_CFG_CHECK_CRC       0

/* --------------------------- Functional Range ---------------------------- */

#define USB_CFG_HAVE_INTRIN_ENDPOINT    0
#define USB_CFG_HAVE_INTRIN_ENDPOINT3   0
#define USB_CFG_EP3_NUMBER              3
#define USB_CFG_IMPLEMENT_HALT          0
#define USB_CFG_SUPPRESS_INTR_CODE      0
#define USB_CFG_INTR_POLL_INTERVAL      10
#define USB_CFG_IS_SELF_POWERED         0
#define USB_CFG_MAX_BUS_POWER           100
#define USB_CFG_IMPLEMENT_FN_WRITE      1   /* USBasp WRITEFLASH/WRITEEEPROM */
#define USB_CFG_IMPLEMENT_FN_READ       1   /* USBasp READFLASH/READEEPROM */
#define USB_CFG_IMPLEMENT_FN_WRITEOUT   0
#define USB_CFG_HAVE_FLOWCONTROL        0
#define USB_CFG_DRIVER_FLASH_PAGE       0
#define USB_CFG_LONG_TRANSFERS          0
#define USB_COUNT_SOF                   0
#define USB_CFG_CHECK_DATA_TOGGLING     0
#define USB_CFG_HAVE_MEASURE_FRAME_LENGTH   1   /* for OSCCAL tuning */
#define USB_USE_FAST_CRC                0

#ifndef __ASSEMBLER__
extern void usbHadReset(void);
#endif
#define USB_RESET_HOOK(resetStarts)     if(!resetStarts){usbHadReset();}

/* -------------------------- Device Description --------------------------- */

/* Obdev's shared VID/PID for vendor class devices, same as USBasp. Hosts must
 * identify the device by its strings, see usbdrv/USB-IDs-for-free.txt.
 * avrdude finds it with "-c usbasp-clone" (VID/PID match only). */
#define USB_CFG_VENDOR_ID       0xc0, 0x16 /* = 0x16c0 = 5824 = voti.nl */
#define USB_CFG_DEVICE_ID       0xdc, 0x05 /* = 0x05dc = 1500 */
#define USB_CFG_DEVICE_VERSION  0x01, 0x00 /* bcdDevice 0.01 */
/* TODO: obdev's rules ask for a vendor string naming a domain or e-mail
 * address you control (e.g. the project URL). */
#define USB_CFG_VENDOR_NAME     'D', 'i', 'g', 'i', 'I', 'S', 'P'
#define USB_CFG_VENDOR_NAME_LEN 7
#define USB_CFG_DEVICE_NAME     'D', 'i', 'g', 'i', 'I', 'S', 'P'
#define USB_CFG_DEVICE_NAME_LEN 7
#define USB_CFG_DEVICE_CLASS        0xff
#define USB_CFG_DEVICE_SUBCLASS     0
#define USB_CFG_INTERFACE_CLASS     0xff
#define USB_CFG_INTERFACE_SUBCLASS  0
#define USB_CFG_INTERFACE_PROTOCOL  0

/* ------------------- Fine Control over USB Descriptors ------------------- */

/* Own device descriptor (main.c): bcdUSB 2.10 so Windows asks for the BOS. */
#define USB_CFG_DESCR_PROPS_DEVICE                  USB_PROP_LENGTH(18)
#define USB_CFG_DESCR_PROPS_CONFIGURATION           0
#define USB_CFG_DESCR_PROPS_STRINGS                 0
#define USB_CFG_DESCR_PROPS_STRING_0                0
#define USB_CFG_DESCR_PROPS_STRING_VENDOR           0
#define USB_CFG_DESCR_PROPS_STRING_PRODUCT          0
#define USB_CFG_DESCR_PROPS_STRING_SERIAL_NUMBER    0
#define USB_CFG_DESCR_PROPS_HID                     0
#define USB_CFG_DESCR_PROPS_HID_REPORT              0
/* BOS descriptor is served by usbFunctionDescriptor() from flash. */
#define USB_CFG_DESCR_PROPS_UNKNOWN                 USB_PROP_IS_DYNAMIC

/* ----------------------- Optional MCU Description ------------------------ */

/* D+ is on PB4, which is not INT0: use the pin change interrupt, as
 * Micronucleus does. PB0..PB2 (ISP) are not in PCMSK. */
#define USB_INTR_CFG            PCMSK
#define USB_INTR_CFG_SET        (1 << USB_CFG_DPLUS_BIT)
#define USB_INTR_CFG_CLR        0
#define USB_INTR_ENABLE         GIMSK
#define USB_INTR_ENABLE_BIT     PCIE
#define USB_INTR_PENDING        GIFR
#define USB_INTR_PENDING_BIT    PCIF
#define USB_INTR_VECTOR         PCINT0_vect

#endif /* __usbconfig_h_included__ */
