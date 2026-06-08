#include "serial_port.h"

#include <fcntl.h>
#include <termios.h>
#include <unistd.h>

#include <utility>

namespace {

speed_t baudRateFlag(int baudRate) {
    switch (baudRate) {
    case 4800:
        return B4800;
    case 9600:
        return B9600;
    case 19200:
        return B19200;
    case 38400:
        return B38400;
    case 57600:
        return B57600;
    case 115200:
        return B115200;
    default:
        return B9600;
    }
}

} // namespace

SerialPort::SerialPort(UniqueFd fd) noexcept : fd_(std::move(fd)) {}

bool SerialPort::openPort(const SerialPortConfig &config) {
    UniqueFd candidate(open(config.path.c_str(), O_RDWR | O_NOCTTY | O_NONBLOCK));
    if (!candidate) {
        return false;
    }

    termios settings{};
    if (tcgetattr(candidate.get(), &settings) != 0) {
        return false;
    }

    cfmakeraw(&settings);
    const speed_t speed = baudRateFlag(config.baudRate);
    cfsetispeed(&settings, speed);
    cfsetospeed(&settings, speed);
    settings.c_cflag |= CLOCAL | CREAD;

    if (tcsetattr(candidate.get(), TCSANOW, &settings) != 0) {
        return false;
    }

    fd_ = std::move(candidate);
    return true;
}

void SerialPort::closePort() noexcept {
    fd_.reset();
}

bool SerialPort::isOpen() const noexcept {
    return fd_.valid();
}

int SerialPort::fd() const noexcept {
    return fd_.get();
}
