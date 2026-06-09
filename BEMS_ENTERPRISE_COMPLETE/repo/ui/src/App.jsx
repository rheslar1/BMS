import React, { useEffect, useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

const apiBase = import.meta.env.VITE_API_URL ?? "";

const headerStyle = {
  padding: "12px 10px",
  backgroundColor: "#eef4fb",
  color: "#1f355e",
  borderBottom: "1px solid #d9e2ef",
  textAlign: "left",
};

const cellStyle = {
  padding: "12px 10px",
  borderBottom: "1px solid #edf2f7",
  verticalAlign: "middle",
};

const buttonStyle = {
  padding: "8px 12px",
  borderRadius: "5px",
  border: "none",
  cursor: "pointer",
  color: "white",
  transition: "transform 140ms ease, box-shadow 140ms ease, background-color 140ms ease",
};

const inputStyle = {
  width: "100%",
  boxSizing: "border-box",
  padding: "10px 12px",
  border: "1px solid #cbd5e1",
  borderRadius: "6px",
};

const panelStyle = {
  backgroundColor: "white",
  border: "1px solid #e2e8f0",
  borderRadius: "8px",
  boxShadow: "0 1px 4px rgba(15, 23, 42, 0.08)",
  animation: "bemsPanelIn 180ms ease both",
};

const defaultAlarmColors = {
  critical: "#dc2626",
  warning: "#f59e0b",
  info: "#2563eb",
  default: "#7c3aed",
  cleared: "#94a3b8",
};

const alarmSeverityKeys = ["critical", "warning", "info", "default", "cleared"];

const temperatureHeatBands = [
  { key: "hot", label: "Hot", minIntensity: 0.75, color: "#dc2626", textColor: "white", range: "75-100%" },
  { key: "mid", label: "Mid", minIntensity: 0.5, color: "#f59e0b", textColor: "#0f172a", range: "50-75%" },
  { key: "normal", label: "Normal", minIntensity: 0.25, color: "#16a34a", textColor: "white", range: "25-50%" },
  { key: "cold", label: "Cold", minIntensity: 0, color: "#2563eb", textColor: "white", range: "0-25%" },
];

const noSamplesHeatBand = {
  key: "none",
  label: "No samples",
  color: "#f1f5f9",
  textColor: "#475569",
  range: "none",
};

const floorplanSlots = ["lobby", "floor-one", "floor-two", "tower-lobby", "tower-floor"];

function getTemperatureHeatBand(intensity, hasSamples) {
  if (!hasSamples) return noSamplesHeatBand;
  return temperatureHeatBands.find((band) => intensity >= band.minIntensity) || temperatureHeatBands[temperatureHeatBands.length - 1];
}

function estimateZoneIntensityFromDevices(zone) {
  const numericDevices = (zone.devices || []).filter((device) => typeof device.value === "number");
  const temperatureDevice = numericDevices.find((device) => /temp|air/i.test(`${device.name} ${device.type} ${device.objectType || ""}`));

  if (temperatureDevice) {
    const temperature = Number(temperatureDevice.value);
    if (temperature >= 24) return 0.9;
    if (temperature >= 22.5) return 0.62;
    if (temperature >= 20) return 0.36;
    return 0.12;
  }

  if (numericDevices.length === 0) return 0;
  const average = numericDevices.reduce((sum, device) => sum + Number(device.value || 0), 0) / numericDevices.length;
  return Math.max(0, Math.min(1, average / 100));
}

function buildDashboardHeatZones(hierarchy, heatMap) {
  const reportZones = heatMap?.zones || [];
  const reportByZoneId = new Map(reportZones.map((zone) => [String(zone.zoneId), zone]));
  const hierarchyZones = flattenZones(hierarchy || []);

  if (hierarchyZones.length === 0) {
    return reportZones.map((zone, index) => {
      const hasSamples = zone.sampleCount > 0;
      const heatBand = getTemperatureHeatBand(Number(zone.intensity || 0), hasSamples);
      return {
        id: zone.zoneId || index,
        name: zone.zonePath || `Zone ${index + 1}`,
        buildingName: zone.buildingName || "Building",
        value: zone.averageValue ?? "-",
        sampleCount: zone.sampleCount ?? 0,
        heatBand,
        slot: floorplanSlots[index % floorplanSlots.length],
        devices: [],
      };
    });
  }

  return hierarchyZones.map((zone, index) => {
    const reportZone = reportByZoneId.get(String(zone.id));
    const hasSamples = reportZone ? reportZone.sampleCount > 0 : (zone.devices || []).some((device) => typeof device.value === "number");
    const intensity = reportZone ? Number(reportZone.intensity || 0) : estimateZoneIntensityFromDevices(zone);
    const heatBand = getTemperatureHeatBand(intensity, hasSamples);
    const numericDevice = (zone.devices || []).find((device) => typeof device.value === "number");

    return {
      id: zone.id,
      name: formatZonePath(zone),
      buildingName: zone.buildingName,
      value: reportZone?.averageValue ?? numericDevice?.value ?? "-",
      sampleCount: reportZone?.sampleCount ?? (numericDevice ? 1 : 0),
      heatBand,
      slot: floorplanSlots[index % floorplanSlots.length],
      devices: zone.devices || [],
    };
  });
}

function normalizeSeverity(severity) {
  return String(severity || "default").toLowerCase();
}

function getAlarmColor(alarm, overrides = {}) {
  if (String(alarm?.status || "").toLowerCase() === "cleared") return overrides.cleared || defaultAlarmColors.cleared;
  const severity = normalizeSeverity(alarm?.severity);
  return overrides[severity] || defaultAlarmColors[severity] || overrides.default || defaultAlarmColors.default;
}

function tooltip(text) {
  return { title: text, "aria-label": text };
}

function GlobalUiStyles() {
  return (
    <style>{`
      @keyframes bemsPanelIn { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: translateY(0); } }
      @keyframes bemsPulseLive { 0%, 100% { box-shadow: 0 0 0 0 rgba(22, 163, 74, 0.28); } 50% { box-shadow: 0 0 0 5px rgba(22, 163, 74, 0); } }
      @keyframes bemsAlarmFlash { 0%, 100% { opacity: 1; } 50% { opacity: 0.28; } }
      button:hover:not(:disabled) { transform: translateY(-1px); box-shadow: 0 2px 7px rgba(15, 23, 42, 0.18); }
      button:disabled { cursor: not-allowed; opacity: 0.72; }
      .bems-live-pill { animation: bemsPulseLive 1.4s ease-in-out infinite; }
      .bems-alarm-point { animation: bemsAlarmFlash 0.75s ease-in-out infinite; }
      .bems-status-dot { width: 9px; height: 9px; border-radius: 999px; display: inline-block; margin-right: 7px; }
    `}</style>
  );
}

const statusPillStyle = (ok) => ({
  display: "inline-block",
  padding: "5px 9px",
  borderRadius: "999px",
  backgroundColor: ok ? "#dcfce7" : "#fee2e2",
  color: ok ? "#166534" : "#991b1b",
  fontWeight: 700,
  fontSize: "12px",
});

function flattenDevices(hierarchy) {
  return hierarchy.flatMap((building) =>
    getBuildingZones(building).flatMap((zone) =>
      zone.devices.map((device) => ({
        ...device,
        zoneId: zone.id,
        buildingId: building.id,
        zoneName: formatZonePath(zone),
        controlZoneName: zone.name,
        floorName: zone.floorName,
        roomName: zone.roomName,
        buildingName: building.name,
      }))
    )
  );
}

function formatZonePath(zone) {
  return zone?.zonePath || zone?.path || zone?.displayName || [zone?.floorName, zone?.roomName].filter(Boolean).join(" / ") || zone?.name || "";
}

function formatScheduleTarget(schedule) {
  if (schedule.deviceName) return `Device: ${schedule.deviceName}`;
  if (schedule.zonePath || schedule.zoneName) return `Zone: ${schedule.zonePath || schedule.zoneName}`;
  if (schedule.buildingName) return `Building: ${schedule.buildingName}`;
  return "Global";
}

function bacnetPointLabel(objectType) {
  const normalized = String(objectType || "").replace(/[_\s-]/g, "").toLowerCase();
  return {
    analoginput: "AI",
    analogoutput: "AO",
    analogvalue: "AV",
    binaryinput: "BI",
    binaryoutput: "BO",
    binaryvalue: "BV",
    schedule: "SCH",
  }[normalized] || "OBJ";
}

function getBuildingZones(building) {
  if (building?.floors?.length) {
    return building.floors.flatMap((floor) =>
      (floor.rooms || []).flatMap((room) =>
        (room.zones || []).map((zone) => ({
          ...zone,
          floorId: floor.id,
          floorName: floor.name,
          floorLevel: floor.level,
          roomId: room.id,
          roomName: room.name,
          roomNumber: room.roomNumber,
          zonePath: formatZonePath({ ...zone, floorName: floor.name, roomName: room.name }),
        }))
      )
    );
  }
  return building?.zones || [];
}

function flattenZones(hierarchy) {
  return hierarchy.flatMap((building) =>
    getBuildingZones(building).map((zone) => ({
      ...zone,
      buildingId: building.id,
      buildingName: building.name,
    }))
  );
}

function mergeTelemetryHierarchy(currentHierarchy, twin) {
  if (!twin?.buildings?.length) return currentHierarchy;
  const telemetryById = new Map();
  twin.buildings.forEach((building) => {
    getBuildingZones(building).forEach((zone) => {
      zone.devices.forEach((device) => {
        telemetryById.set(device.id, {
          value: device.value,
          units: device.units,
          status: device.status,
          provisioned: device.provisioned,
          commissioned: device.commissioned,
          configuration: device.configuration,
        });
      });
    });
  });

  return currentHierarchy.map((building) => ({
    ...building,
    floors: (building.floors || []).map((floor) => ({
      ...floor,
      rooms: (floor.rooms || []).map((room) => ({
        ...room,
        zones: (room.zones || []).map((zone) => ({
          ...zone,
          devices: zone.devices.map((device) => {
            const telemetry = telemetryById.get(device.id);
            return telemetry ? { ...device, ...telemetry } : device;
          }),
        })),
      })),
    })),
    zones: (building.zones || []).map((zone) => ({
      ...zone,
      devices: zone.devices.map((device) => {
        const telemetry = telemetryById.get(device.id);
        return telemetry ? { ...device, ...telemetry } : device;
      }),
    })),
  }));
}

function telemetrySamplesFromTwin(twin) {
  if (!twin?.buildings?.length) return [];
  const timestamp = new Date().toLocaleTimeString();
  return twin.buildings.flatMap((building) =>
    getBuildingZones(building).flatMap((zone) =>
      zone.devices
        .filter((device) => typeof device.value === "number")
        .map((device) => ({
          timestamp,
          deviceId: device.id,
          deviceName: device.name,
          zoneName: formatZonePath(zone),
          controlZoneName: zone.name,
          floorName: zone.floorName,
          roomName: zone.roomName,
          value: device.value,
          units: device.units || "",
          status: device.status,
        }))
    )
  );
}

function formatSetpoint(device) {
  const value = device.configuration?.setpoint;
  return value == null ? "Not set" : `${value} ${device.units || ""}`.trim();
}

function formatRange(device) {
  const min = device.configuration?.minSetpoint;
  const max = device.configuration?.maxSetpoint;
  if (min == null && max == null) return "Not set";
  return `${min ?? "Any"} - ${max ?? "Any"} ${device.units || ""}`.trim();
}

function formatBatteryPercent(configuration = {}) {
  const value = configuration.batteryPercent;
  if (value == null || value === "") return "-";
  const numeric = Number(value);
  return Number.isFinite(numeric) ? `${numeric}%` : String(value);
}

function eepromStorageSummary(configuration = {}) {
  if (!configuration.eepromEnabled && !configuration.setpointStorage && !configuration.persistentStorage && !configuration.bacnetScheduleStorage) return null;
  const storage = configuration.setpointStorage || {};
  const persistent = configuration.persistentStorage || {};
  const scheduleStorage = configuration.bacnetScheduleStorage || {};
  return {
    enabled: configuration.eepromEnabled !== false || persistent.enabled === true,
    medium: persistent.medium || "EEPROM",
    namespace: persistent.namespace || "device_config",
    address: configuration.eepromAddress || storage.address || "-",
    sizeBytes: configuration.eepromSizeBytes || storage.sizeBytes || "-",
    writePolicy: configuration.eepromWritePolicy || storage.writePolicy || "on_change",
    retainedSetpoint: storage.retainedSetpoint ?? configuration.setpoint ?? "-",
    retainedKeys: persistent.retainedKeys || ["identity", "commissioning", "setpoint", "schedule", "range", "calibration"],
    wearLeveling: persistent.wearLeveling === true,
    checksum: storage.checksum || "crc16",
    scheduleStorage,
  };
}

function MiniBarChart({ devices }) {
  const chartDevices = devices
    .filter((device) => typeof device.value === "number")
    .slice(0, 8)
    .map((device) => ({
      name: device.name.length > 12 ? `${device.name.slice(0, 11)}...` : device.name,
      value: device.value,
      status: device.status,
    }));

  if (chartDevices.length === 0) {
    return <div style={{ height: "190px", display: "grid", placeItems: "center", color: "#64748b" }}>No numeric telemetry</div>;
  }

  return (
    <div style={{ width: "100%", height: "190px" }}>
      <ResponsiveContainer>
        <BarChart data={chartDevices} margin={{ top: 8, right: 8, left: -16, bottom: 12 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
          <XAxis dataKey="name" tick={{ fontSize: 11 }} />
          <YAxis tick={{ fontSize: 11 }} />
          <Tooltip />
          <Bar dataKey="value" fill="#2563eb" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function WeeklyTimelineEditor({ schedules }) {
  const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const hours = [0, 4, 8, 12, 16, 20, 24];
  const activeSchedules = schedules.filter((schedule) => schedule.enabled).slice(0, 8);

  const scheduleAppliesToDay = (schedule, day) => {
    const value = String(schedule.days || "").toLowerCase();
    if (!value || value === "all" || schedule.recurrence === "daily") return true;
    return value.includes(day.toLowerCase());
  };

  const timeToPercent = (time, fallback) => {
    if (!time) return fallback;
    const [hour = 0, minute = 0] = String(time).split(":").map(Number);
    return Math.max(0, Math.min(100, ((hour + minute / 60) / 24) * 100));
  };

  return (
    <div style={{ ...panelStyle, padding: "16px", marginBottom: "18px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: "12px", alignItems: "baseline", marginBottom: "14px" }}>
        <div>
          <h3 style={{ margin: 0, color: "#334155" }}>Weekly Timeline Editor</h3>
          <p style={{ margin: "6px 0 0", color: "#64748b" }}>Building, zone, and device schedules can override each other by priority.</p>
        </div>
        <span style={{ color: "#64748b", fontSize: "13px" }}>{activeSchedules.length} enabled schedules</span>
      </div>
      <div style={{ display: "grid", gap: "8px" }}>
        {days.map((day) => (
          <div key={day} style={{ display: "grid", gridTemplateColumns: "52px minmax(0, 1fr)", gap: "10px", alignItems: "center" }}>
            <strong style={{ color: "#334155" }}>{day}</strong>
            <div style={{ position: "relative", height: "34px", border: "1px solid #dbe4ef", borderRadius: "6px", background: "#f8fafc", overflow: "hidden" }}>
              {hours.slice(0, -1).map((hour) => (
                <span key={hour} style={{ position: "absolute", left: `${(hour / 24) * 100}%`, top: 0, bottom: 0, borderLeft: "1px solid #e2e8f0" }} />
              ))}
              {activeSchedules.filter((schedule) => scheduleAppliesToDay(schedule, day)).map((schedule, index) => {
                const left = timeToPercent(schedule.startTime || schedule.start_time, 33);
                const right = timeToPercent(schedule.endTime || schedule.end_time, 71);
                const width = Math.max(4, right - left);
                return (
                  <button
                    key={`${day}-${schedule.id}`}
                    title={`${schedule.name}: ${schedule.startTime || schedule.start_time || ""} - ${schedule.endTime || schedule.end_time || ""}`}
                    style={{
                      position: "absolute",
                      left: `${left}%`,
                      width: `${width}%`,
                      top: `${4 + (index % 2) * 13}px`,
                      height: "11px",
                      border: "none",
                      borderRadius: "999px",
                      background: schedule.targetType === "device" ? "#7c3aed" : schedule.targetType === "zone" ? "#2563eb" : "#0f766e",
                      cursor: "pointer",
                    }}
                    aria-label={schedule.name}
                  />
                );
              })}
            </div>
          </div>
        ))}
      </div>
      <div style={{ display: "flex", gap: "12px", flexWrap: "wrap", marginTop: "12px", color: "#64748b", fontSize: "13px" }}>
        <span><strong style={{ color: "#0f766e" }}>Building</strong> base</span>
        <span><strong style={{ color: "#2563eb" }}>Zone</strong> override</span>
        <span><strong style={{ color: "#7c3aed" }}>Device</strong> override</span>
      </div>
    </div>
  );
}

function AhuVavDashboard({ hierarchy, telemetrySeries, trendLogs, onSelectDevice }) {
  const zones = flattenZones(hierarchy);
  const devices = flattenDevices(hierarchy);
  const numericDevices = devices.filter((device) => typeof device.value === "number");
  const tempDevices = numericDevices.filter((device) => /temp|sat|air/i.test(`${device.name} ${device.type} ${device.objectType || ""}`));
  const fanDevices = devices.filter((device) => /fan/i.test(`${device.name} ${device.type}`));
  const damperDevices = devices.filter((device) => /vav|damper|valve/i.test(`${device.name} ${device.type}`));
  const supplyAirTemp = tempDevices.length
    ? tempDevices.reduce((sum, device) => sum + Number(device.value || 0), 0) / tempDevices.length
    : 22.0;
  const highSupplyTemp = supplyAirTemp > 24;
  const averageDamper = damperDevices.length
    ? damperDevices.reduce((sum, device) => sum + Number(device.value || 0), 0) / damperDevices.length
    : 48;
  const ahuStatus = devices.some((device) => String(device.status || "").toLowerCase().includes("offline")) ? "Degraded" : "Auto";
  const chartData = telemetrySeries.slice(-36).map((sample, index) => ({
    index,
    label: sample.timestamp,
    value: Number(sample.value || 0),
  }));
  const vavRows = zones.map((zone) => {
    const zoneDevices = zone.devices || [];
    const vavDevice = zoneDevices.find((device) => /vav|damper|valve/i.test(`${device.name} ${device.type}`)) || zoneDevices.find((device) => typeof device.value === "number");
    const tempDevice = zoneDevices.find((device) => /temp/i.test(`${device.name} ${device.type}`));
    return {
      zone,
      vavDevice,
      tempDevice,
      airflow: vavDevice && typeof vavDevice.value === "number" ? Number(vavDevice.value) : null,
      temperature: tempDevice && typeof tempDevice.value === "number" ? Number(tempDevice.value) : null,
      status: zoneDevices.some((device) => String(device.status || "").toLowerCase().includes("offline")) ? "Offline" : "Normal",
    };
  });

  return (
    <section style={{ display: "grid", gap: "18px" }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: "14px" }}>
        {[
          ["AHU Mode", ahuStatus, "#2563eb"],
          ["Supply Air", `${supplyAirTemp.toFixed(1)} C`, "#0f766e"],
          ["Avg VAV", `${averageDamper.toFixed(0)}%`, "#7c3aed"],
          ["Fan Points", fanDevices.length, "#f59e0b"],
          ["Trend Logs", trendLogs.length, "#334155"],
        ].map(([label, value, color]) => (
          <div key={label} style={{ ...panelStyle, padding: "16px", borderTop: `4px solid ${color}` }}>
            <div style={{ color: "#64748b", fontSize: "12px", textTransform: "uppercase" }}>{label}</div>
            <strong style={{ color: "#0f172a", fontSize: "24px" }}>{value}</strong>
          </div>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "minmax(360px, 1.2fr) minmax(320px, 0.9fr)", gap: "18px" }}>
        <section style={{ ...panelStyle, padding: "18px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: "12px", alignItems: "center", marginBottom: "14px" }}>
            <div>
              <h2 style={{ margin: 0, color: "#1f355e" }}>AHU Dashboard</h2>
              <p style={{ margin: "6px 0 0", color: "#64748b" }}>Supply fan, coil, damper, filter, and mixed-air path with live BACnet values.</p>
            </div>
            <span style={statusPillStyle(ahuStatus === "Auto")}>{ahuStatus}</span>
          </div>
          <style>{`
            @keyframes bemsAirflowDash { from { stroke-dashoffset: 12; } to { stroke-dashoffset: 0; } }
            @keyframes bemsFanSpin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
            .bems-airflow { animation: bemsAirflowDash 0.9s linear infinite; }
            .bems-fan { transform-origin: 76px 29px; animation: bemsFanSpin 1.4s linear infinite; }
          `}</style>
          <svg viewBox="0 0 136 58" style={{ width: "100%", height: "320px", border: "1px solid #cbd5e1", background: "#f8fafc" }}>
            <defs>
              <marker id="air-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
                <path d="M 0 0 L 10 5 L 0 10 z" fill="#2563eb" />
              </marker>
            </defs>
            <rect x="7" y="22" width="122" height="14" fill={highSupplyTemp ? "#fee2e2" : "#dbeafe"} stroke={highSupplyTemp ? "#ef4444" : "#93c5fd"} />
            <path className="bems-airflow" d="M 13 29 H 124" stroke="#2563eb" strokeWidth="2.2" strokeDasharray="6 6" markerEnd="url(#air-arrow)" />
            <rect x="8" y="16" width="18" height="27" fill="#e0f2fe" stroke="#0284c7" />
            <text x="9.5" y="30.5" fontSize="3.7" fill="#075985">Outside</text>
            <text x="12" y="35" fontSize="3.7" fill="#075985">Air</text>
            <rect x="32" y="16" width="17" height="27" fill="#fff" stroke="#64748b" />
            <line x1="36" y1="18" x2="36" y2="41" stroke="#cbd5e1" />
            <line x1="40.5" y1="18" x2="40.5" y2="41" stroke="#cbd5e1" />
            <line x1="45" y1="18" x2="45" y2="41" stroke="#cbd5e1" />
            <text x="35" y="47.5" fontSize="4" fill="#334155">Filter</text>
            <rect x="58" y="15" width="18" height="28" fill="#f5f3ff" stroke="#7c3aed" />
            <path d="M 61 18 L 73 40 M 73 18 L 61 40" stroke="#a78bfa" />
            <text x="62.5" y="47.5" fontSize="4" fill="#5b21b6">Coil</text>
            <g className="bems-fan">
              <circle cx="76" cy="29" r="12" fill="#ecfdf5" stroke="#0f766e" strokeWidth="1.4" />
              <path d="M76 29 L76 18 A11 11 0 0 1 85 26 Z" fill="#0f766e" opacity="0.8" />
              <path d="M76 29 L86 34 A11 11 0 0 1 77 40 Z" fill="#0f766e" opacity="0.8" />
              <path d="M76 29 L66 34 A11 11 0 0 1 67 22 Z" fill="#0f766e" opacity="0.8" />
              <circle cx="76" cy="29" r="3" fill="#064e3b" />
            </g>
            <text x="72" y="47.5" fontSize="4" fill="#065f46">Fan</text>
            <rect x="100" y="17" width="14" height="24" fill="#fffbeb" stroke="#f59e0b" />
            <line x1="102" y1="39" x2="112" y2="19" stroke="#f59e0b" strokeWidth="2" />
            <text x="96" y="47.5" fontSize="4" fill="#92400e">Damper</text>
            <rect x="120" y="17" width="12" height="24" fill={highSupplyTemp ? "#fee2e2" : "#ecfeff"} stroke={highSupplyTemp ? "#dc2626" : "#06b6d4"} />
            <text x="118" y="47.5" fontSize="4" fill={highSupplyTemp ? "#b91c1c" : "#155e75"}>Supply</text>
            <circle cx="22" cy="11" r="2.2" fill="#0284c7" />
            <text x="26" y="12" fontSize="3.4" fill="#334155">Outside Temp 18.5 C</text>
            <circle cx="113" cy="11" r="2.2" fill="#f59e0b" />
            <text x="88" y="12" fontSize="3.4" fill="#334155">Duct Pressure 1.2 in.wc</text>
            {[
              ["Supply Temp", `${supplyAirTemp.toFixed(1)} C`, 116, 4, highSupplyTemp ? "#b91c1c" : "#0f172a"],
              ["Fan", fanDevices.length ? "On" : "Ready", 68, 4, "#0f172a"],
              ["Valve", "43%", 55, 47, "#0f172a"],
              ["VAV", `${averageDamper.toFixed(0)}%`, 96, 4, "#0f172a"],
            ].map(([label, value, x, y, fill]) => (
              <g key={label}>
                <rect x={x} y={y} width="18" height="9" rx="1.5" fill={fill} />
                <text x={x + 2} y={y + 3.5} fontSize="2.5" fill="#cbd5e1">{label}</text>
                <text x={x + 2} y={y + 7.3} fontSize="3.2" fill="#fff" fontWeight="700">{value}</text>
              </g>
            ))}
          </svg>
        </section>

        <section style={{ ...panelStyle, padding: "18px" }}>
          <h2 style={{ margin: "0 0 12px", color: "#1f355e" }}>AHU Trend</h2>
          <div style={{ height: "300px" }}>
            {chartData.length ? (
              <ResponsiveContainer>
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="index" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Line type="monotone" dataKey="value" stroke="#2563eb" dot={false} strokeWidth={2} />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <div style={{ height: "100%", display: "grid", placeItems: "center", color: "#64748b" }}>Waiting for telemetry SSE samples</div>
            )}
          </div>
        </section>
      </div>

      <section style={{ ...panelStyle, overflowX: "auto" }}>
        <div style={{ padding: "16px 16px 0" }}>
          <h2 style={{ margin: 0, color: "#1f355e" }}>VAV Zone Dashboard</h2>
          <p style={{ margin: "6px 0 12px", color: "#64748b" }}>Terminal unit view for room comfort, airflow, damper command, and BACnet point status.</p>
        </div>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: "860px" }}>
          <thead>
            <tr>
              <th style={headerStyle}>Zone / Room</th>
              <th style={headerStyle}>VAV Device</th>
              <th style={headerStyle}>Temperature</th>
              <th style={headerStyle}>Airflow / Damper</th>
              <th style={headerStyle}>BACnet Service</th>
              <th style={headerStyle}>Status</th>
            </tr>
          </thead>
          <tbody>
            {vavRows.map((row) => (
              <tr key={row.zone.id}>
                <td style={cellStyle}>
                  <strong>{formatZonePath(row.zone)}</strong>
                  <div style={{ color: "#64748b", fontSize: "12px" }}>{row.zone.buildingName}</div>
                </td>
                <td style={cellStyle}>
                  {row.vavDevice ? (
                    <button onClick={() => onSelectDevice(row.vavDevice)} style={{ border: "none", background: "transparent", color: "#2563eb", cursor: "pointer", padding: 0, fontWeight: 700 }}>
                      {row.vavDevice.name}
                    </button>
                  ) : "Unmapped"}
                </td>
                <td style={cellStyle}>{row.temperature == null ? "-" : `${row.temperature.toFixed(1)} C`}</td>
                <td style={cellStyle}>{row.airflow == null ? "-" : `${row.airflow.toFixed(0)} ${row.vavDevice?.units || "%"}`}</td>
                <td style={cellStyle}>{row.vavDevice ? "SubscribeCOV + ReadProperty fallback" : "Discovery required"}</td>
                <td style={cellStyle}><span style={statusPillStyle(row.status === "Normal")}>{row.status}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </section>
  );
}

function EcoStruxureStyleMock({ hierarchy, alarms, schedules, trendLogs, telemetrySeries, onSelectDevice }) {
  const buildings = hierarchy || [];
  const zones = flattenZones(buildings);
  const devices = flattenDevices(buildings);
  const ahuDevice = devices.find((device) => /fan|vav|damper|temp|ahu/i.test(`${device.name} ${device.type}`)) || devices[0] || {};
  const activeAlarms = alarms.filter((alarm) => alarm.status !== "Cleared").slice(0, 5);
  const scheduleCount = schedules.filter((schedule) => schedule.enabled).length;
  const numericDevices = devices.filter((device) => typeof device.value === "number");
  const averageValue = numericDevices.length
    ? numericDevices.reduce((sum, device) => sum + Number(device.value || 0), 0) / numericDevices.length
    : 0;
  const chartData = telemetrySeries.slice(-48).map((sample, index) => ({
    index,
    value: Number(sample.value || 0),
    label: sample.timestamp,
  }));
  const pointRows = [
    ["AI-1", "Supply Air Temp", "analogInput", `${averageValue.toFixed(1)} C`, "ReadProperty"],
    ["AO-1", "Cooling Valve", "analogOutput", "43 %", "WriteProperty"],
    ["BO-1", "Supply Fan Cmd", "binaryOutput", ahuDevice.value ? "On" : "Off", "WriteProperty"],
    ["SCH-1", "Occupied Schedule", "schedule", scheduleCount ? "Active" : "Idle", "Schedule Object"],
  ];

  return (
    <section style={{ display: "grid", gridTemplateColumns: "280px minmax(0, 1fr) 320px", gap: "16px", alignItems: "start" }}>
      <aside style={{ ...panelStyle, padding: "14px", maxHeight: "820px", overflowY: "auto" }}>
        <h2 style={{ margin: "0 0 12px", color: "#1f355e", fontSize: "18px" }}>System Tree</h2>
        {buildings.map((building) => (
          <div key={building.id} style={{ marginBottom: "14px" }}>
            <div style={{ fontWeight: 700, color: "#0f172a", marginBottom: "8px" }}>{building.name}</div>
            {(building.floors || []).map((floor) => (
              <div key={floor.id} style={{ borderLeft: "2px solid #cbd5e1", paddingLeft: "10px", margin: "8px 0" }}>
                <div style={{ color: "#1f355e", fontWeight: 700 }}>{floor.name}</div>
                {(floor.rooms || []).flatMap((room) => (room.zones || []).map((zone) => ({ ...zone, roomName: room.name, roomNumber: room.roomNumber }))).map((zone) => (
                  <div key={`${floor.id}-${zone.id}`} style={{ marginTop: "8px", paddingLeft: "8px", borderLeft: "2px solid #e2e8f0" }}>
                    <div style={{ color: "#334155", fontWeight: 700 }}>Zone: {zone.name}</div>
                    <div style={{ color: "#64748b", fontSize: "12px" }}>Room: {zone.roomName || "Unassigned"}</div>
                    {(zone.devices || []).slice(0, 5).map((device) => (
                      <button
                        key={device.id}
                        onClick={() => onSelectDevice({ ...device, buildingName: building.name, zoneName: formatZonePath(zone) })}
                        style={{ display: "block", width: "100%", marginTop: "6px", padding: "7px 8px", border: "1px solid #e2e8f0", borderRadius: "5px", background: "#fff", color: "#475569", textAlign: "left", cursor: "pointer" }}
                      >
                        <span style={{ display: "block", fontWeight: 700 }}>{device.name}</span>
                        <span style={{ color: "#64748b", fontSize: "12px" }}>Point {bacnetPointLabel(device.bacnet?.objectType)}-{device.bacnet?.objectInstance || 1}</span>
                      </button>
                    ))}
                  </div>
                ))}
              </div>
            ))}
            {(building.floors || []).length === 0 && getBuildingZones(building).map((zone) => (
              <div key={zone.id} style={{ borderLeft: "2px solid #cbd5e1", paddingLeft: "10px", margin: "8px 0" }}>
                <div style={{ color: "#334155", fontWeight: 600 }}>{formatZonePath(zone)}</div>
                {(zone.devices || []).slice(0, 5).map((device) => (
                  <button
                    key={device.id}
                    onClick={() => onSelectDevice({ ...device, buildingName: building.name, zoneName: formatZonePath(zone) })}
                    style={{ display: "block", width: "100%", marginTop: "6px", padding: "7px 8px", border: "1px solid #e2e8f0", borderRadius: "5px", background: "#fff", color: "#475569", textAlign: "left", cursor: "pointer" }}
                  >
                    {device.name}
                  </button>
                ))}
              </div>
            ))}
          </div>
        ))}
      </aside>

      <main style={{ display: "grid", gap: "16px" }}>
        <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: "12px" }}>
          {[
            ["Online Devices", devices.length, "#2563eb"],
            ["Active Alarms", activeAlarms.length, "#dc2626"],
            ["Schedules", scheduleCount, "#0f766e"],
            ["Trend Logs", trendLogs.length, "#f59e0b"],
            ["Avg Point", averageValue.toFixed(1), "#7c3aed"],
          ].map(([label, value, color]) => (
            <div key={label} style={{ ...panelStyle, padding: "14px", borderTop: `4px solid ${color}` }}>
              <div style={{ color: "#64748b", fontSize: "12px", textTransform: "uppercase" }}>{label}</div>
              <div style={{ color: "#0f172a", fontSize: "26px", fontWeight: 800 }}>{value}</div>
            </div>
          ))}
        </section>

        <section style={{ ...panelStyle, padding: "18px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: "12px", alignItems: "center", marginBottom: "16px" }}>
            <div>
              <h2 style={{ margin: 0, color: "#1f355e" }}>AHU-1 Equipment Graphic</h2>
              <p style={{ margin: "6px 0 0", color: "#64748b" }}>BACnet points, controller logic, and energy context in one operator view.</p>
            </div>
            <span style={{ padding: "6px 10px", borderRadius: "999px", background: "#dcfce7", color: "#166534", fontWeight: 700 }}>Auto</span>
          </div>
          <div style={{ position: "relative", minHeight: "280px", border: "1px solid #cbd5e1", borderRadius: "8px", background: "linear-gradient(180deg, #f8fafc 0%, #eef6f7 100%)", overflow: "hidden" }}>
            <div style={{ position: "absolute", left: "7%", right: "7%", top: "44%", height: "54px", background: "#dbeafe", border: "2px solid #93c5fd" }} />
            <div style={{ position: "absolute", left: "12%", top: "35%", width: "86px", height: "92px", border: "2px solid #64748b", background: "#fff", display: "grid", placeItems: "center", fontWeight: 700 }}>Filter</div>
            <div style={{ position: "absolute", left: "31%", top: "34%", width: "94px", height: "94px", borderRadius: "50%", border: "3px solid #0f766e", background: "#ecfdf5", display: "grid", placeItems: "center", fontWeight: 800 }}>Fan</div>
            <div style={{ position: "absolute", left: "52%", top: "33%", width: "78px", height: "98px", border: "2px solid #7c3aed", background: "#f5f3ff", display: "grid", placeItems: "center", fontWeight: 700 }}>Coil</div>
            <div style={{ position: "absolute", right: "13%", top: "36%", width: "88px", height: "88px", border: "2px solid #f59e0b", background: "#fffbeb", display: "grid", placeItems: "center", fontWeight: 700 }}>Damper</div>
            {[
              ["SAT", `${averageValue.toFixed(1)} C`, "18%", "20%"],
              ["Valve", "43%", "54%", "18%"],
              ["Fan Cmd", ahuDevice.value ? "On" : "Auto", "34%", "68%"],
              ["kW", "12.8", "72%", "68%"],
            ].map(([label, value, left, top]) => (
              <div key={label} style={{ position: "absolute", left, top, minWidth: "82px", padding: "8px 10px", borderRadius: "6px", background: "#0f172a", color: "white", boxShadow: "0 8px 18px rgba(15, 23, 42, 0.2)" }}>
                <div style={{ fontSize: "11px", color: "#cbd5e1" }}>{label}</div>
                <div style={{ fontWeight: 800 }}>{value}</div>
              </div>
            ))}
          </div>
        </section>

        <section style={{ ...panelStyle, overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: "760px" }}>
            <thead>
              <tr>
                <th style={headerStyle}>Point</th>
                <th style={headerStyle}>Name</th>
                <th style={headerStyle}>BACnet Object</th>
                <th style={headerStyle}>Value</th>
                <th style={headerStyle}>Service</th>
              </tr>
            </thead>
            <tbody>
              {pointRows.map(([point, name, objectType, value, service]) => (
                <tr key={point}>
                  <td style={cellStyle}>{point}</td>
                  <td style={cellStyle}>{name}</td>
                  <td style={cellStyle}>{objectType}</td>
                  <td style={cellStyle}>{value}</td>
                  <td style={cellStyle}>{service}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </main>

      <aside style={{ display: "grid", gap: "16px" }}>
        <section style={{ ...panelStyle, padding: "14px" }}>
          <h2 style={{ margin: "0 0 12px", color: "#1f355e", fontSize: "18px" }}>Alarm Server</h2>
          {activeAlarms.length === 0 ? (
            <p style={{ color: "#64748b" }}>No active alarms.</p>
          ) : activeAlarms.map((alarm) => (
            <div key={alarm.id} style={{ padding: "10px 0", borderBottom: "1px solid #e2e8f0" }}>
              <div style={{ fontWeight: 700, color: alarm.severity === "critical" ? "#b91c1c" : "#92400e" }}>{alarm.severity}</div>
              <div style={{ color: "#334155" }}>{alarm.message}</div>
              <div style={{ color: "#64748b", fontSize: "12px" }}>{alarm.deviceName || `Alarm ${alarm.id}`}</div>
            </div>
          ))}
        </section>

        <section style={{ ...panelStyle, padding: "14px" }}>
          <h2 style={{ margin: "0 0 12px", color: "#1f355e", fontSize: "18px" }}>Energy Trend</h2>
          <div style={{ height: "220px" }}>
            <ResponsiveContainer>
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="index" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} />
                <Tooltip />
                <Line type="monotone" dataKey="value" stroke="#0f766e" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </section>

        <section style={{ ...panelStyle, padding: "14px" }}>
          <h2 style={{ margin: "0 0 12px", color: "#1f355e", fontSize: "18px" }}>Open Protocols</h2>
          {["BACnet/IP", "BACnet MS/TP", "Modbus RTU", "CAN gateway", "SSE live UI", "gRPC edge core"].map((item) => (
            <div key={item} style={{ display: "flex", justifyContent: "space-between", padding: "7px 0", borderBottom: "1px solid #e2e8f0" }}>
              <span>{item}</span>
              <strong style={{ color: "#16a34a" }}>Ready</strong>
            </div>
          ))}
        </section>

        <section style={{ ...panelStyle, padding: "14px" }}>
          <h2 style={{ margin: "0 0 12px", color: "#1f355e", fontSize: "18px" }}>Trend Logging</h2>
          {trendLogs.length === 0 ? (
            <p style={{ color: "#64748b" }}>No persisted trend samples yet.</p>
          ) : trendLogs.slice(0, 5).map((trend) => (
            <div key={trend.id} style={{ padding: "8px 0", borderBottom: "1px solid #e2e8f0" }}>
              <div style={{ color: "#334155", fontWeight: 700 }}>{trend.deviceName || `Device ${trend.deviceId}`}</div>
              <div style={{ color: "#64748b", fontSize: "13px" }}>{trend.metricValue} {trend.units || ""} | {trend.metricName}</div>
            </div>
          ))}
        </section>
      </aside>
    </section>
  );
}

function EnergyUsageCharts({ telemetrySeries }) {
  const recent = telemetrySeries.slice(-80);
  const energySeries = recent.map((sample, index) => ({
    index,
    timestamp: sample.timestamp,
    value: Number(sample.value || 0),
    deviceName: sample.deviceName,
    units: sample.units,
  }));

  if (energySeries.length === 0) {
    return <div style={{ height: "220px", display: "grid", placeItems: "center", color: "#64748b" }}>Waiting for live telemetry</div>;
  }

  return (
    <div style={{ width: "100%", height: "220px" }}>
      <ResponsiveContainer>
        <LineChart data={energySeries} margin={{ top: 8, right: 12, left: -16, bottom: 8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
          <XAxis dataKey="timestamp" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
          <YAxis tick={{ fontSize: 11 }} />
          <Tooltip formatter={(value, name, item) => [`${value} ${item.payload.units || ""}`, item.payload.deviceName]} />
          <Line type="monotone" dataKey="value" stroke="#0f766e" dot={false} strokeWidth={2} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function BuildingFootprintPanel({ footprint }) {
  if (!footprint) {
    return null;
  }

  const buildings = footprint.buildings || [];
  const chartData = buildings.map((building) => ({
    name: building.buildingName,
    monthlyCost: building.monthlyCost,
    monthlyCarbonKg: building.monthlyCarbonKg,
  }));

  return (
    <section style={{ ...panelStyle, padding: "16px", marginBottom: "28px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: "12px", alignItems: "baseline", flexWrap: "wrap", marginBottom: "14px" }}>
        <div>
          <h2 style={{ margin: 0, color: "#2c5282" }}>Building Cost and Carbon Footprint</h2>
          <p style={{ margin: "6px 0 0", color: "#64748b" }}>Calculated from live power/energy points when available, with simulator-safe load estimates.</p>
        </div>
        <span style={{ color: "#64748b", fontSize: "13px" }}>{footprint.assumptions?.electricityPriceUsdPerKwh ?? "-"} USD/kWh | {footprint.assumptions?.emissionsKgPerKwh ?? "-"} kg CO2e/kWh</span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: "12px", marginBottom: "16px" }}>
        {[
          ["Live Demand", `${footprint.totals?.liveDemandKw ?? 0} kW`],
          ["Daily Cost", `$${footprint.totals?.dailyCost ?? 0}`],
          ["Monthly Cost", `$${footprint.totals?.monthlyCost ?? 0}`],
          ["Annual Cost", `$${footprint.totals?.annualCost ?? 0}`],
          ["Monthly Carbon", `${footprint.totals?.monthlyCarbonKg ?? 0} kg CO2e`],
          ["Annual Carbon", `${footprint.totals?.annualCarbonTons ?? 0} t CO2e`],
        ].map(([label, value]) => (
          <div key={label} style={{ border: "1px solid #e2e8f0", borderRadius: "6px", padding: "12px" }}>
            <div style={{ color: "#64748b", fontSize: "12px", textTransform: "uppercase" }}>{label}</div>
            <strong style={{ color: "#1f355e", fontSize: "20px" }}>{value}</strong>
          </div>
        ))}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "minmax(280px, 1fr) minmax(280px, 1fr)", gap: "16px" }}>
        <div style={{ height: "230px" }}>
          <ResponsiveContainer>
            <BarChart data={chartData} margin={{ top: 8, right: 12, left: -12, bottom: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="name" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip formatter={(value) => [`$${value}`, "Monthly cost"]} />
              <Bar dataKey="monthlyCost" fill="#2563eb" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div style={{ height: "230px" }}>
          <ResponsiveContainer>
            <BarChart data={chartData} margin={{ top: 8, right: 12, left: -12, bottom: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="name" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip formatter={(value) => [`${value} kg CO2e`, "Monthly carbon"]} />
              <Bar dataKey="monthlyCarbonKg" fill="#0f766e" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
      <div style={{ overflowX: "auto", marginTop: "14px", border: "1px solid #e2e8f0", borderRadius: "6px" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: "900px" }}>
          <thead>
            <tr>
              <th style={headerStyle}>Building</th>
              <th style={headerStyle}>Basis</th>
              <th style={headerStyle}>Demand</th>
              <th style={headerStyle}>Daily kWh</th>
              <th style={headerStyle}>Monthly Cost</th>
              <th style={headerStyle}>Annual Cost</th>
              <th style={headerStyle}>Annual Carbon</th>
            </tr>
          </thead>
          <tbody>
            {buildings.map((building) => (
              <tr key={building.buildingId}>
                <td style={cellStyle}>{building.buildingName}</td>
                <td style={cellStyle}>{building.basis}</td>
                <td style={cellStyle}>{building.liveDemandKw} kW</td>
                <td style={cellStyle}>{building.estimatedDailyKwh} kWh</td>
                <td style={cellStyle}>${building.monthlyCost}</td>
                <td style={cellStyle}>${building.annualCost}</td>
                <td style={cellStyle}>{building.annualCarbonTons} t CO2e</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function EdgePlatformCapabilitiesPanel({ capabilities }) {
  if (!capabilities) {
    return null;
  }

  const nrf52840Capability = (capabilities.capabilities || []).find((capability) => capability.key === "nrf52840_bacnet_devices");
  const powerMeterCapability = (capabilities.capabilities || []).find((capability) => capability.key === "field_selectable_power_meter");

  return (
    <section style={{ ...panelStyle, padding: "16px", marginBottom: "28px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: "12px", alignItems: "baseline", flexWrap: "wrap", marginBottom: "14px" }}>
        <div>
          <h2 style={{ margin: 0, color: "#2c5282" }}>BACnet Edge Platform</h2>
          <p style={{ margin: "6px 0 0", color: "#64748b" }}>Protocol translation, cloud connectivity, local edge logic, and standardized point data.</p>
        </div>
        <span style={{ color: "#64748b", fontSize: "13px" }}>{capabilities.platformRole}</span>
      </div>
      {nrf52840Capability && (
        <div style={{ border: "1px solid #bfdbfe", borderRadius: "6px", padding: "12px", marginBottom: "12px", background: "#eff6ff" }}>
          <strong style={{ color: "#1e3a8a" }}>{nrf52840Capability.label}</strong>
          <div style={{ color: "#334155", marginTop: "6px", fontSize: "13px" }}>
            {nrf52840Capability.chipset} | {(nrf52840Capability.transportProfiles || []).join(" | ")}
          </div>
          <div style={{ color: "#64748b", marginTop: "6px", fontSize: "13px" }}>{nrf52840Capability.runtimeProfile}</div>
          <div style={{ color: "#64748b", marginTop: "6px", fontSize: "13px" }}>{nrf52840Capability.gatewayPath}</div>
        </div>
      )}
      {powerMeterCapability && (
        <div style={{ border: "1px solid #bbf7d0", borderRadius: "6px", padding: "12px", marginBottom: "12px", background: "#f0fdf4" }}>
          <strong style={{ color: "#14532d" }}>{powerMeterCapability.label}</strong>
          <div style={{ color: "#334155", marginTop: "6px", fontSize: "13px" }}>
            {powerMeterCapability.communicationProfile} | {(powerMeterCapability.selectableProtocols || []).join(" | ")}
          </div>
          <div style={{ color: "#64748b", marginTop: "6px", fontSize: "13px" }}>
            Serial {powerMeterCapability.interfaces?.serial || "EIA-485"} | Ethernet {(powerMeterCapability.interfaces?.ethernet || []).join(" / ")} | Pulse I/O {powerMeterCapability.pulseIo?.configurablePulseOutputs || 0} out, {powerMeterCapability.pulseIo?.configurablePulseInputs || 0} in
          </div>
        </div>
      )}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))", gap: "12px" }}>
        {(capabilities.capabilities || []).map((capability) => (
          <div key={capability.key} style={{ border: "1px solid #e2e8f0", borderRadius: "6px", padding: "12px", display: "grid", gap: "8px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: "10px" }}>
              <strong style={{ color: "#1f355e" }}>{capability.label}</strong>
              <span style={{ color: capability.status === "configured" ? "#166534" : "#2563eb", fontSize: "12px", fontWeight: 700 }}>{capability.status}</span>
            </div>
            <div style={{ color: "#64748b", fontSize: "13px" }}>
              {[
                ...(capability.fieldProtocols || []),
                ...(capability.webProtocols || []),
                ...(capability.secureTransports || []),
                ...(capability.normalizedObjects || []),
              ].slice(0, 6).join(" | ")}
            </div>
            {capability.offlinePolicy && <div style={{ color: "#334155", fontSize: "13px" }}>{capability.offlinePolicy}</div>}
          </div>
        ))}
      </div>
    </section>
  );
}

function EventDrivenArchitecturePanel({ events }) {
  if (!events) {
    return null;
  }
  const architecture = events.architecture || {};
  const kafkaStatus = events.kafka || {};
  const mqttStatus = events.mqtt || {};
  const rabbitStatus = events.rabbitmq || {};

  return (
    <section style={{ ...panelStyle, padding: "16px", marginBottom: "28px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: "12px", alignItems: "baseline", flexWrap: "wrap", marginBottom: "14px" }}>
        <div>
          <h2 style={{ margin: 0, color: "#2c5282" }}>Event-Driven Architecture</h2>
          <p style={{ margin: "6px 0 0", color: "#64748b" }}>Commands publish domain events; SSE, Kafka, RabbitMQ, and MQTT carry updates to operators and integrations.</p>
        </div>
        <span style={{ color: "#166534", fontSize: "13px", fontWeight: 700 }}>{architecture.style || "event-driven"}</span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "12px", marginBottom: "14px" }}>
        {[
          ["Browser live", architecture.browserRealtime || architecture.realtimePath || "SSE"],
          ["Backend bus", kafkaStatus.enabled ? "Kafka enabled" : "Kafka disabled"],
          ["Work queue", rabbitStatus.enabled ? "RabbitMQ enabled" : "RabbitMQ available"],
          ["Cloud bridge", mqttStatus.enabled ? "MQTT/TLS enabled" : "MQTT/TLS available"],
          ["Topics", (events.topics || []).length],
        ].map(([label, value]) => (
          <div key={label} style={{ border: "1px solid #e2e8f0", borderRadius: "6px", padding: "12px", background: "#f8fafc" }}>
            <div style={{ color: "#64748b", fontSize: "12px", textTransform: "uppercase" }}>{label}</div>
            <strong style={{ color: "#0f172a", fontSize: "18px" }}>{value}</strong>
          </div>
        ))}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "minmax(240px, 1fr) minmax(240px, 1fr)", gap: "14px" }}>
        <div>
          <h3 style={{ margin: "0 0 8px", color: "#334155" }}>Event Families</h3>
          {(architecture.eventFamilies || []).slice(0, 9).map((family) => (
            <div key={family} style={{ padding: "7px 0", borderTop: "1px solid #e2e8f0", color: "#334155" }}>{family}</div>
          ))}
        </div>
        <div>
          <h3 style={{ margin: "0 0 8px", color: "#334155" }}>Flow</h3>
          {[architecture.commandPath, architecture.realtimePath, architecture.guarantees?.offlineTolerance].filter(Boolean).map((item) => (
            <div key={item} style={{ padding: "7px 0", borderTop: "1px solid #e2e8f0", color: "#334155" }}>{item}</div>
          ))}
        </div>
      </div>
    </section>
  );
}

function TemperatureHistoryChart({ telemetrySeries }) {
  const temperatureSeries = telemetrySeries
    .filter((sample) => /temp|temperature/i.test(`${sample.deviceName} ${sample.units}`) || /celsius|°c|c$/i.test(String(sample.units || "")))
    .slice(-80)
    .map((sample, index) => ({
      index,
      timestamp: sample.timestamp,
      value: Number(sample.value || 0),
      deviceName: sample.deviceName,
      units: sample.units || "C",
    }));

  if (temperatureSeries.length === 0) {
    return <div style={{ height: "220px", display: "grid", placeItems: "center", color: "#64748b" }}>Waiting for temperature history</div>;
  }

  return (
    <div style={{ width: "100%", height: "220px" }}>
      <ResponsiveContainer>
        <LineChart data={temperatureSeries} margin={{ top: 8, right: 12, left: -16, bottom: 8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
          <XAxis dataKey="timestamp" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
          <YAxis tick={{ fontSize: 11 }} />
          <Tooltip formatter={(value, name, item) => [`${value} ${item.payload.units}`, item.payload.deviceName]} />
          <Line type="monotone" dataKey="value" stroke="#dc2626" dot={false} strokeWidth={2} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function TelemetryFeed({ feed }) {
  return (
    <div style={{ ...panelStyle, padding: "16px" }}>
      <h2 style={{ margin: "0 0 12px", color: "#2c5282" }}>Live Telemetry Feed</h2>
      <div style={{ maxHeight: "240px", overflowY: "auto", borderTop: "1px solid #e2e8f0" }}>
        {feed.length === 0 ? (
          <div style={{ color: "#64748b", paddingTop: "12px" }}>Waiting for SSE telemetry.</div>
        ) : feed.slice(0, 80).map((sample, index) => (
          <div key={`${sample.deviceId}-${sample.timestamp}-${index}`} style={{ display: "grid", gridTemplateColumns: "90px 1fr auto", gap: "10px", padding: "9px 0", borderBottom: "1px solid #edf2f7", color: "#334155" }}>
            <span style={{ color: "#64748b" }}>{sample.timestamp}</span>
            <span>{sample.deviceName} <span style={{ color: "#64748b" }}>({sample.zoneName})</span></span>
            <strong>{sample.value} {sample.units}</strong>
          </div>
        ))}
      </div>
    </div>
  );
}

function CampusDashboard({ loginContext, hierarchy, fddFindings, alarms }) {
  const sites = loginContext?.sites || [];
  const buildings = hierarchy || [];
  const openFaults = fddFindings.filter((finding) => finding.status !== "closed").length;
  const activeAlarms = alarms.filter((alarm) => alarm.status !== "Cleared").length;

  return (
    <section style={{ ...panelStyle, padding: "16px", marginBottom: "24px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: "12px", alignItems: "baseline", marginBottom: "12px" }}>
        <div>
          <h2 style={{ margin: 0, color: "#2c5282" }}>Multi-Site Dashboard</h2>
          <p style={{ margin: "6px 0 0", color: "#64748b" }}>Campus overview for sites, buildings, active alarms, and Fault Detection AI.</p>
        </div>
        <a href={`${apiBase}/api/reports/energy.pdf`} target="_blank" rel="noreferrer" style={{ ...buttonStyle, backgroundColor: "#0f766e", textDecoration: "none" }}>
          PDF Energy Report
        </a>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: "12px", marginBottom: "14px" }}>
        {[
          ["Sites", sites.length],
          ["Buildings", buildings.length],
          ["Active Alarms", activeAlarms],
          ["FDD Findings", openFaults],
        ].map(([label, value]) => (
          <div key={label} style={{ border: "1px solid #e2e8f0", borderRadius: "6px", padding: "12px" }}>
            <div style={{ color: "#64748b", fontSize: "12px" }}>{label}</div>
            <strong style={{ color: "#1f355e", fontSize: "22px" }}>{value}</strong>
          </div>
        ))}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "10px" }}>
        {buildings.map((building) => {
          const zones = getBuildingZones(building);
          const buildingDevices = zones.flatMap((zone) => zone.devices || []);
          return (
            <div key={building.id} style={{ border: "1px solid #e2e8f0", borderRadius: "6px", padding: "12px" }}>
              <strong style={{ color: "#334155" }}>{building.name}</strong>
              <div style={{ color: "#64748b", marginTop: "4px" }}>{zones.length} zones | {buildingDevices.length} devices</div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function HistoryTimeline({ history }) {
  const events = Array.isArray(history) ? history : history?.events || [];
  const days = Array.isArray(history) ? 30 : history?.days || 30;
  return (
    <section style={{ ...panelStyle, padding: "16px", marginBottom: "24px" }}>
      <h2 style={{ margin: "0 0 12px", color: "#2c5282" }}>History ({days} days)</h2>
      <div style={{ maxHeight: "260px", overflowY: "auto", borderTop: "1px solid #e2e8f0" }}>
        {events.length === 0 ? (
          <div style={{ color: "#64748b", paddingTop: "12px" }}>No history events yet.</div>
        ) : events.slice(0, 60).map((event) => (
          <div key={`${event.type}-${event.id}`} style={{ display: "grid", gridTemplateColumns: "150px 110px 1fr", gap: "12px", padding: "10px 0", borderBottom: "1px solid #edf2f7", color: "#334155" }}>
            <span style={{ color: "#64748b" }}>{event.occurredAt ? new Date(event.occurredAt).toLocaleString() : "-"}</span>
            <strong style={{ color: event.type === "alarm" ? "#b91c1c" : event.type === "optimization" ? "#7c3aed" : "#0f766e" }}>{event.type}</strong>
            <span>{event.label}: <span style={{ color: "#64748b" }}>{event.detail}</span></span>
          </div>
        ))}
      </div>
    </section>
  );
}

function ReportingCenter({ reportSummary, reportSchedules, reportExports, reportRuns, reportScheduleForm, setReportScheduleForm, onCreateSchedule, onRunSchedule, onRunDueSchedules }) {
  if (!reportSummary) return null;
  const cards = [
    ["Buildings", reportSummary.buildings ?? 0],
    ["Trend Samples", reportSummary.trendSamples?.count ?? 0],
    ["Active Alarms", reportSummary.alarms?.activeCount ?? 0],
    ["Open FDD", reportSummary.fdd?.openCount ?? 0],
    ["Optimization Runs", reportSummary.optimization?.runCount ?? 0],
    ["Savings", `${reportSummary.optimization?.estimatedSavingsKwh ?? 0} kWh`],
  ];

  return (
    <section style={{ ...panelStyle, padding: "16px", marginBottom: "24px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: "12px", alignItems: "baseline", flexWrap: "wrap", marginBottom: "14px" }}>
        <div>
          <h2 style={{ margin: 0, color: "#2c5282" }}>Reporting Center</h2>
          <p style={{ margin: "6px 0 0", color: "#64748b" }}>Energy, trend, alarm, FDD, and optimization reporting for the last {reportSummary.periodDays} days.</p>
        </div>
        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
          <a href={`${apiBase}${reportSummary.exports?.pdf || "/api/reports/energy.pdf"}`} target="_blank" rel="noreferrer" style={{ ...buttonStyle, backgroundColor: "#0f766e", textDecoration: "none" }}>
            PDF
          </a>
          <a href={`${apiBase}${reportSummary.exports?.trendsCsv || "/api/reports/trends.csv"}`} target="_blank" rel="noreferrer" style={{ ...buttonStyle, backgroundColor: "#2563eb", textDecoration: "none" }}>
            CSV
          </a>
          <a href={`${apiBase}${reportSummary.exports?.json || "/api/reports/export?format=json"}`} target="_blank" rel="noreferrer" style={{ ...buttonStyle, backgroundColor: "#475569", textDecoration: "none" }}>
            JSON
          </a>
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: "10px" }}>
        {cards.map(([label, value]) => (
          <div key={label} style={{ border: "1px solid #e2e8f0", borderRadius: "6px", padding: "10px" }}>
            <div style={{ color: "#64748b", fontSize: "12px" }}>{label}</div>
            <strong style={{ color: "#1f355e" }}>{value}</strong>
          </div>
        ))}
      </div>
      <div style={{ color: "#64748b", fontSize: "13px", marginTop: "12px" }}>
        Sources: {(reportSummary.sources || []).join(", ")}.
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "minmax(260px, 0.85fr) minmax(320px, 1.15fr)", gap: "14px", marginTop: "16px" }}>
        <div style={{ border: "1px solid #e2e8f0", borderRadius: "6px", padding: "12px" }}>
          <h3 style={{ margin: "0 0 10px", color: "#334155", fontSize: "15px" }}>Scheduled Reports</h3>
          <div style={{ display: "grid", gap: "8px" }}>
            <input style={inputStyle} placeholder="Schedule name" value={reportScheduleForm.name} onChange={(event) => setReportScheduleForm((prev) => ({ ...prev, name: event.target.value }))} />
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
              <select style={inputStyle} value={reportScheduleForm.reportType} onChange={(event) => setReportScheduleForm((prev) => ({ ...prev, reportType: event.target.value }))}>
                <option value="energy">Energy</option>
                <option value="trends">Trends</option>
              </select>
              <select style={inputStyle} value={reportScheduleForm.cadence} onChange={(event) => setReportScheduleForm((prev) => ({ ...prev, cadence: event.target.value }))}>
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
                <option value="monthly">Monthly</option>
              </select>
            </div>
            <input style={inputStyle} placeholder="Recipients, comma separated" value={reportScheduleForm.recipients} onChange={(event) => setReportScheduleForm((prev) => ({ ...prev, recipients: event.target.value }))} />
            <input style={inputStyle} placeholder="Days" type="number" min="1" max="365" value={reportScheduleForm.days} onChange={(event) => setReportScheduleForm((prev) => ({ ...prev, days: event.target.value }))} />
            <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
              <button type="button" style={{ ...buttonStyle, backgroundColor: "#2563eb" }} onClick={onCreateSchedule}>Create</button>
              <button type="button" style={{ ...buttonStyle, backgroundColor: "#0f766e" }} onClick={onRunDueSchedules}>Run Due</button>
            </div>
          </div>
        </div>
        <div style={{ border: "1px solid #e2e8f0", borderRadius: "6px", overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={headerStyle}>Name</th>
                <th style={headerStyle}>Cadence</th>
                <th style={headerStyle}>Next Run</th>
                <th style={headerStyle}>Action</th>
              </tr>
            </thead>
            <tbody>
              {(reportSchedules || []).slice(0, 5).map((schedule) => (
                <tr key={schedule.id}>
                  <td style={cellStyle}>{schedule.name}</td>
                  <td style={cellStyle}>{schedule.reportType} / {schedule.cadence}</td>
                  <td style={cellStyle}>{schedule.nextRunAt ? new Date(schedule.nextRunAt).toLocaleString() : "-"}</td>
                  <td style={cellStyle}>
                    <button type="button" style={{ ...buttonStyle, backgroundColor: "#64748b", padding: "6px 9px" }} onClick={() => onRunSchedule(schedule.id)}>Run</button>
                  </td>
                </tr>
              ))}
              {(reportSchedules || []).length === 0 && (
                <tr><td style={cellStyle} colSpan="4">No scheduled reports.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: "14px", marginTop: "14px" }}>
        <div style={{ border: "1px solid #e2e8f0", borderRadius: "6px", padding: "12px" }}>
          <h3 style={{ margin: "0 0 8px", color: "#334155", fontSize: "15px" }}>Recent Exports</h3>
          {(reportExports || []).slice(0, 4).map((item) => (
            <div key={item.id} style={{ padding: "7px 0", borderTop: "1px solid #e2e8f0", color: "#334155", fontSize: "13px" }}>
              <strong>{item.reportType}</strong> {item.format} | {item.requestedBy || "system"} | {item.createdAt ? new Date(item.createdAt).toLocaleString() : "-"}
            </div>
          ))}
          {(reportExports || []).length === 0 && <div style={{ color: "#64748b", fontSize: "13px" }}>No exports yet.</div>}
        </div>
        <div style={{ border: "1px solid #e2e8f0", borderRadius: "6px", padding: "12px" }}>
          <h3 style={{ margin: "0 0 8px", color: "#334155", fontSize: "15px" }}>Schedule Runs</h3>
          {(reportRuns || []).slice(0, 4).map((item) => (
            <div key={item.id} style={{ padding: "7px 0", borderTop: "1px solid #e2e8f0", color: "#334155", fontSize: "13px" }}>
              <strong>{item.scheduleName}</strong> {item.status} | {item.createdAt ? new Date(item.createdAt).toLocaleString() : "-"}
            </div>
          ))}
          {(reportRuns || []).length === 0 && <div style={{ color: "#64748b", fontSize: "13px" }}>No scheduled runs yet.</div>}
        </div>
      </div>
    </section>
  );
}

function ReportHeatMap({ heatMap }) {
  if (!heatMap) return null;
  const zones = heatMap.zones || [];

  return (
    <section style={{ ...panelStyle, padding: "16px", marginBottom: "24px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: "12px", alignItems: "baseline", flexWrap: "wrap", marginBottom: "14px" }}>
        <div>
          <h2 style={{ margin: 0, color: "#2c5282" }}>Report Heat Map</h2>
          <p style={{ margin: "6px 0 0", color: "#64748b" }}>Zone intensity from filtered trend averages for the reporting period.</p>
        </div>
        <span style={{ color: "#64748b", fontSize: "13px" }}>
          {heatMap.scale?.min ?? 0} to {heatMap.scale?.max ?? 0}
        </span>
      </div>
      <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginBottom: "14px" }} aria-label="Temperature heat map legend">
        {[...temperatureHeatBands, noSamplesHeatBand].map((band) => (
          <span
            key={band.label}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "6px",
              border: "1px solid #e2e8f0",
              borderRadius: "999px",
              padding: "5px 9px",
              color: "#334155",
              fontSize: "12px",
              fontWeight: 700,
              background: "white",
            }}
            title={band.range}
          >
            <span style={{ width: "11px", height: "11px", borderRadius: "3px", background: band.color, display: "inline-block" }} />
            {band.label}
          </span>
        ))}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: "10px" }}>
        {zones.map((zone) => {
          const hasSamples = zone.sampleCount > 0;
          const heatBand = getTemperatureHeatBand(zone.intensity, hasSamples);
          return (
            <div
              key={zone.zoneId}
              title={`${zone.zonePath}: ${heatBand.label}, ${zone.averageValue ?? "no samples"}`}
              style={{
                minHeight: "86px",
                border: "1px solid #e2e8f0",
                borderRadius: "6px",
                padding: "10px",
                background: heatBand.color,
                color: heatBand.textColor,
                display: "flex",
                flexDirection: "column",
                justifyContent: "space-between",
              }}
            >
              <div>
                <strong style={{ display: "block", fontSize: "14px" }}>{zone.zonePath}</strong>
                <span style={{ fontSize: "12px", opacity: 0.8 }}>{zone.buildingName}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", gap: "8px", alignItems: "end" }}>
                <div>
                  <strong style={{ display: "block", fontSize: "20px" }}>{zone.averageValue ?? "-"}</strong>
                  <span style={{ fontSize: "12px", opacity: 0.85 }}>{heatBand.label}</span>
                </div>
                <span style={{ fontSize: "12px", opacity: 0.85 }}>{zone.sampleCount} samples</span>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function RealTimeMonitoringPanel({ telemetryConnected, alarmConnected, lastTelemetryAt, devices, alarms, telemetryFeed, trendLogs }) {
  const onlineDevices = devices.filter((device) => {
    const status = String(device.status || "").toLowerCase();
    return status.includes("normal") || status.includes("on") || status.includes("commissioned") || status.includes("provisioned");
  }).length;
  const activeAlarms = alarms.filter((alarm) => alarm.status !== "Cleared").length;
  const latestSamples = telemetryFeed.slice(0, 8);
  const statusPill = (connected) => ({
    display: "inline-block",
    padding: "5px 9px",
    borderRadius: "999px",
    backgroundColor: connected ? "#dcfce7" : "#fee2e2",
    color: connected ? "#166534" : "#991b1b",
    fontWeight: 700,
    fontSize: "12px",
  });

  return (
    <section style={{ ...panelStyle, padding: "16px", marginBottom: "28px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: "12px", alignItems: "flex-start", flexWrap: "wrap", marginBottom: "14px" }}>
        <div>
          <h2 style={{ margin: "0 0 6px", color: "#2c5282" }}>Real-Time Monitoring</h2>
          <p style={{ margin: 0, color: "#64748b" }}>SSE live telemetry, alarm stream, device state, and trend readiness.</p>
        </div>
        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
          <span className={telemetryConnected ? "bems-live-pill" : ""} style={statusPill(telemetryConnected)} {...tooltip("Server-Sent Events telemetry stream status")}>Telemetry {telemetryConnected ? "connected" : "offline"}</span>
          <span className={alarmConnected ? "bems-live-pill" : ""} style={statusPill(alarmConnected)} {...tooltip("Server-Sent Events alarm stream status")}>Alarms {alarmConnected ? "connected" : "offline"}</span>
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: "12px", marginBottom: "14px" }}>
        {[
          ["Online devices", onlineDevices],
          ["Active alarms", activeAlarms],
          ["Live samples", telemetryFeed.length],
          ["Trend records", trendLogs.length],
          ["Last update", lastTelemetryAt || "waiting"],
        ].map(([label, value]) => (
          <div key={label} style={{ border: "1px solid #e2e8f0", borderRadius: "6px", padding: "12px", background: "#f8fafc" }}>
            <div style={{ color: "#64748b", fontSize: "12px", textTransform: "uppercase" }}>{label}</div>
            <div style={{ color: "#0f172a", fontSize: "20px", fontWeight: 800, marginTop: "4px" }}>{value}</div>
          </div>
        ))}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "minmax(260px, 1fr) minmax(260px, 1fr)", gap: "14px" }}>
        <div>
          <h3 style={{ margin: "0 0 8px", color: "#334155" }}>Latest Point Updates</h3>
          <div style={{ maxHeight: "220px", overflowY: "auto", borderTop: "1px solid #e2e8f0" }}>
            {latestSamples.length === 0 ? (
              <div style={{ color: "#64748b", paddingTop: "10px" }}>Waiting for live BACnet/device samples.</div>
            ) : latestSamples.map((sample, index) => (
              <div key={`${sample.deviceId}-${sample.timestamp}-${index}`} style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: "10px", padding: "8px 0", borderBottom: "1px solid #edf2f7" }}>
                <span style={{ color: "#334155" }}>{sample.deviceName} <span style={{ color: "#64748b" }}>{sample.zoneName}</span></span>
                <strong style={{ color: "#0f172a" }}>{sample.value} {sample.units}</strong>
              </div>
            ))}
          </div>
        </div>
        <div>
          <h3 style={{ margin: "0 0 8px", color: "#334155" }}>Monitoring Path</h3>
          {["BACnet device values", "C++ edge core", "Node API SSE stream", "React dashboard graphics", "MySQL trend logs"].map((item) => (
            <div key={item} style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderTop: "1px solid #e2e8f0", color: "#334155" }}>
              <span>{item}</span>
              <strong style={{ color: "#16a34a" }}>active</strong>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function AiControlPanel({
  weatherPricing,
  smartGridAi,
  airflowGraph,
  simulation,
  controlStatus,
  onSimulate,
  onIterate,
  onStart,
  onStop,
  running,
}) {
  return (
    <section style={{ marginBottom: "28px" }}>
      <h2 style={{ marginBottom: "16px", color: "#2c5282" }}>AI Energy Optimization</h2>
      <div style={{ ...panelStyle, padding: "16px" }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: "12px", marginBottom: "16px" }}>
          <div><strong>{weatherPricing?.weather?.condition || "-"}</strong><div style={{ color: "#64748b" }}>Weather state</div></div>
          <div><strong>${weatherPricing?.pricing?.electricityPrice ?? "-"}/kWh</strong><div style={{ color: "#64748b" }}>Energy price</div></div>
          <div><strong>{weatherPricing?.pricing?.priceSignal || "-"}</strong><div style={{ color: "#64748b" }}>Price signal</div></div>
          <div><strong>{smartGridAi?.grid?.demandRisk || "-"}</strong><div style={{ color: "#64748b" }}>Grid demand risk</div></div>
          <div><strong>{smartGridAi?.grid?.reserveMarginKw ?? "-"} kW</strong><div style={{ color: "#64748b" }}>Grid headroom</div></div>
          <div><strong>{airflowGraph?.nodes?.length || 0}</strong><div style={{ color: "#64748b" }}>Airflow graph nodes</div></div>
          <div><strong>{controlStatus?.running ? "running" : "stopped"}</strong><div style={{ color: "#64748b" }}>Control loop</div></div>
        </div>
        <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", marginBottom: "16px" }}>
          <button onClick={onSimulate} disabled={running} style={{ ...buttonStyle, backgroundColor: "#2563eb" }}>{running ? "Working..." : "Simulate"}</button>
          <button onClick={() => onIterate(false)} disabled={running} style={{ ...buttonStyle, backgroundColor: "#0f766e" }}>Optimize Once</button>
          <button onClick={() => onIterate(true)} disabled={running} style={{ ...buttonStyle, backgroundColor: "#7c3aed" }}>Apply Once</button>
          <button onClick={onStart} disabled={running || controlStatus?.running} style={{ ...buttonStyle, backgroundColor: "#334155" }}>Start Loop</button>
          <button onClick={onStop} disabled={running || !controlStatus?.running} style={{ ...buttonStyle, backgroundColor: "#dc2626" }}>Stop Loop</button>
        </div>
        {simulation && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: "14px" }}>
            <div>
              <h3 style={{ margin: "0 0 10px", color: "#334155" }}>Predictive Simulation</h3>
              {simulation.timeline?.map((item) => (
                <div key={item.hour} style={{ padding: "8px 0", borderTop: "1px solid #e2e8f0", color: "#475569" }}>
                  Hour {item.hour}: {item.estimatedSavingsKwh} kWh saved, comfort risk {item.comfortRisk}
                </div>
              ))}
            </div>
            <div>
              <h3 style={{ margin: "0 0 10px", color: "#334155" }}>Airflow Model</h3>
              {(airflowGraph?.nodes || []).slice(0, 6).map((node) => (
                <div key={node.zoneId} style={{ padding: "8px 0", borderTop: "1px solid #e2e8f0", color: "#475569" }}>
                  {node.zoneName}: score {node.predictedAirflowScore}, flow bias {node.recommendedFlowBias}
                </div>
              ))}
            </div>
            <div>
              <h3 style={{ margin: "0 0 10px", color: "#334155" }}>Smart Grid AI</h3>
              <div style={{ padding: "8px 0", borderTop: "1px solid #e2e8f0", color: "#475569" }}>
                Signal {smartGridAi?.grid?.signal || "-"} | target reduction {smartGridAi?.grid?.targetReductionKw ?? "-"} kW
              </div>
              {(smartGridAi?.actions || []).map((action) => (
                <div key={action.system} style={{ padding: "8px 0", borderTop: "1px solid #e2e8f0", color: "#475569" }}>
                  {action.system}: {action.action} ({action.reductionKw} kW)
                </div>
              ))}
            </div>
            <div>
              <h3 style={{ margin: "0 0 10px", color: "#334155" }}>Fire / Security / HVAC</h3>
              {(smartGridAi?.integrations || []).slice(0, 5).map((item) => (
                <div key={item.system} style={{ padding: "8px 0", borderTop: "1px solid #e2e8f0", color: "#475569" }}>
                  <strong>{item.system}</strong>: {item.status}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

function ReinforcementLearningPanel({ policy, controlStatus }) {
  const lastResult = controlStatus?.lastResult;
  const components = [
    ["State", "current building condition", lastResult?.globalState ? `${lastResult.globalState.totals.zoneCount} zones / ${lastResult.globalState.totals.deviceCount} devices` : "waiting"],
    ["Action", "control decisions", lastResult?.actions ? `${lastResult.actions.length} actions` : "waiting"],
    ["Reward", "performance score", lastResult?.rewardSummary ? lastResult.rewardSummary.averageReward : "waiting"],
    ["Policy", "decision strategy", `${policy.length} persisted Q-values`],
  ];

  return (
    <section style={{ marginBottom: "28px" }}>
      <h2 style={{ marginBottom: "16px", color: "#2c5282" }}>Reinforcement Learning Model</h2>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "12px" }}>
        {components.map(([name, purpose, value]) => (
          <div key={name} style={{ ...panelStyle, padding: "14px" }}>
            <strong style={{ color: "#1f355e" }}>{name}</strong>
            <div style={{ color: "#64748b", marginTop: "6px" }}>{purpose}</div>
            <div style={{ color: "#334155", marginTop: "10px", fontWeight: 700 }}>{value}</div>
          </div>
        ))}
      </div>
    </section>
  );
}

function FloorplanEditor({ devices, alarms, layout, onLayoutChange, onSelectDevice, alarmColors }) {
  const [dragId, setDragId] = useState(null);
  const [mapSvg, setMapSvg] = useState(() => localStorage.getItem("bems.floorplanSvg") || "");
  const alarmByDeviceId = new Map((alarms || []).filter((alarm) => alarm.status !== "Cleared").map((alarm) => [Number(alarm.deviceId), alarm]));

  const uploadMap = (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result || "");
      const encoded = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(text)}`;
      setMapSvg(encoded);
      localStorage.setItem("bems.floorplanSvg", encoded);
    };
    reader.readAsText(file);
  };

  const updateDevicePosition = (event) => {
    if (!dragId) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const x = Math.max(4, Math.min(88, ((event.clientX - bounds.left) / bounds.width) * 100));
    const y = Math.max(8, Math.min(84, ((event.clientY - bounds.top) / bounds.height) * 100));
    onLayoutChange((previous) => ({
      ...previous,
      [dragId]: { ...(previous[dragId] || {}), x, y },
    }));
  };

  return (
    <div style={{ ...panelStyle, padding: "16px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: "12px", alignItems: "center", marginBottom: "12px" }}>
        <h2 style={{ margin: 0, color: "#2c5282" }}>Floorplan Editor</h2>
        <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", alignItems: "center" }}>
          <label style={{ ...buttonStyle, backgroundColor: "#2563eb", display: "inline-block" }} {...tooltip("Upload an SVG floor map for this operator browser")}>
            Upload SVG Map
            <input type="file" accept=".svg,image/svg+xml" onChange={uploadMap} style={{ display: "none" }} />
          </label>
          <button
            onClick={() => {
              localStorage.removeItem("bems.floorplan");
              localStorage.removeItem("bems.floorplanSvg");
              setMapSvg("");
            }}
            style={{ ...buttonStyle, backgroundColor: "#64748b" }}
            {...tooltip("Clear the saved SVG floor map and device overlay positions")}
          >
            Reset Saved Layout
          </button>
        </div>
      </div>
      <svg
        viewBox="0 0 100 64"
        style={{ width: "100%", height: "360px", border: "1px solid #cbd5e1", backgroundColor: "#f8fafc", cursor: dragId ? "grabbing" : "default" }}
        onPointerMove={updateDevicePosition}
        onPointerUp={() => setDragId(null)}
        onPointerLeave={() => setDragId(null)}
      >
        {mapSvg ? (
          <image href={mapSvg} x="0" y="0" width="100" height="64" preserveAspectRatio="xMidYMid meet" opacity="0.9" />
        ) : (
          <>
            <rect x="4" y="5" width="42" height="24" fill="#ffffff" stroke="#94a3b8" />
            <rect x="50" y="5" width="46" height="24" fill="#ffffff" stroke="#94a3b8" />
            <rect x="4" y="34" width="28" height="25" fill="#ffffff" stroke="#94a3b8" />
            <rect x="36" y="34" width="60" height="25" fill="#ffffff" stroke="#94a3b8" />
            <line x1="48" y1="5" x2="48" y2="59" stroke="#cbd5e1" strokeDasharray="2 2" />
          </>
        )}
        {devices.map((device, index) => {
          const saved = layout[device.id] || {};
          const x = saved.x ?? 12 + (index % 5) * 16;
          const y = saved.y ?? 14 + Math.floor(index / 5) * 18;
          const alarm = alarmByDeviceId.get(Number(device.id));
          const hasAlarm = !!alarm;
          const alarmColor = getAlarmColor(alarm, alarmColors);
          const fill = hasAlarm ? alarmColor : device.status === "Normal" || device.status === "normal" ? "#16a34a" : "#f59e0b";
          return (
            <g
              key={device.id}
              className={hasAlarm ? "bems-alarm-point" : ""}
              onPointerDown={() => setDragId(device.id)}
              onClick={() => onSelectDevice(device)}
              style={{ cursor: "grab" }}
            >
              <title>{hasAlarm ? `${device.name}: ${alarm.severity} alarm - ${alarm.message}` : `${device.name}: drag to position, click for details`}</title>
              {hasAlarm && <circle cx={x} cy={y} r="6.5" fill="none" stroke={alarmColor} strokeWidth="1.2" />}
              <circle cx={x} cy={y} r="3.8" fill={fill} stroke="#ffffff" strokeWidth="1" />
              <text x={x + 5} y={y + 1.5} fontSize="3.2" fill="#1e293b">{device.name}</text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function DigitalTwinView({ twin, onSelectDevice }) {
  if (!twin?.buildings?.length) return null;
  const building = twin.buildings[0];

  return (
    <div style={{ ...panelStyle, padding: "16px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: "12px", alignItems: "baseline", marginBottom: "12px" }}>
        <h2 style={{ margin: 0, color: "#2c5282" }}>Digital Twin</h2>
        <span style={{ color: "#64748b", fontSize: "13px" }}>{twin.appliance?.role}</span>
      </div>
      <svg viewBox="0 0 100 70" role="img" style={{ width: "100%", height: "360px", border: "1px solid #cbd5e1", backgroundColor: "#f8fafc" }}>
        <rect x="2" y="3" width="96" height="64" fill="#ffffff" stroke="#94a3b8" />
        <text x="5" y="9" fontSize="4" fill="#334155">{building.name}</text>
        {getBuildingZones(building).map((zone) => (
          <g key={zone.id}>
            <rect x={zone.geometry.x} y={zone.geometry.y} width={zone.geometry.width} height={zone.geometry.height} fill="#eef6ff" stroke="#93c5fd" rx="1" />
            <text x={zone.geometry.x + 2} y={zone.geometry.y + 5} fontSize="3.2" fill="#1e3a8a">{formatZonePath(zone)}</text>
            <text x={zone.geometry.x + 2} y={zone.geometry.y + 9} fontSize="2.5" fill="#475569">{zone.name}</text>
            {zone.devices.map((device) => {
              const fill = device.status === "Normal" || device.status === "normal" ? "#16a34a" : "#dc2626";
              return (
                <g key={device.id} onClick={() => onSelectDevice({ ...device, buildingName: building.name, floorName: zone.floorName, roomName: zone.roomName, zoneName: formatZonePath(zone), controlZoneName: zone.name })} style={{ cursor: "pointer" }}>
                  <circle cx={device.coordinates.x} cy={device.coordinates.y} r="3" fill={fill} stroke="#ffffff" strokeWidth="1" />
                  <title>{`${device.name}: ${device.value ?? "-"} ${device.units || ""}`}</title>
                </g>
              );
            })}
          </g>
        ))}
      </svg>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: "10px", marginTop: "12px", color: "#334155" }}>
        <div><strong>{twin.summary.deviceCount}</strong><div style={{ color: "#64748b" }}>devices</div></div>
        <div><strong>{twin.summary.zoneCount}</strong><div style={{ color: "#64748b" }}>zones</div></div>
        <div><strong>{twin.summary.statusCounts.normal}</strong><div style={{ color: "#64748b" }}>normal</div></div>
      </div>
    </div>
  );
}

function ZoneDeviceBrowser({ hierarchy, selectedZoneId, onSelectZone, onSelectDevice }) {
  const zones = flattenZones(hierarchy);
  const selectedZone = zones.find((zone) => zone.id === selectedZoneId) || zones[0];

  if (zones.length === 0) {
    return null;
  }

  return (
    <section style={{ marginBottom: "28px" }}>
      <h2 style={{ marginBottom: "16px", color: "#2c5282" }}>Zone Devices</h2>
      <div style={{ display: "grid", gridTemplateColumns: "minmax(220px, 0.8fr) minmax(320px, 1.6fr)", gap: "16px" }}>
        <div style={{ ...panelStyle, padding: "12px" }}>
          {zones.map((zone) => (
            <button
              key={zone.id}
              onClick={() => onSelectZone(zone.id)}
              style={{
                width: "100%",
                display: "block",
                textAlign: "left",
                padding: "12px",
                marginBottom: "8px",
                border: "1px solid #dbe4ef",
                borderRadius: "6px",
                backgroundColor: selectedZone?.id === zone.id ? "#eef4fb" : "white",
                color: "#1f355e",
                cursor: "pointer",
              }}
            >
              <strong>{formatZonePath(zone)}</strong>
              <div style={{ color: "#64748b", fontSize: "13px", marginTop: "4px" }}>{zone.buildingName} | control zone {zone.name} | {zone.devices.length} devices</div>
            </button>
          ))}
        </div>
        <div style={{ ...panelStyle, overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: "760px" }}>
            <thead>
              <tr>
                <th style={headerStyle}>Device</th>
                <th style={headerStyle}>Type</th>
                <th style={headerStyle}>BACnet</th>
                <th style={headerStyle}>Value</th>
                <th style={headerStyle}>Status</th>
                <th style={headerStyle}>Details</th>
              </tr>
            </thead>
            <tbody>
              {(selectedZone?.devices || []).map((device) => (
                <tr key={device.id}>
                  <td style={cellStyle}>{device.name}</td>
                  <td style={cellStyle}>{device.type}</td>
                  <td style={cellStyle}>{device.bacnetInstance}:{device.objectType}:{device.objectInstance}</td>
                  <td style={cellStyle}>{device.value ?? "-"} {device.units || ""}</td>
                  <td style={cellStyle}>{device.status}</td>
                  <td style={cellStyle}>
                    <button onClick={() => onSelectDevice(device)} style={{ ...buttonStyle, backgroundColor: "#2563eb" }}>Open</button>
                  </td>
                </tr>
              ))}
              {(!selectedZone || selectedZone.devices.length === 0) && (
                <tr><td colSpan={6} style={{ ...cellStyle, textAlign: "center" }}>No devices in this zone.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

function DeviceDetailsPanel({ device, findings, tickets, onClose, onConfigure, onCreateTicket, onToggleMaintenance }) {
  if (!device) return null;
  const deviceFindings = findings.filter((finding) => finding.deviceId === device.id);
  const deviceTickets = tickets.filter((ticket) => ticket.deviceId === device.id);
  const eepromStorage = eepromStorageSummary(device.configuration || {});
  const details = [
    ["Building", device.buildingName || "-"],
    ["Zone", device.zonePath || device.zoneName || "-"],
    ["Control Zone", device.controlZoneName || device.zoneName || "-"],
    ["Type", device.type || "-"],
    ["Vendor", device.vendor || "-"],
    ["Model", device.model || "-"],
    ["IP Address", device.ipAddress || "-"],
    ["BACnet Instance", device.bacnetInstance ?? "-"],
    ["Object", `${device.objectType || "-"}:${device.objectInstance ?? "-"}`],
    ["Present Value", `${device.value ?? "-"} ${device.units || ""}`.trim()],
    ["Battery", formatBatteryPercent(device.configuration || {})],
    ["Setpoint", formatSetpoint(device)],
    ["Range", formatRange(device)],
    ["Status", device.status || "-"],
    ["Maintenance Mode", device.maintenanceMode ? "Enabled" : "Disabled"],
    ["Provisioned", device.provisioned ? "Yes" : "No"],
    ["Commissioned", device.commissioned ? "Yes" : "No"],
  ];

  return (
    <section style={{ marginBottom: "28px", padding: "18px", ...panelStyle }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "12px", marginBottom: "16px" }}>
        <div>
          <h2 style={{ margin: 0, color: "#1f355e" }}>Device Details</h2>
          <div style={{ color: "#64748b", marginTop: "4px" }}>{device.name}</div>
        </div>
        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
          <button onClick={() => onConfigure(device)} style={{ ...buttonStyle, backgroundColor: "#0f766e" }}>Configure</button>
          <button onClick={() => onCreateTicket(device)} style={{ ...buttonStyle, backgroundColor: "#7c3aed" }}>Ticket</button>
          <button onClick={() => onToggleMaintenance(device)} style={{ ...buttonStyle, backgroundColor: device.maintenanceMode ? "#dc2626" : "#f59e0b" }}>
            {device.maintenanceMode ? "Exit Maintenance" : "Maintenance Mode"}
          </button>
          <button onClick={onClose} style={{ ...buttonStyle, backgroundColor: "#64748b" }}>Close</button>
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: "12px", marginBottom: "16px" }}>
        {details.map(([label, value]) => (
          <div key={label} style={{ border: "1px solid #e2e8f0", borderRadius: "6px", padding: "10px" }}>
            <div style={{ color: "#64748b", fontSize: "12px" }}>{label}</div>
            <strong style={{ color: "#334155" }}>{value}</strong>
          </div>
        ))}
      </div>
      {device.description && <div style={{ color: "#475569", marginBottom: "16px" }}>{device.description}</div>}
      {eepromStorage && (
        <div style={{ border: "1px solid #bfdbfe", borderRadius: "6px", padding: "12px", background: "#eff6ff", marginBottom: "16px" }}>
          <strong style={{ color: "#1e3a8a" }}>Device Persistent Storage and Setpoint Retention</strong>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: "10px", marginTop: "10px" }}>
            {[
              ["Enabled", eepromStorage.enabled ? "Yes" : "No"],
              ["Medium", eepromStorage.medium],
              ["Namespace", eepromStorage.namespace],
              ["Address", eepromStorage.address],
              ["Size", `${eepromStorage.sizeBytes} bytes`],
              ["Write Policy", eepromStorage.writePolicy],
              ["Retained Setpoint", eepromStorage.retainedSetpoint],
              ["Device Schedules", eepromStorage.scheduleStorage?.enabled === false ? "Disabled" : "Persistent on BACnet device"],
              ["Schedule Count", eepromStorage.scheduleStorage?.scheduleCount ?? (eepromStorage.scheduleStorage?.schedules || []).length ?? 0],
              ["Schedule Write Path", eepromStorage.scheduleStorage?.writePath || "BACnet Schedule object"],
              ["Wear Leveling", eepromStorage.wearLeveling ? "Yes" : "No"],
              ["Checksum", eepromStorage.checksum],
              ["Retained Keys", eepromStorage.retainedKeys.join(", ")],
            ].map(([label, value]) => (
              <div key={label}>
                <div style={{ color: "#64748b", fontSize: "12px" }}>{label}</div>
                <strong style={{ color: "#334155" }}>{value}</strong>
              </div>
            ))}
          </div>
        </div>
      )}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: "14px" }}>
        <div>
          <h3 style={{ margin: "0 0 10px", color: "#334155" }}>FDD Findings</h3>
          {deviceFindings.length === 0 ? <div style={{ color: "#64748b" }}>No findings for this device.</div> : deviceFindings.map((finding) => (
            <div key={finding.id} style={{ borderTop: "1px solid #e2e8f0", padding: "10px 0" }}>
              <strong>{finding.severity} | {finding.faultCode}</strong>
              <div style={{ color: "#64748b", marginTop: "4px" }}>{finding.message}</div>
            </div>
          ))}
        </div>
        <div>
          <h3 style={{ margin: "0 0 10px", color: "#334155" }}>Maintenance</h3>
          {deviceTickets.length === 0 ? <div style={{ color: "#64748b" }}>No tickets for this device.</div> : deviceTickets.map((ticket) => (
            <div key={ticket.id} style={{ borderTop: "1px solid #e2e8f0", padding: "10px 0" }}>
              <strong>{ticket.title}</strong>
              <div style={{ color: "#64748b", marginTop: "4px" }}>{ticket.priority} | {ticket.status}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function DeviceProvisioningPanel({
  zones,
  discoveryForm,
  setDiscoveryForm,
  discoveryResult,
  provisioningForm,
  setProvisioningForm,
  onDiscover,
  onSelectDiscovered,
  onProvision,
  discovering,
  provisioning,
}) {
  const objectTypes = [
    ["analogInput", "Analog Input"],
    ["analogOutput", "Analog Output"],
    ["analogValue", "Analog Value"],
    ["binaryInput", "Binary Input"],
    ["binaryOutput", "Binary Output"],
    ["binaryValue", "Binary Value"],
  ];

  const useSimulatorRange = () => {
    setDiscoveryForm({ lowInstance: "101", highInstance: "302" });
  };

  return (
    <section style={{ marginBottom: "28px" }}>
      <h2 style={{ marginBottom: "16px", color: "#2c5282" }}>BACnet Discovery UI</h2>
      <div style={{ display: "grid", gridTemplateColumns: "minmax(300px, 0.9fr) minmax(340px, 1.4fr)", gap: "16px" }}>
        <div style={{ ...panelStyle, padding: "16px" }}>
          <h3 style={{ marginTop: 0, color: "#334155" }}>Auto-Learn Devices (Who-Is / I-Am)</h3>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px", marginBottom: "12px" }}>
            <label style={{ color: "#334155" }}>
              Low Instance
              <input value={discoveryForm.lowInstance} onChange={(event) => setDiscoveryForm((prev) => ({ ...prev, lowInstance: event.target.value }))} style={{ ...inputStyle, marginTop: "6px" }} />
            </label>
            <label style={{ color: "#334155" }}>
              High Instance
              <input value={discoveryForm.highInstance} onChange={(event) => setDiscoveryForm((prev) => ({ ...prev, highInstance: event.target.value }))} style={{ ...inputStyle, marginTop: "6px" }} />
            </label>
          </div>
          <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", marginBottom: "12px" }}>
            <button onClick={onDiscover} disabled={discovering} style={{ ...buttonStyle, backgroundColor: "#2563eb" }}>
              {discovering ? "Auto-learning..." : "Auto-Learn Devices"}
            </button>
            <button onClick={useSimulatorRange} disabled={discovering} style={{ ...buttonStyle, backgroundColor: "#475569" }}>
              Sim Range
            </button>
          </div>
          {discoveryResult && (
            <div style={{ color: "#475569", fontSize: "13px", marginBottom: "12px" }}>
              {discoveryResult.source || "unknown"} | {(discoveryResult.devices || []).length} devices
              {discoveryResult.message ? ` | ${discoveryResult.message}` : ""}
              {discoveryResult.edgeError ? ` | ${discoveryResult.edgeError}` : ""}
            </div>
          )}
          <div style={{ maxHeight: "320px", overflow: "auto", borderTop: "1px solid #e2e8f0" }}>
            {(discoveryResult?.devices || []).length === 0 ? (
              <div style={{ color: "#64748b", paddingTop: "12px" }}>No discovered devices yet.</div>
            ) : discoveryResult.devices.map((device, index) => (
              <button
                key={`${device.bacnetInstance || device.bacnet_instance || index}-${index}`}
                onClick={() => onSelectDiscovered(device)}
                style={{
                  display: "block",
                  width: "100%",
                  textAlign: "left",
                  padding: "10px 0",
                  border: "none",
                  borderBottom: "1px solid #e2e8f0",
                  backgroundColor: "transparent",
                  color: "#334155",
                  cursor: "pointer",
                }}
              >
                <strong>{device.name || `BACnet ${device.bacnetInstance || device.bacnet_instance || "-"}`}</strong>
                <div style={{ color: "#64748b", fontSize: "13px", marginTop: "4px" }}>
                  Instance {device.bacnetInstance || device.bacnet_instance || "-"} | {device.objectType || device.object_type || "object"} | {device.ipAddress || device.ip_address || "no ip"}
                </div>
              </button>
            ))}
          </div>
        </div>

        <div style={{ ...panelStyle, padding: "16px" }}>
          <h3 style={{ marginTop: 0, color: "#334155" }}>Provision Device</h3>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: "12px" }}>
            <label style={{ color: "#334155" }}>
              Zone
              <select value={provisioningForm.zoneId} onChange={(event) => setProvisioningForm((prev) => ({ ...prev, zoneId: event.target.value }))} style={{ ...inputStyle, marginTop: "6px", backgroundColor: "white" }}>
                <option value="">Select zone</option>
                {zones.map((zone) => (
                  <option key={zone.id} value={zone.id}>
                    {[zone.buildingName, formatZonePath(zone)].filter(Boolean).join(" / ")}
                  </option>
                ))}
              </select>
            </label>
            <label style={{ color: "#334155" }}>
              Name
              <input value={provisioningForm.name} onChange={(event) => setProvisioningForm((prev) => ({ ...prev, name: event.target.value }))} style={{ ...inputStyle, marginTop: "6px" }} />
            </label>
            <label style={{ color: "#334155" }}>
              Type
              <input value={provisioningForm.type} onChange={(event) => setProvisioningForm((prev) => ({ ...prev, type: event.target.value }))} style={{ ...inputStyle, marginTop: "6px" }} />
            </label>
            <label style={{ color: "#334155" }}>
              Object Type
              <select value={provisioningForm.objectType} onChange={(event) => setProvisioningForm((prev) => ({ ...prev, objectType: event.target.value }))} style={{ ...inputStyle, marginTop: "6px", backgroundColor: "white" }}>
                {objectTypes.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </label>
            <label style={{ color: "#334155" }}>
              BACnet Instance
              <input value={provisioningForm.bacnetInstance} onChange={(event) => setProvisioningForm((prev) => ({ ...prev, bacnetInstance: event.target.value }))} style={{ ...inputStyle, marginTop: "6px" }} />
            </label>
            <label style={{ color: "#334155" }}>
              Object Instance
              <input value={provisioningForm.objectInstance} onChange={(event) => setProvisioningForm((prev) => ({ ...prev, objectInstance: event.target.value }))} style={{ ...inputStyle, marginTop: "6px" }} />
            </label>
            <label style={{ color: "#334155" }}>
              Vendor
              <input value={provisioningForm.vendor} onChange={(event) => setProvisioningForm((prev) => ({ ...prev, vendor: event.target.value }))} style={{ ...inputStyle, marginTop: "6px" }} />
            </label>
            <label style={{ color: "#334155" }}>
              Model
              <input value={provisioningForm.model} onChange={(event) => setProvisioningForm((prev) => ({ ...prev, model: event.target.value }))} style={{ ...inputStyle, marginTop: "6px" }} />
            </label>
            <label style={{ color: "#334155" }}>
              IP Address
              <input value={provisioningForm.ipAddress} onChange={(event) => setProvisioningForm((prev) => ({ ...prev, ipAddress: event.target.value }))} style={{ ...inputStyle, marginTop: "6px" }} />
            </label>
            <label style={{ color: "#334155" }}>
              Units
              <input value={provisioningForm.units} onChange={(event) => setProvisioningForm((prev) => ({ ...prev, units: event.target.value }))} style={{ ...inputStyle, marginTop: "6px" }} />
            </label>
            <label style={{ color: "#334155" }}>
              Battery %
              <input type="number" min="0" max="100" value={provisioningForm.batteryPercent} onChange={(event) => setProvisioningForm((prev) => ({ ...prev, batteryPercent: event.target.value }))} style={{ ...inputStyle, marginTop: "6px" }} />
            </label>
            <label style={{ color: "#334155" }}>
              Setpoint
              <input value={provisioningForm.setpoint} onChange={(event) => setProvisioningForm((prev) => ({ ...prev, setpoint: event.target.value }))} style={{ ...inputStyle, marginTop: "6px" }} />
            </label>
            <label style={{ color: "#334155" }}>
              Range
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px", marginTop: "6px" }}>
                <input placeholder="Min" value={provisioningForm.minSetpoint} onChange={(event) => setProvisioningForm((prev) => ({ ...prev, minSetpoint: event.target.value }))} style={inputStyle} />
                <input placeholder="Max" value={provisioningForm.maxSetpoint} onChange={(event) => setProvisioningForm((prev) => ({ ...prev, maxSetpoint: event.target.value }))} style={inputStyle} />
              </div>
            </label>
            <label style={{ color: "#334155" }}>
              EEPROM Address
              <input value={provisioningForm.eepromAddress} onChange={(event) => setProvisioningForm((prev) => ({ ...prev, eepromAddress: event.target.value }))} placeholder="0x0000" style={{ ...inputStyle, marginTop: "6px" }} />
            </label>
            <label style={{ color: "#334155" }}>
              EEPROM Size
              <input value={provisioningForm.eepromSizeBytes} onChange={(event) => setProvisioningForm((prev) => ({ ...prev, eepromSizeBytes: event.target.value }))} placeholder="256" style={{ ...inputStyle, marginTop: "6px" }} />
            </label>
            <label style={{ color: "#334155" }}>
              Setpoint Storage
              <select value={provisioningForm.eepromWritePolicy} onChange={(event) => setProvisioningForm((prev) => ({ ...prev, eepromWritePolicy: event.target.value }))} style={{ ...inputStyle, marginTop: "6px", backgroundColor: "white" }}>
                <option value="on_change">EEPROM on change</option>
                <option value="on_schedule">EEPROM on schedule</option>
                <option value="manual">Manual save</option>
                <option value="disabled">Disabled</option>
              </select>
            </label>
            <label style={{ color: "#334155" }}>
              Persistent Medium
              <select value={provisioningForm.persistentStorageMedium} onChange={(event) => setProvisioningForm((prev) => ({ ...prev, persistentStorageMedium: event.target.value }))} style={{ ...inputStyle, marginTop: "6px", backgroundColor: "white" }}>
                <option value="EEPROM">EEPROM</option>
                <option value="Flash NVS">Flash NVS</option>
                <option value="FRAM">FRAM</option>
                <option value="Filesystem">Filesystem</option>
              </select>
            </label>
            <label style={{ color: "#334155" }}>
              Storage Namespace
              <input value={provisioningForm.persistentStorageNamespace} onChange={(event) => setProvisioningForm((prev) => ({ ...prev, persistentStorageNamespace: event.target.value }))} placeholder="device_config" style={{ ...inputStyle, marginTop: "6px" }} />
            </label>
          </div>
          <label style={{ color: "#334155", display: "block", marginTop: "12px" }}>
            Description
            <input value={provisioningForm.description} onChange={(event) => setProvisioningForm((prev) => ({ ...prev, description: event.target.value }))} style={{ ...inputStyle, marginTop: "6px" }} />
          </label>
          <button onClick={onProvision} disabled={provisioning} style={{ ...buttonStyle, backgroundColor: "#0f766e", marginTop: "14px" }}>
            {provisioning ? "Provisioning..." : "Provision Device"}
          </button>
        </div>
      </div>
    </section>
  );
}

function LoginPage({ loginForm, setLoginForm, onLogin, loginError, loggingIn, loginContext, darkMode, onToggleDarkMode }) {
  const sites = (loginContext?.sites || []).filter((site) => String(site.organizationId) === String(loginForm.organizationId || ""));
  const buildings = loginContext?.buildings || [];

  return (
    <div className={`bems-shell ${darkMode ? "bems-dark" : ""}`} style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: "24px", fontFamily: "Inter, system-ui, sans-serif" }}>
      <GlobalUiStyles />
      <main style={{ ...panelStyle, width: "100%", maxWidth: "520px", padding: "24px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: "12px", alignItems: "flex-start", marginBottom: "22px" }}>
          <div>
            <h1 style={{ margin: "0 0 6px", color: "#1f355e" }}>Building Login</h1>
            <p style={{ margin: 0, color: "#64748b" }}>Select the building context for this operator session.</p>
          </div>
          <button
            onClick={onToggleDarkMode}
            style={{ ...buttonStyle, backgroundColor: darkMode ? "#0f766e" : "#1f2937", whiteSpace: "nowrap" }}
            {...tooltip("Toggle login dark mode")}
          >
            {darkMode ? "Light" : "Dark"}
          </button>
        </div>
        {loginError && <div style={{ padding: "12px", marginBottom: "16px", borderRadius: "6px", backgroundColor: "#fff1f0", color: "#b91c1c" }}>{loginError}</div>}
        <div style={{ display: "grid", gap: "14px" }}>
          <label style={{ color: "#334155" }}>
            Organization
            <select value={loginForm.organizationId} onChange={(event) => setLoginForm((prev) => ({ ...prev, organizationId: event.target.value, siteId: "" }))} style={{ ...inputStyle, marginTop: "6px", backgroundColor: "white" }}>
              {(loginContext?.organizations || []).map((org) => <option key={org.id} value={org.id}>{org.name}</option>)}
            </select>
          </label>
          <label style={{ color: "#334155" }}>
            Site
            <select value={loginForm.siteId} onChange={(event) => setLoginForm((prev) => ({ ...prev, siteId: event.target.value }))} style={{ ...inputStyle, marginTop: "6px", backgroundColor: "white" }}>
              <option value="">All sites</option>
              {sites.map((site) => <option key={site.id} value={site.id}>{site.name} ({site.timezone})</option>)}
            </select>
          </label>
          <label style={{ color: "#334155" }}>
            Building
            <select value={loginForm.buildingId} onChange={(event) => setLoginForm((prev) => ({ ...prev, buildingId: event.target.value }))} style={{ ...inputStyle, marginTop: "6px", backgroundColor: "white" }}>
              <option value="">All buildings</option>
              {buildings.map((building) => (
                <option key={building.id} value={building.id}>
                  {building.name} ({building.floorCount || 0} floors, {building.roomCount || 0} rooms, {building.zoneCount} zones)
                </option>
              ))}
            </select>
          </label>
          <label style={{ color: "#334155" }}>
            Username
            <input value={loginForm.username} onChange={(event) => setLoginForm((prev) => ({ ...prev, username: event.target.value }))} style={{ ...inputStyle, marginTop: "6px" }} />
          </label>
          <label style={{ color: "#334155" }}>
            Password
            <input type="password" value={loginForm.password} onChange={(event) => setLoginForm((prev) => ({ ...prev, password: event.target.value }))} style={{ ...inputStyle, marginTop: "6px" }} />
          </label>
          <button onClick={onLogin} disabled={loggingIn} style={{ ...buttonStyle, backgroundColor: "#2563eb", height: "42px" }}>
            {loggingIn ? "Signing in..." : "Sign In"}
          </button>
        </div>
      </main>
    </div>
  );
}

function AdminPage({
  summary,
  onRefresh,
  userForm,
  setUserForm,
  onCreateUser,
  roleForm,
  setRoleForm,
  onCreateRole,
  onUpdateUserRole,
  onToggleUserActive,
  onResetUserPassword,
  onDeleteUser,
  onToggleFeature,
}) {
  const [passwordEdits, setPasswordEdits] = useState({});

  if (!summary) {
    return (
      <section style={{ ...panelStyle, padding: "16px" }}>
        <button onClick={onRefresh} style={{ ...buttonStyle, backgroundColor: "#2563eb" }}>Load Admin</button>
      </section>
    );
  }

  const selectedOrganizationId = userForm.organizationId || String(summary.organizations?.[0]?.id || "");
  const availableSites = (summary.sites || []).filter((site) => String(site.organizationId) === String(selectedOrganizationId));

  return (
    <section style={{ display: "grid", gap: "20px" }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: "14px" }}>
        {[
          ["Buildings", summary.counts?.buildings ?? 0],
          ["Floors", summary.counts?.floors ?? 0],
          ["Rooms", summary.counts?.rooms ?? 0],
          ["Zones", summary.counts?.zones ?? 0],
          ["Devices", summary.counts?.devices ?? 0],
          ["Active Alarms", summary.counts?.activeAlarms ?? 0],
          ["Active Schedules", summary.counts?.activeSchedules ?? 0],
        ].map(([label, value]) => (
          <div key={label} style={{ ...panelStyle, padding: "16px" }}>
            <div style={{ color: "#64748b", fontSize: "13px" }}>{label}</div>
            <strong style={{ color: "#1f355e", fontSize: "24px" }}>{value}</strong>
          </div>
        ))}
      </div>

      <div style={{ ...panelStyle, padding: "16px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: "12px", flexWrap: "wrap", marginBottom: "14px" }}>
          <h2 style={{ margin: 0, color: "#2c5282" }}>SaaS Administration</h2>
          <button onClick={onRefresh} style={{ ...buttonStyle, backgroundColor: "#2563eb" }}>Refresh</button>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: "16px" }}>
          <div>
            <h3 style={{ color: "#334155" }}>Organizations</h3>
            {summary.organizations.map((org) => <div key={org.id} style={{ padding: "10px 0", borderBottom: "1px solid #e2e8f0" }}><strong>{org.name}</strong><div style={{ color: "#64748b" }}>{org.slug} | {org.plan} | {org.status}</div></div>)}
          </div>
          <div>
            <h3 style={{ color: "#334155" }}>Sites</h3>
            {summary.sites.map((site) => <div key={site.id} style={{ padding: "10px 0", borderBottom: "1px solid #e2e8f0" }}><strong>{site.name}</strong><div style={{ color: "#64748b" }}>{site.timezone} | {site.edgeGatewayId || "no gateway"}</div></div>)}
          </div>
          <div>
            <h3 style={{ color: "#334155" }}>Users / Roles</h3>
            {summary.roles.map((role) => <div key={role.id} style={{ padding: "8px 0", color: "#334155" }}><strong>{role.name}</strong><div style={{ color: "#64748b" }}>{role.description}</div></div>)}
            {summary.users.length === 0 && <div style={{ color: "#64748b" }}>No named users yet.</div>}
          </div>
        </div>
      </div>

      <div style={{ ...panelStyle, padding: "16px" }}>
        <h2 style={{ marginTop: 0, color: "#2c5282" }}>Configurable Features</h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: "12px" }}>
          {(summary.features || []).map((feature) => (
            <label key={feature.featureKey} style={{ border: "1px solid #e2e8f0", borderRadius: "6px", padding: "12px", color: "#334155", display: "grid", gap: "8px" }}>
              <span style={{ display: "flex", justifyContent: "space-between", gap: "10px", alignItems: "center" }}>
                <strong>{feature.label}</strong>
                <input type="checkbox" checked={!!feature.enabled} onChange={(event) => onToggleFeature(feature.featureKey, event.target.checked)} />
              </span>
              <span style={{ color: "#64748b", fontSize: "13px" }}>{feature.description}</span>
            </label>
          ))}
        </div>
      </div>

      <div style={{ ...panelStyle, padding: "16px" }}>
        <h2 style={{ marginTop: 0, color: "#2c5282" }}>User Roles</h2>
        <div style={{ display: "grid", gridTemplateColumns: "minmax(180px, 1fr) minmax(220px, 1.4fr)", gap: "12px", marginBottom: "14px" }}>
          <label style={{ color: "#334155" }}>
            Role name
            <input value={roleForm.name} onChange={(event) => setRoleForm((prev) => ({ ...prev, name: event.target.value }))} style={{ ...inputStyle, marginTop: "6px" }} />
          </label>
          <label style={{ color: "#334155" }}>
            Description
            <input value={roleForm.description} onChange={(event) => setRoleForm((prev) => ({ ...prev, description: event.target.value }))} style={{ ...inputStyle, marginTop: "6px" }} />
          </label>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: "8px", marginBottom: "14px" }}>
          {(summary.availablePermissions || []).map((permission) => (
            <label key={permission} style={{ display: "flex", gap: "8px", alignItems: "center", color: "#334155" }}>
              <input
                type="checkbox"
                checked={roleForm.permissions.includes(permission)}
                onChange={(event) => setRoleForm((prev) => ({
                  ...prev,
                  permissions: event.target.checked
                    ? [...prev.permissions, permission]
                    : prev.permissions.filter((item) => item !== permission),
                }))}
              />
              {permission}
            </label>
          ))}
        </div>
        <button onClick={onCreateRole} style={{ ...buttonStyle, backgroundColor: "#0f766e", marginBottom: "14px" }}>Create Role</button>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: "780px" }}>
            <thead><tr><th style={headerStyle}>Role</th><th style={headerStyle}>Description</th><th style={headerStyle}>Permissions</th></tr></thead>
            <tbody>
              {summary.roles.map((role) => (
                <tr key={role.id}><td style={cellStyle}>{role.name}</td><td style={cellStyle}>{role.description || "-"}</td><td style={cellStyle}>{(role.permissions || []).join(", ")}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div style={{ ...panelStyle, padding: "16px" }}>
        <h2 style={{ marginTop: 0, color: "#2c5282" }}>User Maintenance</h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "12px", alignItems: "end", marginBottom: "14px" }}>
          <label style={{ color: "#334155" }}>
            Username
            <input value={userForm.username} onChange={(event) => setUserForm((prev) => ({ ...prev, username: event.target.value }))} style={{ ...inputStyle, marginTop: "6px" }} />
          </label>
          <label style={{ color: "#334155" }}>
            Email
            <input value={userForm.email} onChange={(event) => setUserForm((prev) => ({ ...prev, email: event.target.value }))} style={{ ...inputStyle, marginTop: "6px" }} />
          </label>
          <label style={{ color: "#334155" }}>
            Role
            <select value={userForm.roleId} onChange={(event) => setUserForm((prev) => ({ ...prev, roleId: event.target.value }))} style={{ ...inputStyle, marginTop: "6px", backgroundColor: "white" }}>
              {summary.roles.map((role) => <option key={role.id} value={role.id}>{role.name}</option>)}
            </select>
          </label>
          <label style={{ color: "#334155" }}>
            Organization
            <select
              value={selectedOrganizationId}
              onChange={(event) => setUserForm((prev) => ({ ...prev, organizationId: event.target.value, siteId: "" }))}
              style={{ ...inputStyle, marginTop: "6px", backgroundColor: "white" }}
            >
              {summary.organizations.map((organization) => <option key={organization.id} value={organization.id}>{organization.name}</option>)}
            </select>
          </label>
          <label style={{ color: "#334155" }}>
            Site
            <select value={userForm.siteId || ""} onChange={(event) => setUserForm((prev) => ({ ...prev, siteId: event.target.value }))} style={{ ...inputStyle, marginTop: "6px", backgroundColor: "white" }}>
              <option value="">All sites</option>
              {availableSites.map((site) => <option key={site.id} value={site.id}>{site.name}</option>)}
            </select>
          </label>
          <label style={{ color: "#334155" }}>
            Password
            <input type="password" value={userForm.password} onChange={(event) => setUserForm((prev) => ({ ...prev, password: event.target.value }))} style={{ ...inputStyle, marginTop: "6px" }} />
          </label>
          <label style={{ color: "#334155", display: "flex", gap: "8px", alignItems: "center", paddingBottom: "9px" }}>
            <input type="checkbox" checked={userForm.active !== false} onChange={(event) => setUserForm((prev) => ({ ...prev, active: event.target.checked }))} />
            Active
          </label>
          <button onClick={onCreateUser} style={{ ...buttonStyle, backgroundColor: "#2563eb", height: "40px" }}>Create User</button>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: "1080px" }}>
            <thead><tr><th style={headerStyle}>Username</th><th style={headerStyle}>Email</th><th style={headerStyle}>Org / Site</th><th style={headerStyle}>Role</th><th style={headerStyle}>Active</th><th style={headerStyle}>Last Login</th><th style={headerStyle}>Password</th><th style={headerStyle}>Actions</th></tr></thead>
            <tbody>
              {summary.users.map((user) => (
                <tr key={user.id}>
                  <td style={cellStyle}>{user.username}</td>
                  <td style={cellStyle}>{user.email || "-"}</td>
                  <td style={cellStyle}>{user.organizationId || "-"} / {user.siteId || "all"}</td>
                  <td style={cellStyle}>
                    <select value={user.roleId || ""} onChange={(event) => onUpdateUserRole(user.id, event.target.value)} style={{ ...inputStyle, backgroundColor: "white" }}>
                      <option value="">No role</option>
                      {summary.roles.map((role) => <option key={role.id} value={role.id}>{role.name}</option>)}
                    </select>
                  </td>
                  <td style={cellStyle}>{user.active ? "Yes" : "No"}</td>
                  <td style={cellStyle}>{user.lastLoginAt ? new Date(user.lastLoginAt).toLocaleString() : "-"}</td>
                  <td style={cellStyle}>
                    <div style={{ display: "flex", gap: "8px", minWidth: "240px" }}>
                      <input
                        type="password"
                        placeholder="New password"
                        value={passwordEdits[user.id] || ""}
                        onChange={(event) => setPasswordEdits((prev) => ({ ...prev, [user.id]: event.target.value }))}
                        style={inputStyle}
                      />
                      <button
                        onClick={() => {
                          onResetUserPassword(user.id, passwordEdits[user.id] || "");
                          setPasswordEdits((prev) => ({ ...prev, [user.id]: "" }));
                        }}
                        style={{ ...buttonStyle, backgroundColor: "#0f766e", whiteSpace: "nowrap" }}
                      >
                        Reset
                      </button>
                    </div>
                  </td>
                  <td style={cellStyle}>
                    <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                      <button onClick={() => onToggleUserActive(user)} style={{ ...buttonStyle, backgroundColor: user.active ? "#dc2626" : "#16a34a" }}>
                        {user.active ? "Deactivate" : "Activate"}
                      </button>
                      <button onClick={() => onDeleteUser(user)} style={{ ...buttonStyle, backgroundColor: "#7f1d1d" }}>Delete</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div style={{ ...panelStyle, padding: "16px" }}>
        <h2 style={{ marginTop: 0, color: "#2c5282" }}>Audit Events</h2>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: "760px" }}>
            <thead><tr><th style={headerStyle}>Actor</th><th style={headerStyle}>Action</th><th style={headerStyle}>Resource</th><th style={headerStyle}>Created</th></tr></thead>
            <tbody>
              {summary.auditEvents.length === 0 ? <tr><td colSpan={4} style={cellStyle}>No audit events yet.</td></tr> : summary.auditEvents.map((event) => (
                <tr key={event.id}><td style={cellStyle}>{event.actor}</td><td style={cellStyle}>{event.action}</td><td style={cellStyle}>{event.resourceType}:{event.resourceId || "-"}</td><td style={cellStyle}>{new Date(event.createdAt).toLocaleString()}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

function AutonomousModePanel({ form, setForm, mode, optimization, buildingOptimization, scheduleSetpoints, onApply, onApplySetpoints, saving }) {
  const fieldStyle = { display: "flex", flexDirection: "column", gap: "6px", color: "#334155" };
  const selectStyle = { ...inputStyle, backgroundColor: "white" };

  return (
    <section style={{ marginBottom: "28px" }}>
      <h2 style={{ marginBottom: "16px", color: "#2c5282" }}>Autonomous Mode BEMS</h2>
      <div style={{ ...panelStyle, padding: "16px" }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: "12px", marginBottom: "16px" }}>
          <label style={fieldStyle}>
            Occupancy
            <select value={form.occupancyState} onChange={(event) => setForm((prev) => ({ ...prev, occupancyState: event.target.value }))} style={selectStyle}>
              <option value="occupied">occupied</option>
              <option value="partial">partial</option>
              <option value="unoccupied">unoccupied</option>
            </select>
          </label>
          <label style={fieldStyle}>
            Academic calendar
            <select value={form.academicCalendar} onChange={(event) => setForm((prev) => ({ ...prev, academicCalendar: event.target.value }))} style={selectStyle}>
              <option value="in_session">in session</option>
              <option value="break">break</option>
              <option value="holiday">holiday</option>
            </select>
          </label>
          <label style={fieldStyle}>
            Residential pattern
            <select value={form.residentialPattern} onChange={(event) => setForm((prev) => ({ ...prev, residentialPattern: event.target.value }))} style={selectStyle}>
              <option value="home">home</option>
              <option value="away">away</option>
              <option value="sleep">sleep</option>
            </select>
          </label>
          <label style={fieldStyle}>
            Weather
            <select value={form.weatherCondition} onChange={(event) => setForm((prev) => ({ ...prev, weatherCondition: event.target.value }))} style={selectStyle}>
              <option value="mild">mild</option>
              <option value="hot">hot</option>
              <option value="cold">cold</option>
              <option value="extreme_hot">extreme hot</option>
              <option value="extreme_cold">extreme cold</option>
            </select>
          </label>
          <label style={{ ...fieldStyle, justifyContent: "end" }}>
            <span>Demand response</span>
            <select value={form.demandResponseEvent ? "true" : "false"} onChange={(event) => setForm((prev) => ({ ...prev, demandResponseEvent: event.target.value === "true" }))} style={selectStyle}>
              <option value="false">inactive</option>
              <option value="true">active</option>
            </select>
          </label>
          <button onClick={onApply} disabled={saving} style={{ ...buttonStyle, backgroundColor: "#2563eb", height: "40px", alignSelf: "end" }}>
            {saving ? "Optimizing..." : "Apply Mode"}
          </button>
          <button onClick={() => onApplySetpoints(false)} disabled={saving} style={{ ...buttonStyle, backgroundColor: "#0f766e", height: "40px", alignSelf: "end" }}>
            Preview Setpoints
          </button>
          <button onClick={() => onApplySetpoints(true)} disabled={saving} style={{ ...buttonStyle, backgroundColor: "#7c3aed", height: "40px", alignSelf: "end" }}>
            Apply BACnet Writes
          </button>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "12px", marginBottom: "16px" }}>
          <div><strong style={{ color: "#1f355e" }}>{mode?.profile || "Unknown"}</strong><div style={{ color: "#64748b" }}>Current AI profile</div></div>
          <div><strong style={{ color: "#1f355e" }}>{optimization?.summary?.estimatedSavingsKwh ?? "-"} kWh</strong><div style={{ color: "#64748b" }}>Device savings</div></div>
          <div><strong style={{ color: "#1f355e" }}>{buildingOptimization?.objective?.estimatedSavingsKwh ?? "-"} kWh</strong><div style={{ color: "#64748b" }}>Building savings</div></div>
          <div><strong style={{ color: "#1f355e" }}>${buildingOptimization?.objective?.estimatedCostSavings ?? "-"}</strong><div style={{ color: "#64748b" }}>Cost savings</div></div>
        </div>

        {mode?.reasons?.length > 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
            {mode.reasons.map((reason) => (
              <span key={reason} style={{ padding: "6px 10px", borderRadius: "999px", backgroundColor: "#eef4fb", color: "#1f355e", fontSize: "13px" }}>{reason}</span>
            ))}
          </div>
        )}
        {scheduleSetpoints?.actions?.length > 0 && (
          <div style={{ marginTop: "16px", overflowX: "auto" }}>
            <div style={{ color: "#64748b", fontSize: "13px", marginBottom: "8px" }}>{scheduleSetpoints.flow}</div>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: "760px" }}>
              <thead><tr><th style={headerStyle}>Device</th><th style={headerStyle}>Zone</th><th style={headerStyle}>Base</th><th style={headerStyle}>AI Target</th><th style={headerStyle}>BACnet</th></tr></thead>
              <tbody>
                {scheduleSetpoints.actions.slice(0, 8).map((action) => (
                  <tr key={`${action.deviceId}-${action.targetSetpoint}`}>
                    <td style={cellStyle}>{action.deviceName}</td>
                    <td style={cellStyle}>{action.zonePath || "-"}</td>
                    <td style={cellStyle}>{action.baseSetpoint} {action.units || ""}</td>
                    <td style={cellStyle}>{action.targetSetpoint} {action.units || ""}</td>
                    <td style={cellStyle}>{action.applied ? "WriteProperty accepted" : action.service}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}

export default function App() {
  const [session, setSession] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem("bems.session") || "null");
    } catch {
      return null;
    }
  });
  const [view, setView] = useState("dashboard");
  const [darkMode, setDarkMode] = useState(() => localStorage.getItem("bems.theme") === "dark");
  const [loginForm, setLoginForm] = useState({ username: "admin", password: "admin", organizationId: "1", siteId: "1", buildingId: "1" });
  const [loginContext, setLoginContext] = useState({ organizations: [], sites: [], buildings: [] });
  const [loginError, setLoginError] = useState(null);
  const [loggingIn, setLoggingIn] = useState(false);
  const [adminSummary, setAdminSummary] = useState(null);
  const [userForm, setUserForm] = useState({ username: "", email: "", roleId: "1", organizationId: "1", siteId: "", password: "", active: true });
  const [roleForm, setRoleForm] = useState({ name: "", description: "", permissions: ["devices:view", "alarms:view", "schedules:view"] });
  const [maintenanceForm, setMaintenanceForm] = useState({ deviceId: "", title: "", description: "", priority: "medium", assignedTo: "" });
  const [autonomousForm, setAutonomousForm] = useState({
    occupancyState: "occupied",
    academicCalendar: "in_session",
    residentialPattern: "home",
    weatherCondition: "mild",
    demandResponseEvent: false,
  });
  const [autonomousSaving, setAutonomousSaving] = useState(false);
  const [scheduleSetpoints, setScheduleSetpoints] = useState(null);
  const [hierarchy, setHierarchy] = useState([]);
  const [alarms, setAlarms] = useState([]);
  const [alarmLogs, setAlarmLogs] = useState([]);
  const [trendLogs, setTrendLogs] = useState([]);
  const [history, setHistory] = useState([]);
  const [schedules, setSchedules] = useState([]);
  const [holidaySchedules, setHolidaySchedules] = useState([]);
  const [specialEvents, setSpecialEvents] = useState([]);
  const [scheduleForm, setScheduleForm] = useState({
    name: "Daily comfort schedule",
    targetType: "building",
    buildingId: "1",
    zoneId: "",
    deviceId: "",
    recurrence: "daily",
    month: "",
    dayOfMonth: "",
    startTime: "06:00",
    endTime: "18:00",
    days: "Mon,Tue,Wed,Thu,Fri",
    action: "setpoint",
    targetValue: "22",
    units: "Celsius",
    description: "",
  });
  const [holidayForm, setHolidayForm] = useState({
    buildingId: "1",
    name: "Holiday setback",
    eventDate: "",
    month: "1",
    dayOfMonth: "1",
    recurring: true,
    startTime: "00:00",
    endTime: "23:59",
    action: "setpoint_bias",
    targetValue: "2",
    units: "Celsius",
    description: "",
  });
  const [specialEventForm, setSpecialEventForm] = useState({
    targetType: "building",
    buildingId: "1",
    zoneId: "",
    deviceId: "",
    name: "Special event",
    startAt: "",
    endAt: "",
    priority: "400",
    action: "setpoint",
    targetValue: "22",
    units: "Celsius",
    description: "",
  });
  const [autonomousMode, setAutonomousMode] = useState(null);
  const [optimization, setOptimization] = useState(null);
  const [buildingOptimization, setBuildingOptimization] = useState(null);
  const [rlPolicy, setRlPolicy] = useState([]);
  const [optimizationHistory, setOptimizationHistory] = useState([]);
  const [fddFindings, setFddFindings] = useState([]);
  const [maintenanceTickets, setMaintenanceTickets] = useState([]);
  const [maintenanceModes, setMaintenanceModes] = useState([]);
  const [maintenanceModeForm, setMaintenanceModeForm] = useState({
    targetType: "device",
    buildingId: "1",
    zoneId: "",
    deviceId: "",
    reason: "Service work in progress",
    endsAt: "",
  });
  const [digitalTwin, setDigitalTwin] = useState(null);
  const [floorplanLayout, setFloorplanLayout] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem("bems.floorplan") || "{}");
    } catch {
      return {};
    }
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState({});
  const [creatingAlarm, setCreatingAlarm] = useState(false);
  const [alarmForm, setAlarmForm] = useState({ deviceId: "", message: "Test alarm triggered", severity: "critical" });
  const [alarmColorOverrides, setAlarmColorOverrides] = useState(() => {
    try {
      return { ...defaultAlarmColors, ...JSON.parse(localStorage.getItem("bems.alarmColors") || "{}") };
    } catch {
      return defaultAlarmColors;
    }
  });
  const [deviceConfigForm, setDeviceConfigForm] = useState({ setpoint: "", minSetpoint: "", maxSetpoint: "", batteryPercent: "", eepromEnabled: false, eepromAddress: "", eepromSizeBytes: "", eepromWritePolicy: "on_change", persistentStorageMedium: "EEPROM", persistentStorageNamespace: "device_config", wearLeveling: true, bacnetScheduleStorageEnabled: true });
  const [configDevice, setConfigDevice] = useState(null);
  const [selectedDevice, setSelectedDevice] = useState(null);
  const [selectedZoneId, setSelectedZoneId] = useState(null);
  const [telemetrySeries, setTelemetrySeries] = useState([]);
  const [telemetryFeed, setTelemetryFeed] = useState([]);
  const [telemetryConnected, setTelemetryConnected] = useState(false);
  const [alarmStreamConnected, setAlarmStreamConnected] = useState(false);
  const [lastTelemetryAt, setLastTelemetryAt] = useState(null);
  const [weatherPricing, setWeatherPricing] = useState(null);
  const [smartGridAi, setSmartGridAi] = useState(null);
  const [airflowGraph, setAirflowGraph] = useState(null);
  const [buildingFootprint, setBuildingFootprint] = useState(null);
  const [reportSummary, setReportSummary] = useState(null);
  const [reportHeatMap, setReportHeatMap] = useState(null);
  const [reportSchedules, setReportSchedules] = useState([]);
  const [reportExports, setReportExports] = useState([]);
  const [reportRuns, setReportRuns] = useState([]);
  const [reportScheduleForm, setReportScheduleForm] = useState({ name: "Weekly energy report", reportType: "energy", cadence: "weekly", recipients: "", days: "30" });
  const [edgeCapabilities, setEdgeCapabilities] = useState(null);
  const [eventStatus, setEventStatus] = useState(null);
  const [simulation, setSimulation] = useState(null);
  const [controlStatus, setControlStatus] = useState(null);
  const [discoveryForm, setDiscoveryForm] = useState({ lowInstance: "101", highInstance: "302" });
  const [discoveryResult, setDiscoveryResult] = useState(null);
  const [provisioningForm, setProvisioningForm] = useState({
    zoneId: "",
    name: "",
    type: "Analog Input",
    bacnetInstance: "",
    objectInstance: "1",
    objectType: "analogInput",
    vendor: "",
    model: "",
    ipAddress: "",
    units: "",
    batteryPercent: "",
    setpoint: "",
    minSetpoint: "",
    maxSetpoint: "",
    eepromEnabled: true,
    eepromAddress: "0x0000",
    eepromSizeBytes: "256",
    eepromWritePolicy: "on_change",
    persistentStorageMedium: "EEPROM",
    persistentStorageNamespace: "device_config",
    wearLeveling: true,
    description: "",
  });
  const [statusMessage, setStatusMessage] = useState(null);

  const devices = useMemo(() => flattenDevices(hierarchy), [hierarchy]);
  const zones = useMemo(() => flattenZones(hierarchy), [hierarchy]);
  const buildings = useMemo(() => hierarchy.map((building) => ({ id: building.id, name: building.name })), [hierarchy]);
  const activeBuilding = useMemo(
    () => loginContext.buildings.find((building) => String(building.id) === String(session?.buildingId || "")) || null,
    [loginContext.buildings, session?.buildingId]
  );
  const activeAlarmCount = alarms.filter((alarm) => alarm.status !== "Cleared").length;
  const activeScheduleCount = schedules.filter((schedule) => !!schedule.enabled).length;
  const openFindingCount = fddFindings.filter((finding) => finding.status === "open").length;
  const openTicketCount = maintenanceTickets.filter((ticket) => ticket.status === "open").length;
  const canManageUsers = (session?.scopes || []).includes("users:manage");

  const updateAlarmColor = (severity, color) => {
    setAlarmColorOverrides((previous) => {
      const next = { ...previous, [severity]: color };
      localStorage.setItem("bems.alarmColors", JSON.stringify(next));
      return next;
    });
  };

  useEffect(() => {
    document.documentElement.classList.toggle("dark", darkMode);
    localStorage.setItem("bems.theme", darkMode ? "dark" : "light");
  }, [darkMode]);

  useEffect(() => {
    if (selectedZoneId || hierarchy.length === 0) return;
    const firstZone = flattenZones(hierarchy)[0];
    if (firstZone) {
      setSelectedZoneId(firstZone.id);
    }
  }, [hierarchy, selectedZoneId]);

  const requestHeaders = (extra = {}) => {
    const headers = { ...extra };
    if (session?.sessionToken) headers["X-Session-Token"] = session.sessionToken;
    if (session?.actor) headers["X-Actor"] = session.actor;
    if (session?.organizationId) headers["X-Organization-ID"] = String(session.organizationId);
    if (session?.siteId) headers["X-Site-ID"] = String(session.siteId);
    return headers;
  };

  const apiFetch = (path, options = {}) => fetch(`${apiBase}${path}`, {
    ...options,
    headers: requestHeaders(options.headers || {}),
  });

  const login = async () => {
    setLoggingIn(true);
    setLoginError(null);
    try {
      const response = await fetch(`${apiBase}/api/v1/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: loginForm.username,
          password: loginForm.password,
          organizationId: Number(loginForm.organizationId || 1),
          siteId: loginForm.siteId ? Number(loginForm.siteId) : null,
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(body.error || "Login failed");
      }
      const selectedBuilding = loginContext.buildings.find((building) => String(building.id) === String(loginForm.buildingId || ""));
      const nextSession = {
        ...body.session,
        buildingId: loginForm.buildingId ? Number(loginForm.buildingId) : null,
        buildingName: selectedBuilding?.name || null,
      };
      setSession(nextSession);
      localStorage.setItem("bems.session", JSON.stringify(nextSession));
      setView("dashboard");
    } catch (err) {
      setLoginError(err.message);
    } finally {
      setLoggingIn(false);
    }
  };

  const logout = async () => {
    await apiFetch("/api/v1/auth/logout", { method: "POST" }).catch(() => {});
    localStorage.removeItem("bems.session");
    setSession(null);
    setAdminSummary(null);
    setView("dashboard");
  };

  const loadLoginContext = async () => {
    try {
      const response = await fetch(`${apiBase}/api/v1/auth/context`);
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(body.error || "Unable to load login context");
      }
      setLoginContext(body);
      setLoginForm((prev) => ({
        ...prev,
        organizationId: prev.organizationId || String(body.defaultOrganizationId || 1),
        siteId: prev.siteId || (body.defaultSiteId ? String(body.defaultSiteId) : ""),
        buildingId: prev.buildingId || (body.defaultBuildingId ? String(body.defaultBuildingId) : ""),
      }));
    } catch (err) {
      console.warn("Login context unavailable:", err.message);
    }
  };

  const loadAdmin = async () => {
    const response = await apiFetch("/api/v1/admin/summary");
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body.error || "Unable to load admin data");
    }
    const summary = await response.json();
    setAdminSummary(summary);
    const adminRole = summary.roles?.find((role) => role.name === "Admin") || summary.roles?.[0];
    setUserForm((prev) => ({
      ...prev,
      roleId: prev.roleId || String(adminRole?.id || "1"),
      organizationId: prev.organizationId || String(summary.organizations?.[0]?.id || "1"),
    }));
  };

  const createUser = async () => {
    setStatusMessage(null);
    try {
      const response = await apiFetch("/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: userForm.username,
          email: userForm.email,
          roleId: Number(userForm.roleId || 1),
          organizationId: Number(userForm.organizationId || session?.organizationId || 1),
          siteId: userForm.siteId ? Number(userForm.siteId) : null,
          password: userForm.password,
          active: userForm.active !== false,
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(body.error || "Unable to create user");
      }
      setUserForm((prev) => ({ ...prev, username: "", email: "", password: "", active: true }));
      setStatusMessage({ type: "success", text: `User ${body.username} created with hashed password storage.` });
      await loadAdmin();
    } catch (err) {
      setStatusMessage({ type: "error", text: err.message });
    }
  };

  const createRole = async () => {
    setStatusMessage(null);
    try {
      const response = await apiFetch("/api/roles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(roleForm),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(body.error || "Unable to create role");
      }
      setRoleForm({ name: "", description: "", permissions: ["devices:view", "alarms:view", "schedules:view"] });
      setStatusMessage({ type: "success", text: `Role ${body.name} created.` });
      await loadAdmin();
    } catch (err) {
      setStatusMessage({ type: "error", text: err.message });
    }
  };

  const updateUserRole = async (userId, roleId) => {
    setStatusMessage(null);
    try {
      const response = await apiFetch(`/api/users/${userId}/role`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roleId: roleId ? Number(roleId) : null }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(body.error || "Unable to update user role");
      }
      await loadAdmin();
    } catch (err) {
      setStatusMessage({ type: "error", text: err.message });
    }
  };

  const toggleUserActive = async (user) => {
    setStatusMessage(null);
    try {
      const response = await apiFetch(`/api/users/${user.id}/active`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: !user.active }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(body.error || "Unable to update user state");
      }
      await loadAdmin();
    } catch (err) {
      setStatusMessage({ type: "error", text: err.message });
    }
  };

  const resetUserPassword = async (userId, password) => {
    setStatusMessage(null);
    if (!password || password.length < 8) {
      setStatusMessage({ type: "error", text: "Password must be at least 8 characters." });
      return;
    }
    try {
      const response = await apiFetch(`/api/users/${userId}/password`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(body.error || "Unable to reset password");
      }
      setStatusMessage({ type: "success", text: `Password reset for user ${userId}.` });
      await loadAdmin();
    } catch (err) {
      setStatusMessage({ type: "error", text: err.message });
    }
  };

  const deleteUser = async (user) => {
    setStatusMessage(null);
    if (!window.confirm(`Delete user ${user.username}?`)) {
      return;
    }
    try {
      const response = await apiFetch(`/api/users/${user.id}`, { method: "DELETE" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(body.error || "Unable to delete user");
      }
      setStatusMessage({ type: "success", text: `User ${user.username} deleted.` });
      await loadAdmin();
    } catch (err) {
      setStatusMessage({ type: "error", text: err.message });
    }
  };

  const toggleFeature = async (featureKey, enabled) => {
    setStatusMessage(null);
    try {
      const response = await apiFetch(`/api/v1/admin/features/${featureKey}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(body.error || "Unable to update feature");
      }
      setStatusMessage({ type: "success", text: `${body.label} ${enabled ? "enabled" : "disabled"}.` });
      await loadAdmin();
    } catch (err) {
      setStatusMessage({ type: "error", text: err.message });
    }
  };

  const modeQueryString = () => new URLSearchParams({
    occupancyState: autonomousForm.occupancyState,
    academicCalendar: autonomousForm.academicCalendar,
    residentialPattern: autonomousForm.residentialPattern,
    weatherCondition: autonomousForm.weatherCondition,
    demandResponseEvent: autonomousForm.demandResponseEvent ? "true" : "false",
  }).toString();

  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      const modeQuery = modeQueryString();
      const [
        hierarchyRes,
        alarmsRes,
        alarmLogsRes,
        trendsRes,
        historyRes,
        schedulesRes,
        holidaySchedulesRes,
        specialEventsRes,
        autonomousRes,
        optimizationRes,
        buildingOptimizationRes,
        twinRes,
        rlPolicyRes,
        optimizationHistoryRes,
        fddRes,
        ticketsRes,
        maintenanceModesRes,
        weatherPricingRes,
        smartGridRes,
        airflowGraphRes,
        buildingFootprintRes,
        reportSummaryRes,
        reportHeatMapRes,
        reportSchedulesRes,
        reportExportsRes,
        reportRunsRes,
        edgeCapabilitiesRes,
        eventStatusRes,
        controlStatusRes,
      ] = await Promise.all([
        apiFetch("/api/hierarchy"),
        apiFetch("/api/alarms"),
        apiFetch("/api/alarm-logs"),
        apiFetch("/api/trends?limit=50"),
        apiFetch("/api/history?days=30"),
        apiFetch("/api/schedules"),
        apiFetch("/api/holiday-schedules"),
        apiFetch("/api/special-events"),
        apiFetch(`/api/autonomous-mode/evaluate?${modeQuery}`),
        apiFetch(`/api/ai/optimization?${modeQuery}`),
        apiFetch(`/api/ai/building-optimization?${modeQuery}`),
        apiFetch("/api/digital-twin"),
        apiFetch("/api/ai/reinforcement/policy"),
        apiFetch("/api/ai/optimization-history"),
        apiFetch("/api/fdd/findings"),
        apiFetch("/api/maintenance/tickets"),
        apiFetch("/api/maintenance/modes"),
        apiFetch("/api/ai/weather-pricing"),
        apiFetch("/api/ai/smart-grid"),
        apiFetch("/api/ai/airflow-graph"),
        apiFetch("/api/buildings/footprint"),
        apiFetch("/api/reports/summary?days=30"),
        apiFetch("/api/reports/heat-map?days=30"),
        apiFetch("/api/reports/schedules"),
        apiFetch("/api/reports/exports"),
        apiFetch("/api/reports/schedule-runs"),
        apiFetch("/api/edge/capabilities"),
        apiFetch("/api/events/status"),
        apiFetch("/api/ai/control/status"),
      ]);

      if (!hierarchyRes.ok) throw new Error("Unable to fetch hierarchy");
      if (!alarmsRes.ok) throw new Error("Unable to fetch alarms");
      if (!alarmLogsRes.ok) throw new Error("Unable to fetch alarm logs");
      if (!trendsRes.ok) throw new Error("Unable to fetch trend logs");
      if (!historyRes.ok) throw new Error("Unable to fetch history");
      if (!schedulesRes.ok) throw new Error("Unable to fetch schedules");
      if (!holidaySchedulesRes.ok) throw new Error("Unable to fetch holiday schedules");
      if (!specialEventsRes.ok) throw new Error("Unable to fetch special events");
      if (!autonomousRes.ok) throw new Error("Unable to fetch autonomous mode");
      if (!optimizationRes.ok) throw new Error("Unable to fetch optimization");
      if (!buildingOptimizationRes.ok) throw new Error("Unable to fetch building optimization");
      if (!twinRes.ok) throw new Error("Unable to fetch digital twin");
      if (!rlPolicyRes.ok) throw new Error("Unable to fetch RL policy");
      if (!optimizationHistoryRes.ok) throw new Error("Unable to fetch optimization history");
      if (!fddRes.ok) throw new Error("Unable to fetch FDD findings");
      if (!ticketsRes.ok) throw new Error("Unable to fetch maintenance tickets");
      if (!maintenanceModesRes.ok) throw new Error("Unable to fetch maintenance modes");
      if (!weatherPricingRes.ok) throw new Error("Unable to fetch weather pricing");
      if (!smartGridRes.ok) throw new Error("Unable to fetch smart grid AI context");
      if (!airflowGraphRes.ok) throw new Error("Unable to fetch airflow graph");
      if (!buildingFootprintRes.ok) throw new Error("Unable to fetch building footprint");
      if (!reportSummaryRes.ok) throw new Error("Unable to fetch report summary");
      if (!reportHeatMapRes.ok) throw new Error("Unable to fetch report heat map");
      if (!reportSchedulesRes.ok) throw new Error("Unable to fetch report schedules");
      if (!reportExportsRes.ok) throw new Error("Unable to fetch report exports");
      if (!reportRunsRes.ok) throw new Error("Unable to fetch report schedule runs");
      if (!edgeCapabilitiesRes.ok) throw new Error("Unable to fetch edge platform capabilities");
      if (!eventStatusRes.ok) throw new Error("Unable to fetch event-driven status");
      if (!controlStatusRes.ok) throw new Error("Unable to fetch control status");

      const nextHierarchy = await hierarchyRes.json();
      const nextTwin = await twinRes.json();
      setHierarchy(nextHierarchy);
      setAlarms(await alarmsRes.json());
      setAlarmLogs(await alarmLogsRes.json());
      setTrendLogs(await trendsRes.json());
      setHistory(await historyRes.json());
      setSchedules(await schedulesRes.json());
      setHolidaySchedules(await holidaySchedulesRes.json());
      setSpecialEvents(await specialEventsRes.json());
      setAutonomousMode(await autonomousRes.json());
      setOptimization(await optimizationRes.json());
      setBuildingOptimization(await buildingOptimizationRes.json());
      setDigitalTwin(nextTwin);
      setRlPolicy(await rlPolicyRes.json());
      setOptimizationHistory(await optimizationHistoryRes.json());
      setFddFindings(await fddRes.json());
      setMaintenanceTickets(await ticketsRes.json());
      setMaintenanceModes(await maintenanceModesRes.json());
      setWeatherPricing(await weatherPricingRes.json());
      setSmartGridAi(await smartGridRes.json());
      setAirflowGraph(await airflowGraphRes.json());
      setBuildingFootprint(await buildingFootprintRes.json());
      setReportSummary(await reportSummaryRes.json());
      setReportHeatMap(await reportHeatMapRes.json());
      setReportSchedules(await reportSchedulesRes.json());
      setReportExports(await reportExportsRes.json());
      setReportRuns(await reportRunsRes.json());
      setEdgeCapabilities(await edgeCapabilitiesRes.json());
      setEventStatus(await eventStatusRes.json());
      setControlStatus(await controlStatusRes.json());
      const samples = telemetrySamplesFromTwin(nextTwin);
      setTelemetrySeries((previous) => [...previous, ...samples].slice(-240));
      setTelemetryFeed((previous) => [...samples.reverse(), ...previous].slice(0, 200));
      if (samples.length > 0) {
        setLastTelemetryAt(new Date().toLocaleTimeString());
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const applyAutonomousMode = async () => {
    setAutonomousSaving(true);
    setStatusMessage(null);
    try {
      await loadData();
      setStatusMessage({ type: "success", text: "Autonomous BEMS mode evaluated and optimization refreshed." });
    } finally {
      setAutonomousSaving(false);
    }
  };

  const createReportSchedule = async () => {
    setStatusMessage(null);
    try {
      const recipients = reportScheduleForm.recipients
        .split(",")
        .map((recipient) => recipient.trim())
        .filter(Boolean);
      const response = await apiFetch("/api/reports/schedules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: reportScheduleForm.name,
          reportType: reportScheduleForm.reportType,
          cadence: reportScheduleForm.cadence,
          recipients,
          filters: { days: Number(reportScheduleForm.days || 30) },
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "Unable to create report schedule");
      setStatusMessage({ type: "success", text: `Report schedule ${body.name} created.` });
      setReportScheduleForm((prev) => ({ ...prev, name: "" }));
      await loadData();
    } catch (err) {
      setStatusMessage({ type: "error", text: err.message });
    }
  };

  const runReportSchedule = async (scheduleId) => {
    setStatusMessage(null);
    try {
      const response = await apiFetch(`/api/reports/schedules/${scheduleId}/run`, { method: "POST" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "Unable to run report schedule");
      setStatusMessage({ type: "success", text: `Scheduled report queued: ${body.downloadPath}` });
      await loadData();
    } catch (err) {
      setStatusMessage({ type: "error", text: err.message });
    }
  };

  const runDueReportSchedules = async () => {
    setStatusMessage(null);
    try {
      const response = await apiFetch("/api/reports/schedules/run-due", { method: "POST" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "Unable to run due report schedules");
      setStatusMessage({ type: "success", text: `${body.ran} due report schedule(s) queued.` });
      await loadData();
    } catch (err) {
      setStatusMessage({ type: "error", text: err.message });
    }
  };

  const applyAutomatedScheduleSetpoints = async (apply) => {
    setAutonomousSaving(true);
    setStatusMessage(null);
    try {
      const response = await apiFetch("/api/autonomous-mode/schedule-setpoints", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: autonomousForm, apply }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "Unable to compute automated schedule setpoints");
      setScheduleSetpoints(body);
      setStatusMessage({
        type: "success",
        text: apply ? "AI schedule setpoints sent to BACnet writeback." : "AI schedule setpoint preview generated.",
      });
      if (apply) await loadData();
    } catch (err) {
      setStatusMessage({ type: "error", text: err.message });
    } finally {
      setAutonomousSaving(false);
    }
  };

  useEffect(() => {
    loadLoginContext();
  }, []);

  useEffect(() => {
    if (session) {
      loadData();
    }
  }, [session]);

  useEffect(() => {
    if (!session) return undefined;
    const stream = new EventSource(`${apiBase}/api/alarms/stream`);
    stream.onopen = () => setAlarmStreamConnected(true);
    stream.addEventListener("alarms", (event) => {
      setAlarms(JSON.parse(event.data));
      apiFetch("/api/alarm-logs")
        .then((response) => response.ok ? response.json() : [])
        .then((logs) => setAlarmLogs(logs))
        .catch(() => {});
    });
    stream.onerror = () => {
      setAlarmStreamConnected(false);
      stream.close();
    };
    return () => {
      setAlarmStreamConnected(false);
      stream.close();
    };
  }, [session]);

  useEffect(() => {
    if (!session) return undefined;
    const stream = new EventSource(`${apiBase}/api/telemetry/stream`);
    stream.onopen = () => setTelemetryConnected(true);
    stream.addEventListener("telemetry", (event) => {
      const twin = JSON.parse(event.data);
      const samples = telemetrySamplesFromTwin(twin);
      setDigitalTwin(twin);
      setHierarchy((previous) => mergeTelemetryHierarchy(previous, twin));
      setTelemetrySeries((previous) => [...previous, ...samples].slice(-240));
      setTelemetryFeed((previous) => [...samples.reverse(), ...previous].slice(0, 200));
      setLastTelemetryAt(new Date().toLocaleTimeString());
    });
    stream.onerror = () => {
      setTelemetryConnected(false);
      stream.close();
    };
    return () => {
      setTelemetryConnected(false);
      stream.close();
    };
  }, [session]);

  useEffect(() => {
    localStorage.setItem("bems.floorplan", JSON.stringify(floorplanLayout));
  }, [floorplanLayout]);

  const updateStatus = async (endpoint, id, successMessage) => {
    setSaving((prev) => ({ ...prev, [id]: true }));
    setStatusMessage(null);
    try {
      const response = await apiFetch(`/${endpoint}`, { method: "PATCH" });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || "Unable to update status");
      }
      setStatusMessage({ type: "success", text: successMessage });
      await loadData();
    } catch (err) {
      setStatusMessage({ type: "error", text: err.message });
    } finally {
      setSaving((prev) => ({ ...prev, [id]: false }));
    }
  };

  const updateDeviceStatus = async (deviceId, action) => {
    await updateStatus(`api/devices/${deviceId}/${action}`, deviceId, `Device ${action}ed successfully.`);
  };

  const findFullDevice = (device) => devices.find((item) => item.id === device.id) || device;

  const openDeviceDetails = (device) => {
    setSelectedDevice(findFullDevice(device));
    setStatusMessage(null);
  };

  const openDeviceConfig = (device) => {
    const fullDevice = findFullDevice(device);
    setConfigDevice(fullDevice);
    setSelectedDevice(fullDevice);
    setDeviceConfigForm({
      setpoint: fullDevice.configuration?.setpoint ?? "",
      minSetpoint: fullDevice.configuration?.minSetpoint ?? "",
      maxSetpoint: fullDevice.configuration?.maxSetpoint ?? "",
      batteryPercent: fullDevice.configuration?.batteryPercent ?? "",
      eepromEnabled: !!fullDevice.configuration?.eepromEnabled || !!fullDevice.configuration?.setpointStorage,
      eepromAddress: fullDevice.configuration?.eepromAddress || fullDevice.configuration?.setpointStorage?.address || "",
      eepromSizeBytes: fullDevice.configuration?.eepromSizeBytes || fullDevice.configuration?.setpointStorage?.sizeBytes || "",
      eepromWritePolicy: fullDevice.configuration?.eepromWritePolicy || fullDevice.configuration?.setpointStorage?.writePolicy || "on_change",
      persistentStorageMedium: fullDevice.configuration?.persistentStorage?.medium || "EEPROM",
      persistentStorageNamespace: fullDevice.configuration?.persistentStorage?.namespace || "device_config",
      wearLeveling: fullDevice.configuration?.persistentStorage?.wearLeveling !== false,
      bacnetScheduleStorageEnabled: fullDevice.configuration?.bacnetScheduleStorage?.enabled !== false,
    });
    setStatusMessage(null);
  };

  const closeDeviceConfig = () => {
    setConfigDevice(null);
    setDeviceConfigForm({ setpoint: "", minSetpoint: "", maxSetpoint: "", batteryPercent: "", eepromEnabled: false, eepromAddress: "", eepromSizeBytes: "", eepromWritePolicy: "on_change", persistentStorageMedium: "EEPROM", persistentStorageNamespace: "device_config", wearLeveling: true, bacnetScheduleStorageEnabled: true });
  };

  const saveDeviceConfig = async () => {
    if (!configDevice) return;
    setSaving((prev) => ({ ...prev, config: true }));
    setStatusMessage(null);

    try {
      const response = await apiFetch(`/api/devices/${configDevice.id}/configuration`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          configuration: {
            ...configDevice.configuration,
            setpoint: deviceConfigForm.setpoint !== "" ? Number(deviceConfigForm.setpoint) : configDevice.configuration?.setpoint,
            minSetpoint: deviceConfigForm.minSetpoint !== "" ? Number(deviceConfigForm.minSetpoint) : configDevice.configuration?.minSetpoint,
            maxSetpoint: deviceConfigForm.maxSetpoint !== "" ? Number(deviceConfigForm.maxSetpoint) : configDevice.configuration?.maxSetpoint,
            batteryPercent: deviceConfigForm.batteryPercent !== "" ? Number(deviceConfigForm.batteryPercent) : configDevice.configuration?.batteryPercent,
            eepromEnabled: !!deviceConfigForm.eepromEnabled,
            eepromAddress: deviceConfigForm.eepromAddress || configDevice.configuration?.eepromAddress || "0x0000",
            eepromSizeBytes: deviceConfigForm.eepromSizeBytes !== "" ? Number(deviceConfigForm.eepromSizeBytes) : configDevice.configuration?.eepromSizeBytes,
            eepromWritePolicy: deviceConfigForm.eepromWritePolicy || "on_change",
            setpointStorage: {
              address: deviceConfigForm.eepromAddress || configDevice.configuration?.eepromAddress || "0x0000",
              sizeBytes: deviceConfigForm.eepromSizeBytes !== "" ? Number(deviceConfigForm.eepromSizeBytes) : configDevice.configuration?.eepromSizeBytes,
              writePolicy: deviceConfigForm.eepromWritePolicy || "on_change",
              retainedSetpoint: deviceConfigForm.setpoint !== "" ? Number(deviceConfigForm.setpoint) : configDevice.configuration?.setpoint,
              checksum: configDevice.configuration?.setpointStorage?.checksum || "crc16",
            },
            persistentStorage: {
              enabled: !!deviceConfigForm.eepromEnabled,
              medium: deviceConfigForm.persistentStorageMedium || "EEPROM",
              namespace: deviceConfigForm.persistentStorageNamespace || "device_config",
              wearLeveling: !!deviceConfigForm.wearLeveling,
              retainedKeys: ["identity", "commissioning", "setpoint", "schedule", "range", "calibration", "counters"],
            },
            bacnetScheduleStorage: {
              ...(configDevice.configuration?.bacnetScheduleStorage || {}),
              enabled: !!deviceConfigForm.bacnetScheduleStorageEnabled,
              persistentOnDevice: true,
              objectType: "schedule",
              storagePolicy: "device_resident",
              writePath: "BACnet WriteProperty to the device Schedule object",
            },
          },
          provisioned: configDevice.provisioned,
        }),
      });

      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || "Unable to save device configuration");
      }

      setStatusMessage({ type: "success", text: `Device configuration updated for ${configDevice.name}.` });
      closeDeviceConfig();
      await loadData();
    } catch (err) {
      setStatusMessage({ type: "error", text: err.message });
    } finally {
      setSaving((prev) => ({ ...prev, config: false }));
    }
  };

  const createAlarm = async () => {
    if (!alarmForm.deviceId || !alarmForm.message) {
      setStatusMessage({ type: "error", text: "Device and message are required to create an alarm." });
      return;
    }

    setCreatingAlarm(true);
    setStatusMessage(null);
    try {
      const response = await apiFetch("/api/alarms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          deviceId: Number(alarmForm.deviceId),
          message: alarmForm.message,
          severity: alarmForm.severity,
        }),
      });

      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || "Unable to create alarm");
      }

      setStatusMessage({ type: "success", text: "Simulated alarm generated." });
      setAlarmForm((prev) => ({ ...prev, message: "Test alarm triggered" }));
      await loadData();
    } catch (err) {
      setStatusMessage({ type: "error", text: err.message });
    } finally {
      setCreatingAlarm(false);
    }
  };

  const handleAlarmAction = async (alarmId, action) => {
    await updateStatus(`api/alarms/${alarmId}/${action}`, alarmId, `Alarm ${action}ed successfully.`);
  };

  const toggleSchedule = async (schedule) => {
    const action = schedule.enabled ? "disable" : "enable";
    await updateStatus(`api/schedules/${schedule.id}/${action}`, `schedule-${schedule.id}`, `Schedule ${action}d successfully.`);
  };

  const createSchedule = async () => {
    setSaving((prev) => ({ ...prev, scheduleCreate: true }));
    setStatusMessage(null);
    try {
      if (scheduleForm.targetType === "building" && !scheduleForm.buildingId) throw new Error("Select a building for this schedule.");
      if (scheduleForm.targetType === "zone" && !scheduleForm.zoneId) throw new Error("Select a zone for this schedule.");
      if (scheduleForm.targetType === "device" && !scheduleForm.deviceId) throw new Error("Select a device for this schedule.");
      const payload = {
        name: scheduleForm.name,
        enabled: true,
        startTime: scheduleForm.startTime,
        endTime: scheduleForm.endTime,
        days: scheduleForm.days,
        recurrence: scheduleForm.recurrence,
        month: scheduleForm.month ? Number(scheduleForm.month) : null,
        dayOfMonth: scheduleForm.dayOfMonth ? Number(scheduleForm.dayOfMonth) : null,
        action: scheduleForm.action,
        targetValue: scheduleForm.targetValue === "" ? null : Number(scheduleForm.targetValue),
        units: scheduleForm.units,
        description: scheduleForm.description,
      };
      if (scheduleForm.targetType === "device") {
        payload.deviceId = Number(scheduleForm.deviceId);
        const device = devices.find((item) => String(item.id) === String(scheduleForm.deviceId));
        payload.zoneId = device?.zoneId || null;
        payload.buildingId = device?.buildingId || null;
      } else if (scheduleForm.targetType === "zone") {
        payload.zoneId = Number(scheduleForm.zoneId);
        const zone = zones.find((item) => String(item.id) === String(scheduleForm.zoneId));
        payload.buildingId = zone?.buildingId || Number(scheduleForm.buildingId || 0) || null;
      } else if (scheduleForm.targetType === "building") {
        payload.buildingId = Number(scheduleForm.buildingId);
      }

      const response = await apiFetch("/api/schedules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(body.error || "Unable to create schedule");
      }
      setStatusMessage({ type: "success", text: `${body.scopeType} ${body.recurrence} schedule created. Device overrides zone, zone overrides building.` });
      await loadData();
    } catch (err) {
      setStatusMessage({ type: "error", text: err.message });
    } finally {
      setSaving((prev) => ({ ...prev, scheduleCreate: false }));
    }
  };

  const createHolidaySchedule = async () => {
    setSaving((prev) => ({ ...prev, holidayCreate: true }));
    setStatusMessage(null);
    try {
      if (!holidayForm.name) throw new Error("Enter a holiday schedule name.");
      if (!holidayForm.eventDate && (!holidayForm.month || !holidayForm.dayOfMonth)) {
        throw new Error("Use a date or recurring month/day for holiday schedules.");
      }
      const payload = {
        buildingId: holidayForm.buildingId ? Number(holidayForm.buildingId) : null,
        name: holidayForm.name,
        eventDate: holidayForm.eventDate || null,
        month: holidayForm.month ? Number(holidayForm.month) : null,
        dayOfMonth: holidayForm.dayOfMonth ? Number(holidayForm.dayOfMonth) : null,
        recurring: !!holidayForm.recurring,
        enabled: true,
        startTime: holidayForm.startTime,
        endTime: holidayForm.endTime,
        action: holidayForm.action,
        targetValue: holidayForm.targetValue === "" ? null : Number(holidayForm.targetValue),
        units: holidayForm.units,
        description: holidayForm.description,
      };
      const response = await apiFetch("/api/holiday-schedules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(body.error || "Unable to create holiday schedule");
      }
      setStatusMessage({ type: "success", text: `Holiday schedule ${body.name} created.` });
      await loadData();
    } catch (err) {
      setStatusMessage({ type: "error", text: err.message });
    } finally {
      setSaving((prev) => ({ ...prev, holidayCreate: false }));
    }
  };

  const disableHolidaySchedule = async (holidayId) => {
    await updateStatus(`api/holiday-schedules/${holidayId}/disable`, `holiday-${holidayId}`, "Holiday schedule disabled.");
  };

  const createSpecialEvent = async () => {
    setSaving((prev) => ({ ...prev, specialEventCreate: true }));
    setStatusMessage(null);
    try {
      if (!specialEventForm.name || !specialEventForm.startAt || !specialEventForm.endAt) {
        throw new Error("Enter a special event name, start time, and end time.");
      }
      const payload = {
        name: specialEventForm.name,
        startAt: specialEventForm.startAt,
        endAt: specialEventForm.endAt,
        priority: Number(specialEventForm.priority || 400),
        enabled: true,
        action: specialEventForm.action,
        targetValue: specialEventForm.targetValue === "" ? null : Number(specialEventForm.targetValue),
        units: specialEventForm.units,
        description: specialEventForm.description,
      };
      if (specialEventForm.targetType === "device") {
        if (!specialEventForm.deviceId) throw new Error("Select a device for this special event.");
        const device = devices.find((item) => String(item.id) === String(specialEventForm.deviceId));
        payload.deviceId = Number(specialEventForm.deviceId);
        payload.zoneId = device?.zoneId || null;
        payload.buildingId = device?.buildingId || null;
      } else if (specialEventForm.targetType === "zone") {
        if (!specialEventForm.zoneId) throw new Error("Select a zone for this special event.");
        const zone = zones.find((item) => String(item.id) === String(specialEventForm.zoneId));
        payload.zoneId = Number(specialEventForm.zoneId);
        payload.buildingId = zone?.buildingId || null;
      } else {
        if (!specialEventForm.buildingId) throw new Error("Select a building for this special event.");
        payload.buildingId = Number(specialEventForm.buildingId);
      }

      const response = await apiFetch("/api/special-events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(body.error || "Unable to create special event");
      }
      setStatusMessage({ type: "success", text: `Special event ${body.name} created.` });
      await loadData();
    } catch (err) {
      setStatusMessage({ type: "error", text: err.message });
    } finally {
      setSaving((prev) => ({ ...prev, specialEventCreate: false }));
    }
  };

  const disableSpecialEvent = async (eventId) => {
    await updateStatus(`api/special-events/${eventId}/disable`, `special-event-${eventId}`, "Special event disabled.");
  };

  const runFddAnalysis = async () => {
    setSaving((prev) => ({ ...prev, fdd: true }));
    setStatusMessage(null);
    try {
      const response = await apiFetch("/api/fdd/analyze", { method: "POST" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(body.error || "Unable to run FDD analysis");
      }
      setStatusMessage({ type: "success", text: `FDD analyzed ${body.analyzedDevices} devices and created ${body.createdCount} new findings.` });
      await loadData();
    } catch (err) {
      setStatusMessage({ type: "error", text: err.message });
    } finally {
      setSaving((prev) => ({ ...prev, fdd: false }));
    }
  };

  const updateTicketStatus = async (ticket, status) => {
    setSaving((prev) => ({ ...prev, [`ticket-${ticket.id}`]: true }));
    setStatusMessage(null);
    try {
      const response = await apiFetch(`/api/maintenance/tickets/${ticket.id}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(body.error || "Unable to update ticket");
      }
      setStatusMessage({ type: "success", text: `Ticket ${ticket.id} moved to ${status}.` });
      await loadData();
    } catch (err) {
      setStatusMessage({ type: "error", text: err.message });
    } finally {
      setSaving((prev) => ({ ...prev, [`ticket-${ticket.id}`]: false }));
    }
  };

  const startMaintenanceTicket = (device) => {
    const fullDevice = findFullDevice(device);
    setSelectedDevice(fullDevice);
    setMaintenanceForm({
      deviceId: String(fullDevice.id),
      title: `${fullDevice.name} maintenance`,
      description: "",
      priority: "medium",
      assignedTo: "",
    });
    setStatusMessage(null);
  };

  const createMaintenanceTicket = async () => {
    if (!maintenanceForm.title) {
      setStatusMessage({ type: "error", text: "Ticket title is required." });
      return;
    }
    setSaving((prev) => ({ ...prev, maintenanceCreate: true }));
    setStatusMessage(null);
    try {
      const response = await apiFetch("/api/maintenance/tickets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          deviceId: maintenanceForm.deviceId ? Number(maintenanceForm.deviceId) : null,
          title: maintenanceForm.title,
          description: maintenanceForm.description,
          priority: maintenanceForm.priority,
          assignedTo: maintenanceForm.assignedTo || null,
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(body.error || "Unable to create maintenance ticket");
      }
      setStatusMessage({ type: "success", text: `Maintenance ticket ${body.id} created.` });
      setMaintenanceForm({ deviceId: "", title: "", description: "", priority: "medium", assignedTo: "" });
      await loadData();
    } catch (err) {
      setStatusMessage({ type: "error", text: err.message });
    } finally {
      setSaving((prev) => ({ ...prev, maintenanceCreate: false }));
    }
  };

  const enableMaintenanceMode = async (override = {}) => {
    const form = { ...maintenanceModeForm, ...override };
    setSaving((prev) => ({ ...prev, maintenanceMode: true }));
    setStatusMessage(null);
    try {
      const payload = {
        reason: form.reason,
        endsAt: form.endsAt || null,
      };
      if (form.targetType === "device") {
        if (!form.deviceId) throw new Error("Select a device for maintenance mode.");
        payload.deviceId = Number(form.deviceId);
      } else if (form.targetType === "zone") {
        if (!form.zoneId) throw new Error("Select a zone for maintenance mode.");
        payload.zoneId = Number(form.zoneId);
      } else if (form.targetType === "building") {
        if (!form.buildingId) throw new Error("Select a building for maintenance mode.");
        payload.buildingId = Number(form.buildingId);
      }

      const response = await apiFetch("/api/maintenance/modes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "Unable to enable maintenance mode");
      setStatusMessage({ type: "success", text: `${body.scopeType} maintenance mode enabled. Automation writeback will skip matching devices.` });
      await loadData();
    } catch (err) {
      setStatusMessage({ type: "error", text: err.message });
    } finally {
      setSaving((prev) => ({ ...prev, maintenanceMode: false }));
    }
  };

  const disableMaintenanceMode = async (modeId) => {
    setSaving((prev) => ({ ...prev, [`maintenance-mode-${modeId}`]: true }));
    setStatusMessage(null);
    try {
      const response = await apiFetch(`/api/maintenance/modes/${modeId}/disable`, { method: "PATCH" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "Unable to disable maintenance mode");
      setStatusMessage({ type: "success", text: "Maintenance mode disabled." });
      await loadData();
    } catch (err) {
      setStatusMessage({ type: "error", text: err.message });
    } finally {
      setSaving((prev) => ({ ...prev, [`maintenance-mode-${modeId}`]: false }));
    }
  };

  const toggleDeviceMaintenance = async (device) => {
    const activeMode = maintenanceModes.find((mode) => mode.enabled && mode.scopeType === "device" && mode.deviceId === device.id);
    if (activeMode) {
      await disableMaintenanceMode(activeMode.id);
      return;
    }
    await enableMaintenanceMode({
      targetType: "device",
      deviceId: String(device.id),
      reason: `${device.name} service mode`,
    });
  };

  const runDiscovery = async () => {
    setSaving((prev) => ({ ...prev, discovery: true }));
    setStatusMessage(null);
    try {
      const response = await apiFetch("/api/provisioning/discover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lowInstance: Number(discoveryForm.lowInstance || 1),
          highInstance: Number(discoveryForm.highInstance || discoveryForm.lowInstance || 1),
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(body.error || "Unable to run BACnet discovery");
      }
      setDiscoveryResult(body);
      setStatusMessage({ type: "success", text: `Discovery returned ${(body.devices || []).length} devices.` });
    } catch (err) {
      setStatusMessage({ type: "error", text: err.message });
    } finally {
      setSaving((prev) => ({ ...prev, discovery: false }));
    }
  };

  const selectDiscoveredDevice = (device) => {
    const bacnetInstance = device.bacnetInstance ?? device.bacnet_instance ?? "";
    const objectInstance = device.objectInstance ?? device.object_instance ?? 1;
    const objectType = device.objectType ?? device.object_type ?? "analogInput";
    setProvisioningForm((prev) => ({
      ...prev,
      name: device.name || `BACnet ${bacnetInstance}`,
      type: device.type || objectType,
      bacnetInstance: String(bacnetInstance),
      objectInstance: String(objectInstance),
      objectType,
      vendor: device.vendor || "",
      model: device.model || "",
      ipAddress: device.ipAddress || device.ip_address || "",
      units: device.units || "",
      batteryPercent: device.batteryPercent ?? device.configuration?.batteryPercent ?? "",
    }));
  };

  const provisionDevice = async () => {
    setSaving((prev) => ({ ...prev, provisioning: true }));
    setStatusMessage(null);
    try {
      if (!provisioningForm.zoneId || !provisioningForm.name || !provisioningForm.bacnetInstance || !provisioningForm.objectType) {
        throw new Error("Select a zone and discovered BACnet device before provisioning.");
      }
      const configuration = {};
      if (provisioningForm.setpoint !== "") configuration.setpoint = Number(provisioningForm.setpoint);
      if (provisioningForm.minSetpoint !== "") configuration.minSetpoint = Number(provisioningForm.minSetpoint);
      if (provisioningForm.maxSetpoint !== "") configuration.maxSetpoint = Number(provisioningForm.maxSetpoint);
      if (provisioningForm.batteryPercent !== "") configuration.batteryPercent = Number(provisioningForm.batteryPercent);
      if (provisioningForm.eepromWritePolicy !== "disabled") {
        configuration.eepromEnabled = true;
        configuration.eepromAddress = provisioningForm.eepromAddress || "0x0000";
        configuration.eepromSizeBytes = provisioningForm.eepromSizeBytes !== "" ? Number(provisioningForm.eepromSizeBytes) : 256;
        configuration.eepromWritePolicy = provisioningForm.eepromWritePolicy || "on_change";
        configuration.setpointStorage = {
          address: configuration.eepromAddress,
          sizeBytes: configuration.eepromSizeBytes,
          writePolicy: configuration.eepromWritePolicy,
          retainedSetpoint: provisioningForm.setpoint !== "" ? Number(provisioningForm.setpoint) : null,
          checksum: "crc16",
        };
        configuration.persistentStorage = {
          enabled: true,
          medium: provisioningForm.persistentStorageMedium || "EEPROM",
          namespace: provisioningForm.persistentStorageNamespace || "device_config",
          wearLeveling: provisioningForm.wearLeveling !== false,
          retainedKeys: ["identity", "commissioning", "setpoint", "schedule", "range", "calibration", "counters"],
        };
      }
      const response = await apiFetch("/api/devices/provision", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          zoneId: Number(provisioningForm.zoneId),
          name: provisioningForm.name,
          type: provisioningForm.type,
          bacnetInstance: Number(provisioningForm.bacnetInstance),
          objectInstance: Number(provisioningForm.objectInstance || 1),
          objectType: provisioningForm.objectType,
          vendor: provisioningForm.vendor,
          model: provisioningForm.model,
          ipAddress: provisioningForm.ipAddress,
          units: provisioningForm.units,
          description: provisioningForm.description,
          configuration,
          provisioned: true,
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(body.error || "Unable to provision device");
      }
      setStatusMessage({ type: "success", text: `Device ${body.name} provisioned.` });
      setProvisioningForm((prev) => ({ ...prev, name: "", bacnetInstance: "", batteryPercent: "", description: "" }));
      await loadData();
    } catch (err) {
      setStatusMessage({ type: "error", text: err.message });
    } finally {
      setSaving((prev) => ({ ...prev, provisioning: false }));
    }
  };

  const refreshAiContext = async () => {
    const [weatherRes, smartGridRes, graphRes, controlRes] = await Promise.all([
      apiFetch("/api/ai/weather-pricing"),
      apiFetch("/api/ai/smart-grid"),
      apiFetch("/api/ai/airflow-graph"),
      apiFetch("/api/ai/control/status"),
    ]);
    if (weatherRes.ok) setWeatherPricing(await weatherRes.json());
    if (smartGridRes.ok) setSmartGridAi(await smartGridRes.json());
    if (graphRes.ok) setAirflowGraph(await graphRes.json());
    if (controlRes.ok) setControlStatus(await controlRes.json());
  };

  const runSimulation = async () => {
    setSaving((prev) => ({ ...prev, aiControl: true }));
    setStatusMessage(null);
    try {
      const response = await apiFetch("/api/ai/predictive-simulation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ horizonHours: 4, mode: autonomousForm }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "Unable to run simulation");
      setSimulation(body);
      await refreshAiContext();
      setStatusMessage({ type: "success", text: "Predictive digital twin simulation complete." });
    } catch (err) {
      setStatusMessage({ type: "error", text: err.message });
    } finally {
      setSaving((prev) => ({ ...prev, aiControl: false }));
    }
  };

  const runControlIteration = async (apply) => {
    setSaving((prev) => ({ ...prev, aiControl: true }));
    setStatusMessage(null);
    try {
      const response = await apiFetch("/api/ai/control/iterate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apply, mode: autonomousForm }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "Unable to run AI control loop");
      setControlStatus((prev) => ({ ...(prev || {}), lastResult: body, lastRunAt: body.generatedAt }));
      setSimulation(body);
      setStatusMessage({ type: "success", text: apply ? "AI control actions applied." : "AI control loop simulated." });
      await loadData();
    } catch (err) {
      setStatusMessage({ type: "error", text: err.message });
    } finally {
      setSaving((prev) => ({ ...prev, aiControl: false }));
    }
  };

  const startControlLoop = async () => {
    setSaving((prev) => ({ ...prev, aiControl: true }));
    try {
      const response = await apiFetch("/api/ai/control/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apply: false, intervalMs: 60000, mode: autonomousForm }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "Unable to start control loop");
      setControlStatus({ running: body.running, intervalMs: body.intervalMs, lastResult: body.firstRun });
      setStatusMessage({ type: "success", text: "Continuous AI control loop started in simulation mode." });
    } catch (err) {
      setStatusMessage({ type: "error", text: err.message });
    } finally {
      setSaving((prev) => ({ ...prev, aiControl: false }));
    }
  };

  const stopControlLoop = async () => {
    setSaving((prev) => ({ ...prev, aiControl: true }));
    try {
      const response = await apiFetch("/api/ai/control/stop", { method: "POST" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "Unable to stop control loop");
      setControlStatus((prev) => ({ ...(prev || {}), ...body }));
      setStatusMessage({ type: "success", text: "Continuous AI control loop stopped." });
    } catch (err) {
      setStatusMessage({ type: "error", text: err.message });
    } finally {
      setSaving((prev) => ({ ...prev, aiControl: false }));
    }
  };

  const buttonText = (item, action) => {
    if (action === "provision") return item.provisioned ? "Provisioned" : "Provision";
    if (action === "commission") return item.commissioned ? "Commissioned" : "Commission";
    if (action === "ack") return item.acked ? "Acknowledged" : "Acknowledge";
    if (action === "clear") return item.status === "Cleared" ? "Cleared" : "Clear";
    return action;
  };

  if (!session) {
    return (
      <LoginPage
        loginForm={loginForm}
        setLoginForm={setLoginForm}
        onLogin={login}
        loginError={loginError}
        loggingIn={loggingIn}
        loginContext={loginContext}
        darkMode={darkMode}
        onToggleDarkMode={() => setDarkMode((value) => !value)}
      />
    );
  }

  return (
    <div className={`bems-shell bems-enterprise-console ${darkMode ? "bems-dark" : ""}`} style={{ fontFamily: "Inter, system-ui, sans-serif", padding: "24px", minHeight: "100vh" }}>
      <GlobalUiStyles />
      <header className="bems-command-header" style={{ marginBottom: "18px", display: "flex", justifyContent: "space-between", gap: "16px", alignItems: "flex-start", flexWrap: "wrap" }}>
        <div>
          <div className="bems-console-eyebrow">Enterprise WebStation Console</div>
          <h1 style={{ margin: 0, color: "#1f355e" }}>IntelliBuild Energy</h1>
          <p style={{ margin: "8px 0 0", color: "#4a5568" }}>
            From edge to cloud, smarter buildings.
          </p>
          <p style={{ margin: "6px 0 0", color: "#4a5568" }}>
            Monitor alarms, autonomous AI mode, setpoints, BACnet/IP devices, and floorplan placement.
          </p>
          <p style={{ margin: "8px 0 0", color: "#64748b", fontSize: "13px" }}>
            {session.actor} | org {session.organizationId} | site {session.siteId || "all"} | {activeBuilding?.name || session.buildingName || "all buildings"} | realtime SSE
          </p>
        </div>
        <nav className="bems-command-tabs" style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
          <button onClick={() => setView("dashboard")} className={view === "dashboard" ? "is-active" : ""} style={{ ...buttonStyle, backgroundColor: view === "dashboard" ? "#2563eb" : "#64748b" }} {...tooltip("Open the home dashboard with KPIs, live telemetry, AI optimization, alarms, schedules, and commissioning")}>Home</button>
          <button onClick={() => setView("hvac")} className={view === "hvac" ? "is-active" : ""} style={{ ...buttonStyle, backgroundColor: view === "hvac" ? "#2563eb" : "#64748b" }} {...tooltip("Open animated AHU and VAV equipment graphics")}>HVAC Graphics</button>
          <button onClick={() => setView("supervisory")} className={view === "supervisory" ? "is-active" : ""} style={{ ...buttonStyle, backgroundColor: view === "supervisory" ? "#2563eb" : "#64748b" }} {...tooltip("Open EcoStruxure-style supervisory graphics and device tree")}>System Tree</button>
          {canManageUsers && (
            <button
              onClick={() => {
                setView("admin");
                loadAdmin().catch((err) => setStatusMessage({ type: "error", text: err.message }));
              }}
              className={view === "admin" ? "is-active" : ""}
              style={{ ...buttonStyle, backgroundColor: view === "admin" ? "#2563eb" : "#64748b" }}
              {...tooltip("Open tenant, user, role, and feature administration")}
            >
              Admin
            </button>
          )}
          <button
            onClick={() => setDarkMode((value) => !value)}
            style={{ ...buttonStyle, backgroundColor: darkMode ? "#0f766e" : "#1f2937" }}
            {...tooltip("Toggle dark mode for the operator console")}
          >
            {darkMode ? "Light Mode" : "Dark Mode"}
          </button>
          <button onClick={logout} style={{ ...buttonStyle, backgroundColor: "#334155" }} {...tooltip("End this operator session")}>Logout</button>
        </nav>
      </header>

      <div className="bems-console-layout">
        <aside className="bems-sidebar" aria-label="Main navigation">
          <div className="bems-sidebar-title">Navigation</div>
          {[
            ["Home", "dashboard", "Home dashboard with KPIs, telemetry, AI, alarms, schedules"],
            ["Buildings", "supervisory", "Building tree and device context"],
            ["Alarms", "dashboard", "Alarm console and alarm logs"],
            ["Trends", "dashboard", "Charts, history, and live telemetry feed"],
            ["Graphics", "hvac", "AHU, VAV, floorplan, and equipment graphics"],
          ].map(([label, target, title]) => (
            <button
              key={label}
              onClick={() => setView(target)}
              className={`bems-sidebar-button ${view === target ? "is-active" : ""}`}
              {...tooltip(title)}
            >
              <span>{label}</span>
            </button>
          ))}
          {canManageUsers && (
            <button
              onClick={() => {
                setView("admin");
                loadAdmin().catch((err) => setStatusMessage({ type: "error", text: err.message }));
              }}
              className={`bems-sidebar-button ${view === "admin" ? "is-active" : ""}`}
              {...tooltip("Settings, users, roles, tenants, and features")}
            >
              <span>Settings</span>
            </button>
          )}
          <div className="bems-sidebar-meta">
            <strong>{session.actor}</strong>
            <span>org {session.organizationId} | site {session.siteId || "all"}</span>
          </div>
        </aside>

        <main className="bems-main-panel">
          <section className="bems-ops-strip" aria-label="operations status">
            <span><strong>{activeBuilding?.name || session.buildingName || "All Buildings"}</strong> active scope</span>
            <span><strong>{telemetryConnected ? "Live" : "Recovering"}</strong> SSE telemetry</span>
            <span><strong>{activeAlarmCount}</strong> active alarms</span>
            <span><strong>{controlStatus?.running ? "Running" : "Standby"}</strong> AI control</span>
            <span><strong>{buildingFootprint ? `$${buildingFootprint.totals.monthlyCost}` : "Pending"}</strong> monthly energy cost</span>
          </section>

          {statusMessage && (
            <div style={{ padding: "14px 16px", marginBottom: "20px", borderRadius: "8px", backgroundColor: statusMessage.type === "error" ? "#fff1f0" : "#ecfdf3", color: statusMessage.type === "error" ? "#b91c1c" : "#166534" }}>
              {statusMessage.text}
            </div>
          )}

          {loading && <p>Loading dashboard data...</p>}
          {error && <p style={{ color: "#b91c1c" }}>Error: {error}</p>}

      {view === "admin" && (
        <AdminPage
          summary={adminSummary}
          onRefresh={() => loadAdmin().catch((err) => setStatusMessage({ type: "error", text: err.message }))}
          userForm={userForm}
          setUserForm={setUserForm}
          onCreateUser={createUser}
          roleForm={roleForm}
          setRoleForm={setRoleForm}
          onCreateRole={createRole}
          onUpdateUserRole={updateUserRole}
          onToggleUserActive={toggleUserActive}
          onResetUserPassword={resetUserPassword}
          onDeleteUser={deleteUser}
          onToggleFeature={toggleFeature}
        />
      )}

      {view === "supervisory" && !loading && !error && (
        <EcoStruxureStyleMock
          hierarchy={hierarchy}
          alarms={alarms}
          schedules={schedules}
          trendLogs={trendLogs}
          telemetrySeries={telemetrySeries}
          onSelectDevice={openDeviceDetails}
        />
      )}

      {view === "hvac" && !loading && !error && (
        <AhuVavDashboard
          hierarchy={hierarchy}
          telemetrySeries={telemetrySeries}
          trendLogs={trendLogs}
          onSelectDevice={openDeviceDetails}
        />
      )}

      {view === "dashboard" && !loading && !error && (
        <>
          <section className="bems-home-hero" aria-label="Home dashboard">
            <div>
              <div className="bems-console-eyebrow">Home Page</div>
              <h2>Dashboard</h2>
              <p>Unified view for live building health, energy, alarms, AI optimization, schedules, and field device status.</p>
            </div>
          </section>

          <CampusDashboard
            loginContext={loginContext}
            hierarchy={hierarchy}
            fddFindings={fddFindings}
            alarms={alarms}
          />

          <HistoryTimeline history={history} />

          <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "14px", marginBottom: "24px" }}>
            {[
              ["Devices", devices.length],
              ["Active Alarms", activeAlarmCount],
              ["Schedules", activeScheduleCount],
              ["AI Profile", autonomousMode?.profile || "Unknown"],
              ["FDD Findings", openFindingCount],
              ["Tickets", openTicketCount],
              ["Est. Savings", buildingOptimization ? `${buildingOptimization.objective.estimatedSavingsKwh} kWh` : "Pending"],
              ["Monthly Cost", buildingFootprint ? `$${buildingFootprint.totals.monthlyCost}` : "Pending"],
              ["Annual Carbon", buildingFootprint ? `${buildingFootprint.totals.annualCarbonTons} t` : "Pending"],
            ].map(([label, value]) => (
              <div key={label} style={{ ...panelStyle, padding: "16px" }}>
                <div style={{ color: "#64748b", fontSize: "13px" }}>{label}</div>
                <strong style={{ color: "#1f355e", fontSize: "24px" }}>{value}</strong>
              </div>
            ))}
          </section>

          <RealTimeMonitoringPanel
            telemetryConnected={telemetryConnected}
            alarmConnected={alarmStreamConnected}
            lastTelemetryAt={lastTelemetryAt}
            devices={devices}
            alarms={alarms}
            telemetryFeed={telemetryFeed}
            trendLogs={trendLogs}
          />

          <EventDrivenArchitecturePanel events={eventStatus} />

          <EdgePlatformCapabilitiesPanel capabilities={edgeCapabilities} />

          <BuildingFootprintPanel footprint={buildingFootprint} />

          <ReportingCenter
            reportSummary={reportSummary}
            reportSchedules={reportSchedules}
            reportExports={reportExports}
            reportRuns={reportRuns}
            reportScheduleForm={reportScheduleForm}
            setReportScheduleForm={setReportScheduleForm}
            onCreateSchedule={createReportSchedule}
            onRunSchedule={runReportSchedule}
            onRunDueSchedules={runDueReportSchedules}
          />

          <ReportHeatMap heatMap={reportHeatMap} />

          <AutonomousModePanel
            form={autonomousForm}
            setForm={setAutonomousForm}
            mode={autonomousMode}
            optimization={optimization}
            buildingOptimization={buildingOptimization}
            scheduleSetpoints={scheduleSetpoints}
            onApply={applyAutonomousMode}
            onApplySetpoints={applyAutomatedScheduleSetpoints}
            saving={autonomousSaving}
          />

          <AiControlPanel
            weatherPricing={weatherPricing}
            smartGridAi={smartGridAi}
            airflowGraph={airflowGraph}
            simulation={simulation}
            controlStatus={controlStatus}
            onSimulate={runSimulation}
            onIterate={runControlIteration}
            onStart={startControlLoop}
            onStop={stopControlLoop}
            running={saving.aiControl}
          />

          <ReinforcementLearningPanel policy={rlPolicy} controlStatus={controlStatus} />

          <section style={{ display: "grid", gridTemplateColumns: "minmax(320px, 1.2fr) minmax(300px, 0.9fr)", gap: "18px", marginBottom: "28px" }}>
            <div style={{ ...panelStyle, padding: "16px" }}>
              <h2 style={{ margin: "0 0 12px", color: "#2c5282" }}>Trend Charts</h2>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: "14px" }}>
                <div>
                  <h3 style={{ margin: "0 0 8px", color: "#334155", fontSize: "15px" }}>Temperature History</h3>
                  <TemperatureHistoryChart telemetrySeries={telemetrySeries} />
                </div>
                <div>
                  <h3 style={{ margin: "0 0 8px", color: "#334155", fontSize: "15px" }}>Energy Usage Graphs / Dashboard</h3>
                  <EnergyUsageCharts telemetrySeries={telemetrySeries} />
                </div>
              </div>
            </div>
            <TelemetryFeed feed={telemetryFeed} />
          </section>

          <DeviceProvisioningPanel
            zones={zones}
            discoveryForm={discoveryForm}
            setDiscoveryForm={setDiscoveryForm}
            discoveryResult={discoveryResult}
            provisioningForm={provisioningForm}
            setProvisioningForm={setProvisioningForm}
            onDiscover={runDiscovery}
            onSelectDiscovered={selectDiscoveredDevice}
            onProvision={provisionDevice}
            discovering={saving.discovery}
            provisioning={saving.provisioning}
          />

          <section style={{ display: "grid", gridTemplateColumns: "minmax(300px, 1fr) minmax(320px, 1.2fr)", gap: "18px", marginBottom: "28px" }}>
            <div style={{ ...panelStyle, padding: "16px" }}>
              <h2 style={{ margin: "0 0 12px", color: "#2c5282" }}>Live Device Values</h2>
              <MiniBarChart devices={devices} />
            </div>
            <FloorplanEditor devices={devices} alarms={alarms} layout={floorplanLayout} onLayoutChange={setFloorplanLayout} onSelectDevice={openDeviceDetails} alarmColors={alarmColorOverrides} />
          </section>

          <section style={{ marginBottom: "28px" }}>
            <DigitalTwinView twin={digitalTwin} onSelectDevice={openDeviceDetails} />
          </section>

          <ZoneDeviceBrowser
            hierarchy={hierarchy}
            selectedZoneId={selectedZoneId}
            onSelectZone={setSelectedZoneId}
            onSelectDevice={openDeviceDetails}
          />

          <DeviceDetailsPanel
            device={selectedDevice}
            findings={fddFindings}
            tickets={maintenanceTickets}
            onClose={() => setSelectedDevice(null)}
            onConfigure={openDeviceConfig}
            onCreateTicket={startMaintenanceTicket}
            onToggleMaintenance={toggleDeviceMaintenance}
          />

          {optimization && autonomousMode && (
            <section style={{ marginBottom: "28px" }}>
              <h2 style={{ marginBottom: "16px", color: "#2c5282" }}>AI Optimization Engine</h2>
              <div style={{ ...panelStyle, padding: "16px" }}>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "12px", marginBottom: "16px" }}>
                  <div><strong>{autonomousMode.profile}</strong><div style={{ color: "#64748b" }}>Autonomous profile</div></div>
                  <div><strong>{optimization.summary.estimatedSavingsKwh} kWh</strong><div style={{ color: "#64748b" }}>Projected savings</div></div>
                  <div><strong>${optimization.summary.estimatedCostSavings}</strong><div style={{ color: "#64748b" }}>Projected cost savings</div></div>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: "12px" }}>
                  {optimization.recommendations.slice(0, 6).map((item) => (
                    <div key={item.deviceId} style={{ border: "1px solid #e2e8f0", borderRadius: "8px", padding: "12px" }}>
                      <strong style={{ color: "#1f355e" }}>{item.deviceName}</strong>
                      <div style={{ color: "#475569", marginTop: "6px" }}>{item.currentSetpoint} to {item.targetSetpoint}</div>
                      <div style={{ color: "#64748b", fontSize: "13px", marginTop: "6px" }}>{item.reason}</div>
                    </div>
                  ))}
                </div>
              </div>
            </section>
          )}

          {buildingOptimization && (
            <section style={{ marginBottom: "28px" }}>
              <h2 style={{ marginBottom: "16px", color: "#2c5282" }}>Multi-Zone Reinforcement Learning</h2>
              <div style={{ ...panelStyle, padding: "16px" }}>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "12px", marginBottom: "16px" }}>
                  <div><strong>{buildingOptimization.learning.algorithm}</strong><div style={{ color: "#64748b" }}>Learning policy</div></div>
                  <div><strong>{buildingOptimization.learning.stateCount}</strong><div style={{ color: "#64748b" }}>Learned states</div></div>
                  <div><strong>{buildingOptimization.objective.estimatedCostSavings}</strong><div style={{ color: "#64748b" }}>Building cost savings</div></div>
                  <div><strong>{rlPolicy.length}</strong><div style={{ color: "#64748b" }}>Persisted Q-values</div></div>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: "12px" }}>
                  {buildingOptimization.zonePlans.map((zone) => (
                    <div key={zone.zoneId} style={{ border: "1px solid #e2e8f0", borderRadius: "8px", padding: "12px" }}>
                      <strong style={{ color: "#1f355e" }}>{zone.zoneName}</strong>
                      <div style={{ color: "#475569", marginTop: "6px" }}>Delta {zone.coordinatedDelta} | Score {zone.objectiveScore}</div>
                      <div style={{ color: "#64748b", fontSize: "13px", marginTop: "6px" }}>{zone.energySavingsKwh} kWh saved, comfort penalty {zone.comfortPenalty}</div>
                    </div>
                  ))}
                </div>
                {optimizationHistory.length > 0 && (
                  <div style={{ marginTop: "16px", color: "#475569", fontSize: "13px" }}>
                    Last persisted optimization: {optimizationHistory[0].source} | {optimizationHistory[0].profile || "profile n/a"} | {optimizationHistory[0].estimatedSavingsKwh ?? "-"} kWh
                  </div>
                )}
              </div>
            </section>
          )}

          <section style={{ marginBottom: "28px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px", gap: "12px", flexWrap: "wrap" }}>
              <h2 style={{ margin: 0, color: "#2c5282" }}>Fault Detection</h2>
              <button onClick={runFddAnalysis} disabled={saving.fdd} style={{ ...buttonStyle, backgroundColor: "#0f766e" }}>
                {saving.fdd ? "Analyzing..." : "Run FDD"}
              </button>
            </div>
            <div style={{ ...panelStyle, overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", minWidth: "920px" }}>
                <thead>
                  <tr>
                    <th style={headerStyle}>Severity</th>
                    <th style={headerStyle}>Device</th>
                    <th style={headerStyle}>Zone</th>
                    <th style={headerStyle}>Fault</th>
                    <th style={headerStyle}>Message</th>
                    <th style={headerStyle}>Status</th>
                    <th style={headerStyle}>Created</th>
                  </tr>
                </thead>
                <tbody>
                  {fddFindings.length === 0 ? (
                    <tr><td colSpan={7} style={{ ...cellStyle, textAlign: "center" }}>No FDD findings. Run analysis to evaluate devices.</td></tr>
                  ) : fddFindings.slice(0, 12).map((finding) => (
                    <tr key={finding.id}>
                      <td style={cellStyle}>{finding.severity}</td>
                      <td style={cellStyle}>{finding.deviceName || `Device ${finding.deviceId || "N/A"}`}</td>
                      <td style={cellStyle}>{finding.zoneName || "-"}</td>
                      <td style={cellStyle}>{finding.faultCode}</td>
                      <td style={cellStyle}>{finding.message}</td>
                      <td style={cellStyle}>{finding.status}</td>
                      <td style={cellStyle}>{finding.createdAt ? new Date(finding.createdAt).toLocaleString() : "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section style={{ marginBottom: "32px" }}>
            <h2 style={{ marginBottom: "16px", color: "#2c5282" }}>Maintenance Tickets</h2>
            <div style={{ ...panelStyle, padding: "16px", marginBottom: "14px" }}>
              <h3 style={{ margin: "0 0 12px", color: "#334155" }}>Maintenance Mode</h3>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "12px", alignItems: "end" }}>
                <label style={{ color: "#334155" }}>
                  Scope
                  <select value={maintenanceModeForm.targetType} onChange={(event) => setMaintenanceModeForm((prev) => ({ ...prev, targetType: event.target.value }))} style={{ ...inputStyle, marginTop: "6px", backgroundColor: "white" }}>
                    <option value="building">Building</option>
                    <option value="zone">Zone</option>
                    <option value="device">Device</option>
                  </select>
                </label>
                {maintenanceModeForm.targetType === "building" && (
                  <label style={{ color: "#334155" }}>
                    Building
                    <select value={maintenanceModeForm.buildingId} onChange={(event) => setMaintenanceModeForm((prev) => ({ ...prev, buildingId: event.target.value }))} style={{ ...inputStyle, marginTop: "6px", backgroundColor: "white" }}>
                      {buildings.map((building) => <option key={building.id} value={building.id}>{building.name}</option>)}
                    </select>
                  </label>
                )}
                {maintenanceModeForm.targetType === "zone" && (
                  <label style={{ color: "#334155" }}>
                    Zone
                    <select value={maintenanceModeForm.zoneId} onChange={(event) => setMaintenanceModeForm((prev) => ({ ...prev, zoneId: event.target.value }))} style={{ ...inputStyle, marginTop: "6px", backgroundColor: "white" }}>
                      <option value="">Select zone</option>
                      {zones.map((zone) => <option key={zone.id} value={zone.id}>{zone.buildingName} / {formatZonePath(zone)}</option>)}
                    </select>
                  </label>
                )}
                {maintenanceModeForm.targetType === "device" && (
                  <label style={{ color: "#334155" }}>
                    Device
                    <select value={maintenanceModeForm.deviceId} onChange={(event) => setMaintenanceModeForm((prev) => ({ ...prev, deviceId: event.target.value }))} style={{ ...inputStyle, marginTop: "6px", backgroundColor: "white" }}>
                      <option value="">Select device</option>
                      {devices.map((device) => <option key={device.id} value={device.id}>{device.buildingName} / {device.zoneName} / {device.name}</option>)}
                    </select>
                  </label>
                )}
                <label style={{ color: "#334155" }}>
                  Ends At
                  <input type="datetime-local" value={maintenanceModeForm.endsAt} onChange={(event) => setMaintenanceModeForm((prev) => ({ ...prev, endsAt: event.target.value }))} style={{ ...inputStyle, marginTop: "6px" }} />
                </label>
                <label style={{ color: "#334155" }}>
                  Reason
                  <input value={maintenanceModeForm.reason} onChange={(event) => setMaintenanceModeForm((prev) => ({ ...prev, reason: event.target.value }))} style={{ ...inputStyle, marginTop: "6px" }} />
                </label>
                <button onClick={() => enableMaintenanceMode()} disabled={saving.maintenanceMode} style={{ ...buttonStyle, backgroundColor: "#f59e0b", height: "40px" }}>
                  {saving.maintenanceMode ? "Enabling..." : "Enable Mode"}
                </button>
              </div>
              <div style={{ overflowX: "auto", marginTop: "14px", border: "1px solid #e2e8f0", borderRadius: "6px" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", minWidth: "900px" }}>
                  <thead>
                    <tr>
                      <th style={headerStyle}>Scope</th>
                      <th style={headerStyle}>Target</th>
                      <th style={headerStyle}>Reason</th>
                      <th style={headerStyle}>Ends</th>
                      <th style={headerStyle}>Status</th>
                      <th style={headerStyle}>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {maintenanceModes.length === 0 ? (
                      <tr><td colSpan={6} style={{ ...cellStyle, textAlign: "center" }}>No maintenance modes.</td></tr>
                    ) : maintenanceModes.map((mode) => (
                      <tr key={mode.id}>
                        <td style={cellStyle}>{mode.scopeType}</td>
                        <td style={cellStyle}>{mode.deviceName || mode.zonePath || mode.zoneName || mode.buildingName || "-"}</td>
                        <td style={cellStyle}>{mode.reason || "-"}</td>
                        <td style={cellStyle}>{mode.endsAt ? new Date(mode.endsAt).toLocaleString() : "manual"}</td>
                        <td style={cellStyle}>{mode.enabled ? "Enabled" : "Disabled"}</td>
                        <td style={cellStyle}>
                          <button onClick={() => disableMaintenanceMode(mode.id)} disabled={!mode.enabled || saving[`maintenance-mode-${mode.id}`]} style={{ ...buttonStyle, backgroundColor: mode.enabled ? "#dc2626" : "#94a3b8" }}>
                            Disable
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            <div style={{ ...panelStyle, padding: "16px", marginBottom: "14px" }}>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "12px", alignItems: "end" }}>
                <label style={{ color: "#334155" }}>
                  Device
                  <select
                    value={maintenanceForm.deviceId}
                    onChange={(event) => setMaintenanceForm((prev) => ({ ...prev, deviceId: event.target.value }))}
                    style={{ ...inputStyle, marginTop: "6px", backgroundColor: "white" }}
                  >
                    <option value="">No device</option>
                    {devices.map((device) => <option key={device.id} value={device.id}>{device.name}</option>)}
                  </select>
                </label>
                <label style={{ color: "#334155" }}>
                  Title
                  <input value={maintenanceForm.title} onChange={(event) => setMaintenanceForm((prev) => ({ ...prev, title: event.target.value }))} style={{ ...inputStyle, marginTop: "6px" }} />
                </label>
                <label style={{ color: "#334155" }}>
                  Priority
                  <select value={maintenanceForm.priority} onChange={(event) => setMaintenanceForm((prev) => ({ ...prev, priority: event.target.value }))} style={{ ...inputStyle, marginTop: "6px", backgroundColor: "white" }}>
                    <option value="low">low</option>
                    <option value="medium">medium</option>
                    <option value="high">high</option>
                    <option value="critical">critical</option>
                  </select>
                </label>
                <label style={{ color: "#334155" }}>
                  Assigned To
                  <input value={maintenanceForm.assignedTo} onChange={(event) => setMaintenanceForm((prev) => ({ ...prev, assignedTo: event.target.value }))} style={{ ...inputStyle, marginTop: "6px" }} />
                </label>
                <button onClick={createMaintenanceTicket} disabled={saving.maintenanceCreate} style={{ ...buttonStyle, backgroundColor: "#0f766e", height: "40px" }}>
                  {saving.maintenanceCreate ? "Creating..." : "Create Ticket"}
                </button>
              </div>
              <label style={{ color: "#334155", display: "block", marginTop: "12px" }}>
                Description
                <input value={maintenanceForm.description} onChange={(event) => setMaintenanceForm((prev) => ({ ...prev, description: event.target.value }))} style={{ ...inputStyle, marginTop: "6px" }} />
              </label>
            </div>
            <div style={{ ...panelStyle, overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", minWidth: "900px" }}>
                <thead>
                  <tr>
                    <th style={headerStyle}>Ticket</th>
                    <th style={headerStyle}>Device</th>
                    <th style={headerStyle}>Priority</th>
                    <th style={headerStyle}>Status</th>
                    <th style={headerStyle}>Created</th>
                    <th style={headerStyle}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {maintenanceTickets.length === 0 ? (
                    <tr><td colSpan={6} style={{ ...cellStyle, textAlign: "center" }}>No maintenance tickets.</td></tr>
                  ) : maintenanceTickets.slice(0, 12).map((ticket) => (
                    <tr key={ticket.id}>
                      <td style={cellStyle}><strong>{ticket.title}</strong><div style={{ color: "#64748b", fontSize: "13px" }}>{ticket.description || "-"}</div></td>
                      <td style={cellStyle}>{ticket.deviceName || `Device ${ticket.deviceId || "N/A"}`}</td>
                      <td style={cellStyle}>{ticket.priority}</td>
                      <td style={cellStyle}>{ticket.status}</td>
                      <td style={cellStyle}>{ticket.createdAt ? new Date(ticket.createdAt).toLocaleString() : "-"}</td>
                      <td style={cellStyle}>
                        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                          <button onClick={() => updateTicketStatus(ticket, "in_progress")} disabled={saving[`ticket-${ticket.id}`] || ticket.status === "in_progress"} style={{ ...buttonStyle, backgroundColor: "#2563eb" }}>Start</button>
                          <button onClick={() => updateTicketStatus(ticket, "closed")} disabled={saving[`ticket-${ticket.id}`] || ticket.status === "closed"} style={{ ...buttonStyle, backgroundColor: "#16a34a" }}>Close</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section style={{ marginBottom: "32px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px", gap: "12px", flexWrap: "wrap" }}>
              <h2 style={{ margin: 0, color: "#2c5282" }}>Alarm Engine</h2>
              <button onClick={loadData} style={{ ...buttonStyle, backgroundColor: "#2563eb" }} {...tooltip("Refresh alarms, logs, telemetry, and dashboard state")}>Refresh</button>
            </div>
            <div style={{ ...panelStyle, padding: "14px 16px", marginBottom: "14px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: "14px", alignItems: "center", flexWrap: "wrap" }}>
                <div>
                  <h3 style={{ margin: 0, color: "#334155", fontSize: "15px" }}>Alarm Color Overrides</h3>
                  <p style={{ margin: "5px 0 0", color: "#64748b", fontSize: "13px" }}>Applies to alarm tables and floorplan overlays.</p>
                </div>
                <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
                  {alarmSeverityKeys.map((severity) => (
                    <label key={severity} style={{ display: "flex", alignItems: "center", gap: "7px", color: "#334155", fontSize: "13px", textTransform: "capitalize" }}>
                      <input
                        type="color"
                        value={alarmColorOverrides[severity] || defaultAlarmColors[severity]}
                        onChange={(event) => updateAlarmColor(severity, event.target.value)}
                        style={{ width: "34px", height: "28px", padding: "2px", border: "1px solid #cbd5e1", borderRadius: "6px", cursor: "pointer" }}
                        {...tooltip(`Set ${severity} alarm overlay color`)}
                      />
                      {severity}
                    </label>
                  ))}
                </div>
              </div>
            </div>
            <div style={{ ...panelStyle, overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", minWidth: "920px" }}>
                <thead>
                  <tr>
                    <th style={headerStyle}>Alarm ID</th>
                    <th style={headerStyle}>Device</th>
                    <th style={headerStyle}>Message</th>
                    <th style={headerStyle}>Severity</th>
                    <th style={headerStyle}>Status</th>
                    <th style={headerStyle}>Acknowledged</th>
                    <th style={headerStyle}>Created</th>
                    <th style={headerStyle}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {alarms.length === 0 ? (
                    <tr><td colSpan={8} style={{ ...cellStyle, textAlign: "center" }}>No alarms found.</td></tr>
                  ) : alarms.map((alarm) => {
                    const alarmColor = getAlarmColor(alarm, alarmColorOverrides);
                    return (
                      <tr key={alarm.id} style={{ borderLeft: `4px solid ${alarmColor}` }}>
                        <td style={cellStyle}>{alarm.id}</td>
                        <td style={cellStyle}>{alarm.deviceName || `Device ${alarm.deviceId || "N/A"}`}</td>
                        <td style={cellStyle}>{alarm.message}</td>
                        <td style={cellStyle}>
                          <span className="bems-severity-chip" style={{ backgroundColor: alarmColor }} {...tooltip(`Alarm severity: ${alarm.severity}`)}>
                            {alarm.severity}
                          </span>
                        </td>
                        <td style={cellStyle}>
                          <span className="bems-status-dot" style={{ backgroundColor: alarm.status === "Cleared" ? alarmColorOverrides.cleared : alarmColor }} />
                          {alarm.status}
                        </td>
                        <td style={cellStyle}>{alarm.acked ? "Yes" : "No"}</td>
                        <td style={cellStyle}>{new Date(alarm.createdAt).toLocaleString()}</td>
                        <td style={cellStyle}>
                          <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                            <button
                              onClick={() => handleAlarmAction(alarm.id, "ack")}
                              disabled={alarm.acked || saving[alarm.id] || alarm.status === "Cleared"}
                              style={{ ...buttonStyle, backgroundColor: alarm.acked || alarm.status === "Cleared" ? "#94a3b8" : "#f59e0b" }}
                              {...tooltip(`Acknowledge alarm ${alarm.id}`)}
                            >
                              {buttonText(alarm, "ack")}
                            </button>
                            <button
                              onClick={() => handleAlarmAction(alarm.id, "clear")}
                              disabled={alarm.status === "Cleared" || saving[alarm.id]}
                              style={{ ...buttonStyle, backgroundColor: alarm.status === "Cleared" ? "#94a3b8" : "#dc2626" }}
                              {...tooltip(`Clear alarm ${alarm.id}`)}
                            >
                              {buttonText(alarm, "clear")}
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>

          <section style={{ marginBottom: "32px" }}>
            <h2 style={{ marginBottom: "16px", color: "#2c5282" }}>Alarm Logs</h2>
            <div style={{ ...panelStyle, overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", minWidth: "980px" }}>
                <thead>
                  <tr>
                    <th style={headerStyle}>Time</th>
                    <th style={headerStyle}>Alarm</th>
                    <th style={headerStyle}>Device</th>
                    <th style={headerStyle}>Event</th>
                    <th style={headerStyle}>Severity</th>
                    <th style={headerStyle}>Status</th>
                    <th style={headerStyle}>Actor</th>
                    <th style={headerStyle}>Message</th>
                  </tr>
                </thead>
                <tbody>
                  {alarmLogs.length === 0 ? (
                    <tr><td colSpan={8} style={{ ...cellStyle, textAlign: "center" }}>No alarm log events.</td></tr>
                  ) : alarmLogs.slice(0, 50).map((log) => (
                    <tr key={log.id}>
                      <td style={cellStyle}>{log.createdAt ? new Date(log.createdAt).toLocaleString() : "-"}</td>
                      <td style={cellStyle}>{log.alarmId || "-"}</td>
                      <td style={cellStyle}>{log.deviceName || `Device ${log.deviceId || "N/A"}`}</td>
                      <td style={cellStyle}>{log.eventType}</td>
                      <td style={cellStyle}>{log.severity || "-"}</td>
                      <td style={cellStyle}>{log.status || "-"}</td>
                      <td style={cellStyle}>{log.actor || "-"}</td>
                      <td style={cellStyle}>{log.message || "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section style={{ marginBottom: "32px" }}>
            <h2 style={{ marginBottom: "16px", color: "#2c5282" }}>Scheduling System</h2>
            <WeeklyTimelineEditor schedules={schedules} />
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: "14px", marginBottom: "14px" }}>
              <div style={{ ...panelStyle, padding: "16px" }}>
                <h3 style={{ marginTop: 0, color: "#334155" }}>Holiday Schedules</h3>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: "12px", alignItems: "end" }}>
                  <label style={{ color: "#334155" }}>
                    Name
                    <input value={holidayForm.name} onChange={(event) => setHolidayForm((prev) => ({ ...prev, name: event.target.value }))} style={{ ...inputStyle, marginTop: "6px" }} />
                  </label>
                  <label style={{ color: "#334155" }}>
                    Building
                    <select value={holidayForm.buildingId} onChange={(event) => setHolidayForm((prev) => ({ ...prev, buildingId: event.target.value }))} style={{ ...inputStyle, marginTop: "6px", backgroundColor: "white" }}>
                      <option value="">Global</option>
                      {buildings.map((building) => <option key={building.id} value={building.id}>{building.name}</option>)}
                    </select>
                  </label>
                  <label style={{ color: "#334155" }}>
                    Date
                    <input type="date" value={holidayForm.eventDate} onChange={(event) => setHolidayForm((prev) => ({ ...prev, eventDate: event.target.value }))} style={{ ...inputStyle, marginTop: "6px" }} />
                  </label>
                  <label style={{ color: "#334155" }}>
                    Recurring
                    <select value={holidayForm.recurring ? "true" : "false"} onChange={(event) => setHolidayForm((prev) => ({ ...prev, recurring: event.target.value === "true" }))} style={{ ...inputStyle, marginTop: "6px", backgroundColor: "white" }}>
                      <option value="true">Yearly</option>
                      <option value="false">One time</option>
                    </select>
                  </label>
                  <label style={{ color: "#334155" }}>
                    Month
                    <input type="number" min="1" max="12" value={holidayForm.month} onChange={(event) => setHolidayForm((prev) => ({ ...prev, month: event.target.value }))} style={{ ...inputStyle, marginTop: "6px" }} />
                  </label>
                  <label style={{ color: "#334155" }}>
                    Day
                    <input type="number" min="1" max="31" value={holidayForm.dayOfMonth} onChange={(event) => setHolidayForm((prev) => ({ ...prev, dayOfMonth: event.target.value }))} style={{ ...inputStyle, marginTop: "6px" }} />
                  </label>
                  <label style={{ color: "#334155" }}>
                    Start
                    <input type="time" value={holidayForm.startTime} onChange={(event) => setHolidayForm((prev) => ({ ...prev, startTime: event.target.value }))} style={{ ...inputStyle, marginTop: "6px" }} />
                  </label>
                  <label style={{ color: "#334155" }}>
                    End
                    <input type="time" value={holidayForm.endTime} onChange={(event) => setHolidayForm((prev) => ({ ...prev, endTime: event.target.value }))} style={{ ...inputStyle, marginTop: "6px" }} />
                  </label>
                  <label style={{ color: "#334155" }}>
                    Action
                    <input value={holidayForm.action} onChange={(event) => setHolidayForm((prev) => ({ ...prev, action: event.target.value }))} style={{ ...inputStyle, marginTop: "6px" }} />
                  </label>
                  <label style={{ color: "#334155" }}>
                    Value
                    <input value={holidayForm.targetValue} onChange={(event) => setHolidayForm((prev) => ({ ...prev, targetValue: event.target.value }))} style={{ ...inputStyle, marginTop: "6px" }} />
                  </label>
                  <button onClick={createHolidaySchedule} disabled={saving.holidayCreate} style={{ ...buttonStyle, backgroundColor: "#0f766e", height: "40px" }}>
                    {saving.holidayCreate ? "Creating..." : "Create Holiday"}
                  </button>
                </div>
              </div>
              <div style={{ ...panelStyle, padding: "16px" }}>
                <h3 style={{ marginTop: 0, color: "#334155" }}>Special Events</h3>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: "12px", alignItems: "end" }}>
                  <label style={{ color: "#334155" }}>
                    Name
                    <input value={specialEventForm.name} onChange={(event) => setSpecialEventForm((prev) => ({ ...prev, name: event.target.value }))} style={{ ...inputStyle, marginTop: "6px" }} />
                  </label>
                  <label style={{ color: "#334155" }}>
                    Scope
                    <select value={specialEventForm.targetType} onChange={(event) => setSpecialEventForm((prev) => ({ ...prev, targetType: event.target.value }))} style={{ ...inputStyle, marginTop: "6px", backgroundColor: "white" }}>
                      <option value="building">Building</option>
                      <option value="zone">Zone</option>
                      <option value="device">Device</option>
                    </select>
                  </label>
                  {specialEventForm.targetType === "building" && (
                    <label style={{ color: "#334155" }}>
                      Building
                      <select value={specialEventForm.buildingId} onChange={(event) => setSpecialEventForm((prev) => ({ ...prev, buildingId: event.target.value }))} style={{ ...inputStyle, marginTop: "6px", backgroundColor: "white" }}>
                        {buildings.map((building) => <option key={building.id} value={building.id}>{building.name}</option>)}
                      </select>
                    </label>
                  )}
                  {specialEventForm.targetType === "zone" && (
                    <label style={{ color: "#334155" }}>
                      Zone
                      <select value={specialEventForm.zoneId} onChange={(event) => setSpecialEventForm((prev) => ({ ...prev, zoneId: event.target.value }))} style={{ ...inputStyle, marginTop: "6px", backgroundColor: "white" }}>
                        <option value="">Select zone</option>
                        {zones.map((zone) => <option key={zone.id} value={zone.id}>{zone.buildingName} / {formatZonePath(zone)}</option>)}
                      </select>
                    </label>
                  )}
                  {specialEventForm.targetType === "device" && (
                    <label style={{ color: "#334155" }}>
                      Device
                      <select value={specialEventForm.deviceId} onChange={(event) => setSpecialEventForm((prev) => ({ ...prev, deviceId: event.target.value }))} style={{ ...inputStyle, marginTop: "6px", backgroundColor: "white" }}>
                        <option value="">Select device</option>
                        {devices.map((device) => <option key={device.id} value={device.id}>{device.buildingName} / {device.zoneName} / {device.name}</option>)}
                      </select>
                    </label>
                  )}
                  <label style={{ color: "#334155" }}>
                    Start
                    <input type="datetime-local" value={specialEventForm.startAt} onChange={(event) => setSpecialEventForm((prev) => ({ ...prev, startAt: event.target.value }))} style={{ ...inputStyle, marginTop: "6px" }} />
                  </label>
                  <label style={{ color: "#334155" }}>
                    End
                    <input type="datetime-local" value={specialEventForm.endAt} onChange={(event) => setSpecialEventForm((prev) => ({ ...prev, endAt: event.target.value }))} style={{ ...inputStyle, marginTop: "6px" }} />
                  </label>
                  <label style={{ color: "#334155" }}>
                    Priority
                    <input type="number" value={specialEventForm.priority} onChange={(event) => setSpecialEventForm((prev) => ({ ...prev, priority: event.target.value }))} style={{ ...inputStyle, marginTop: "6px" }} />
                  </label>
                  <label style={{ color: "#334155" }}>
                    Action
                    <input value={specialEventForm.action} onChange={(event) => setSpecialEventForm((prev) => ({ ...prev, action: event.target.value }))} style={{ ...inputStyle, marginTop: "6px" }} />
                  </label>
                  <label style={{ color: "#334155" }}>
                    Value
                    <input value={specialEventForm.targetValue} onChange={(event) => setSpecialEventForm((prev) => ({ ...prev, targetValue: event.target.value }))} style={{ ...inputStyle, marginTop: "6px" }} />
                  </label>
                  <button onClick={createSpecialEvent} disabled={saving.specialEventCreate} style={{ ...buttonStyle, backgroundColor: "#2563eb", height: "40px" }}>
                    {saving.specialEventCreate ? "Creating..." : "Create Event"}
                  </button>
                </div>
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: "14px", marginBottom: "14px" }}>
              <div style={{ ...panelStyle, overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", minWidth: "720px" }}>
                  <thead>
                    <tr>
                      <th style={headerStyle}>Holiday</th>
                      <th style={headerStyle}>Building</th>
                      <th style={headerStyle}>Date</th>
                      <th style={headerStyle}>Window</th>
                      <th style={headerStyle}>Action</th>
                      <th style={headerStyle}>Status</th>
                      <th style={headerStyle}>Control</th>
                    </tr>
                  </thead>
                  <tbody>
                    {holidaySchedules.length === 0 ? (
                      <tr><td colSpan={7} style={{ ...cellStyle, textAlign: "center" }}>No holiday schedules configured.</td></tr>
                    ) : holidaySchedules.map((holiday) => (
                      <tr key={holiday.id}>
                        <td style={cellStyle}>{holiday.name}</td>
                        <td style={cellStyle}>{holiday.buildingName || "Global"}</td>
                        <td style={cellStyle}>{holiday.eventDate || `${holiday.month}/${holiday.dayOfMonth}`} {holiday.recurring ? "yearly" : ""}</td>
                        <td style={cellStyle}>{holiday.startTime} - {holiday.endTime}</td>
                        <td style={cellStyle}>{holiday.action} {holiday.targetValue ?? ""} {holiday.units || ""}</td>
                        <td style={cellStyle}>{holiday.enabled ? "Enabled" : "Disabled"}</td>
                        <td style={cellStyle}>
                          <button onClick={() => disableHolidaySchedule(holiday.id)} disabled={!holiday.enabled || saving[`holiday-${holiday.id}`]} style={{ ...buttonStyle, backgroundColor: holiday.enabled ? "#dc2626" : "#94a3b8" }}>
                            Disable
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div style={{ ...panelStyle, overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", minWidth: "820px" }}>
                  <thead>
                    <tr>
                      <th style={headerStyle}>Event</th>
                      <th style={headerStyle}>Target</th>
                      <th style={headerStyle}>Window</th>
                      <th style={headerStyle}>Priority</th>
                      <th style={headerStyle}>Action</th>
                      <th style={headerStyle}>Status</th>
                      <th style={headerStyle}>Control</th>
                    </tr>
                  </thead>
                  <tbody>
                    {specialEvents.length === 0 ? (
                      <tr><td colSpan={7} style={{ ...cellStyle, textAlign: "center" }}>No special events configured.</td></tr>
                    ) : specialEvents.map((eventItem) => (
                      <tr key={eventItem.id}>
                        <td style={cellStyle}>{eventItem.name}</td>
                        <td style={cellStyle}>{formatScheduleTarget(eventItem)}</td>
                        <td style={cellStyle}>{eventItem.startAt} - {eventItem.endAt}</td>
                        <td style={cellStyle}>{eventItem.priority}</td>
                        <td style={cellStyle}>{eventItem.action} {eventItem.targetValue ?? ""} {eventItem.units || ""}</td>
                        <td style={cellStyle}>{eventItem.enabled ? "Enabled" : "Disabled"}</td>
                        <td style={cellStyle}>
                          <button onClick={() => disableSpecialEvent(eventItem.id)} disabled={!eventItem.enabled || saving[`special-event-${eventItem.id}`]} style={{ ...buttonStyle, backgroundColor: eventItem.enabled ? "#dc2626" : "#94a3b8" }}>
                            Disable
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            <div style={{ ...panelStyle, padding: "16px", marginBottom: "14px" }}>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "12px", alignItems: "end" }}>
                <label style={{ color: "#334155" }}>
                  Schedule
                  <input value={scheduleForm.name} onChange={(event) => setScheduleForm((prev) => ({ ...prev, name: event.target.value }))} style={{ ...inputStyle, marginTop: "6px" }} />
                </label>
                <label style={{ color: "#334155" }}>
                  Scope
                  <select value={scheduleForm.targetType} onChange={(event) => setScheduleForm((prev) => ({ ...prev, targetType: event.target.value }))} style={{ ...inputStyle, marginTop: "6px", backgroundColor: "white" }}>
                    <option value="building">Building</option>
                    <option value="zone">Zone</option>
                    <option value="device">Device</option>
                  </select>
                </label>
                {scheduleForm.targetType === "building" && (
                  <label style={{ color: "#334155" }}>
                    Building
                    <select value={scheduleForm.buildingId} onChange={(event) => setScheduleForm((prev) => ({ ...prev, buildingId: event.target.value }))} style={{ ...inputStyle, marginTop: "6px", backgroundColor: "white" }}>
                      {buildings.map((building) => <option key={building.id} value={building.id}>{building.name}</option>)}
                    </select>
                  </label>
                )}
                {scheduleForm.targetType === "zone" && (
                  <label style={{ color: "#334155" }}>
                    Zone
                    <select value={scheduleForm.zoneId} onChange={(event) => setScheduleForm((prev) => ({ ...prev, zoneId: event.target.value }))} style={{ ...inputStyle, marginTop: "6px", backgroundColor: "white" }}>
                      <option value="">Select zone</option>
                      {zones.map((zone) => <option key={zone.id} value={zone.id}>{[zone.buildingName, formatZonePath(zone)].filter(Boolean).join(" / ")}</option>)}
                    </select>
                  </label>
                )}
                {scheduleForm.targetType === "device" && (
                  <label style={{ color: "#334155" }}>
                    Device
                    <select value={scheduleForm.deviceId} onChange={(event) => setScheduleForm((prev) => ({ ...prev, deviceId: event.target.value }))} style={{ ...inputStyle, marginTop: "6px", backgroundColor: "white" }}>
                      <option value="">Select device</option>
                      {devices.map((device) => <option key={device.id} value={device.id}>{device.buildingName} / {device.zoneName} / {device.name}</option>)}
                    </select>
                  </label>
                )}
                <label style={{ color: "#334155" }}>
                  Recurrence
                  <select value={scheduleForm.recurrence} onChange={(event) => setScheduleForm((prev) => ({ ...prev, recurrence: event.target.value }))} style={{ ...inputStyle, marginTop: "6px", backgroundColor: "white" }}>
                    <option value="daily">Daily</option>
                    <option value="monthly">Monthly</option>
                    <option value="yearly">Yearly</option>
                  </select>
                </label>
                {(scheduleForm.recurrence === "monthly" || scheduleForm.recurrence === "yearly") && (
                  <label style={{ color: "#334155" }}>
                    Day
                    <input type="number" min="1" max="31" value={scheduleForm.dayOfMonth} onChange={(event) => setScheduleForm((prev) => ({ ...prev, dayOfMonth: event.target.value }))} style={{ ...inputStyle, marginTop: "6px" }} />
                  </label>
                )}
                {scheduleForm.recurrence === "yearly" && (
                  <label style={{ color: "#334155" }}>
                    Month
                    <input type="number" min="1" max="12" value={scheduleForm.month} onChange={(event) => setScheduleForm((prev) => ({ ...prev, month: event.target.value }))} style={{ ...inputStyle, marginTop: "6px" }} />
                  </label>
                )}
                <label style={{ color: "#334155" }}>
                  Start
                  <input type="time" value={scheduleForm.startTime} onChange={(event) => setScheduleForm((prev) => ({ ...prev, startTime: event.target.value }))} style={{ ...inputStyle, marginTop: "6px" }} />
                </label>
                <label style={{ color: "#334155" }}>
                  End
                  <input type="time" value={scheduleForm.endTime} onChange={(event) => setScheduleForm((prev) => ({ ...prev, endTime: event.target.value }))} style={{ ...inputStyle, marginTop: "6px" }} />
                </label>
                <label style={{ color: "#334155" }}>
                  Days
                  <input value={scheduleForm.days} onChange={(event) => setScheduleForm((prev) => ({ ...prev, days: event.target.value }))} style={{ ...inputStyle, marginTop: "6px" }} />
                </label>
                <label style={{ color: "#334155" }}>
                  Action
                  <input value={scheduleForm.action} onChange={(event) => setScheduleForm((prev) => ({ ...prev, action: event.target.value }))} style={{ ...inputStyle, marginTop: "6px" }} />
                </label>
                <label style={{ color: "#334155" }}>
                  Value
                  <input value={scheduleForm.targetValue} onChange={(event) => setScheduleForm((prev) => ({ ...prev, targetValue: event.target.value }))} style={{ ...inputStyle, marginTop: "6px" }} />
                </label>
                <label style={{ color: "#334155" }}>
                  Units
                  <input value={scheduleForm.units} onChange={(event) => setScheduleForm((prev) => ({ ...prev, units: event.target.value }))} style={{ ...inputStyle, marginTop: "6px" }} />
                </label>
                <button onClick={createSchedule} disabled={saving.scheduleCreate} style={{ ...buttonStyle, backgroundColor: "#0f766e", height: "40px" }}>
                  {saving.scheduleCreate ? "Creating..." : "Create Schedule"}
                </button>
              </div>
            </div>
            <div style={{ ...panelStyle, overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", minWidth: "1180px" }}>
                <thead>
                  <tr>
                    <th style={headerStyle}>Schedule</th>
                    <th style={headerStyle}>Target</th>
                    <th style={headerStyle}>Recurrence</th>
                    <th style={headerStyle}>Override</th>
                    <th style={headerStyle}>Window</th>
                    <th style={headerStyle}>Days</th>
                    <th style={headerStyle}>Action</th>
                    <th style={headerStyle}>Value</th>
                    <th style={headerStyle}>Status</th>
                    <th style={headerStyle}>Control</th>
                  </tr>
                </thead>
                <tbody>
                  {schedules.length === 0 ? (
                    <tr><td colSpan={10} style={{ ...cellStyle, textAlign: "center" }}>No schedules configured.</td></tr>
                  ) : schedules.map((schedule) => (
                    <tr key={schedule.id}>
                      <td style={cellStyle}>{schedule.name}</td>
                      <td style={cellStyle}>{formatScheduleTarget(schedule)}</td>
                      <td style={cellStyle}>
                        {schedule.recurrence}
                        {schedule.recurrence === "monthly" && schedule.dayOfMonth ? ` / day ${schedule.dayOfMonth}` : ""}
                        {schedule.recurrence === "yearly" && schedule.month && schedule.dayOfMonth ? ` / ${schedule.month}/${schedule.dayOfMonth}` : ""}
                      </td>
                      <td style={cellStyle}>{schedule.scopeType} ({schedule.overridePriority})</td>
                      <td style={cellStyle}>{schedule.startTime} - {schedule.endTime}</td>
                      <td style={cellStyle}>{schedule.days}</td>
                      <td style={cellStyle}>{schedule.action}</td>
                      <td style={cellStyle}>{schedule.targetValue ?? "-"} {schedule.units || ""}</td>
                      <td style={cellStyle}>{schedule.enabled ? "Enabled" : "Disabled"}</td>
                      <td style={cellStyle}>
                        <button
                          onClick={() => toggleSchedule(schedule)}
                          disabled={saving[`schedule-${schedule.id}`]}
                          style={{ ...buttonStyle, backgroundColor: schedule.enabled ? "#dc2626" : "#16a34a" }}
                        >
                          {schedule.enabled ? "Disable" : "Enable"}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section>
            <h2 style={{ marginBottom: "16px", color: "#2c5282" }}>Device Commissioning</h2>
            {hierarchy.map((building) => (
              <section key={building.id} style={{ marginBottom: "30px" }}>
                <h3 style={{ marginBottom: "12px", color: "#334155" }}>{building.name}</h3>
                {getBuildingZones(building).map((zone) => (
                  <div key={zone.id} style={{ marginBottom: "22px" }}>
                    <h4 style={{ marginBottom: "10px", color: "#334155" }}>
                      {formatZonePath(zone)} <span style={{ color: "#64748b", fontWeight: 400 }}>control zone {zone.name}</span>
                    </h4>
                    <div style={{ ...panelStyle, overflowX: "auto" }}>
                      <table style={{ width: "100%", borderCollapse: "collapse", minWidth: "1220px" }}>
                        <thead>
                          <tr>
                            <th style={headerStyle}>Device</th>
                            <th style={headerStyle}>BACnet</th>
                            <th style={headerStyle}>Type</th>
                            <th style={headerStyle}>Value</th>
                            <th style={headerStyle}>Setpoint</th>
                            <th style={headerStyle}>Range</th>
                            <th style={headerStyle}>Status</th>
                            <th style={headerStyle}>Provisioned</th>
                            <th style={headerStyle}>Commissioned</th>
                            <th style={headerStyle}>Actions</th>
                          </tr>
                        </thead>
                        <tbody>
                          {zone.devices.map((device) => (
                            <tr key={device.id}>
                              <td style={cellStyle}>{device.name}</td>
                              <td style={cellStyle}>{device.bacnetInstance}:{device.objectType}:{device.objectInstance}</td>
                              <td style={cellStyle}>{device.type}</td>
                              <td style={cellStyle}>{device.value ?? "-"} {device.units || ""}</td>
                              <td style={cellStyle}>{formatSetpoint(device)}</td>
                              <td style={cellStyle}>{formatRange(device)}</td>
                              <td style={cellStyle}>{device.status}</td>
                              <td style={cellStyle}>{device.provisioned ? "Yes" : "No"}</td>
                              <td style={cellStyle}>{device.commissioned ? "Yes" : "No"}</td>
                              <td style={cellStyle}>
                                <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
                                  <button onClick={() => updateDeviceStatus(device.id, "provision")} disabled={device.provisioned || saving[device.id]} style={{ ...buttonStyle, backgroundColor: device.provisioned ? "#94a3b8" : "#2563eb" }}>{buttonText(device, "provision")}</button>
                                  <button onClick={() => updateDeviceStatus(device.id, "commission")} disabled={!device.provisioned || device.commissioned || saving[device.id]} style={{ ...buttonStyle, backgroundColor: device.commissioned ? "#94a3b8" : "#16a34a" }}>{buttonText(device, "commission")}</button>
                                  <button onClick={() => openDeviceDetails(device)} style={{ ...buttonStyle, backgroundColor: "#2563eb" }}>Details</button>
                                  <button onClick={() => openDeviceConfig(device)} style={{ ...buttonStyle, backgroundColor: "#0f766e" }}>Configure</button>
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ))}
              </section>
            ))}
          </section>

          <section style={{ marginTop: "32px" }}>
            <h2 style={{ marginBottom: "16px", color: "#2c5282" }}>Simulated Alarm</h2>
            <div style={{ ...panelStyle, padding: "16px", display: "grid", gridTemplateColumns: "minmax(180px, 1fr) minmax(220px, 2fr) minmax(160px, 1fr) auto", gap: "12px", alignItems: "end" }}>
              <label style={{ color: "#334155" }}>Device ID<input value={alarmForm.deviceId} onChange={(e) => setAlarmForm((prev) => ({ ...prev, deviceId: e.target.value }))} style={{ display: "block", width: "100%", marginTop: "6px", padding: "10px", border: "1px solid #cbd5e1", borderRadius: "6px" }} /></label>
              <label style={{ color: "#334155" }}>Message<input value={alarmForm.message} onChange={(e) => setAlarmForm((prev) => ({ ...prev, message: e.target.value }))} style={{ display: "block", width: "100%", marginTop: "6px", padding: "10px", border: "1px solid #cbd5e1", borderRadius: "6px" }} /></label>
              <label style={{ color: "#334155" }}>Severity<select value={alarmForm.severity} onChange={(e) => setAlarmForm((prev) => ({ ...prev, severity: e.target.value }))} style={{ display: "block", width: "100%", marginTop: "6px", padding: "10px", border: "1px solid #cbd5e1", borderRadius: "6px" }}><option value="critical">critical</option><option value="warning">warning</option><option value="info">info</option></select></label>
              <button onClick={createAlarm} disabled={creatingAlarm} style={{ ...buttonStyle, backgroundColor: "#dc2626", height: "40px" }}>{creatingAlarm ? "Creating..." : "Create"}</button>
            </div>
          </section>

          {configDevice && (
            <section style={{ marginTop: "32px", padding: "22px", ...panelStyle }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "18px", gap: "12px" }}>
                <h2 style={{ margin: 0, color: "#1f355e" }}>Configure {configDevice.name}</h2>
                <button onClick={closeDeviceConfig} style={{ ...buttonStyle, backgroundColor: "#64748b" }}>Close</button>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "16px", marginBottom: "18px" }}>
                {[
                  ["Current Setpoint", "setpoint", "e.g. 22.5"],
                  ["Minimum Setpoint", "minSetpoint", "e.g. 18"],
                  ["Maximum Setpoint", "maxSetpoint", "e.g. 26"],
                  ["Battery Percent", "batteryPercent", "e.g. 91"],
                  ["EEPROM Address", "eepromAddress", "e.g. 0x0000"],
                  ["EEPROM Size Bytes", "eepromSizeBytes", "e.g. 256"],
                  ["Storage Namespace", "persistentStorageNamespace", "device_config"],
                ].map(([label, key, placeholder]) => (
                  <label key={key} style={{ display: "flex", flexDirection: "column", gap: "8px", color: "#334155" }}>
                    {label}
                    <input value={deviceConfigForm[key]} onChange={(e) => setDeviceConfigForm((prev) => ({ ...prev, [key]: e.target.value }))} placeholder={placeholder} style={{ padding: "10px 12px", borderRadius: "6px", border: "1px solid #cbd5e1" }} />
                  </label>
                ))}
                <label style={{ display: "flex", flexDirection: "column", gap: "8px", color: "#334155" }}>
                  Persistent Medium
                  <select value={deviceConfigForm.persistentStorageMedium} onChange={(e) => setDeviceConfigForm((prev) => ({ ...prev, persistentStorageMedium: e.target.value }))} style={{ padding: "10px 12px", borderRadius: "6px", border: "1px solid #cbd5e1", backgroundColor: "white" }}>
                    <option value="EEPROM">EEPROM</option>
                    <option value="Flash NVS">Flash NVS</option>
                    <option value="FRAM">FRAM</option>
                    <option value="Filesystem">Filesystem</option>
                  </select>
                </label>
                <label style={{ display: "flex", flexDirection: "column", gap: "8px", color: "#334155" }}>
                  Setpoint Storage
                  <select value={deviceConfigForm.eepromWritePolicy} onChange={(e) => setDeviceConfigForm((prev) => ({ ...prev, eepromWritePolicy: e.target.value }))} style={{ padding: "10px 12px", borderRadius: "6px", border: "1px solid #cbd5e1", backgroundColor: "white" }}>
                    <option value="on_change">EEPROM on change</option>
                    <option value="on_schedule">EEPROM on schedule</option>
                    <option value="manual">Manual save</option>
                    <option value="disabled">Disabled</option>
                  </select>
                </label>
                <label style={{ display: "flex", gap: "8px", alignItems: "center", color: "#334155", paddingTop: "28px" }}>
                  <input type="checkbox" checked={!!deviceConfigForm.eepromEnabled} onChange={(e) => setDeviceConfigForm((prev) => ({ ...prev, eepromEnabled: e.target.checked }))} />
                  Enable device persistent storage
                </label>
                <label style={{ display: "flex", gap: "8px", alignItems: "center", color: "#334155", paddingTop: "28px" }}>
                  <input type="checkbox" checked={!!deviceConfigForm.wearLeveling} onChange={(e) => setDeviceConfigForm((prev) => ({ ...prev, wearLeveling: e.target.checked }))} />
                  Wear leveling
                </label>
                <label style={{ display: "flex", gap: "8px", alignItems: "center", color: "#334155", paddingTop: "28px" }}>
                  <input type="checkbox" checked={!!deviceConfigForm.bacnetScheduleStorageEnabled} onChange={(e) => setDeviceConfigForm((prev) => ({ ...prev, bacnetScheduleStorageEnabled: e.target.checked }))} />
                  Persist BACnet schedules on device
                </label>
              </div>
              <button onClick={saveDeviceConfig} disabled={saving.config} style={{ ...buttonStyle, backgroundColor: "#2563eb" }}>
                {saving.config ? "Saving..." : "Save Setpoint / EEPROM"}
              </button>
            </section>
          )}
        </>
      )}
        </main>
      </div>
    </div>
  );
}
