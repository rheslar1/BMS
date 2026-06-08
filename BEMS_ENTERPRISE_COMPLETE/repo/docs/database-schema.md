# BMS/BEMS Database Schema Design

This schema is designed for a commercial BMS/BEMS platform with BACnet objects, enterprise administration, alarms, schedules, trend logging, analytics, AI optimization, and maintenance workflows.

## Enterprise Scope

```text
organizations
  -> sites
     -> buildings
        -> floors
           -> zones
              -> rooms
                 -> devices
                    -> points: AI, AO, AV, BI, BO, BV, schedule
```

Purpose:

- Supports one building, multi-building sites, and large campuses.
- Keeps tenant/site/building context available for RBAC, reports, alarms, schedules, and analytics.
- Lets the React UI render a System Tree similar to commercial BMS platforms.

Operator-facing tree:

```text
Building
 ├── Floor
 │   ├── Zone
 │   │   ├── Room
 │   │   │   ├── Device
 │   │   │   │   ├── Points (AI, AO, BO, schedule, etc.)
```

## BACnet Object Model

`devices` stores the normalized point/device record:

- `bacnet_instance`
- `object_type`
- `object_instance`
- `ip_address`
- `vendor`
- `model`
- `present_value`
- `units`
- `status`
- `configuration`
- provisioning and commissioning flags

## BACnet Mapping

BACnet is flat compared with the operator hierarchy. On the BACnet side, a BACnet device exposes objects. The BEMS database adds building context around that device/object model.

| Layer | Source |
| --- | --- |
| Building | Database |
| Floor | Database |
| Zone | Database |
| Room | Database |
| Device | BACnet Device Object plus database metadata |
| Points | BACnet Objects |

Protocol view:

```text
BACnet Device
  -> Object: analogInput:1
  -> Object: binaryOutput:1
  -> Object: schedule:1
```

BEMS view:

```text
Building -> Floor -> Zone -> Room -> Device -> Points
```

Examples:

- Temperature sensor -> `analogInput`
- Fan command -> `binaryOutput`
- Damper command -> `analogOutput`
- Power meter demand -> `analogInput` or `analogValue`
- Occupancy schedule -> `schedule`

## Scheduling Engine

Tables:

- `schedules`
- `holiday_schedules`
- `special_events`

Precedence:

```text
global
  < building
    < zone
      < device
        < holiday
          < special event
```

This supports:

- Daily schedules
- Monthly schedules
- Yearly schedules
- Holiday exceptions
- Temporary events
- Building/zone/device overrides

## Alarm Server

Tables:

- `alarms`
- `alarm_logs`

Design:

- `alarms` stores the current alarm state.
- `alarm_logs` stores append-only alarm lifecycle events.
- Acknowledge and clear actions are preserved for audit.
- SSE streams current alarm state to the UI.

## Trend Logging

Table:

- `trend_logs`

Fields:

- building, zone, and device references
- BACnet object type and object instance
- metric name
- metric value
- units
- source
- timestamp

Use cases:

- Equipment graphics trends
- Energy reports
- Diagnostics
- FDD
- AI training and optimization history
- Commissioning validation

## AI and Energy Analytics

Tables:

- `analytics_events`
- `building_optimization_runs`
- `optimization_history`
- `rl_q_values`
- `fdd_findings`

Purpose:

- Persist optimization results.
- Persist PPO reinforcement policy/value state for zone/action decisions.
- Store FDD findings and analytics events.
- Support Smart Grid AI with demand response, price signals, and mixed HVAC/power optimization.

## Security and Administration

Tables:

- `users`
- `roles`
- `user_sessions`
- `audit_events`

Purpose:

- Salted password hashes.
- Session tokens.
- RBAC permissions.
- Audit history for administration and remote operations.

## Maintenance and Operations

Tables:

- `maintenance_tickets`
- `maintenance_modes`

Purpose:

- Track service work.
- Lock out building/zone/device writeback during maintenance.
- Preserve operator intent and AI safety boundaries.

## Why This Schema Matches Commercial BMS

It covers the core EcoStruxure/Metasys-style requirements:

- Device tree
- BACnet object model
- Scheduling engine
- Alarm server
- Trend logging
- Graphics and digital twin data
- Role-based access
- API layer
- Energy + IoT integration
- Scalability from small buildings to airports, hospitals, and large campuses
