import React, { useEffect, useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

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
};

const panelStyle = {
  backgroundColor: "white",
  border: "1px solid #e2e8f0",
  borderRadius: "8px",
  boxShadow: "0 1px 4px rgba(15, 23, 42, 0.08)",
};

function flattenDevices(hierarchy) {
  return hierarchy.flatMap((building) =>
    building.zones.flatMap((zone) =>
      zone.devices.map((device) => ({
        ...device,
        zoneName: zone.name,
        buildingName: building.name,
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

function FloorplanEditor({ devices, layout, onLayoutChange, onSelectDevice }) {
  const [dragId, setDragId] = useState(null);

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
        <button onClick={() => localStorage.removeItem("bems.floorplan")} style={{ ...buttonStyle, backgroundColor: "#64748b" }}>Reset Saved Layout</button>
      </div>
      <svg
        viewBox="0 0 100 64"
        style={{ width: "100%", height: "360px", border: "1px solid #cbd5e1", backgroundColor: "#f8fafc", cursor: dragId ? "grabbing" : "default" }}
        onPointerMove={updateDevicePosition}
        onPointerUp={() => setDragId(null)}
        onPointerLeave={() => setDragId(null)}
      >
        <rect x="4" y="5" width="42" height="24" fill="#ffffff" stroke="#94a3b8" />
        <rect x="50" y="5" width="46" height="24" fill="#ffffff" stroke="#94a3b8" />
        <rect x="4" y="34" width="28" height="25" fill="#ffffff" stroke="#94a3b8" />
        <rect x="36" y="34" width="60" height="25" fill="#ffffff" stroke="#94a3b8" />
        <line x1="48" y1="5" x2="48" y2="59" stroke="#cbd5e1" strokeDasharray="2 2" />
        {devices.map((device, index) => {
          const saved = layout[device.id] || {};
          const x = saved.x ?? 12 + (index % 5) * 16;
          const y = saved.y ?? 14 + Math.floor(index / 5) * 18;
          const fill = device.status === "Normal" || device.status === "normal" ? "#16a34a" : "#dc2626";
          return (
            <g
              key={device.id}
              onPointerDown={() => setDragId(device.id)}
              onClick={() => onSelectDevice(device)}
              style={{ cursor: "grab" }}
            >
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
        {building.zones.map((zone) => (
          <g key={zone.id}>
            <rect x={zone.geometry.x} y={zone.geometry.y} width={zone.geometry.width} height={zone.geometry.height} fill="#eef6ff" stroke="#93c5fd" rx="1" />
            <text x={zone.geometry.x + 2} y={zone.geometry.y + 5} fontSize="3.2" fill="#1e3a8a">{zone.name}</text>
            {zone.devices.map((device) => {
              const fill = device.status === "Normal" || device.status === "normal" ? "#16a34a" : "#dc2626";
              return (
                <g key={device.id} onClick={() => onSelectDevice(device)} style={{ cursor: "pointer" }}>
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

export default function App() {
  const [hierarchy, setHierarchy] = useState([]);
  const [alarms, setAlarms] = useState([]);
  const [schedules, setSchedules] = useState([]);
  const [autonomousMode, setAutonomousMode] = useState(null);
  const [optimization, setOptimization] = useState(null);
  const [buildingOptimization, setBuildingOptimization] = useState(null);
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
  const [deviceConfigForm, setDeviceConfigForm] = useState({ setpoint: "", minSetpoint: "", maxSetpoint: "" });
  const [configDevice, setConfigDevice] = useState(null);
  const [statusMessage, setStatusMessage] = useState(null);

  const devices = useMemo(() => flattenDevices(hierarchy), [hierarchy]);
  const activeAlarmCount = alarms.filter((alarm) => alarm.status !== "Cleared").length;
  const activeScheduleCount = schedules.filter((schedule) => !!schedule.enabled).length;

  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      const modeQuery = "occupancyState=occupied&academicCalendar=in_session&residentialPattern=home&weatherCondition=mild";
      const [hierarchyRes, alarmsRes, schedulesRes, autonomousRes, optimizationRes, buildingOptimizationRes, twinRes] = await Promise.all([
        fetch(`${apiBase}/api/hierarchy`),
        fetch(`${apiBase}/api/alarms`),
        fetch(`${apiBase}/api/schedules`),
        fetch(`${apiBase}/api/autonomous-mode/evaluate?${modeQuery}`),
        fetch(`${apiBase}/api/ai/optimization?${modeQuery}`),
        fetch(`${apiBase}/api/ai/building-optimization?${modeQuery}`),
        fetch(`${apiBase}/api/digital-twin`),
      ]);

      if (!hierarchyRes.ok) throw new Error("Unable to fetch hierarchy");
      if (!alarmsRes.ok) throw new Error("Unable to fetch alarms");
      if (!schedulesRes.ok) throw new Error("Unable to fetch schedules");
      if (!autonomousRes.ok) throw new Error("Unable to fetch autonomous mode");
      if (!optimizationRes.ok) throw new Error("Unable to fetch optimization");
      if (!buildingOptimizationRes.ok) throw new Error("Unable to fetch building optimization");
      if (!twinRes.ok) throw new Error("Unable to fetch digital twin");

      setHierarchy(await hierarchyRes.json());
      setAlarms(await alarmsRes.json());
      setSchedules(await schedulesRes.json());
      setAutonomousMode(await autonomousRes.json());
      setOptimization(await optimizationRes.json());
      setBuildingOptimization(await buildingOptimizationRes.json());
      setDigitalTwin(await twinRes.json());
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  useEffect(() => {
    const stream = new EventSource(`${apiBase}/api/alarms/stream`);
    stream.addEventListener("alarms", (event) => {
      setAlarms(JSON.parse(event.data));
    });
    stream.onerror = () => stream.close();
    return () => stream.close();
  }, []);

  useEffect(() => {
    const stream = new EventSource(`${apiBase}/api/telemetry/stream`);
    stream.addEventListener("telemetry", (event) => {
      setDigitalTwin(JSON.parse(event.data));
    });
    stream.onerror = () => stream.close();
    return () => stream.close();
  }, []);

  useEffect(() => {
    localStorage.setItem("bems.floorplan", JSON.stringify(floorplanLayout));
  }, [floorplanLayout]);

  const updateStatus = async (endpoint, id, successMessage) => {
    setSaving((prev) => ({ ...prev, [id]: true }));
    setStatusMessage(null);
    try {
      const response = await fetch(`${apiBase}/${endpoint}`, { method: "PATCH" });
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

  const openDeviceConfig = (device) => {
    setConfigDevice(device);
    setDeviceConfigForm({
      setpoint: device.configuration?.setpoint ?? "",
      minSetpoint: device.configuration?.minSetpoint ?? "",
      maxSetpoint: device.configuration?.maxSetpoint ?? "",
    });
    setStatusMessage(null);
  };

  const closeDeviceConfig = () => {
    setConfigDevice(null);
    setDeviceConfigForm({ setpoint: "", minSetpoint: "", maxSetpoint: "" });
  };

  const saveDeviceConfig = async () => {
    if (!configDevice) return;
    setSaving((prev) => ({ ...prev, config: true }));
    setStatusMessage(null);

    try {
      const response = await fetch(`${apiBase}/api/devices/${configDevice.id}/configuration`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          configuration: {
            ...configDevice.configuration,
            setpoint: deviceConfigForm.setpoint !== "" ? Number(deviceConfigForm.setpoint) : configDevice.configuration?.setpoint,
            minSetpoint: deviceConfigForm.minSetpoint !== "" ? Number(deviceConfigForm.minSetpoint) : configDevice.configuration?.minSetpoint,
            maxSetpoint: deviceConfigForm.maxSetpoint !== "" ? Number(deviceConfigForm.maxSetpoint) : configDevice.configuration?.maxSetpoint,
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
      const response = await fetch(`${apiBase}/api/alarms`, {
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

  const buttonText = (item, action) => {
    if (action === "provision") return item.provisioned ? "Provisioned" : "Provision";
    if (action === "commission") return item.commissioned ? "Commissioned" : "Commission";
    if (action === "ack") return item.acked ? "Acknowledged" : "Acknowledge";
    if (action === "clear") return item.status === "Cleared" ? "Cleared" : "Clear";
    return action;
  };

  return (
    <div style={{ fontFamily: "Inter, system-ui, sans-serif", padding: "24px", backgroundColor: "#f8fafc", minHeight: "100vh" }}>
      <header style={{ marginBottom: "24px" }}>
        <h1 style={{ margin: 0, color: "#1f355e" }}>BEMS Operations Dashboard</h1>
        <p style={{ margin: "8px 0 0", color: "#4a5568" }}>
          Monitor alarms, autonomous AI mode, setpoints, BACnet/IP devices, and floorplan placement.
        </p>
      </header>

      {statusMessage && (
        <div style={{ padding: "14px 16px", marginBottom: "20px", borderRadius: "8px", backgroundColor: statusMessage.type === "error" ? "#fff1f0" : "#ecfdf3", color: statusMessage.type === "error" ? "#b91c1c" : "#166534" }}>
          {statusMessage.text}
        </div>
      )}

      {loading && <p>Loading dashboard data...</p>}
      {error && <p style={{ color: "#b91c1c" }}>Error: {error}</p>}

      {!loading && !error && (
        <>
          <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "14px", marginBottom: "24px" }}>
            {[
              ["Devices", devices.length],
              ["Active Alarms", activeAlarmCount],
              ["Schedules", activeScheduleCount],
              ["AI Profile", autonomousMode?.profile || "Unknown"],
              ["Est. Savings", buildingOptimization ? `${buildingOptimization.objective.estimatedSavingsKwh} kWh` : "Pending"],
            ].map(([label, value]) => (
              <div key={label} style={{ ...panelStyle, padding: "16px" }}>
                <div style={{ color: "#64748b", fontSize: "13px" }}>{label}</div>
                <strong style={{ color: "#1f355e", fontSize: "24px" }}>{value}</strong>
              </div>
            ))}
          </section>

          <section style={{ display: "grid", gridTemplateColumns: "minmax(300px, 1fr) minmax(320px, 1.2fr)", gap: "18px", marginBottom: "28px" }}>
            <div style={{ ...panelStyle, padding: "16px" }}>
              <h2 style={{ margin: "0 0 12px", color: "#2c5282" }}>Live Device Values</h2>
              <MiniBarChart devices={devices} />
            </div>
            <FloorplanEditor devices={devices} layout={floorplanLayout} onLayoutChange={setFloorplanLayout} onSelectDevice={openDeviceConfig} />
          </section>

          <section style={{ marginBottom: "28px" }}>
            <DigitalTwinView twin={digitalTwin} onSelectDevice={openDeviceConfig} />
          </section>

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
              </div>
            </section>
          )}

          <section style={{ marginBottom: "32px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px", gap: "12px", flexWrap: "wrap" }}>
              <h2 style={{ margin: 0, color: "#2c5282" }}>Alarm Monitoring</h2>
              <button onClick={loadData} style={{ ...buttonStyle, backgroundColor: "#2563eb" }}>Refresh</button>
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
                  ) : alarms.map((alarm) => (
                    <tr key={alarm.id}>
                      <td style={cellStyle}>{alarm.id}</td>
                      <td style={cellStyle}>{alarm.deviceName || `Device ${alarm.deviceId || "N/A"}`}</td>
                      <td style={cellStyle}>{alarm.message}</td>
                      <td style={cellStyle}>{alarm.severity}</td>
                      <td style={cellStyle}>{alarm.status}</td>
                      <td style={cellStyle}>{alarm.acked ? "Yes" : "No"}</td>
                      <td style={cellStyle}>{new Date(alarm.createdAt).toLocaleString()}</td>
                      <td style={cellStyle}>
                        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                          <button onClick={() => handleAlarmAction(alarm.id, "ack")} disabled={alarm.acked || saving[alarm.id] || alarm.status === "Cleared"} style={{ ...buttonStyle, backgroundColor: alarm.acked || alarm.status === "Cleared" ? "#94a3b8" : "#f59e0b" }}>
                            {buttonText(alarm, "ack")}
                          </button>
                          <button onClick={() => handleAlarmAction(alarm.id, "clear")} disabled={alarm.status === "Cleared" || saving[alarm.id]} style={{ ...buttonStyle, backgroundColor: alarm.status === "Cleared" ? "#94a3b8" : "#dc2626" }}>
                            {buttonText(alarm, "clear")}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section style={{ marginBottom: "32px" }}>
            <h2 style={{ marginBottom: "16px", color: "#2c5282" }}>Scheduling System</h2>
            <div style={{ ...panelStyle, overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", minWidth: "980px" }}>
                <thead>
                  <tr>
                    <th style={headerStyle}>Schedule</th>
                    <th style={headerStyle}>Target</th>
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
                    <tr><td colSpan={8} style={{ ...cellStyle, textAlign: "center" }}>No schedules configured.</td></tr>
                  ) : schedules.map((schedule) => (
                    <tr key={schedule.id}>
                      <td style={cellStyle}>{schedule.name}</td>
                      <td style={cellStyle}>{schedule.deviceName || schedule.zoneName || schedule.buildingName || "Global"}</td>
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
                {building.zones.map((zone) => (
                  <div key={zone.id} style={{ marginBottom: "22px" }}>
                    <h4 style={{ marginBottom: "10px", color: "#334155" }}>{zone.name}</h4>
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
                ].map(([label, key, placeholder]) => (
                  <label key={key} style={{ display: "flex", flexDirection: "column", gap: "8px", color: "#334155" }}>
                    {label}
                    <input value={deviceConfigForm[key]} onChange={(e) => setDeviceConfigForm((prev) => ({ ...prev, [key]: e.target.value }))} placeholder={placeholder} style={{ padding: "10px 12px", borderRadius: "6px", border: "1px solid #cbd5e1" }} />
                  </label>
                ))}
              </div>
              <button onClick={saveDeviceConfig} disabled={saving.config} style={{ ...buttonStyle, backgroundColor: "#2563eb" }}>
                {saving.config ? "Saving..." : "Save Setpoint / Range"}
              </button>
            </section>
          )}
        </>
      )}
    </div>
  );
}
