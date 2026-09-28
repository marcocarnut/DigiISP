/*
 * digiisp-reboot - ask DigiISP boards to reset into the Micronucleus
 * bootloader, so new firmware can be uploaded without replugging.
 *
 * usage: digiisp-reboot [serial]
 *
 * Without a serial, reboots every DigiISP found. Exit status 0 if at least
 * one board was rebooted.
 *
 * License: GNU GPL v2 (see LICENSE)
 */

#include <stdio.h>
#include <string.h>
#include <libusb-1.0/libusb.h>

#include "../firmware/protocol.h"

#define VID 0x16c0
#define PID 0x05dc

int main(int argc, char **argv) {
    const char *want = argc > 1 ? argv[1] : NULL;
    libusb_device **list;
    ssize_t n, i;
    int rebooted = 0;

    if (libusb_init(NULL) != 0) {
        fprintf(stderr, "libusb_init failed\n");
        return 2;
    }
    n = libusb_get_device_list(NULL, &list);
    for (i = 0; i < n; i++) {
        struct libusb_device_descriptor dd;
        libusb_device_handle *h;
        unsigned char product[64] = "", serial[64] = "";
        int r;

        if (libusb_get_device_descriptor(list[i], &dd) != 0
                || dd.idVendor != VID || dd.idProduct != PID)
            continue;
        if (libusb_open(list[i], &h) != 0) {
            fprintf(stderr, "found %04x:%04x but can't open it (udev rule?)\n", VID, PID);
            continue;
        }
        libusb_get_string_descriptor_ascii(h, dd.iProduct, product, sizeof(product));
        if (dd.iSerialNumber)
            libusb_get_string_descriptor_ascii(h, dd.iSerialNumber, serial, sizeof(serial));
        if (strcmp((char *)product, "DigiISP") != 0
                || (want && strcmp((char *)serial, want) != 0)) {
            libusb_close(h);
            continue;
        }
        r = libusb_control_transfer(h,
                LIBUSB_REQUEST_TYPE_VENDOR | LIBUSB_RECIPIENT_DEVICE | LIBUSB_ENDPOINT_IN,
                DIGIISP_FUNC_REBOOT, 0, 0, NULL, 0, 1000);
        if (r < 0) {
            fprintf(stderr, "DigiISP %s: reboot failed: %s\n", serial, libusb_error_name(r));
        } else {
            printf("DigiISP %s: rebooting into bootloader\n", serial[0] ? (char *)serial : "(no serial)");
            rebooted++;
        }
        libusb_close(h);
    }
    libusb_free_device_list(list, 1);
    libusb_exit(NULL);

    if (!rebooted)
        fprintf(stderr, "no DigiISP rebooted\n");
    return rebooted ? 0 : 1;
}
