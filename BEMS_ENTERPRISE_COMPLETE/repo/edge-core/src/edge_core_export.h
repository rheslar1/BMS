#pragma once

#if defined(_WIN32)
#if defined(BEMS_EDGE_CORE_BUILD)
#define BEMS_EDGE_CORE_EXPORT __declspec(dllexport)
#else
#define BEMS_EDGE_CORE_EXPORT __declspec(dllimport)
#endif
#else
#define BEMS_EDGE_CORE_EXPORT __attribute__((visibility("default")))
#endif
