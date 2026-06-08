SUMMARY = "BEMS Edge Core graphical image"
DESCRIPTION = "core-image-sato based image for the IntelliBuild BEMS BACnet/RabbitMQ edge-core machine."
LICENSE = "CLOSED"

require recipes-sato/images/core-image-sato.bb

IMAGE_FEATURES += "ssh-server-openssh package-management"

CORE_IMAGE_EXTRA_INSTALL += " \
    edge-core \
    node-api \
    swupdate \
"
