# BACnet + Enterprise BMS System Diagram

This diagram shows how the platform maps to a WebStation/EcoStruxure-style BMS architecture while keeping this project's actual implementation boundaries: React UI, Node.js API, MySQL, Python AI service, C++ edge core, gRPC, SSE, and BACnet/IP.

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│                         Enterprise / Supervisory Layer                       │
│                                                                              │
│  React WebStation-Style UI                                                   │
│  - Equipment graphics: AHU, VAV, chiller, lighting, meters                   │
│  - System tree: site -> building -> floor -> room -> zone -> device          │
│  - Alarm console, schedules, trends, energy dashboards, admin                │
│  - Live updates by Server-Sent Events, not WebSockets                        │
└───────────────────────────────────┬──────────────────────────────────────────┘
                                    │ HTTP/JSON + SSE
                                    ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│                         Node.js BEMS Backend API                             │
│                                                                              │
│  REST API, session auth/RBAC, audit, tenant/site context                      │
│  Scheduling, alarms, provisioning, analytics, Smart Grid AI, remote mgmt      │
│  Device tree, digital twin, floorplan overlays, maintenance workflows         │
└───────────────┬───────────────────────────────┬──────────────────────────────┘
                │ SQL                           │ gRPC
                ▼                               ▼
┌────────────────────────────┐       ┌─────────────────────────────────────────┐
│ MySQL                      │       │ Python AI / Analytics Service            │
│ - Buildings/zones/devices  │       │ - Whole-building optimization            │
│ - BACnet object metadata   │       │ - Energy, comfort, price, peak control   │
│ - Schedules/holidays/events│       │ - Digital twin simulation                │
│ - Alarms/alarm logs        │       │ - Smart Grid AI demand response          │
│ - Trend logs               │       │ - Reinforcement learning feedback        │
│ - Trends/analytics/RL      │       └─────────────────────────────────────────┘
└────────────────────────────┘
                ▲
                │ gRPC
                ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│                              C++ Edge Core                                   │
│                                                                              │
│  EdgeCoreService                                                             │
│  - DiscoverDevices                                                           │
│  - ReadPoint                                                                 │
│  - WritePoint                                                                │
│  - SubscribeCov                                                              │
│  - EnergyForecast                                                            │
│                                                                              │
│  BACnet/IP client                                                            │
│  - Who-Is / I-Am                                                             │
│  - ReadProperty present-value                                                │
│  - WriteProperty present-value                                               │
│  - SubscribeCOV                                                              │
│  - Safe writeback: clamp, verify, rollback                                   │
└───────────────────────────────────┬──────────────────────────────────────────┘
                                    │ BACnet/IP UDP 47808
                                    ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│                              Controller Layer                                │
│                                                                              │
│  SmartX-style AS-P/AS-B controllers, PLCs, programmable controllers          │
│  - PID loops                                                                 │
│  - HVAC sequences                                                            │
│  - Local alarms                                                              │
│  - Trend logging                                                             │
│  - Schedules                                                                 │
└───────────────────────────────────┬──────────────────────────────────────────┘
                                    │ BACnet MS/TP, Modbus RTU, CAN, gateways
                                    ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│                              Field Device Layer                              │
│                                                                              │
│  Sensors: temperature, humidity, CO2, pressure, occupancy                    │
│  Actuators: valves, dampers, relays                                          │
│  Equipment: AHUs, VAVs, chillers, pumps, fans                                │
│  Electrical: VFD drives, power meters, smart breakers, lighting panels       │
└──────────────────────────────────────────────────────────────────────────────┘
```

## BACnet Object Examples

| Real Device Point | BACnet Object | Typical Service |
| --- | --- | --- |
| Temperature sensor | Analog Input | ReadProperty, SubscribeCOV |
| Cooling valve command | Analog Output | WriteProperty |
| Fan command | Binary Output | WriteProperty |
| Power meter demand | Analog Input or Analog Value | ReadProperty, SubscribeCOV |
| Occupancy schedule | Schedule Object | ReadProperty / schedule integration |

## BACnet Mapping

| Layer | Source |
| --- | --- |
| Building | Database |
| Floor | Database |
| Zone | Database |
| Room | Database |
| Device | BACnet Device Object plus database metadata |
| Points | BACnet Objects |

BACnet protocol view:

```text
Device -> Objects
```

BEMS logical view:

```text
Building -> Floor -> Zone -> Room -> Device -> Points
```

## Simplified Data Flow

```text
Sensor -> Controller -> Server/API -> User Interface
  AI       Logic          DB          Graphics
```

## Deployment Scale

```text
Single building
  One edge appliance
  Local MySQL + API + UI + AI service
  Direct BACnet/IP or routed MS/TP network

Large campus
  Edge appliance per building or plant
  Central enterprise UI and shared analytics
  Site/building isolation through organization/site/building context
  Centralized alarms, reports, users, roles, and audit events
  Energy + IoT integration for airports, hospitals, and large campuses
```
