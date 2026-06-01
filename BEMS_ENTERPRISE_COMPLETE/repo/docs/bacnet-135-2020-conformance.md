# IntelliBuild Energy BACnet 135-2020 Conformance Profile

## Standard Target

IntelliBuild Energy targets **ANSI/ASHRAE Standard 135-2020, BACnet - A Data Communication Protocol for Building Automation and Control Networks** for its BACnet/IP edge communication profile.

This document is a project conformance profile and implementation checklist. It is not a BTL listing, product certification, or official PICS document. Formal product conformance requires a completed Protocol Implementation Conformance Statement, protocol test evidence, and certification/lab testing where required by the customer or market.

## Product BACnet Role

IntelliBuild Energy acts as a BACnet/IP client, supervisory gateway, and edge integration appliance.

Primary responsibilities:

- Discover BACnet devices on the building IP network.
- Read BACnet object values for telemetry, dashboards, trends, analytics, and FDD.
- Write approved control values through rollback-aware safe writeback.
- Subscribe to change-of-value reporting where supported by field devices.
- Preserve BACnet device/object identity while adding enterprise context in MySQL and the React UI.

The current product does not claim to be a full BACnet server/device exposing its own complete standard object database to third-party BACnet clients.

## Energy Services Interface And B/WS Profile

The project includes a BACnet Energy Services Interface concept for external energy data clients. The ESI facade exposes complex structured building information using BACnet Web Services style JSON endpoints:

- `GET /api/energy-services/esi`
- `GET /api/energy-services/signals`
- `GET /api/energy-services/bws`

This layer is intentionally field-network agnostic. The building control network can be BACnet/IP, Modbus RTU, CAN, a simulator, or another integrated system. IntelliBuild Energy maps those sources into structured energy/control signal objects for external energy service protocols, pricing systems, demand-response workflows, and analytics.

This is documented as a project B/WS-style facade and integration path. Formal B/WS conformance should be validated through a completed PICS and protocol testing for the final product profile.

## Supported BACnet/IP Data Link

| Area | Project Support |
| --- | --- |
| BACnet/IP UDP port | Default `47808` |
| BVLC type | BACnet/IP `0x81` |
| Original-Unicast-NPDU | Supported for directed requests |
| Original-Broadcast-NPDU | Supported for Who-Is discovery |
| NPDU version | Version `0x01` |
| Confirmed request APDU | Supported for ReadProperty, ReadPropertyMultiple, WriteProperty, SubscribeCOV, and ConfirmedCOVNotification ACK handling |
| Unconfirmed request APDU | Supported for Who-Is |
| ComplexACK parsing | Supported for ReadProperty and ReadPropertyMultiple values currently needed by the runtime |
| SimpleACK parsing | Supported for WriteProperty and SubscribeCOV acceptance |

## Supported Services

| Service | Direction | Status | Use In Product |
| --- | --- | --- | --- |
| Who-Is | Client sends | Supported | Device discovery by instance/range |
| I-Am | Client receives/parses | Supported | Discovery response normalization |
| ReadProperty | Client sends confirmed request | Supported | `present-value` telemetry and device refresh |
| WriteProperty | Client sends confirmed request | Supported | Operator/AI-approved command writes |
| SubscribeCOV | Client sends confirmed request | Supported | COV subscription setup where devices support it |
| ReadPropertyMultiple | Client sends confirmed request | Supported | C++ runtime batches same-device `present-value` reads and falls back to single ReadProperty when needed |
| ConfirmedCOVNotification | Client receives/parses and ACKs | Supported | COV notifications are parsed by edge core and ingested through the API telemetry event path |
| UnconfirmedCOVNotification | Client receives/parses | Supported | Unconfirmed COV notifications are parsed and ingested through the API telemetry event path |
| Error/Reject/Abort handling | Partial | Timeouts are handled; full standard error semantics are a hardening item |

## BIBB-Style Support Matrix

| BIBB-Style Capability | Status | Notes |
| --- | --- | --- |
| Data Sharing - ReadProperty - A | Supported | Reads `present-value` for supported object types |
| Data Sharing - WriteProperty - A | Supported | Writes `present-value` through safe writeback |
| Device Management - Dynamic Device Binding - A | Supported | Who-Is/I-Am discovery |
| Data Sharing - COV - A | Supported subset | SubscribeCOV setup, ConfirmedCOVNotification ACK handling, UnconfirmedCOVNotification parsing, API ingestion, and telemetry event publication |
| Data Sharing - ReadPropertyMultiple - A | Supported subset | Same-device `present-value` batch reads with simulator coverage and single-read fallback |
| Device Communication Control | Not implemented | Out of current scope |
| Time Synchronization | Not implemented | Out of current scope |
| Backup/Restore | Not implemented | Out of current scope |

## Supported Object Types

| Object Type | Runtime Support | Product Use |
| --- | --- | --- |
| Device | Discovery identity | BACnet device inventory |
| Analog Input | ReadProperty | Temperature, humidity, CO2, meters where exposed as AI |
| Analog Output | ReadProperty/WriteProperty | Dampers, valves, setpoints, VAV commands |
| Analog Value | ReadProperty/WriteProperty | Software values and setpoints |
| Binary Input | ReadProperty | Status, feedback, safeties |
| Binary Output | ReadProperty/WriteProperty | Fans, lighting relays, enable commands |
| Binary Value | ReadProperty/WriteProperty | Software binary values |
| Schedule | Device-resident persistence metadata | Device-scoped schedules are mirrored to BACnet Schedule object metadata and retained on the field device |

Current runtime reads and writes the `present-value` property. Full object property coverage, object lists, status flags, event state, reliability, priority arrays, and schedule members should be added before claiming broad BACnet object conformance.

## Enterprise Logical Model

BACnet is flat: a BACnet device exposes objects. IntelliBuild Energy adds enterprise context without changing the BACnet identity:

```text
Building
  -> Floor
    -> Zone
      -> Room
        -> Device
          -> BACnet Object
            -> Object Type / Object Instance / Present Value
```

The database stores building/floor/zone/room context while the edge runtime preserves BACnet device instance, object type, object instance, and property mapping.

## Implementation Files

| File | Responsibility |
| --- | --- |
| `edge-core/src/bacnet_interface.cpp` | BACnet/IP BVLC/NPDU/APDU service encoding, discovery, read/write, ReadPropertyMultiple, COV subscription, and COV notification parsing |
| `edge-core/src/bacnet_interface.h` | C-compatible BACnet boundary used by the C++ edge core |
| `edge-core/src/bacnet_client.cpp` | C++ adapter implementing `IBacnetClient` |
| `edge-core/src/discovery_service.cpp` | Device discovery service abstraction |
| `edge-core/src/writeback_controller.cpp` | Safe writeback, clamping, verification read, rollback |
| `edge-core/tests/bacnet_simulator_test.cpp` | Simulator tests for discovery, read, write, ReadPropertyMultiple, COV subscribe, and COV notification dispatch |
| `proto/edge_service.proto` | gRPC contract between Node API and EdgeCoreService |
| `node-api/server.js` | REST endpoints for BACnet discovery, read, batch read, write, COV subscription, and provisioning |

## Source BACnet Stack Integration

The preferred upstream C stack option is the SourceForge BACnet Protocol Stack:

- https://sourceforge.net/projects/bacnet/

The project page describes a C BACnet library with application, network, and MAC-layer communication services for embedded systems and operating systems. IntelliBuild Energy should integrate it behind `edge-core/src/bacnet_interface.h`, preserving the current edge runtime contract while replacing local packet helpers with upstream stack calls where appropriate.

Integration checklist:

1. Add the BACnet stack source as a vendored dependency, package dependency, or Yocto recipe source.
2. Wire BACnet/IP datalink initialization to `BACNET_LOCAL_IP` and UDP port `47808`.
3. Map Who-Is/I-Am discovery into `bacnet_discover_device`.
4. Map ReadProperty and WriteProperty for `present-value` into the existing functions.
5. Map SubscribeCOV setup and notification receiving into the edge event path.
6. Extend tests to run both simulator mode and stack-backed integration mode.
7. Re-run the PICS/BTL readiness checklist before claiming formal conformance.

## Safety And Control Rules

- All command writes should flow through safe writeback.
- Safe writeback reads the current value before writing.
- Values are clamped to approved min/max ranges.
- Writes are verified by a follow-up read.
- If verification fails, the previous value is restored where possible.
- Active maintenance mode blocks automatic AI/control writeback.
- Operator-visible APIs should distinguish preview/simulation from applied control.

## Required Validation Before Certification Claim

Before claiming formal Standard 135-2020 conformance or BTL readiness:

1. Complete a PICS document for the exact product/device profile.
2. Validate ReadPropertyMultiple behavior against the target controller vendors and their object/property mixes.
3. Add standard Error, Reject, and Abort APDU parsing.
4. Validate ConfirmedCOVNotification and UnconfirmedCOVNotification receive/dispatch against real devices and customer network timing.
5. Validate priority-array write behavior for writable command objects where required.
6. Validate object type/property support against target AHU, VAV, chiller, meter, lighting, and controller vendors.
7. Run protocol tests against real BACnet controllers plus simulator regression tests.
8. Document unsupported services explicitly in release notes and customer deployment guides.
9. Complete BTL or customer-required third-party testing if the product is marketed as certified.

## Current Conformance Position

IntelliBuild Energy currently conforms to a practical **BACnet/IP client integration subset** for discovery, `present-value` ReadProperty/ReadPropertyMultiple, WriteProperty, SubscribeCOV, and COV notification ingestion. It should be described commercially as **BACnet/IP integration ready** or **BACnet 135-2020 aligned** until PICS completion and protocol certification work are finished.
