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
    const char *units;
    double presentValue;
    const char *status;
} BacnetDeviceInfo;

bool bacnet_initialize(const char *localDeviceId, const char *localIpAddress, uint16_t localPort);
bool bacnet_discover_device(int deviceInstance, BacnetDeviceInfo *outInfo);
bool bacnet_read_property(int deviceInstance, int objectType, int objectInstance, double *outValue);
bool bacnet_write_property(int deviceInstance, int objectType, int objectInstance, double value);
void bacnet_shutdown(void);

#ifdef __cplusplus
}
#endif
