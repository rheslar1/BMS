SUMMARY = "BEMS Node.js backend API"
LICENSE = "CLOSED"

SRC_URI = "file://node-api"
S = "${WORKDIR}/node-api"

RDEPENDS:${PN} += "nodejs"

do_install() {
    install -d ${D}/opt/bems/node-api
    cp -R ${S}/* ${D}/opt/bems/node-api/
}

FILES:${PN} += "/opt/bems/node-api"
