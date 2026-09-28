/*
 * digiisp - command line helper for DigiISP boards
 *
 *   digiisp list             show connected boards, their fuses and firmware
 *   digiisp reboot [serial]  reset boards into the Micronucleus bootloader,
 *                            so new firmware can be uploaded without replugging
 *   digiisp pins [serial]    show the ISP pin levels (wiring check: with the
 *                            programmer idle, RST must read 1 from the
 *                            target's reset pull-up; not conclusive when the
 *                            programmer board has its own pull-up on PB5,
 *                            like a converted Franzininho)
 *   digiisp probe [serial]   connect to the target (8 kHz SCK), show the pins
 *                            and the raw replies to Programming Enable
 *
 * Without a serial, acts on every DigiISP found. Exit status 0 if at least
 * one board was found (list) or rebooted (reboot).
 *
 * License: GNU GPL v2 (see LICENSE)
 */

#include <stdio.h>
#include <string.h>
#include <unistd.h>
#include <libusb-1.0/libusb.h>

#include "../firmware/protocol.h"

#define VID 0x16c0
#define PID 0x05dc
#define VENDOR_IN (LIBUSB_REQUEST_TYPE_VENDOR | LIBUSB_RECIPIENT_DEVICE | LIBUSB_ENDPOINT_IN)

static int list(libusb_device_handle *h, const char *serial) {
    unsigned char info[DIGIISP_INFO_LEN];
    int r = libusb_control_transfer(h, VENDOR_IN, DIGIISP_FUNC_INFO, 0, 0, info, sizeof(info), 1000);

    if (r != DIGIISP_INFO_LEN || info[0] != DIGIISP_MAGIC0 || info[1] != DIGIISP_MAGIC1) {
        printf("DigiISP %s: no INFO reply (%s)\n", serial, r < 0 ? libusb_error_name(r) : "short");
        return 0;
    }
    printf("DigiISP %s: firmware v%d, protocol v%d, fuses low 0x%02X high 0x%02X ext 0x%02X lock 0x%02X, "
           "OSCCAL 0x%02X, %s\n",
           serial, info[3], info[2], info[6], info[7], info[8], info[9], info[5],
           info[4] & DIGIISP_FLAG_RESET_CONTROL ? "drives target reset (PB5)" : "bootstrap mode (reset held by hand)");
    return 1;
}

static int pins(libusb_device_handle *h, const char *serial) {
    static const char *names[8] = { "MISO", "MOSI", "SCK", "D-", "D+", "RST", "", "" };
    unsigned char r[3];
    int i, n = libusb_control_transfer(h, VENDOR_IN, DIGIISP_FUNC_PINS, 0, 0, r, sizeof(r), 1000);

    if (n != 3) {
        printf("DigiISP %s: no PINS reply (%s)\n", serial, n < 0 ? libusb_error_name(n) : "short");
        return 0;
    }
    printf("DigiISP %s:", serial);
    for (i = 0; i < 6; i++) {
        if (i == 3 || i == 4)
            continue;
        printf(" %s=%d%s", names[i], (r[0] >> i) & 1, (r[1] >> i) & 1 ? (((r[2] >> i) & 1) ? "(out 1)" : "(out 0)") : "");
    }
    printf("\n");
    return 1;
}

static int probe(libusb_device_handle *h, const char *serial) {
    unsigned char r[4];
    int i, n;

    libusb_control_transfer(h, VENDOR_IN, USBASP_FUNC_SETISPSCK, 5 /* 8 kHz */, 0, r, 4, 1000);
    libusb_control_transfer(h, VENDOR_IN, USBASP_FUNC_CONNECT, 0, 0, r, 4, 1000);
    usleep(50000);
    pins(h, serial);
    for (i = 0; i < 4; i++) {
        n = libusb_control_transfer(h, VENDOR_IN, USBASP_FUNC_TRANSMIT, 0x53ac, 0x0000, r, 4, 2000);
        if (n == 4)
            printf("  AC 53 00 00 -> %02X %02X %02X %02X%s\n", r[0], r[1], r[2], r[3], r[2] == 0x53 ? "  (in sync)" : "");
    }
    libusb_control_transfer(h, VENDOR_IN, USBASP_FUNC_DISCONNECT, 0, 0, r, 4, 1000);
    return 1;
}

static int reboot(libusb_device_handle *h, const char *serial) {
    int r = libusb_control_transfer(h, VENDOR_IN, DIGIISP_FUNC_REBOOT, 0, 0, NULL, 0, 1000);

    if (r < 0) {
        fprintf(stderr, "DigiISP %s: reboot failed: %s\n", serial, libusb_error_name(r));
        return 0;
    }
    printf("DigiISP %s: rebooting into bootloader\n", serial);
    return 1;
}

int main(int argc, char **argv) {
    int (*action)(libusb_device_handle *, const char *);
    const char *want;
    libusb_device **devs;
    ssize_t n, i;
    int count = 0;

    if (argc >= 2 && strcmp(argv[1], "list") == 0 && argc <= 3) {
        action = list;
    } else if (argc >= 2 && strcmp(argv[1], "reboot") == 0 && argc <= 3) {
        action = reboot;
    } else if (argc >= 2 && strcmp(argv[1], "pins") == 0 && argc <= 3) {
        action = pins;
    } else if (argc >= 2 && strcmp(argv[1], "probe") == 0 && argc <= 3) {
        action = probe;
    } else {
        fprintf(stderr, "usage: digiisp list|reboot|pins|probe [serial]\n");
        return 2;
    }
    want = argc > 2 ? argv[2] : NULL;

    if (libusb_init(NULL) != 0) {
        fprintf(stderr, "libusb_init failed\n");
        return 2;
    }
    n = libusb_get_device_list(NULL, &devs);
    for (i = 0; i < n; i++) {
        struct libusb_device_descriptor dd;
        libusb_device_handle *h;
        unsigned char product[64] = "", serial[64] = "";

        if (libusb_get_device_descriptor(devs[i], &dd) != 0
                || dd.idVendor != VID || dd.idProduct != PID)
            continue;
        if (libusb_open(devs[i], &h) != 0) {
            fprintf(stderr, "found %04x:%04x but can't open it (udev rule?)\n", VID, PID);
            continue;
        }
        libusb_get_string_descriptor_ascii(h, dd.iProduct, product, sizeof(product));
        if (dd.iSerialNumber)
            libusb_get_string_descriptor_ascii(h, dd.iSerialNumber, serial, sizeof(serial));
        if (strcmp((char *)product, "DigiISP") == 0
                && (!want || strcmp((char *)serial, want) == 0))
            count += action(h, serial[0] ? (char *)serial : "(no serial)");
        libusb_close(h);
    }
    libusb_free_device_list(devs, 1);
    libusb_exit(NULL);

    if (!count)
        fprintf(stderr, "no DigiISP %s\n", action == list ? "found" : "rebooted");
    return count ? 0 : 1;
}
