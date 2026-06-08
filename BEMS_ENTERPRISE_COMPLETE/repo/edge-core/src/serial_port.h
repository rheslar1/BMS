#pragma once

#include "unique_fd.h"

#include <string>

struct SerialPortConfig {
    std::string path;
    int baudRate{9600};
};

class SerialPort {
public:
    SerialPort() = default;
    explicit SerialPort(UniqueFd fd) noexcept;

    SerialPort(const SerialPort &) = delete;
    SerialPort &operator=(const SerialPort &) = delete;
    SerialPort(SerialPort &&) noexcept = default;
    SerialPort &operator=(SerialPort &&) noexcept = default;

    bool openPort(const SerialPortConfig &config);
    void closePort() noexcept;
    bool isOpen() const noexcept;
    int fd() const noexcept;

private:
    UniqueFd fd_;
};
