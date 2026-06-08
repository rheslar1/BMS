#include "serial_port.h"

#include <array>
#include <cassert>
#include <fcntl.h>
#include <unistd.h>

#include <utility>

bool descriptorOpen(int fd) {
    return fcntl(fd, F_GETFD) != -1;
}

std::array<int, 2> openPipe() {
    std::array<int, 2> fds{};
    assert(pipe(fds.data()) == 0);
    return fds;
}

void testSerialPortOwnsWrappedDescriptor() {
    const auto fds = openPipe();
    const int serialFd = fds[0];
    UniqueFd writer(fds[1]);

    {
        SerialPort port{UniqueFd(serialFd)};
        assert(port.isOpen());
        assert(port.fd() == serialFd);
        assert(descriptorOpen(serialFd));
    }

    assert(!descriptorOpen(serialFd));
}

void testSerialPortMoveTransfersOwnership() {
    const auto fds = openPipe();
    const int serialFd = fds[0];
    UniqueFd writer(fds[1]);

    SerialPort source{UniqueFd(serialFd)};
    SerialPort destination(std::move(source));

    assert(!source.isOpen());
    assert(destination.isOpen());
    assert(destination.fd() == serialFd);
    assert(descriptorOpen(serialFd));
}

int main() {
    testSerialPortOwnsWrappedDescriptor();
    testSerialPortMoveTransfersOwnership();
    return 0;
}
