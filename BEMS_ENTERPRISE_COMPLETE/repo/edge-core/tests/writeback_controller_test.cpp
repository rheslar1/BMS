#include "writeback_controller.h"

#include <cassert>
#include <cmath>
#include <memory>
#include <string>
#include <vector>

class FakeBacnetClient final : public IBacnetClient {
public:
    explicit FakeBacnetClient(double value) : value_(value) {}

    bool initialize(const std::string &, const std::string &, unsigned short) override { return true; }
    bool discoverDevice(int, DeviceDetails &) override { return false; }

    bool readProperty(const BacnetPointAddress &, double &outValue) override {
        readCount_ += 1;
        if (failSecondRead_ && readCount_ == 2) {
            return false;
        }
        outValue = value_;
        return true;
    }

    bool writeProperty(const BacnetPointAddress &, double value) override {
        writes_.push_back(value);
        value_ = value;
        return writeSucceeds_;
    }

    void shutdown() override {}

    double value_ = 0.0;
    int readCount_ = 0;
    bool failSecondRead_ = false;
    bool writeSucceeds_ = true;
    std::vector<double> writes_;
};

bool near(double left, double right) {
    return std::fabs(left - right) < 0.0001;
}

void testClampsAbsoluteWrite() {
    auto client = std::make_shared<FakeBacnetClient>(58.0);
    SafeWritebackController controller(client);

    const auto result = controller.write({
        {102, 1, 1},
        100.0,
        35.0,
        80.0,
        WriteMode::Absolute,
    });

    assert(result.accepted);
    assert(near(result.previousValue, 58.0));
    assert(near(result.writtenValue, 80.0));
    assert(client->writes_.size() == 1);
    assert(near(client->writes_[0], 80.0));
}

void testRollsBackWhenVerificationReadFails() {
    auto client = std::make_shared<FakeBacnetClient>(55.0);
    client->failSecondRead_ = true;
    SafeWritebackController controller(client);

    const auto result = controller.write({
        {102, 1, 1},
        -10.0,
        35.0,
        80.0,
        WriteMode::Delta,
    });

    assert(!result.accepted);
    assert(near(result.previousValue, 55.0));
    assert(client->writes_.size() == 2);
    assert(near(client->writes_[0], 45.0));
    assert(near(client->writes_[1], 55.0));
}

int main() {
    testClampsAbsoluteWrite();
    testRollsBackWhenVerificationReadFails();
    return 0;
}
