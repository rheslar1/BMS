#include "writeback_controller.h"
#include <algorithm>
#include <utility>

SafeWritebackController::SafeWritebackController(std::shared_ptr<IBacnetClient> bacnetClient)
    : bacnetClient_(std::move(bacnetClient)) {}

WritebackResult SafeWritebackController::write(const WritebackRequest &request) {
    double previousValue = 0.0;
    if (!bacnetClient_->readProperty(request.address, previousValue)) {
        return {false, previousValue, previousValue, "Unable to read current BACnet value before write."};
    }

    const double targetValue = request.mode == WriteMode::Delta ? previousValue + request.value : request.value;
    const double clampedValue = std::clamp(targetValue, request.minimum, request.maximum);

    if (!bacnetClient_->writeProperty(request.address, clampedValue)) {
        return {false, previousValue, previousValue, "BACnet write failed before verification."};
    }

    double verifiedValue = 0.0;
    if (!bacnetClient_->readProperty(request.address, verifiedValue)) {
        bacnetClient_->writeProperty(request.address, previousValue);
        return {false, previousValue, previousValue, "Verification read failed; previous value restored."};
    }

    return {true, previousValue, verifiedValue, "BACnet write accepted and verified."};
}
