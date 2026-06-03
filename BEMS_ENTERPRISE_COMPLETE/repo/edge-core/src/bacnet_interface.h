#pragma once

#include <cstddef>
#include <cstdint>
#include <stdbool.h>

#ifdef __cplusplus
extern "C" {
#endif

typedef struct BacnetDeviceInfo {
    int deviceInstance;
    int objectInstance;
    const char *objectName;
    const char *objectType;
    const char *vendor;
    const char *model;
    const char *ipAddress;
    const char *units;
    double presentValue;
    const char *status;
} BacnetDeviceInfo;

typedef struct BacnetReadPropertyRequest {
    int deviceInstance;
    int objectType;
    int objectInstance;
} BacnetReadPropertyRequest;

typedef struct BacnetReadPropertyResult {
    int deviceInstance;
    int objectType;
    int objectInstance;
    bool success;
    double value;
} BacnetReadPropertyResult;

typedef struct BacnetCovNotification {
    int deviceInstance;
    int objectType;
    int objectInstance;
    double value;
    uint32_t subscriberProcessId;
    bool confirmed;
} BacnetCovNotification;

bool bacnet_initialize(const char *localDeviceId, const char *localIpAddress, uint16_t localPort);
bool bacnet_discover_device(int deviceInstance, BacnetDeviceInfo *outInfo);
bool bacnet_read_property(int deviceInstance, int objectType, int objectInstance, double *outValue);
bool bacnet_read_properties_multiple(const BacnetReadPropertyRequest *requests, size_t requestCount, BacnetReadPropertyResult *outResults);
bool bacnet_write_property(int deviceInstance, int objectType, int objectInstance, double value);
bool bacnet_subscribe_cov(int deviceInstance, int objectType, int objectInstance, uint32_t subscriberProcessId, uint32_t lifetimeSeconds, bool confirmedNotifications);
bool bacnet_poll_cov_notification(BacnetCovNotification *outNotification, int timeoutMs);
size_t bacnet_server_object_count(void);
bool bacnet_server_read_property_text(int objectType, int objectInstance, int propertyIdentifier, char *buffer, size_t bufferLength);
bool bacnet_server_write_present_value(int objectType, int objectInstance, double value, int priority);
bool bacnet_server_release_priority(int objectType, int objectInstance, int priority);
void bacnet_shutdown(void);

#ifdef __cplusplus
}
#endif
