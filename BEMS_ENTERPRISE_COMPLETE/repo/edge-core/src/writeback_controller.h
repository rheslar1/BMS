#pragma once

#include "bacnet_client.h"
#include <memory>
#include <string>

enum class WriteMode {
    Absolute,
    Delta
};

struct WritebackRequest {
    BacnetPointAddress address;
    double value;
    double minimum;
    double maximum;
    WriteMode mode;
};

struct WritebackResult {
    bool accepted;
    double previousValue;
    double writtenValue;
    std::string message;
};

class IWritebackController {
public:
    virtual ~IWritebackController() = default;
    virtual WritebackResult write(const WritebackRequest &request) = 0;
};

class SafeWritebackController final : public IWritebackController {
public:
    explicit SafeWritebackController(std::shared_ptr<IBacnetClient> bacnetClient);

    WritebackResult write(const WritebackRequest &request) override;

private:
    std::shared_ptr<IBacnetClient> bacnetClient_;
};
