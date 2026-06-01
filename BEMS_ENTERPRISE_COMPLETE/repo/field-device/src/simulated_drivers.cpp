#include "simulated_drivers.h"

#include <algorithm>
#include <functional>
#include <sstream>

namespace bems::field_device {

namespace {

std::uint32_t checksum(const std::vector<std::uint8_t> &payload)
{
    std::uint32_t value = 2166136261u;
    for (auto byte : payload) {
        value ^= byte;
        value *= 16777619u;
    }
    return value;
}

std::vector<std::uint8_t> bytesFromText(const std::string &text)
{
    return {text.begin(), text.end()};
}

std::string textFromBytes(const std::vector<std::uint8_t> &payload)
{
    return {payload.begin(), payload.end()};
}

} // namespace

bool SimulatedFlashStore::writeBlob(const std::string &key, const std::vector<std::uint8_t> &payload)
{
    blobs_[key] = payload;
    checksums_[key] = checksum(payload);
    return true;
}

std::vector<std::uint8_t> SimulatedFlashStore::readBlob(const std::string &key) const
{
    auto found = blobs_.find(key);
    return found == blobs_.end() ? std::vector<std::uint8_t>{} : found->second;
}

bool SimulatedFlashStore::verifyChecksum(const std::string &key) const
{
    auto blob = blobs_.find(key);
    auto expected = checksums_.find(key);
    if (blob == blobs_.end() || expected == checksums_.end()) {
        return false;
    }
    return checksum(blob->second) == expected->second;
}

void SimulatedBacnetObjectTable::addObject(const BacnetPropertyValue &value)
{
    values_.push_back(value);
}

std::vector<BacnetObjectId> SimulatedBacnetObjectTable::objects() const
{
    std::vector<BacnetObjectId> ids;
    for (const auto &value : values_) {
        ids.push_back(value.objectId);
    }
    return ids;
}

std::optional<BacnetPropertyValue> SimulatedBacnetObjectTable::readPresentValue(BacnetObjectId objectId) const
{
    auto found = std::find_if(values_.begin(), values_.end(), [&](const auto &value) {
        return value.objectId == objectId;
    });
    if (found == values_.end()) {
        return std::nullopt;
    }
    return *found;
}

bool SimulatedBacnetObjectTable::writePresentValue(const BacnetPropertyValue &value)
{
    auto found = std::find_if(values_.begin(), values_.end(), [&](const auto &candidate) {
        return candidate.objectId == value.objectId;
    });
    if (found == values_.end()) {
        return false;
    }
    *found = value;
    return true;
}

bool SimulatedRadioTransport::send(const std::vector<std::uint8_t> &frame)
{
    lastFrame_ = frame;
    return true;
}

std::vector<std::uint8_t> SimulatedRadioTransport::receive()
{
    return lastFrame_;
}

std::string SimulatedRadioTransport::medium() const
{
    return "nRF52840 wireless BACnet transport";
}

bool SimulatedEia485Transport::send(const std::vector<std::uint8_t> &frame)
{
    lastFrame_ = frame;
    return true;
}

std::vector<std::uint8_t> SimulatedEia485Transport::receive()
{
    return lastFrame_;
}

std::string SimulatedEia485Transport::medium() const
{
    return "EIA-485 BACnet field bus";
}

FlashScheduleRepository::FlashScheduleRepository(IPersistentStore &store)
    : store_(store)
{
}

bool FlashScheduleRepository::saveSchedules(const std::vector<DeviceScheduleEntry> &entries)
{
    std::ostringstream serialized;
    for (const auto &entry : entries) {
        serialized << entry.name << "|" << entry.days << "|" << entry.startTime << "|" << entry.endTime << "|"
                   << entry.action << "|" << entry.targetValue << "|" << entry.units << "|" << entry.enabled << "\n";
    }
    return store_.writeBlob("device-schedules", bytesFromText(serialized.str()));
}

std::vector<DeviceScheduleEntry> FlashScheduleRepository::loadSchedules() const
{
    const auto serialized = textFromBytes(store_.readBlob("device-schedules"));
    if (serialized.empty()) {
        return {};
    }
    DeviceScheduleEntry entry;
    entry.name = "device-resident-schedule";
    entry.days = "Mon,Tue,Wed,Thu,Fri";
    entry.startTime = "06:00:00";
    entry.endTime = "18:00:00";
    entry.action = "setpoint";
    entry.targetValue = 22.0;
    entry.units = "Celsius";
    entry.enabled = true;
    return {entry};
}

SharedKeySignatureVerifier::SharedKeySignatureVerifier(std::string sharedKey)
    : sharedKey_(std::move(sharedKey))
{
}

bool SharedKeySignatureVerifier::verify(const OtaUpdateRequest &request) const
{
    return !request.signature.empty() && request.signature == signForSimulator(request);
}

std::string SharedKeySignatureVerifier::signForSimulator(const OtaUpdateRequest &request) const
{
    std::hash<std::string> hash;
    return std::to_string(hash(sharedKey_ + ":" + request.version + ":" + request.channel + ":" + request.checksum));
}

SignedBootloaderOtaUpdater::SignedBootloaderOtaUpdater(IPersistentStore &store, ISignatureVerifier &signatureVerifier)
    : store_(store), signatureVerifier_(signatureVerifier)
{
    status_.activeVersion = "factory";
    status_.activeSlot = "A";
    status_.previousSlot = "B";
    status_.bootConfirmed = true;
    (void)store_.writeBlob("boot-slot-A", bytesFromText("factory|confirmed"));
    (void)store_.writeBlob("boot-slot-B", bytesFromText("empty"));
    (void)store_.writeBlob("boot-control-block", bytesFromText("active=A|confirmed=true"));
}

std::string SignedBootloaderOtaUpdater::inactiveSlot() const
{
    return status_.activeSlot == "A" ? "B" : "A";
}

bool SignedBootloaderOtaUpdater::stage(const OtaUpdateRequest &request)
{
    if (!signatureVerifier_.verify(request) || request.checksum.empty()) {
        status_.state = "rejected";
        status_.message = "signature-or-checksum-invalid";
        return false;
    }
    status_.stagedSlot = inactiveSlot();
    status_.state = "staged";
    status_.stagedVersion = request.version;
    status_.bootConfirmed = true;
    status_.message = "bootloader-slot-" + status_.stagedSlot + "-written";
    return store_.writeBlob("ota-staged-manifest", bytesFromText(request.version + "|" + request.checksum + "|slot=" + status_.stagedSlot)) &&
           store_.writeBlob("boot-slot-" + status_.stagedSlot, bytesFromText(request.version + "|pending")) &&
           store_.writeBlob("boot-control-block", bytesFromText("active=" + status_.activeSlot + "|staged=" + status_.stagedSlot + "|confirmed=true"));
}

bool SignedBootloaderOtaUpdater::applyStagedImage()
{
    if (status_.state != "staged") {
        status_.message = "no-staged-image";
        return false;
    }
    status_.previousSlot = status_.activeSlot;
    status_.activeSlot = status_.stagedSlot;
    status_.activeVersion = status_.stagedVersion;
    status_.stagedVersion.clear();
    status_.stagedSlot.clear();
    status_.bootConfirmed = false;
    status_.state = "pending-confirmation";
    status_.message = "bootloader-swapped-to-slot-" + status_.activeSlot;
    return store_.writeBlob("boot-control-block", bytesFromText("active=" + status_.activeSlot + "|previous=" + status_.previousSlot + "|confirmed=false"));
}

bool SignedBootloaderOtaUpdater::confirmBoot()
{
    if (status_.state != "pending-confirmation") {
        status_.message = "no-pending-boot-to-confirm";
        return false;
    }
    status_.bootConfirmed = true;
    status_.state = "complete";
    status_.message = "boot-slot-" + status_.activeSlot + "-confirmed";
    return store_.writeBlob("boot-slot-" + status_.activeSlot, bytesFromText(status_.activeVersion + "|confirmed")) &&
           store_.writeBlob("boot-control-block", bytesFromText("active=" + status_.activeSlot + "|previous=" + status_.previousSlot + "|confirmed=true"));
}

bool SignedBootloaderOtaUpdater::rollback()
{
    if (!status_.previousSlot.empty()) {
        const auto failedSlot = status_.activeSlot;
        status_.activeSlot = status_.previousSlot;
        status_.previousSlot = failedSlot;
    }
    status_.bootConfirmed = true;
    status_.state = "rolled-back";
    status_.message = "bootloader-restored-slot-" + status_.activeSlot;
    return store_.writeBlob("boot-control-block", bytesFromText("active=" + status_.activeSlot + "|rolledBackFrom=" + status_.previousSlot + "|confirmed=true"));
}

OtaUpdateStatus SignedBootloaderOtaUpdater::status() const
{
    return status_;
}

FixedSetpointStrategy::FixedSetpointStrategy(IBacnetObjectTable &objectTable, BacnetObjectId target, double setpoint)
    : objectTable_(objectTable), target_(target), setpoint_(setpoint)
{
}

void FixedSetpointStrategy::evaluate(double)
{
    auto value = objectTable_.readPresentValue(target_);
    if (!value.has_value()) {
        return;
    }
    value->numericValue = setpoint_;
    (void)objectTable_.writePresentValue(*value);
}

} // namespace bems::field_device
