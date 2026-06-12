# BMS / BEMS Enterprise Complete

This repository contains the `BEMS_ENTERPRISE_COMPLETE` implementation package: a full-stack Building Management and Energy Management System for edge deployment.

## Primary Entry Points

| Area | Path |
| --- | --- |
| Deep implementation guide | `BEMS_ENTERPRISE_COMPLETE/repo/docs/bems-enterprise-complete-implementation-guide.md` |
| Existing architecture overview | `BEMS_ENTERPRISE_COMPLETE/repo/docs/detailed design archtitecture.md` |
| C++ BACnet edge core | `BEMS_ENTERPRISE_COMPLETE/repo/edge-core/` |
| Node.js REST/SSE API | `BEMS_ENTERPRISE_COMPLETE/repo/node-api/` |
| React operator UI | `BEMS_ENTERPRISE_COMPLETE/repo/ui/` |
| Python AI service | `BEMS_ENTERPRISE_COMPLETE/repo/ai-service/` |
| Database schema | `BEMS_ENTERPRISE_COMPLETE/repo/database/schema.sql` |
| Docker deployment | `BEMS_ENTERPRISE_COMPLETE/repo/docker/docker-compose.yml` |
| Yocto integration | `BEMS_ENTERPRISE_COMPLETE/repo/yocto/` |

## Runtime Shape

Browser UI requests and commands flow through the Node.js API. Real-time updates return through HTTP/JSON and SSE. The Node.js API calls the C++ edge core through gRPC when configured, and the C++ edge core performs BACnet/IP read/write operations against field devices.
