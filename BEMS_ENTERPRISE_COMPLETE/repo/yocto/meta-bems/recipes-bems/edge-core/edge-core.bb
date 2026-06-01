SUMMARY = "BEMS C++ edge core for BACnet and autonomous control"
LICENSE = "CLOSED"

SRC_URI = "file://edge-core file://proto"
S = "${WORKDIR}/edge-core"

DEPENDS += "protobuf protobuf-native grpc grpc-native"

inherit cmake pkgconfig systemd

SYSTEMD_SERVICE:${PN} = "bems-edge-core.service"

do_install:append() {
    install -d ${D}${bindir}
    install -m 0755 ${B}/edge-core ${D}${bindir}/bems-edge-core

    install -d ${D}${systemd_system_unitdir}
    install -m 0644 ${WORKDIR}/edge-core/packaging/bems-edge-core.service ${D}${systemd_system_unitdir}/bems-edge-core.service
}

FILES:${PN} += "${systemd_system_unitdir}/bems-edge-core.service"
