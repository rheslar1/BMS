SUMMARY = "BEMS C++ edge core for BACnet and autonomous control"
LICENSE = "CLOSED"

SRC_URI = "file://edge-core"
S = "${WORKDIR}/edge-core"

inherit cmake systemd

SYSTEMD_SERVICE:${PN} = "bems-edge-core.service"
RDEPENDS:${PN} += "swupdate curl ca-certificates"

do_install:append() {
    install -d ${D}${bindir}
    install -m 0755 ${B}/edge-core ${D}${bindir}/bems-edge-core
    install -m 0755 ${WORKDIR}/edge-core/scripts/bems-swupdate-client.sh ${D}${bindir}/bems-swupdate-client

    install -d ${D}${libdir}/swupdate
    install -m 0755 ${WORKDIR}/edge-core/scripts/bems-system-package-update.sh ${D}${libdir}/swupdate/bems-system-package-update.sh

    install -d ${D}${systemd_system_unitdir}
    install -m 0644 ${WORKDIR}/edge-core/packaging/bems-edge-core.service ${D}${systemd_system_unitdir}/bems-edge-core.service
    install -m 0644 ${WORKDIR}/edge-core/packaging/bems-swupdate-client@.service ${D}${systemd_system_unitdir}/bems-swupdate-client@.service
}

FILES:${PN} += "${systemd_system_unitdir}/bems-edge-core.service ${systemd_system_unitdir}/bems-swupdate-client@.service ${libdir}/swupdate/bems-system-package-update.sh"
