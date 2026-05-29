const express = require("express");
const cors = require("cors");
const mysql = require("mysql2");
const path = require("path");
const fs = require("fs");
const { createEdgeClient } = require("./edgeClient");
const { createAiClient } = require("./aiClient");
const app = express();

app.use(cors());
app.use(express.json());

const uiDistPath = path.join(__dirname, "ui", "dist");
if (fs.existsSync(uiDistPath)) {
  app.use(express.static(uiDistPath));
}

const db = mysql.createPool({
  host: process.env.MYSQL_HOST || "db",
  user: process.env.MYSQL_USER || "root",
  password: process.env.MYSQL_PASSWORD || "root",
  database: process.env.MYSQL_DATABASE || "bems",
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});

const alarmClients = new Set();
const edgeClient = createEdgeClient();
const aiClient = createAiClient();
const aiServiceUrl = process.env.AI_SERVICE_URL || "";
const watchdogIntervalMs = Number(process.env.WATCHDOG_INTERVAL_MS || 30000);
const managementToken = process.env.BEMS_MANAGEMENT_TOKEN || "";
const applianceProfile = {
  product: "BEMS Edge AI Gateway",
  role: "Smart building controller",
  class: "IoT edge compute appliance",
  hardware: "Digi ConnectCore i.MX93 EVK",
};
const watchdogState = {
  status: "starting",
  lastRunAt: null,
  dependencies: {
    database: { status: "unknown" },
    edgeCore: { status: "unknown" },
    aiService: { status: process.env.AI_GRPC_ENDPOINT || aiServiceUrl ? "unknown" : "disabled" },
  },
};
const remoteActions = [];

function handleQuery(res, query, params = []) {
  db.query(query, params, (error, results) => {
    if (error) {
      console.error("MySQL query failed:", error);
      return res.status(500).json({ error: "Database error" });
    }
    res.json(results);
  });
}

function dbQuery(query, params = []) {
  return new Promise((resolve, reject) => {
    db.query(query, params, (error, results) => {
      if (error) reject(error);
      else resolve(results);
    });
  });
}

function requireManagementToken(req, res, next) {
  if (!managementToken) {
    return next();
  }

  if (req.get("X-Management-Token") !== managementToken) {
    return res.status(401).json({ error: "Invalid management token." });
  }

  next();
}

function parseJsonField(value, fallback = {}) {
  if (value == null) return fallback;
  if (Buffer.isBuffer(value)) {
    value = value.toString("utf8");
  }
  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch (error) {
      return fallback;
    }
  }
  return value;
}

function normalizeHealthStatus(status) {
  return status === "ok" || status === "healthy" || status === "disabled";
}

function managementAction(action, status = "accepted", details = {}) {
  const entry = {
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    action,
    status,
    details,
    createdAt: new Date().toISOString(),
  };
  remoteActions.unshift(entry);
  if (remoteActions.length > 50) {
    remoteActions.pop();
  }
  db.query(
    `INSERT INTO analytics_events (event_type, metric_name, payload)
     VALUES ('remote_management', ?, ?)`,
    [action, JSON.stringify(entry)],
    (error) => {
      if (error) {
        console.error("Remote management event insert failed:", error);
      }
    }
  );
  return entry;
}

async function runWatchdog() {
  const checkedAt = new Date().toISOString();
  const dependencies = {};

  try {
    await dbQuery("SELECT 1 AS ok");
    dependencies.database = { status: "ok", checkedAt };
  } catch (error) {
    dependencies.database = { status: "unhealthy", checkedAt, error: error.message };
  }

  try {
    const edgeHealth = await edgeClient.health();
    dependencies.edgeCore = { ...edgeHealth, checkedAt };
  } catch (error) {
    dependencies.edgeCore = { status: "unhealthy", checkedAt, error: error.message };
  }

  const grpcAiHealth = await aiClient.health();
  if (grpcAiHealth.status !== "disabled") {
    dependencies.aiService = { ...grpcAiHealth, transport: "grpc", checkedAt };
  } else if (aiServiceUrl) {
    try {
      const response = await fetch(`${aiServiceUrl}/health`);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      dependencies.aiService = { ...(await response.json()), transport: "http", checkedAt };
    } catch (error) {
      dependencies.aiService = { status: "unhealthy", checkedAt, error: error.message };
    }
  } else {
    dependencies.aiService = { status: "disabled", checkedAt };
  }

  const healthy = Object.values(dependencies).every((dependency) => normalizeHealthStatus(dependency.status));
  watchdogState.status = healthy ? "ok" : "degraded";
  watchdogState.lastRunAt = checkedAt;
  watchdogState.dependencies = dependencies;
  return watchdogState;
}

const autonomousProfiles = {
  Conservative: {
    setpointBias: 1.5,
    ventilationBias: "minimum-safe",
    demandLimit: "strict",
    description: "Prioritizes energy savings, demand response, and low-occupancy operation.",
  },
  Normal: {
    setpointBias: 0,
    ventilationBias: "balanced",
    demandLimit: "standard",
    description: "Balances comfort, schedule adherence, and energy efficiency.",
  },
  Aggressive: {
    setpointBias: -1,
    ventilationBias: "comfort-boost",
    demandLimit: "relaxed",
    description: "Prioritizes comfort recovery, occupied academic periods, and weather-driven load response.",
  },
};

function booleanInput(value) {
  return value === true || value === "true" || value === "1" || value === 1;
}

function evaluateAutonomousMode(input = {}) {
  const evaluatedAt = input.dateTime ? new Date(input.dateTime) : new Date();
  const hour = evaluatedAt.getHours();
  const day = evaluatedAt.getDay();
  const isWeekend = day === 0 || day === 6;
  const isBusinessHours = hour >= 7 && hour < 18 && !isWeekend;
  const occupancyState = input.occupancyState || "occupied";
  const academicCalendar = input.academicCalendar || "in_session";
  const residentialPattern = input.residentialPattern || "home";
  const weatherCondition = input.weatherCondition || "mild";
  const demandResponseEvent = booleanInput(input.demandResponseEvent);
  const reasons = [];
  let score = 0;

  if (demandResponseEvent) {
    reasons.push("Demand response event active");
    return {
      profile: "Conservative",
      evaluatedAt: evaluatedAt.toISOString(),
      reasons,
      inputs: { occupancyState, academicCalendar, residentialPattern, weatherCondition, demandResponseEvent },
      actions: autonomousProfiles.Conservative,
    };
  }

  if (occupancyState === "unoccupied") {
    score -= 2;
    reasons.push("Space is unoccupied");
  } else if (occupancyState === "partial") {
    score -= 1;
    reasons.push("Partial occupancy");
  } else {
    score += 1;
    reasons.push("Occupied space");
  }

  if (isBusinessHours) {
    score += 1;
    reasons.push("Weekday operating hours");
  } else {
    score -= 1;
    reasons.push("Off-hours or weekend");
  }

  if (academicCalendar === "break" || academicCalendar === "holiday") {
    score -= 1;
    reasons.push("Academic calendar is low-use");
  } else if (academicCalendar === "in_session") {
    score += 1;
    reasons.push("Academic calendar is in session");
  }

  if (residentialPattern === "away" || residentialPattern === "sleep") {
    score -= 1;
    reasons.push(`Residential pattern is ${residentialPattern}`);
  } else if (residentialPattern === "home") {
    score += 1;
    reasons.push("Residential spaces are active");
  }

  if (weatherCondition === "extreme_hot" || weatherCondition === "extreme_cold") {
    score += occupancyState === "unoccupied" ? 0 : 2;
    reasons.push("Extreme weather load");
  } else if (weatherCondition === "hot" || weatherCondition === "cold") {
    score += occupancyState === "unoccupied" ? 0 : 1;
    reasons.push("Weather requires active conditioning");
  } else {
    reasons.push("Mild weather");
  }

  const profile = score >= 4 ? "Aggressive" : score <= 0 ? "Conservative" : "Normal";
  return {
    profile,
    evaluatedAt: evaluatedAt.toISOString(),
    score,
    reasons,
    inputs: { occupancyState, academicCalendar, residentialPattern, weatherCondition, demandResponseEvent },
    actions: autonomousProfiles[profile],
  };
}

function clamp(value, min, max) {
  if (min != null && value < min) return min;
  if (max != null && value > max) return max;
  return value;
}

function bacnetObjectTypeNumber(value) {
  if (typeof value === "number") return value;
  const normalized = String(value || "").replace(/[_\s-]/g, "").toLowerCase();
  const objectTypes = {
    analoginput: 0,
    analogoutput: 1,
    analogvalue: 2,
    binaryinput: 3,
    binaryoutput: 4,
    binaryvalue: 5,
  };
  return objectTypes[normalized] ?? Number(value);
}

function buildOptimization(devices, modeInput = {}) {
  const mode = evaluateAutonomousMode(modeInput);
  const recommendations = devices.map((device) => {
    const configuration = parseJsonField(device.configuration);
    const currentSetpoint = Number(configuration.setpoint ?? device.value ?? 0);
    const minSetpoint = configuration.minSetpoint;
    const maxSetpoint = configuration.maxSetpoint;
    const weather = mode.inputs.weatherCondition;
    const comfortNudge = weather === "extreme_hot" || weather === "extreme_cold" ? -0.5 : 0;
    const demandNudge = mode.inputs.demandResponseEvent ? 1.5 : 0;
    const rawTarget = currentSetpoint + (mode.actions.setpointBias || 0) + demandNudge + comfortNudge;
    const targetSetpoint = Number(clamp(rawTarget, minSetpoint, maxSetpoint).toFixed(2));
    const savingsKwh = Math.max(0.2, Math.abs(targetSetpoint - currentSetpoint) * 0.35);

    return {
      deviceId: device.id,
      deviceName: device.name,
      zoneName: device.zoneName,
      type: device.type,
      currentValue: device.value,
      currentSetpoint,
      targetSetpoint,
      minSetpoint,
      maxSetpoint,
      estimatedSavingsKwh: Number(savingsKwh.toFixed(2)),
      confidence: mode.inputs.demandResponseEvent ? 0.91 : mode.profile === "Aggressive" ? 0.82 : 0.76,
      action: targetSetpoint === currentSetpoint ? "hold" : "adjust_setpoint",
      reason: `${mode.profile} profile using ${mode.inputs.occupancyState} occupancy and ${mode.inputs.weatherCondition} weather.`,
    };
  });
  const totalSavingsKwh = recommendations.reduce((sum, item) => sum + item.estimatedSavingsKwh, 0);

  return {
    mode,
    generatedAt: new Date().toISOString(),
    summary: {
      recommendationCount: recommendations.length,
      estimatedSavingsKwh: Number(totalSavingsKwh.toFixed(2)),
      estimatedCostSavings: Number((totalSavingsKwh * 0.14).toFixed(2)),
    },
    recommendations,
  };
}

const rlPolicyState = new Map();
const rlActions = [-1.5, -0.5, 0, 0.5, 1.5];

function qKey(zoneId, action) {
  return `${zoneId}:${action}`;
}

function qValue(zoneId, action) {
  return rlPolicyState.get(qKey(zoneId, action)) || 0;
}

function bestZoneAction(zoneId, exploration = 0.12) {
  if (Math.random() < exploration) {
    return rlActions[Math.floor(Math.random() * rlActions.length)];
  }
  return rlActions.reduce((best, action) => (qValue(zoneId, action) > qValue(zoneId, best) ? action : best), rlActions[0]);
}

function updateRlPolicy({ zoneId, action, reward }) {
  const learningRate = 0.22;
  const key = qKey(zoneId, action);
  const current = rlPolicyState.get(key) || 0;
  const next = current + learningRate * (reward - current);
  rlPolicyState.set(key, Number(next.toFixed(4)));
  return { zoneId, action, reward, qValue: next };
}

function buildBuildingOptimization(rows, modeInput = {}) {
  const mode = evaluateAutonomousMode(modeInput);
  const zones = new Map();

  rows.forEach((row) => {
    if (!zones.has(row.zoneId)) {
      zones.set(row.zoneId, {
        zoneId: row.zoneId,
        zoneName: row.zoneName,
        buildingName: row.buildingName,
        devices: [],
      });
    }
    zones.get(row.zoneId).devices.push({ ...row, configuration: parseJsonField(row.configuration) });
  });

  const zonePlans = Array.from(zones.values()).map((zone) => {
    const learnedAction = bestZoneAction(zone.zoneId);
    const profileBias = mode.actions.setpointBias || 0;
    const coordinatedDelta = Number((profileBias + learnedAction).toFixed(2));
    const devices = zone.devices.map((device) => {
      const currentSetpoint = Number(device.configuration.setpoint ?? device.value ?? 0);
      const targetSetpoint = Number(clamp(
        currentSetpoint + coordinatedDelta,
        device.configuration.minSetpoint,
        device.configuration.maxSetpoint
      ).toFixed(2));
      const comfortPenalty = Math.abs((device.value ?? currentSetpoint) - currentSetpoint);
      const energySavings = Math.max(0.1, Math.abs(targetSetpoint - currentSetpoint) * 0.42);
      return {
        deviceId: device.deviceId,
        deviceName: device.deviceName,
        currentSetpoint,
        targetSetpoint,
        energySavings: Number(energySavings.toFixed(2)),
        comfortPenalty: Number(comfortPenalty.toFixed(2)),
      };
    });
    const energySavings = devices.reduce((sum, device) => sum + device.energySavings, 0);
    const comfortPenalty = devices.reduce((sum, device) => sum + device.comfortPenalty, 0) / Math.max(1, devices.length);
    const costSavings = energySavings * 0.14;
    const objectiveScore = (energySavings * 0.45) + (costSavings * 0.35) - (comfortPenalty * 0.2);

    return {
      zoneId: zone.zoneId,
      zoneName: zone.zoneName,
      buildingName: zone.buildingName,
      learnedAction,
      coordinatedDelta,
      objectiveScore: Number(objectiveScore.toFixed(3)),
      energySavingsKwh: Number(energySavings.toFixed(2)),
      costSavings: Number(costSavings.toFixed(2)),
      comfortPenalty: Number(comfortPenalty.toFixed(2)),
      devices,
    };
  });

  const totalEnergySavings = zonePlans.reduce((sum, zone) => sum + zone.energySavingsKwh, 0);
  return {
    mode,
    generatedAt: new Date().toISOString(),
    objective: {
      energyWeight: 0.45,
      comfortWeight: 0.2,
      costWeight: 0.35,
      estimatedSavingsKwh: Number(totalEnergySavings.toFixed(2)),
      estimatedCostSavings: Number((totalEnergySavings * 0.14).toFixed(2)),
    },
    learning: {
      algorithm: "epsilon_greedy_q_learning",
      actions: rlActions,
      stateCount: rlPolicyState.size,
    },
    zonePlans,
  };
}

async function callPythonAi(path, payload) {
  const grpcResult = path === "/optimize"
    ? await aiClient.optimize(payload)
    : path === "/feedback"
      ? await aiClient.feedback(payload)
      : null;
  if (grpcResult) {
    return grpcResult;
  }

  if (!aiServiceUrl) {
    return null;
  }
  try {
    const response = await fetch(`${aiServiceUrl}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      return null;
    }
    return await response.json();
  } catch (error) {
    console.error("Python AI service unavailable:", error.message);
    return null;
  }
}

function broadcastAlarmUpdate() {
  db.query(
    `SELECT a.id,
            a.device_id AS deviceId,
            d.name AS deviceName,
            a.message,
            a.severity,
            a.status,
            a.acked AS acked,
            a.created_at AS createdAt
     FROM alarms a
     LEFT JOIN devices d ON a.device_id = d.device_id
     ORDER BY a.created_at DESC`,
    (error, results) => {
      if (error) {
        console.error("Broadcast alarm update failed:", error);
        return;
      }
      const payload = JSON.stringify(results);
      alarmClients.forEach((client) => {
        client.write(`event: alarms\ndata: ${payload}\n\n`);
      });
    }
  );
}

function registerAlarmSseClient(req, res) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "Access-Control-Allow-Origin": "*",
  });
  res.write("\n");
  alarmClients.add(res);

  req.on("close", () => {
    alarmClients.delete(res);
  });
}

function buildTwin(rows) {
  const buildings = [];
  const buildingMap = new Map();
  const statusCounts = { normal: 0, warning: 0, critical: 0, offline: 0 };

  for (const row of rows) {
    let building = buildingMap.get(row.buildingId);
    if (!building) {
      building = {
        id: row.buildingId,
        name: row.buildingName,
        address: row.address,
        description: row.buildingDescription,
        zones: [],
      };
      buildingMap.set(row.buildingId, building);
      buildings.push(building);
    }

    if (!row.zoneId) continue;

    let zone = building.zones.find((item) => item.id === row.zoneId);
    if (!zone) {
      zone = {
        id: row.zoneId,
        name: row.zoneName,
        description: row.zoneDescription,
        geometry: {
          x: 6 + (building.zones.length % 2) * 46,
          y: 8 + Math.floor(building.zones.length / 2) * 30,
          width: building.zones.length % 2 === 0 ? 40 : 44,
          height: 24,
        },
        devices: [],
        telemetry: { averageValue: null, activeAlarmCount: 0 },
      };
      building.zones.push(zone);
    }

    if (!row.deviceId) continue;

    const status = String(row.status || "offline").toLowerCase();
    if (status.includes("normal") || status.includes("commissioned") || status.includes("provisioned")) {
      statusCounts.normal += 1;
    } else if (status.includes("alarm") || status.includes("critical")) {
      statusCounts.critical += 1;
    } else if (status.includes("warning")) {
      statusCounts.warning += 1;
    } else {
      statusCounts.offline += 1;
    }

    const device = {
      id: row.deviceId,
      name: row.deviceName,
      type: row.type,
      bacnet: {
        instance: row.bacnetInstance,
        objectType: row.objectType,
        objectInstance: row.objectInstance,
      },
      value: row.value,
      units: row.units,
      status: row.status,
      provisioned: !!row.provisioned,
      commissioned: !!row.commissioned,
      configuration: parseJsonField(row.configuration),
      coordinates: {
        x: zone.geometry.x + 6 + (zone.devices.length % 3) * 10,
        y: zone.geometry.y + 8 + Math.floor(zone.devices.length / 3) * 7,
      },
    };
    zone.devices.push(device);
  }

  for (const building of buildings) {
    for (const zone of building.zones) {
      const numericValues = zone.devices
        .map((device) => device.value)
        .filter((value) => typeof value === "number");
      zone.telemetry.averageValue = numericValues.length
        ? Number((numericValues.reduce((sum, value) => sum + value, 0) / numericValues.length).toFixed(2))
        : null;
    }
  }

  return {
    appliance: applianceProfile,
    generatedAt: new Date().toISOString(),
    summary: {
      buildingCount: buildings.length,
      zoneCount: buildings.reduce((sum, building) => sum + building.zones.length, 0),
      deviceCount: buildings.reduce(
        (sum, building) => sum + building.zones.reduce((zoneSum, zone) => zoneSum + zone.devices.length, 0),
        0
      ),
      statusCounts,
    },
    buildings,
  };
}

function fetchTwin() {
  return dbQuery(
    `SELECT b.building_id AS buildingId,
            b.name AS buildingName,
            b.address,
            b.description AS buildingDescription,
            z.zone_id AS zoneId,
            z.name AS zoneName,
            z.description AS zoneDescription,
            d.device_id AS deviceId,
            d.name AS deviceName,
            d.type,
            d.bacnet_instance AS bacnetInstance,
            d.object_instance AS objectInstance,
            d.object_type AS objectType,
            d.present_value AS value,
            d.units,
            d.status,
            d.provisioned AS provisioned,
            d.commissioned AS commissioned,
            d.configuration AS configuration
     FROM buildings b
     LEFT JOIN zones z ON b.building_id = z.building_id
     LEFT JOIN devices d ON z.zone_id = d.zone_id
     ORDER BY b.building_id, z.zone_id, d.device_id`
  ).then(buildTwin);
}

app.get("/api/buildings", (req, res) => {
  handleQuery(res, "SELECT building_id AS id, name, address, description FROM buildings ORDER BY building_id");
});

app.get("/api/buildings/:buildingId/zones", (req, res) => {
  const buildingId = Number(req.params.buildingId);
  handleQuery(
    res,
    "SELECT zone_id AS id, name, description FROM zones WHERE building_id = ? ORDER BY zone_id",
    [buildingId]
  );
});

app.get("/api/zones/:zoneId/devices", (req, res) => {
  const zoneId = Number(req.params.zoneId);
  handleQuery(
    res,
    `SELECT device_id AS id,
            name,
            type,
            bacnet_instance AS bacnetInstance,
            object_instance AS objectInstance,
            object_type AS objectType,
            vendor,
            model,
            ip_address AS ipAddress,
            present_value AS value,
            units,
            status,
            provisioned AS provisioned,
            commissioned AS commissioned,
            description
     FROM devices
     WHERE zone_id = ?
     ORDER BY device_id`,
    [zoneId]
  );
});

app.get("/api/devices", (req, res) => {
  handleQuery(
    res,
    `SELECT d.device_id AS id,
            d.name,
            d.type,
            d.bacnet_instance AS bacnetInstance,
            d.object_instance AS objectInstance,
            d.object_type AS objectType,
            d.vendor,
            d.model,
            d.ip_address AS ipAddress,
            d.present_value AS value,
            d.units,
            d.status,
            d.provisioned AS provisioned,
            d.commissioned AS commissioned,
            d.configuration AS configuration,
            d.description,
            z.zone_id AS zoneId,
            z.name AS zoneName,
            b.building_id AS buildingId,
            b.name AS buildingName
     FROM devices d
     JOIN zones z ON d.zone_id = z.zone_id
     JOIN buildings b ON z.building_id = b.building_id
     ORDER BY b.building_id, z.zone_id, d.device_id`
  );
});

app.post("/api/devices/provision", (req, res) => {
  const {
    zoneId,
    name,
    type,
    bacnetInstance,
    objectInstance = 1,
    objectType,
    vendor = "",
    model = "",
    ipAddress = "",
    units = "",
    description = "",
    configuration = {},
    provisioned = false,
    commissioned = false,
  } = req.body;

  if (!zoneId || !name || !type || bacnetInstance == null || !objectType) {
    return res.status(400).json({ error: "Missing required device fields." });
  }

  const effectiveProvisioned = provisioned || commissioned;
  const status = commissioned ? "Commissioned" : effectiveProvisioned ? "Provisioned" : "Pending";
  const query = `INSERT INTO devices
      (zone_id, name, type, bacnet_instance, object_instance, object_type, vendor, model, ip_address, units, status, description, configuration, provisioned, commissioned)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
  const params = [
    zoneId,
    name,
    type,
    bacnetInstance,
    objectInstance,
    objectType,
    vendor,
    model,
    ipAddress,
    units,
    status,
    description,
    JSON.stringify(configuration),
    effectiveProvisioned ? 1 : 0,
    commissioned ? 1 : 0,
  ];

  db.query(query, params, (error, result) => {
    if (error) {
      console.error("Provision device failed:", error);
      return res.status(500).json({ error: "Unable to provision device." });
    }
    res.json({ id: result.insertId, name, provisioned, status });
  });
});

app.patch("/api/devices/:deviceId/configuration", (req, res) => {
  const deviceId = Number(req.params.deviceId);
  const { configuration, provisioned } = req.body;

  if (configuration == null) {
    return res.status(400).json({ error: "Configuration payload is required." });
  }

  const configString = JSON.stringify(configuration);
  const provisionedValue = provisioned === true ? 1 : 0;
  const status = provisioned === true ? "Provisioned" : "Configured";

  db.query(
    `UPDATE devices SET configuration = ?, provisioned = ?, status = ? WHERE device_id = ?`,
    [configString, provisionedValue, status, deviceId],
    (error, result) => {
      if (error) {
        console.error("Update device configuration failed:", error);
        return res.status(500).json({ error: "Unable to update device configuration." });
      }
      if (result.affectedRows === 0) {
        return res.status(404).json({ error: "Device not found." });
      }
      res.json({ id: deviceId, provisioned: provisioned === true, status });
    }
  );
});

app.patch("/api/devices/:deviceId/setpoint", (req, res) => {
  const deviceId = Number(req.params.deviceId);
  const { setpoint } = req.body;

  if (setpoint == null) {
    return res.status(400).json({ error: "Setpoint is required." });
  }

  db.query(
    `UPDATE devices SET configuration = JSON_SET(COALESCE(configuration, JSON_OBJECT()), '$.setpoint', ?) WHERE device_id = ?`,
    [setpoint, deviceId],
    (error, result) => {
      if (error) {
        console.error("Update device setpoint failed:", error);
        return res.status(500).json({ error: "Unable to update device setpoint." });
      }
      if (result.affectedRows === 0) {
        return res.status(404).json({ error: "Device not found." });
      }
      res.json({ id: deviceId, setpoint });
    }
  );
});

app.patch("/api/devices/:deviceId/range", (req, res) => {
  const deviceId = Number(req.params.deviceId);
  const { minSetpoint, maxSetpoint } = req.body;

  if (minSetpoint == null && maxSetpoint == null) {
    return res.status(400).json({ error: "At least one of minSetpoint or maxSetpoint is required." });
  }

  const updates = [];
  const params = [];
  if (minSetpoint != null) {
    updates.push("'$.minSetpoint', ?");
    params.push(minSetpoint);
  }
  if (maxSetpoint != null) {
    updates.push("'$.maxSetpoint', ?");
    params.push(maxSetpoint);
  }

  const updateExpr = updates.join(", ");
  db.query(
    `UPDATE devices SET configuration = JSON_SET(COALESCE(configuration, JSON_OBJECT()), ${updateExpr}) WHERE device_id = ?`,
    [...params, deviceId],
    (error, result) => {
      if (error) {
        console.error("Update device range failed:", error);
        return res.status(500).json({ error: "Unable to update device range." });
      }
      if (result.affectedRows === 0) {
        return res.status(404).json({ error: "Device not found." });
      }
      res.json({ id: deviceId, minSetpoint, maxSetpoint });
    }
  );
});

app.patch("/api/devices/:deviceId/provision", (req, res) => {
  const deviceId = Number(req.params.deviceId);
  db.query(
    `UPDATE devices SET provisioned = 1, status = 'Provisioned' WHERE device_id = ?`,
    [deviceId],
    (error, result) => {
      if (error) {
        console.error("Provision device failed:", error);
        return res.status(500).json({ error: "Unable to mark device provisioned." });
      }
      if (result.affectedRows === 0) {
        return res.status(404).json({ error: "Device not found." });
      }
      res.json({ id: deviceId, provisioned: true, status: "Provisioned" });
    }
  );
});

app.patch("/api/devices/:deviceId/commission", (req, res) => {
  const deviceId = Number(req.params.deviceId);
  db.query(
    `UPDATE devices SET commissioned = 1, provisioned = 1, status = 'Commissioned' WHERE device_id = ?`,
    [deviceId],
    (error, result) => {
      if (error) {
        console.error("Commission device failed:", error);
        return res.status(500).json({ error: "Unable to mark device commissioned." });
      }
      if (result.affectedRows === 0) {
        return res.status(404).json({ error: "Device not found." });
      }
      res.json({ id: deviceId, provisioned: true, commissioned: true, status: "Commissioned" });
    }
  );
});

app.get("/api/edge/health", async (req, res) => {
  res.json(await edgeClient.health());
});

app.get("/api/energy/forecast", async (req, res) => {
  const hours = Number(req.query.hours || 3);
  res.json(await edgeClient.getEnergyForecast(hours));
});

app.post("/api/edge/read-point", async (req, res) => {
  const { deviceInstance, objectType, objectInstance } = req.body;
  if (deviceInstance == null || objectType == null || objectInstance == null) {
    return res.status(400).json({ error: "deviceInstance, objectType, and objectInstance are required." });
  }

  res.json(await edgeClient.readPoint({
    deviceInstance: Number(deviceInstance),
    objectType: bacnetObjectTypeNumber(objectType),
    objectInstance: Number(objectInstance),
  }));
});

app.post("/api/edge/write-point", async (req, res) => {
  const { deviceInstance, objectType, objectInstance, value, mode = "WRITE_MODE_ABSOLUTE" } = req.body;
  if (deviceInstance == null || objectType == null || objectInstance == null || value == null) {
    return res.status(400).json({ error: "deviceInstance, objectType, objectInstance, and value are required." });
  }

  res.json(await edgeClient.writePoint({
    deviceInstance: Number(deviceInstance),
    objectType: bacnetObjectTypeNumber(objectType),
    objectInstance: Number(objectInstance),
    value: Number(value),
    mode,
  }));
});

app.get("/api/ai/optimization", (req, res) => {
  db.query(
    `SELECT d.device_id AS id,
            d.name,
            d.type,
            d.present_value AS value,
            d.units,
            d.configuration AS configuration,
            z.name AS zoneName
     FROM devices d
     LEFT JOIN zones z ON d.zone_id = z.zone_id
     ORDER BY d.device_id`,
    (error, devices) => {
      if (error) {
        console.error("AI optimization query failed:", error);
        return res.status(500).json({ error: "Unable to build optimization recommendations." });
      }
      res.json(buildOptimization(devices, req.query));
    }
  );
});

app.get("/api/ai/building-optimization", (req, res) => {
  db.query(
    `SELECT b.name AS buildingName,
            z.zone_id AS zoneId,
            z.name AS zoneName,
            d.device_id AS deviceId,
            d.name AS deviceName,
            d.type,
            d.present_value AS value,
            d.units,
            d.configuration AS configuration
     FROM buildings b
     JOIN zones z ON b.building_id = z.building_id
     JOIN devices d ON z.zone_id = d.zone_id
     ORDER BY b.building_id, z.zone_id, d.device_id`,
    async (error, rows) => {
      if (error) {
        console.error("Building optimization query failed:", error);
        return res.status(500).json({ error: "Unable to build whole-building optimization." });
      }
      const mode = evaluateAutonomousMode(req.query);
      const normalizedRows = rows.map((row) => ({ ...row, configuration: parseJsonField(row.configuration) }));
      const optimization =
        (await callPythonAi("/optimize", { mode, rows: normalizedRows })) ||
        buildBuildingOptimization(rows, req.query);
      db.query(
        `INSERT INTO building_optimization_runs (profile, objective, recommendations, estimated_savings_kwh)
         VALUES (?, ?, ?, ?)`,
        [
          optimization.mode.profile,
          JSON.stringify(optimization.objective),
          JSON.stringify(optimization.zonePlans),
          optimization.objective.estimatedSavingsKwh,
        ],
        (insertError) => {
          if (insertError) {
            console.error("Unable to persist optimization run:", insertError);
          }
        }
      );
      res.json(optimization);
    }
  );
});

app.post("/api/ai/reinforcement/feedback", (req, res) => {
  const { zoneId, action, reward } = req.body;
  if (zoneId == null || action == null || reward == null) {
    return res.status(400).json({ error: "zoneId, action, and reward are required." });
  }
  callPythonAi("/feedback", { zoneId, action, reward }).then((pythonResult) => {
    res.json(pythonResult || updateRlPolicy({ zoneId, action, reward }));
  });
});

app.get("/api/bacnet/discovery", async (req, res) => {
  const lowInstance = Number(req.query.lowInstance || 1);
  const highInstance = Number(req.query.highInstance || lowInstance);
  res.json(await edgeClient.discoverDevices(lowInstance, highInstance));
});

app.post("/api/provisioning/discover", async (req, res) => {
  const lowInstance = Number(req.body.lowInstance || 1);
  const highInstance = Number(req.body.highInstance || lowInstance);
  const discovery = await edgeClient.discoverDevices(lowInstance, highInstance);
  res.json({
    ...discovery,
    recommendedNextStep: discovery.devices?.length
      ? "Select discovered devices and POST them to /api/devices/provision."
      : "No devices discovered through the edge core.",
  });
});

app.get("/api/provisioning/status", (req, res) => {
  db.query(
    `SELECT
       COUNT(*) AS totalDevices,
       SUM(CASE WHEN provisioned = 1 THEN 1 ELSE 0 END) AS provisionedDevices,
       SUM(CASE WHEN commissioned = 1 THEN 1 ELSE 0 END) AS commissionedDevices,
       SUM(CASE WHEN provisioned = 0 THEN 1 ELSE 0 END) AS pendingDevices
     FROM devices`,
    (error, rows) => {
      if (error) {
        console.error("Provisioning status failed:", error);
        return res.status(500).json({ error: "Unable to fetch provisioning status." });
      }
      res.json(rows[0]);
    }
  );
});

app.get("/api/analytics/summary", (req, res) => {
  db.query(
    `SELECT event_type AS eventType,
            COUNT(*) AS eventCount,
            AVG(metric_value) AS averageValue,
            MAX(created_at) AS latestAt
     FROM analytics_events
     GROUP BY event_type
     ORDER BY latestAt DESC`,
    (error, rows) => {
      if (error) {
        console.error("Analytics summary failed:", error);
        return res.status(500).json({ error: "Unable to fetch analytics summary." });
      }
      res.json(rows);
    }
  );
});

app.post("/api/analytics/events", (req, res) => {
  const {
    eventType,
    buildingId = null,
    zoneId = null,
    deviceId = null,
    metricName = null,
    metricValue = null,
    payload = {},
  } = req.body;

  if (!eventType) {
    return res.status(400).json({ error: "eventType is required." });
  }

  db.query(
    `INSERT INTO analytics_events (event_type, building_id, zone_id, device_id, metric_name, metric_value, payload)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [eventType, buildingId, zoneId, deviceId, metricName, metricValue, JSON.stringify(payload)],
    (error, result) => {
      if (error) {
        console.error("Analytics event insert failed:", error);
        return res.status(500).json({ error: "Unable to store analytics event." });
      }
      res.json({ id: result.insertId, eventType });
    }
  );
});

app.get("/api/autonomous-mode/profiles", (req, res) => {
  res.json(autonomousProfiles);
});

app.get("/api/autonomous-mode/evaluate", (req, res) => {
  res.json(evaluateAutonomousMode(req.query));
});

app.post("/api/autonomous-mode/evaluate", (req, res) => {
  res.json(evaluateAutonomousMode(req.body));
});

app.get("/api/devices/:deviceId", (req, res) => {
  const deviceId = Number(req.params.deviceId);
  handleQuery(
    res,
    `SELECT d.device_id AS id,
            d.name,
            d.type,
            d.bacnet_instance AS bacnetInstance,
            d.object_instance AS objectInstance,
            d.object_type AS objectType,
            d.vendor,
            d.model,
            d.ip_address AS ipAddress,
            d.present_value AS value,
            d.units,
            d.status,
            d.provisioned AS provisioned,
            d.commissioned AS commissioned,
            d.configuration AS configuration,
            d.description,
            z.zone_id AS zoneId,
            z.name AS zoneName,
            b.building_id AS buildingId,
            b.name AS buildingName,
            b.address AS buildingAddress,
            b.description AS buildingDescription
     FROM devices d
     JOIN zones z ON d.zone_id = z.zone_id
     JOIN buildings b ON z.building_id = b.building_id
     WHERE d.device_id = ?`,
    [deviceId]
  );
});

app.get("/api/hierarchy", (req, res) => {
  db.query(
    `SELECT b.building_id AS buildingId,
            b.name AS buildingName,
            b.address,
            b.description AS buildingDescription,
            z.zone_id AS zoneId,
            z.name AS zoneName,
            z.description AS zoneDescription,
            d.device_id AS deviceId,
            d.name AS deviceName,
            d.type,
            d.bacnet_instance AS bacnetInstance,
            d.object_instance AS objectInstance,
            d.object_type AS objectType,
            d.present_value AS value,
            d.units,
            d.status,
            d.provisioned AS provisioned,
            d.commissioned AS commissioned,
            d.configuration AS configuration
     FROM buildings b
     LEFT JOIN zones z ON b.building_id = z.building_id
     LEFT JOIN devices d ON z.zone_id = d.zone_id
     ORDER BY b.building_id, z.zone_id, d.device_id`,
    (error, rows) => {
      if (error) {
        console.error("MySQL query failed:", error);
        return res.status(500).json({ error: "Unable to fetch hierarchy" });
      }

      const hierarchy = [];
      const buildingMap = new Map();

      for (const row of rows) {
        let building = buildingMap.get(row.buildingId);
        if (!building) {
          building = {
            id: row.buildingId,
            name: row.buildingName,
            address: row.address,
            description: row.description,
            zones: [],
          };
          buildingMap.set(row.buildingId, building);
          hierarchy.push(building);
        }

        if (row.zoneId) {
          let zone = building.zones.find((z) => z.id === row.zoneId);
          if (!zone) {
            zone = {
              id: row.zoneId,
              name: row.zoneName,
              description: row.zoneDescription,
              devices: [],
            };
            building.zones.push(zone);
          }

          if (row.deviceId) {
            zone.devices.push({
              id: row.deviceId,
              name: row.deviceName,
              type: row.type,
              bacnetInstance: row.bacnetInstance,
              objectInstance: row.objectInstance,
              objectType: row.objectType,
              value: row.value,
              units: row.units,
              status: row.status,
              provisioned: !!row.provisioned,
              commissioned: !!row.commissioned,
              configuration: parseJsonField(row.configuration),
            });
          }
        }
      }

      res.json(hierarchy);
    }
  );
});

app.get("/api/digital-twin", async (req, res) => {
  try {
    res.json(await fetchTwin());
  } catch (error) {
    console.error("Digital twin query failed:", error);
    res.status(500).json({ error: "Unable to fetch digital twin." });
  }
});

app.get("/api/telemetry/stream", (req, res) => {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "Access-Control-Allow-Origin": "*",
  });

  const sendTelemetry = async () => {
    try {
      const twin = await fetchTwin();
      res.write(`event: telemetry\n`);
      res.write(`data: ${JSON.stringify(twin)}\n\n`);
    } catch (error) {
      res.write(`event: error\n`);
      res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
    }
  };

  sendTelemetry();
  const timer = setInterval(sendTelemetry, Number(process.env.TELEMETRY_STREAM_INTERVAL_MS || 5000));
  req.on("close", () => clearInterval(timer));
});

app.get("/api/roles", (req, res) => {
  handleQuery(res, `SELECT role_id AS id, name, description, permissions FROM roles ORDER BY role_id`);
});

app.get("/api/users", (req, res) => {
  handleQuery(
    res,
    `SELECT u.user_id AS id,
            u.username,
            u.email,
            u.role_id AS roleId,
            r.name AS roleName,
            r.permissions
     FROM users u
     LEFT JOIN roles r ON u.role_id = r.role_id
     ORDER BY u.user_id`
  );
});

app.post("/api/users", (req, res) => {
  const { username, email = "", roleId = null } = req.body;
  if (!username) {
    return res.status(400).json({ error: "Username is required." });
  }

  const query = `INSERT INTO users (username, email, role_id) VALUES (?, ?, ?)`;
  db.query(query, [username, email, roleId || null], (error, result) => {
    if (error) {
      console.error("Create user failed:", error);
      return res.status(500).json({ error: "Unable to create user." });
    }
    res.json({ id: result.insertId, username, email, roleId });
  });
});

app.patch("/api/users/:userId/role", (req, res) => {
  const userId = Number(req.params.userId);
  const { roleId = null } = req.body;
  db.query(
    `UPDATE users SET role_id = ? WHERE user_id = ?`,
    [roleId || null, userId],
    (error, result) => {
      if (error) {
        console.error("Update user role failed:", error);
        return res.status(500).json({ error: "Unable to update user role." });
      }
      if (result.affectedRows === 0) {
        return res.status(404).json({ error: "User not found." });
      }
      res.json({ id: userId, roleId });
    }
  );
});

app.delete("/api/users/:userId", (req, res) => {
  const userId = Number(req.params.userId);
  db.query(`DELETE FROM users WHERE user_id = ?`, [userId], (error, result) => {
    if (error) {
      console.error("Delete user failed:", error);
      return res.status(500).json({ error: "Unable to delete user." });
    }
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: "User not found." });
    }
    res.json({ id: userId, deleted: true });
  });
});

app.get("/api/alarms", (req, res) => {
  handleQuery(
    res,
    `SELECT a.id,
            a.device_id AS deviceId,
            d.name AS deviceName,
            a.message,
            a.severity,
            a.status,
            a.acked AS acked,
            a.created_at AS createdAt
     FROM alarms a
     LEFT JOIN devices d ON a.device_id = d.device_id
     ORDER BY a.created_at DESC`
  );
});

app.get("/api/alarms/stream", (req, res) => {
  registerAlarmSseClient(req, res);
});

app.post("/api/alarms", (req, res) => {
  const { deviceId, message, severity = "critical" } = req.body;
  if (!deviceId || !message) {
    return res.status(400).json({ error: "deviceId and message are required." });
  }

  const query = `INSERT INTO alarms (device_id, message, severity, status, acked) VALUES (?, ?, ?, 'Active', 0)`;
  db.query(query, [deviceId, message, severity], (error, result) => {
    if (error) {
      console.error("Create alarm failed:", error);
      return res.status(500).json({ error: "Unable to create alarm." });
    }
    const responsePayload = { id: result.insertId, deviceId, message, severity, status: "Active", acked: false };
    res.json(responsePayload);
    broadcastAlarmUpdate();
  });
});

app.patch("/api/alarms/:alarmId/ack", (req, res) => {
  const alarmId = Number(req.params.alarmId);
  db.query(
    `UPDATE alarms SET acked = 1, status = 'Acknowledged' WHERE id = ?`,
    [alarmId],
    (error, result) => {
      if (error) {
        console.error("Acknowledge alarm failed:", error);
        return res.status(500).json({ error: "Unable to acknowledge alarm." });
      }
      if (result.affectedRows === 0) {
        return res.status(404).json({ error: "Alarm not found." });
      }
      res.json({ id: alarmId, acked: true, status: "Acknowledged" });
      broadcastAlarmUpdate();
    }
  );
});

app.patch("/api/alarms/:alarmId/clear", (req, res) => {
  const alarmId = Number(req.params.alarmId);
  db.query(
    `UPDATE alarms SET status = 'Cleared' WHERE id = ?`,
    [alarmId],
    (error, result) => {
      if (error) {
        console.error("Clear alarm failed:", error);
        return res.status(500).json({ error: "Unable to clear alarm." });
      }
      if (result.affectedRows === 0) {
        return res.status(404).json({ error: "Alarm not found." });
      }
      res.json({ id: alarmId, status: "Cleared" });      broadcastAlarmUpdate();    }
  );
});

app.get("/api/schedules", (req, res) => {
  handleQuery(
    res,
    `SELECT s.schedule_id AS id,
            s.name,
            s.enabled,
            s.start_time AS startTime,
            s.end_time AS endTime,
            s.days,
            s.action,
            s.target_value AS targetValue,
            s.units,
            s.description,
            s.building_id AS buildingId,
            b.name AS buildingName,
            s.zone_id AS zoneId,
            z.name AS zoneName,
            s.device_id AS deviceId,
            d.name AS deviceName,
            s.created_at AS createdAt,
            s.updated_at AS updatedAt
     FROM schedules s
     LEFT JOIN buildings b ON s.building_id = b.building_id
     LEFT JOIN zones z ON s.zone_id = z.zone_id
     LEFT JOIN devices d ON s.device_id = d.device_id
     ORDER BY s.enabled DESC, s.start_time, s.name`
  );
});

app.post("/api/schedules", (req, res) => {
  const {
    name,
    buildingId = null,
    zoneId = null,
    deviceId = null,
    enabled = true,
    startTime,
    endTime,
    days,
    action = "setpoint",
    targetValue = null,
    units = "",
    description = "",
  } = req.body;

  if (!name || !startTime || !endTime || !days) {
    return res.status(400).json({ error: "Name, startTime, endTime, and days are required." });
  }

  const query = `INSERT INTO schedules
      (name, building_id, zone_id, device_id, enabled, start_time, end_time, days, action, target_value, units, description)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
  const params = [
    name,
    buildingId || null,
    zoneId || null,
    deviceId || null,
    enabled ? 1 : 0,
    startTime,
    endTime,
    days,
    action,
    targetValue,
    units,
    description,
  ];

  db.query(query, params, (error, result) => {
    if (error) {
      console.error("Create schedule failed:", error);
      return res.status(500).json({ error: "Unable to create schedule." });
    }
    res.json({ id: result.insertId, name, enabled, startTime, endTime, days, action, targetValue, units, description, buildingId, zoneId, deviceId });
  });
});

app.patch("/api/schedules/:scheduleId", (req, res) => {
  const scheduleId = Number(req.params.scheduleId);
  const {
    name,
    buildingId = null,
    zoneId = null,
    deviceId = null,
    enabled = null,
    startTime,
    endTime,
    days,
    action,
    targetValue,
    units,
    description,
  } = req.body;

  const query = `UPDATE schedules SET
      name = COALESCE(?, name),
      building_id = COALESCE(?, building_id),
      zone_id = COALESCE(?, zone_id),
      device_id = COALESCE(?, device_id),
      enabled = COALESCE(?, enabled),
      start_time = COALESCE(?, start_time),
      end_time = COALESCE(?, end_time),
      days = COALESCE(?, days),
      action = COALESCE(?, action),
      target_value = COALESCE(?, target_value),
      units = COALESCE(?, units),
      description = COALESCE(?, description)
    WHERE schedule_id = ?`;

  const params = [
    name,
    buildingId,
    zoneId,
    deviceId,
    enabled,
    startTime,
    endTime,
    days,
    action,
    targetValue,
    units,
    description,
    scheduleId,
  ];

  db.query(query, params, (error, result) => {
    if (error) {
      console.error("Update schedule failed:", error);
      return res.status(500).json({ error: "Unable to update schedule." });
    }
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: "Schedule not found." });
    }
    res.json({ id: scheduleId, updated: true });
  });
});

app.patch("/api/schedules/:scheduleId/enable", (req, res) => {
  const scheduleId = Number(req.params.scheduleId);
  db.query(
    `UPDATE schedules SET enabled = 1 WHERE schedule_id = ?`,
    [scheduleId],
    (error, result) => {
      if (error) {
        console.error("Enable schedule failed:", error);
        return res.status(500).json({ error: "Unable to enable schedule." });
      }
      if (result.affectedRows === 0) {
        return res.status(404).json({ error: "Schedule not found." });
      }
      res.json({ id: scheduleId, enabled: true });
    }
  );
});

app.patch("/api/schedules/:scheduleId/disable", (req, res) => {
  const scheduleId = Number(req.params.scheduleId);
  db.query(
    `UPDATE schedules SET enabled = 0 WHERE schedule_id = ?`,
    [scheduleId],
    (error, result) => {
      if (error) {
        console.error("Disable schedule failed:", error);
        return res.status(500).json({ error: "Unable to disable schedule." });
      }
      if (result.affectedRows === 0) {
        return res.status(404).json({ error: "Schedule not found." });
      }
      res.json({ id: scheduleId, enabled: false });
    }
  );
});

app.delete("/api/schedules/:scheduleId", (req, res) => {
  const scheduleId = Number(req.params.scheduleId);
  db.query(
    `DELETE FROM schedules WHERE schedule_id = ?`,
    [scheduleId],
    (error, result) => {
      if (error) {
        console.error("Delete schedule failed:", error);
        return res.status(500).json({ error: "Unable to delete schedule." });
      }
      if (result.affectedRows === 0) {
        return res.status(404).json({ error: "Schedule not found." });
      }
      res.json({ id: scheduleId, deleted: true });
    }
  );
});

app.get("/api/health", (req, res) => {
  const statusCode = watchdogState.status === "ok" || watchdogState.status === "starting" ? 200 : 503;
  res.status(statusCode).json({
    status: watchdogState.status,
    checkedAt: watchdogState.lastRunAt,
    appliance: applianceProfile,
  });
});

app.get("/api/watchdog", async (req, res) => {
  const state = watchdogState.lastRunAt ? watchdogState : await runWatchdog();
  res.status(state.status === "ok" ? 200 : 503).json({ ...state, appliance: applianceProfile });
});

app.get("/api/remote/status", requireManagementToken, (req, res) => {
  res.json({
    appliance: applianceProfile,
    watchdog: watchdogState,
    recentActions: remoteActions,
    capabilities: ["restart_service", "push_update", "monitor_health", "provisioning", "digital_twin"],
  });
});

app.post("/api/remote/restart", requireManagementToken, (req, res) => {
  const { service = "api" } = req.body;
  const supported = ["api", "ui", "ai-service", "edge-core"];
  if (!supported.includes(service)) {
    return res.status(400).json({ error: `Unsupported service. Use one of: ${supported.join(", ")}` });
  }
  res.status(202).json(
    managementAction("restart_service", "queued", {
      service,
      note: "Restart accepted by remote API. External supervisor should execute the container/systemd restart.",
    })
  );
});

app.post("/api/remote/update", requireManagementToken, (req, res) => {
  const { version = "latest", channel = "stable" } = req.body;
  res.status(202).json(
    managementAction("push_update", "queued", {
      version,
      channel,
      note: "Update accepted by remote API. CI/CD or device supervisor should pull and apply this artifact.",
    })
  );
});

app.post("/api/remote/watchdog/run", requireManagementToken, async (req, res) => {
  res.json(await runWatchdog());
});

app.get("*", (req, res) => {
  if (req.path.startsWith("/api")) {
    return res.status(404).json({ error: "Not found" });
  }
  if (fs.existsSync(path.join(uiDistPath, "index.html"))) {
    return res.sendFile(path.join(uiDistPath, "index.html"));
  }
  res.status(404).send("Not found");
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`API running on port ${PORT}`);
  runWatchdog().catch((error) => console.error("Initial watchdog run failed:", error));
  setInterval(() => {
    runWatchdog().catch((error) => console.error("Watchdog run failed:", error));
  }, watchdogIntervalMs);
});
