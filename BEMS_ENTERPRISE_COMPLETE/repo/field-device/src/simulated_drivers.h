#pragma once

#include "field_device_firmware.h"

#include <map>
#include <string>
#include <vector>

namespace bems::field_device {

class SimulatedFlashStore final : public IPersistentStore {
public:
    bool writeBlob(const std::string &key, const std::vector<std::uint8_t> &payload) override;
    std::vector<std::uint8_t> readBlob(const std::string &key) const override;
    bool verifyChecksum(const std::string &key) const override;

private:
    std::map<std::string, std::vector<std::uint8_t>> blobs_;
    std::map<std::string, std::uint32_t> checksums_;
};

class SimulatedBacnetObjectTable final : public IBacnetObjectTable {
public:
    void addObject(const BacnetPropertyValue &value);
    std::vector<BacnetObjectId> objects() const override;
    std::optional<BacnetPropertyValue> readPresentValue(BacnetObjectId objectId) const override;
    bool writePresentValue(const BacnetPropertyValue &value) override;

private:
    std::vector<BacnetPropertyValue> values_;
};

class SimulatedRadioTransport final : public ITransportPort {
public:
    bool send(const std::vector<std::uint8_t> &frame) override;
    std::vector<std::uint8_t> receive() override;
    std::string medium() const override;

private:
    std::vector<std::uint8_t> lastFrame_;
};

class SimulatedEia485Transport final : public ITransportPort {
public:
    bool send(const std::vector<std::uint8_t> &frame) override;
    std::vector<std::uint8_t> receive() override;
    std::string medium() const override;

private:
    std::vector<std::uint8_t> lastFrame_;
};

class FlashScheduleRepository final : public IScheduleRepository {
public:
    explicit FlashScheduleRepository(IPersistentStore &store);
    bool saveSchedules(const std::vector<DeviceScheduleEntry> &entries) override;
    std::vector<DeviceScheduleEntry> loadSchedules() const override;

private:
    IPersistentStore &store_;
};

class SharedKeySignatureVerifier final : public ISignatureVerifier {
public:
    explicit SharedKeySignatureVerifier(std::string sharedKey);
    bool verify(const OtaUpdateRequest &request) const override;
    std::string signForSimulator(const OtaUpdateRequest &request) const;

private:
    std::string sharedKey_;
};

class SignedBootloaderOtaUpdater final : public IOtaUpdater {
public:
    SignedBootloaderOtaUpdater(IPersistentStore &store, ISignatureVerifier &signatureVerifier);
    bool stage(const OtaUpdateRequest &request) override;
    bool applyStagedImage() override;
    bool confirmBoot();
    bool rollback() override;
    OtaUpdateStatus status() const override;

private:
    std::string inactiveSlot() const;
    IPersistentStore &store_;
    ISignatureVerifier &signatureVerifier_;
    OtaUpdateStatus status_;
};

class FixedSetpointStrategy final : public IControlStrategy {
public:
    FixedSetpointStrategy(IBacnetObjectTable &objectTable, BacnetObjectId target, double setpoint);
    void evaluate(double deltaSeconds) override;

private:
    IBacnetObjectTable &objectTable_;
    BacnetObjectId target_;
    double setpoint_;
};

} // namespace bems::field_device
