# BEMS UI Design System

## Purpose

The BEMS UI is a production operator console inspired by commercial BMS/WebStation products. It prioritizes dense information, fast scanning, live status, equipment graphics, alarms, schedules, and admin workflows.

## Technology

- React for the application shell and panels.
- Tailwind CSS for design tokens, grid utilities, dark mode, spacing, and reusable component classes.
- Recharts for trend and energy charts.
- Server-Sent Events for live telemetry and alarms. WebSockets are not used.

## Theme Model

- Light mode is optimized for day-to-day facility operations.
- Dark mode is optimized for control rooms and long-running monitoring.
- The selected theme is persisted in `localStorage("bems.theme")`.
- Dark mode uses Tailwind's `class` strategy through `html.dark`.

## Core Layout Classes

- `bems-enterprise-console`: full application background and console surface.
- `bems-command-header`: top command header with tenant/site/building context.
- `bems-command-tabs`: primary navigation tabs.
- `bems-console-layout`: professional sidebar + main workspace layout.
- `bems-sidebar`: persistent navigation for Home, Buildings, Alarms, Trends, Graphics, and Settings.
- `bems-main-panel`: main workspace for KPIs, AHU graphics, floor plans, charts, trends, and forms.
- `bems-home-hero`: Home Page dashboard header for the default operator landing view.
- `bems-ops-strip`: compact live status strip.
- `bems-card`: reusable panel/card surface.
- `bems-dashboard-grid`: responsive dashboard panel grid.
- `bems-kpi-grid`: responsive KPI tiles.
- `bems-control-grid`: two/three-column operator workflow layout.
- `bems-panel-title` and `bems-panel-subtitle`: consistent panel headings.

## Home Page Dashboard Composition

Production dashboards should follow this order:

1. Tenant/site/building context.
2. Sidebar navigation.
3. Live operations strip.
4. KPI grid for alarms, devices, schedules, energy cost, carbon, and AI status.
5. Real-time monitoring and telemetry feed.
6. Energy/cost/carbon panels.
7. AI/autonomous operation panels.
8. Equipment graphics and floorplan.
9. Schedules, alarms, maintenance, and administration.

## Visual Rules

- Use 8px radius for panels and controls.
- Use high-contrast alarm colors with admin-configurable overrides.
- Use compact typography inside dashboards and panels.
- Use grid layouts for dashboards, not marketing-style hero sections.
- Keep operator actions near the data they affect.
- Prefer SSE status indicators and timestamps for live data confidence.

## Operator Roles

- Admin: users, roles, feature flags, tenant/site configuration.
- Operator: alarms, schedules, provisioning, setpoints, AI control approval.
- Viewer: dashboards, trends, digital twin, alarm visibility.

## Future UI Enhancements

- Convert remaining inline styles into Tailwind component classes.
- Add a dedicated design-token file for colors, severity states, and equipment statuses.
- Add visual regression screenshots for light and dark mode dashboards.
- Add reusable equipment graphic components for AHU, VAV, chiller, pump, lighting panel, and meter.
