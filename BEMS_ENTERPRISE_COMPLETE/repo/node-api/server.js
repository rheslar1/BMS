const express = require("express");
const cors = require("cors");
const mysql = require("mysql2");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const { createEdgeClient } = require("./edgeClient");
const { createAiClient } = require("./aiClient");
const { createEventBus } = require("./eventBus");
const {
  createAuthMiddleware,
  auditEvent,
  hashToken,
  hashPassword,
  verifyPassword,
  requirePermission,
  createUserSession,
} = require("./auth");
const app = express();

app.use(cors());
app.use(express.json());

const processStartedAt = Date.now();
const httpMetrics = {
  total: 0,
  byRoute: new Map(),
};

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

app.use(createAuthMiddleware(db, {
  requireAuth: process.env.BEMS_REQUIRE_AUTH === "true",
}));

app.use((req, res, next) => {
  const started = Date.now();
  res.on("finish", () => {
    const routeKey = `${req.method} ${req.route?.path || req.path}`;
    const statusFamily = `${Math.floor(res.statusCode / 100)}xx`;
    const key = `${routeKey}|${statusFamily}`;
    httpMetrics.total += 1;
    const current = httpMetrics.byRoute.get(key) || { routeKey, statusFamily, count: 0, durationMs: 0 };
    current.count += 1;
    current.durationMs += Date.now() - started;
    httpMetrics.byRoute.set(key, current);
  });
  next();
});

const alarmClients = new Set();
const edgeClient = createEdgeClient();
const aiClient = createAiClient();
const eventBus = createEventBus();
const edgeCommandTransport = process.env.EDGE_COMMAND_TRANSPORT || "rabbitmq";
const eventTopics = [
  "bems.telemetry",
  "bems.telemetry.live",
  "bems.alarms",
  "bems.alarms.snapshot",
  "bems.analytics",
  "bems.ai.control",
  "bems.ai.simulation",
  "bems.ai.demand_response",
  "bems.building.footprint",
];
const aiServiceUrl = process.env.AI_SERVICE_URL || "";
const watchdogIntervalMs = Number(process.env.WATCHDOG_INTERVAL_MS || 30000);
const managementToken = process.env.BEMS_MANAGEMENT_TOKEN || "";
const otaSigningKey = process.env.OTA_SIGNING_KEY || "dev-field-device-key";
const otaSigningKeyId = process.env.OTA_SIGNING_KEY_ID || "default";
const otaPrivateKeyPem = process.env.OTA_PRIVATE_KEY_PEM || "";
const swupdateDefaultSoftwareSet = process.env.SWUPDATE_SOFTWARE_SET || "stable";
const swupdateDefaultMode = process.env.SWUPDATE_MODE || "copy-2";
const swupdateDefaultRootfs = process.env.SWUPDATE_ROOTFS_FILENAME || "rootfs.ext4.gz";
const swupdateDefaultDevice = process.env.SWUPDATE_TARGET_DEVICE || "/dev/mmcblk0p2";
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
const controlLoopState = {
  running: false,
  intervalMs: Number(process.env.AI_CONTROL_LOOP_INTERVAL_MS || 60000),
  timer: null,
  lastRunAt: null,
  lastResult: null,
  lastError: null,
};

async function queueEdgeCommand(commandType, payload, key = null) {
  const command = {
    commandType,
    transport: "rabbitmq",
    delivery: "async_command_queue",
    target: "edge-core-or-nrf52840-field-device",
    payload,
  };
  const publishResult = await eventBus.publish("bems.edge.commands", command, key || commandType);
  return {
    accepted: publishResult.published,
    queued: publishResult.published,
    command,
    publishResult,
    message: publishResult.published
      ? "Edge command queued through RabbitMQ AMQP."
      : "Edge command was not queued; RabbitMQ/event bus is unavailable.",
  };
}

function useRabbitEdgeCommands() {
  return edgeCommandTransport === "rabbitmq";
}

const maintenanceModeActiveSql = `
  EXISTS (
    SELECT 1
    FROM maintenance_modes mm
    WHERE mm.enabled = 1
      AND (mm.ends_at IS NULL OR mm.ends_at > CURRENT_TIMESTAMP)
      AND (
        (mm.scope_type = 'device' AND mm.device_id = d.device_id)
        OR (mm.scope_type = 'zone' AND mm.zone_id = d.zone_id)
        OR (mm.scope_type = 'building' AND mm.building_id = z.building_id)
      )
  )
`;

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

function escapePdfText(value) {
  return String(value ?? "").replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

function escapeCsvValue(value) {
  const text = String(value ?? "");
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function buildSimplePdf(title, lines) {
  const content = [
    "BT",
    "/F1 18 Tf",
    "72 760 Td",
    `(${escapePdfText(title)}) Tj`,
    "/F1 10 Tf",
    "0 -28 Td",
    ...lines.flatMap((line) => [`(${escapePdfText(line).slice(0, 110)}) Tj`, "0 -14 Td"]),
    "ET",
  ].join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`,
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefOffset = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  offsets.slice(1).forEach((offset) => {
    pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  });
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(pdf);
}

function sha256Hex(bufferOrText) {
  return crypto.createHash("sha256").update(bufferOrText).digest("hex");
}

function signFirmwareManifest({ version, channel, checksum }) {
  const payload = `${version}:${channel}:${checksum}`;
  if (otaPrivateKeyPem) {
    return crypto.sign("RSA-SHA256", Buffer.from(payload), otaPrivateKeyPem).toString("base64");
  }
  return crypto
    .createHmac("sha256", otaSigningKey)
    .update(payload)
    .digest("hex");
}

function firmwareSignatureAlgorithm() {
  return otaPrivateKeyPem ? "RSA-SHA256" : "HMAC-SHA256";
}

function sanitizeSwupdateToken(value, fallback = "edge-core") {
  return String(value || fallback).replace(/[^A-Za-z0-9_.-]/g, "-");
}

function swupdateFilename(version, channel = "stable") {
  return `bems-${sanitizeSwupdateToken(channel, "stable")}-${sanitizeSwupdateToken(version, "firmware")}.swu`;
}

function buildSwupdateDescription({
  version,
  channel = "stable",
  checksum,
  softwareSet = swupdateDefaultSoftwareSet,
  softwareMode = swupdateDefaultMode,
  hardwareCompatibility = ["edge-core", "nrf52840-bacnet"],
  rootfsFilename = swupdateDefaultRootfs,
  targetDevice = swupdateDefaultDevice,
  systemPackages = [],
  packageManager = "auto",
}) {
  const hardware = hardwareCompatibility
    .map((item) => `            "${sanitizeSwupdateToken(item, "edge-core")}"`)
    .join(",\n");
  const packageList = Array.isArray(systemPackages)
    ? systemPackages.map((item) => sanitizeSwupdateToken(item, "")).filter(Boolean)
    : [];
  const scriptSection = packageList.length > 0
    ? [
        "            scripts: (",
        "                {",
        "                    filename = \"bems-system-package-update.sh\";",
        "                    type = \"shellscript\";",
        `                    packages = "${packageList.join(" ")}";`,
        `                    package-manager = "${sanitizeSwupdateToken(packageManager, "auto")}";`,
        "                }",
        "            );",
      ]
    : [];
  return [
    "software =",
    "{",
    `    version = "${sanitizeSwupdateToken(version, "firmware")}";`,
    `    description = "IntelliBuild BEMS ${sanitizeSwupdateToken(channel, "stable")} ${sanitizeSwupdateToken(version, "firmware")}";`,
    "    hardware-compatibility: [",
    hardware,
    "    ];",
    `    ${sanitizeSwupdateToken(softwareSet, "stable")}: {`,
    `        ${sanitizeSwupdateToken(softwareMode, "copy-2")}: {`,
    "            images: (",
    "                {",
    `                    filename = "${sanitizeSwupdateToken(rootfsFilename, swupdateDefaultRootfs)}";`,
    `                    device = "${targetDevice}";`,
    "                    type = \"raw\";",
    `                    sha256 = "${checksum}";`,
    "                    installed-directly = true;",
    "                }",
    "            );",
    ...scriptSection,
    "            bootenv: (",
    "                {",
    "                    name = \"bems_active_version\";",
    `                    value = "${sanitizeSwupdateToken(version, "firmware")}";`,
    "                },",
    "                {",
    "                    name = \"bems_update_channel\";",
    `                    value = "${sanitizeSwupdateToken(channel, "stable")}";`,
    "                }",
    "            );",
    "        };",
    "    };",
    "}",
    "",
  ].join("\n");
}

function buildSwupdateManifest({
  version,
  channel = "stable",
  artifactUri = "",
  checksum,
  signature,
  softwareSet = swupdateDefaultSoftwareSet,
  softwareMode = swupdateDefaultMode,
  hardwareCompatibility = ["edge-core", "nrf52840-bacnet"],
  rootfsFilename = swupdateDefaultRootfs,
  targetDevice = swupdateDefaultDevice,
  systemPackages = [],
  packageManager = "auto",
}) {
  const swuFilename = swupdateFilename(version, channel);
  const resolvedArtifactUri = artifactUri || `inline://${swuFilename}`;
  const swDescription = buildSwupdateDescription({
    version,
    channel,
    checksum,
    softwareSet,
    softwareMode,
    hardwareCompatibility,
    rootfsFilename,
    targetDevice,
    systemPackages,
    packageManager,
  });
  const packageList = Array.isArray(systemPackages)
    ? systemPackages.map((item) => sanitizeSwupdateToken(item, "")).filter(Boolean)
    : [];
  return {
    version,
    channel,
    artifactUri: resolvedArtifactUri,
    swuArtifactUri: resolvedArtifactUri,
    swuFilename,
    checksum,
    signature,
    signingKeyId: otaSigningKeyId,
    algorithm: firmwareSignatureAlgorithm(),
    updateFramework: "SWUpdate",
    packageFormat: "swu",
    swDescription,
    softwareSet,
    softwareMode,
    hardwareCompatibility,
    rootfsFilename,
    targetDevice,
    systemPackageUpdate: {
      enabled: packageList.length > 0,
      packages: packageList,
      packageManager: sanitizeSwupdateToken(packageManager, "auto"),
      clientEnvironment: {
        SWUPDATE_SYSTEM_PACKAGES: packageList.join(" "),
        SWUPDATE_PACKAGE_MANAGER: sanitizeSwupdateToken(packageManager, "auto"),
      },
    },
    partitionScheme: "A/B",
    bootSlots: ["A", "B"],
    bootloaderFlow: "SWUpdate .swu -> checksum -> signature -> inactive A/B slot -> bootenv swap -> watchdog-confirmed boot -> rollback on failure",
    swupdate: {
      client: "swupdate",
      installCommand: `swupdate -i ${swuFilename} -e ${sanitizeSwupdateToken(softwareSet, "stable")},${sanitizeSwupdateToken(softwareMode, "copy-2")}`,
      progressCommand: "swupdate-progress -w",
      signedImage: true,
      rollback: "bootloader transaction marker and A/B slot fallback",
    },
    createdAt: new Date().toISOString(),
  };
}

function normalizeReportFilters(query = {}) {
  const requestedDays = Number(query.days || 30);
  return {
    days: Number.isFinite(requestedDays) && requestedDays > 0 ? Math.min(requestedDays, 365) : 30,
    buildingId: query.buildingId ? Number(query.buildingId) : null,
    zoneId: query.zoneId ? Number(query.zoneId) : null,
    deviceId: query.deviceId ? Number(query.deviceId) : null,
    metricName: query.metricName ? String(query.metricName) : null,
    severity: query.severity ? String(query.severity) : null,
  };
}

function appendReportTrendFilters(filters, params, tableAlias = "t") {
  const clauses = [`${tableAlias}.logged_at >= DATE_SUB(NOW(), INTERVAL ? DAY)`];
  params.push(filters.days);
  if (filters.buildingId) {
    clauses.push(`${tableAlias}.building_id = ?`);
    params.push(filters.buildingId);
  }
  if (filters.zoneId) {
    clauses.push(`${tableAlias}.zone_id = ?`);
    params.push(filters.zoneId);
  }
  if (filters.deviceId) {
    clauses.push(`${tableAlias}.device_id = ?`);
    params.push(filters.deviceId);
  }
  if (filters.metricName) {
    clauses.push(`${tableAlias}.metric_name = ?`);
    params.push(filters.metricName);
  }
  return clauses.join(" AND ");
}

function nextReportRunDate(cadence, fromDate = new Date()) {
  const next = new Date(fromDate.getTime());
  const normalized = String(cadence || "weekly").toLowerCase();
  if (normalized === "daily") next.setDate(next.getDate() + 1);
  else if (normalized === "monthly") next.setMonth(next.getMonth() + 1);
  else next.setDate(next.getDate() + 7);
  return next;
}

async function executeReportSchedule(schedule, actor = "system") {
  const filters = parseJsonField(schedule.filters, {});
  const recipients = parseJsonField(schedule.recipients, []);
  const format = String(schedule.format || (schedule.reportType === "energy" ? "pdf" : "csv")).toLowerCase();
  const downloadPath = schedule.reportType === "energy"
    ? `/api/reports/energy.pdf?days=${filters.days || 30}`
    : `/api/reports/export?format=${format}&days=${filters.days || 30}`;

  const exportResult = await dbQuery(
    `INSERT INTO report_exports (report_type, format, filters, status, download_path, requested_by)
     VALUES (?, ?, CAST(? AS JSON), 'ready', ?, ?)`,
    [schedule.reportType || "energy", format, JSON.stringify(filters), downloadPath, actor]
  );
  await dbQuery(
    `INSERT INTO report_schedule_runs (report_schedule_id, report_export_id, status, recipients, message)
     VALUES (?, ?, 'queued', CAST(? AS JSON), ?)`,
    [schedule.id, exportResult.insertId, JSON.stringify(recipients), `Scheduled ${schedule.reportType || "energy"} report generated.`]
  );
  if (recipients.length > 0) {
    await Promise.all(recipients.map((recipient) => dbQuery(
      `INSERT INTO notification_outbox (channel, recipient, subject, body, severity, status)
       VALUES ('email', ?, ?, ?, 'info', 'queued')`,
      [
        recipient,
        `BEMS ${schedule.name} report`,
        `Your scheduled report is ready: ${downloadPath}`,
      ]
    )));
  }
  const nextRunAt = nextReportRunDate(schedule.cadence);
  await dbQuery(
    `UPDATE report_schedules
     SET last_run_at = CURRENT_TIMESTAMP, next_run_at = ?
     WHERE report_schedule_id = ?`,
    [nextRunAt, schedule.id]
  );
  return { exportId: exportResult.insertId, nextRunAt: nextRunAt.toISOString(), downloadPath };
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

function permissionListIncludes(permissions, permission) {
  const scopes = parseJsonField(permissions, []);
  return Array.isArray(scopes) && (scopes.includes("*") || scopes.includes(permission));
}

function scheduleResidentPayload(row) {
  return {
    id: row.id,
    name: row.name,
    enabled: !!row.enabled,
    recurrence: row.recurrence,
    month: row.month,
    dayOfMonth: row.dayOfMonth,
    startTime: row.startTime,
    endTime: row.endTime,
    days: row.days,
    action: row.action,
    targetValue: row.targetValue,
    units: row.units,
    overridePriority: row.overridePriority,
    objectType: "schedule",
    persistentOnBacnetDevice: true,
  };
}

async function syncDeviceResidentSchedules(deviceId) {
  if (!deviceId) return null;
  const devices = await dbQuery("SELECT device_id AS id, configuration FROM devices WHERE device_id = ?", [deviceId]);
  if (devices.length === 0) return null;
  const schedules = await dbQuery(
    `SELECT schedule_id AS id,
            name,
            enabled,
            recurrence,
            month,
            day_of_month AS dayOfMonth,
            override_priority AS overridePriority,
            start_time AS startTime,
            end_time AS endTime,
            days,
            action,
            target_value AS targetValue,
            units
     FROM schedules
     WHERE device_id = ?
     ORDER BY override_priority DESC, start_time ASC`,
    [deviceId]
  );
  const configuration = parseJsonField(devices[0].configuration, {});
  const persistentStorage = configuration.persistentStorage || {};
  const retainedKeys = Array.from(new Set([...(persistentStorage.retainedKeys || []), "schedule"]));
  const updatedConfiguration = {
    ...configuration,
    persistentStorage: {
      ...persistentStorage,
      enabled: persistentStorage.enabled !== false,
      retainedKeys,
    },
    bacnetScheduleStorage: {
      enabled: true,
      persistentOnDevice: true,
      objectType: "schedule",
      storagePolicy: "device_resident",
      writePath: "BACnet WriteProperty to the device Schedule object",
      scheduleCount: schedules.length,
      lastSyncedAt: new Date().toISOString(),
      schedules: schedules.map(scheduleResidentPayload),
    },
  };
  await dbQuery("UPDATE devices SET configuration = ? WHERE device_id = ?", [JSON.stringify(updatedConfiguration), deviceId]);
  return updatedConfiguration.bacnetScheduleStorage;
}

async function syncScheduleResidentDevices(scheduleId, previousDeviceId = null) {
  const rows = await dbQuery("SELECT device_id AS deviceId FROM schedules WHERE schedule_id = ?", [scheduleId]);
  const nextDeviceId = rows[0]?.deviceId || null;
  const deviceIds = Array.from(new Set([previousDeviceId, nextDeviceId].filter(Boolean)));
  const synced = [];
  for (const deviceId of deviceIds) {
    synced.push({ deviceId, bacnetScheduleStorage: await syncDeviceResidentSchedules(deviceId) });
  }
  return synced;
}

async function fetchUserManagementState(userId, organizationId) {
  const rows = await dbQuery(
    `SELECT u.user_id AS id,
            u.active,
            r.permissions
     FROM users u
     LEFT JOIN roles r ON u.role_id = r.role_id
     WHERE u.user_id = ? AND u.organization_id = ?
     LIMIT 1`,
    [userId, organizationId]
  );
  return rows[0] || null;
}

async function activeUserManagerCount(organizationId) {
  const rows = await dbQuery(
    `SELECT COUNT(*) AS count
     FROM users u
     JOIN roles r ON u.role_id = r.role_id
     WHERE u.active = 1
       AND u.organization_id = ?
       AND (JSON_CONTAINS(r.permissions, JSON_QUOTE('users:manage')) OR JSON_CONTAINS(r.permissions, JSON_QUOTE('*')))`,
    [organizationId]
  );
  return Number(rows[0]?.count || 0);
}

async function assertCanRemoveUserManager(userId, organizationId) {
  const user = await fetchUserManagementState(userId, organizationId);
  if (!user) {
    const error = new Error("User not found.");
    error.statusCode = 404;
    throw error;
  }

  if (!user.active || !permissionListIncludes(user.permissions, "users:manage")) {
    return user;
  }

  if (await activeUserManagerCount(organizationId) <= 1) {
    const error = new Error("At least one active admin user with users:manage permission is required.");
    error.statusCode = 409;
    throw error;
  }

  return user;
}

function buildZonePath(row) {
  return [row.floorName, row.roomName].filter(Boolean).join(" / ") || row.zoneName || "";
}

function scheduleScopeFromTargets({ buildingId, zoneId, deviceId }) {
  if (deviceId) return { scopeType: "device", overridePriority: 300 };
  if (zoneId) return { scopeType: "zone", overridePriority: 200 };
  if (buildingId) return { scopeType: "building", overridePriority: 100 };
  return { scopeType: "global", overridePriority: 0 };
}

function maintenanceScopeFromTargets({ buildingId, zoneId, deviceId }) {
  if (deviceId) return "device";
  if (zoneId) return "zone";
  if (buildingId) return "building";
  return null;
}

function normalizeRecurrence(value) {
  const recurrence = String(value || "daily").toLowerCase();
  return ["daily", "monthly", "yearly"].includes(recurrence) ? recurrence : "daily";
}

function normalizeDateString(value) {
  if (!value) return new Date().toISOString().slice(0, 10);
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return new Date().toISOString().slice(0, 10);
  return parsed.toISOString().slice(0, 10);
}

function normalizeDateTimeString(value) {
  if (!value) return null;
  return String(value).replace("T", " ");
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

const availablePermissions = [
  "devices:manage",
  "users:manage",
  "roles:manage",
  "alarms:manage",
  "schedules:manage",
  "devices:view",
  "alarms:view",
  "schedules:view",
  "fdd:view",
  "maintenance:view",
  "reports:view",
  "reports:export",
  "reports:manage",
];

const defaultFeatureFlags = [
  ["bacnet_auto_learn", "BACnet Auto-Learn", "Enable Who-Is/I-Am discovery and provisioning workflows."],
  ["ai_setpoint_writeback", "AI Setpoint Writeback", "Allow autonomous AI schedules to write setpoints through BACnet."],
  ["email_notifications", "Email Notifications", "Queue alarm email notifications for warning and critical events."],
  ["floorplan_graphics", "Floor Plan Graphics", "Enable SVG floorplan upload and drag/drop device overlays."],
  ["pdf_energy_reports", "PDF Energy Reports", "Enable downloadable energy report PDFs."],
  ["fault_detection_ai", "Fault Detection AI", "Enable FDD analysis and diagnostics workflows."],
];

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
    device: 8,
    schedule: 17,
    scheduleobject: 17,
  };
  return objectTypes[normalized] ?? Number(value);
}

function bacnetObjectTypeCanonical(value) {
  const numeric = bacnetObjectTypeNumber(value);
  const names = {
    0: "analogInput",
    1: "analogOutput",
    2: "analogValue",
    3: "binaryInput",
    4: "binaryOutput",
    5: "binaryValue",
    8: "device",
    17: "schedule",
  };
  return names[numeric] || String(value);
}

function modbusCrc16(bytes) {
  let crc = 0xFFFF;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc & 1) ? ((crc >> 1) ^ 0xA001) : (crc >> 1);
    }
  }
  return crc & 0xFFFF;
}

function buildModbusReadFrame(slaveAddress, registerAddress, quantity = 1) {
  const frame = [
    slaveAddress & 0xFF,
    0x03,
    (registerAddress >> 8) & 0xFF,
    registerAddress & 0xFF,
    (quantity >> 8) & 0xFF,
    quantity & 0xFF,
  ];
  const crc = modbusCrc16(frame);
  return [...frame, crc & 0xFF, (crc >> 8) & 0xFF];
}

function buildModbusWriteFrame(slaveAddress, registerAddress, value) {
  const frame = [
    slaveAddress & 0xFF,
    0x06,
    (registerAddress >> 8) & 0xFF,
    registerAddress & 0xFF,
    (value >> 8) & 0xFF,
    value & 0xFF,
  ];
  const crc = modbusCrc16(frame);
  return [...frame, crc & 0xFF, (crc >> 8) & 0xFF];
}

function bacnetMstpHeaderCrc(bytes) {
  let crc = 0xFF;
  for (const byte of bytes) {
    crc ^= byte & 0xFF;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc & 1) ? ((crc >> 1) ^ 0x8C) : (crc >> 1);
    }
  }
  return (~crc) & 0xFF;
}

function bacnetMstpDataCrc(bytes) {
  let crc = 0xFFFF;
  for (const byte of bytes) {
    crc ^= byte & 0xFF;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc & 1) ? ((crc >> 1) ^ 0xA001) : (crc >> 1);
    }
  }
  return (~crc) & 0xFFFF;
}

function buildBacnetMstpPayload(serviceChoice, { deviceInstance, objectType, objectInstance, value = null }) {
  const objectTypeCode = bacnetObjectTypeNumber(objectType);
  const payload = [
    0x01,
    0x04,
    serviceChoice,
    (deviceInstance >> 16) & 0xFF,
    (deviceInstance >> 8) & 0xFF,
    deviceInstance & 0xFF,
    (objectTypeCode >> 8) & 0xFF,
    objectTypeCode & 0xFF,
    (objectInstance >> 16) & 0xFF,
    (objectInstance >> 8) & 0xFF,
    objectInstance & 0xFF,
    0x55,
  ];
  if (value != null) {
    const scaled = Math.round(Number(value) * 100);
    payload.push((scaled >> 24) & 0xFF, (scaled >> 16) & 0xFF, (scaled >> 8) & 0xFF, scaled & 0xFF);
  }
  return payload;
}

function buildBacnetMstpFrame({ macAddress, sourceAddress = 1, serviceChoice, deviceInstance, objectType, objectInstance, value = null }) {
  const payload = buildBacnetMstpPayload(serviceChoice, {
    deviceInstance: Number(deviceInstance),
    objectType,
    objectInstance: Number(objectInstance),
    value,
  });
  const header = [
    0x05,
    Number(macAddress) & 0xFF,
    Number(sourceAddress) & 0xFF,
    (payload.length >> 8) & 0xFF,
    payload.length & 0xFF,
  ];
  const frame = [0x55, 0xFF, ...header, bacnetMstpHeaderCrc(header), ...payload];
  const dataCrc = bacnetMstpDataCrc(payload);
  return [...frame, dataCrc & 0xFF, (dataCrc >> 8) & 0xFF];
}

function frameToHex(frame) {
  return frame.map((byte) => byte.toString(16).padStart(2, "0")).join(" ");
}

function validateCanFrame({ arbitrationId, data = [], extended = false }) {
  const id = Number(arbitrationId);
  const bytes = Array.isArray(data) ? data.map(Number) : [];
  const maxId = extended ? 0x1FFFFFFF : 0x7FF;
  if (!Number.isInteger(id) || id < 0 || id > maxId) {
    return { valid: false, error: extended ? "extended CAN identifier must fit 29 bits" : "standard CAN identifier must fit 11 bits" };
  }
  if (bytes.length > 8 || bytes.some((byte) => !Number.isInteger(byte) || byte < 0 || byte > 255)) {
    return { valid: false, error: "classic CAN payload must contain 0-8 byte values" };
  }
  return { valid: true, id, data: bytes, extended: Boolean(extended) };
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

function buildEnergyDecisions(optimization, options = {}) {
  const confidenceFloor = Number(options.confidenceFloor ?? 0.72);
  const maxSetpointDelta = Number(options.maxSetpointDelta ?? 2.5);
  const apply = booleanInput(options.apply);

  return optimization.recommendations
    .filter((item) => item.action === "adjust_setpoint" && item.confidence >= confidenceFloor)
    .map((item) => {
      const delta = Number((item.targetSetpoint - item.currentSetpoint).toFixed(2));
      const boundedDelta = clamp(delta, -Math.abs(maxSetpointDelta), Math.abs(maxSetpointDelta));
      const boundedTarget = Number((item.currentSetpoint + boundedDelta).toFixed(2));
      return {
        deviceId: item.deviceId,
        deviceName: item.deviceName,
        zoneName: item.zoneName,
        action: "setpoint_adjustment",
        currentSetpoint: item.currentSetpoint,
        targetSetpoint: boundedTarget,
        requestedTargetSetpoint: item.targetSetpoint,
        delta: boundedDelta,
        confidence: item.confidence,
        estimatedSavingsKwh: item.estimatedSavingsKwh,
        applied: apply,
        source: "basic_decision_engine",
        upgradePath: "python_ai_service_ml_models",
        reason: item.reason,
      };
    });
}

function buildWeatherPricingContext(input = {}) {
  const outdoorTemperature = Number(input.outdoorTemperature ?? process.env.WEATHER_OUTDOOR_TEMP_C ?? 31);
  const humidity = Number(input.humidity ?? process.env.WEATHER_HUMIDITY_PERCENT ?? 58);
  const windSpeed = Number(input.windSpeed ?? process.env.WEATHER_WIND_SPEED_MPS ?? 4.2);
  const solarRadiation = Number(input.solarRadiation ?? process.env.WEATHER_SOLAR_RADIATION_WM2 ?? 520);
  const electricityPrice = Number(input.electricityPrice ?? process.env.ELECTRICITY_PRICE_PER_KWH ?? 0.18);
  const demandCharge = Number(input.demandCharge ?? process.env.DEMAND_CHARGE_PER_KW ?? 12.5);
  const gridSignal = input.gridSignal || process.env.GRID_SIGNAL || "normal";
  const weatherCondition = outdoorTemperature >= 35
    ? "extreme_hot"
    : outdoorTemperature >= 29
      ? "hot"
      : outdoorTemperature <= 0
        ? "extreme_cold"
        : outdoorTemperature <= 7
          ? "cold"
          : "mild";
  const priceSignal = electricityPrice >= 0.28 || gridSignal === "demand_response"
    ? "critical"
    : electricityPrice >= 0.2
      ? "elevated"
      : "normal";

  return {
    source: input.source || "configured_realtime_context",
    generatedAt: new Date().toISOString(),
    weather: {
      outdoorTemperature,
      humidity,
      windSpeed,
      solarRadiation,
      condition: weatherCondition,
    },
    pricing: {
      electricityPrice,
      demandCharge,
      gridSignal,
      priceSignal,
    },
  };
}

function estimateDeviceLoadKw(row) {
  const value = Number(row.value ?? row.presentValue ?? 0);
  const units = String(row.units || "").toLowerCase();
  const type = String(row.type || "").toLowerCase();
  const name = String(row.deviceName || row.name || "").toLowerCase();
  const status = String(row.status || "").toLowerCase();
  const isOn = status.includes("on") || status.includes("normal") || status.includes("commissioned");

  if (Number.isFinite(value) && units.includes("kw")) return Math.max(0, value);
  if (Number.isFinite(value) && units.includes("watt")) return Math.max(0, value / 1000);
  if (Number.isFinite(value) && units.includes("kwh")) return Math.max(0, value / 24);
  if (!isOn && !Number.isFinite(value)) return 0;

  if (name.includes("fan") || type.includes("fan")) return isOn ? 4.5 : 0;
  if (name.includes("vav") || name.includes("damper") || type.includes("analog output")) {
    return Number.isFinite(value) ? Math.max(0.2, value * 0.035) : 0.8;
  }
  if (name.includes("light") || type.includes("lighting")) return isOn ? 1.2 : 0;
  if (name.includes("meter") || name.includes("power")) return Number.isFinite(value) ? Math.max(0, value) : 0;
  if (type.includes("binary output")) return isOn ? 1.5 : 0;
  return Number.isFinite(value) && value > 0 ? 0.08 : 0.05;
}

function buildBuildingFootprint(rows, trendRows = [], input = {}) {
  const context = buildWeatherPricingContext(input);
  const electricityPrice = Number(input.electricityPrice ?? context.pricing.electricityPrice ?? 0.18);
  const emissionsKgPerKwh = Number(input.emissionsKgPerKwh ?? process.env.GRID_EMISSIONS_KG_PER_KWH ?? 0.386);
  const occupiedHoursPerDay = Number(input.occupiedHoursPerDay ?? process.env.BUILDING_OCCUPIED_HOURS_PER_DAY ?? 14);
  const monthlyDays = Number(input.monthlyDays ?? 30);
  const buildings = new Map();

  rows.forEach((row) => {
    const buildingId = row.buildingId || 0;
    if (!buildings.has(buildingId)) {
      buildings.set(buildingId, {
        buildingId,
        buildingName: row.buildingName || "Unknown building",
        devices: 0,
        liveDemandKw: 0,
        meteredDemandKw: 0,
        estimatedDemandKw: 0,
        trendKwh: 0,
        basis: "estimated_from_device_state",
      });
    }
    const building = buildings.get(buildingId);
    const loadKw = estimateDeviceLoadKw(row);
    building.devices += 1;
    building.estimatedDemandKw += loadKw;
    if (String(row.units || "").toLowerCase().includes("kw")) {
      building.meteredDemandKw += loadKw;
      building.basis = "live_power_meter_points";
    }
  });

  trendRows.forEach((row) => {
    const building = buildings.get(row.buildingId || 0);
    if (!building) return;
    const value = Number(row.metricValue);
    const units = String(row.units || "").toLowerCase();
    if (!Number.isFinite(value)) return;
    if (units.includes("kwh")) {
      building.trendKwh += Math.max(0, value);
      building.basis = "trend_log_energy";
    } else if (units.includes("kw")) {
      building.meteredDemandKw += Math.max(0, value);
      building.basis = "trend_log_power";
    }
  });

  const buildingsOut = Array.from(buildings.values()).map((building) => {
    const currentDemandKw = building.meteredDemandKw > 0
      ? building.meteredDemandKw
      : building.estimatedDemandKw;
    const estimatedDailyKwh = building.trendKwh > 0
      ? building.trendKwh
      : currentDemandKw * occupiedHoursPerDay;
    const monthlyKwh = estimatedDailyKwh * monthlyDays;
    const annualKwh = estimatedDailyKwh * 365;
    return {
      ...building,
      liveDemandKw: Number(currentDemandKw.toFixed(2)),
      estimatedDailyKwh: Number(estimatedDailyKwh.toFixed(2)),
      estimatedMonthlyKwh: Number(monthlyKwh.toFixed(2)),
      estimatedAnnualKwh: Number(annualKwh.toFixed(2)),
      currentCostPerHour: Number((currentDemandKw * electricityPrice).toFixed(2)),
      dailyCost: Number((estimatedDailyKwh * electricityPrice).toFixed(2)),
      monthlyCost: Number((monthlyKwh * electricityPrice).toFixed(2)),
      annualCost: Number((annualKwh * electricityPrice).toFixed(2)),
      dailyCarbonKg: Number((estimatedDailyKwh * emissionsKgPerKwh).toFixed(2)),
      monthlyCarbonKg: Number((monthlyKwh * emissionsKgPerKwh).toFixed(2)),
      annualCarbonKg: Number((annualKwh * emissionsKgPerKwh).toFixed(2)),
      annualCarbonTons: Number(((annualKwh * emissionsKgPerKwh) / 1000).toFixed(2)),
    };
  });

  const totals = buildingsOut.reduce((acc, building) => {
    acc.liveDemandKw += building.liveDemandKw;
    acc.estimatedDailyKwh += building.estimatedDailyKwh;
    acc.estimatedMonthlyKwh += building.estimatedMonthlyKwh;
    acc.estimatedAnnualKwh += building.estimatedAnnualKwh;
    acc.currentCostPerHour += building.currentCostPerHour;
    acc.dailyCost += building.dailyCost;
    acc.monthlyCost += building.monthlyCost;
    acc.annualCost += building.annualCost;
    acc.dailyCarbonKg += building.dailyCarbonKg;
    acc.monthlyCarbonKg += building.monthlyCarbonKg;
    acc.annualCarbonKg += building.annualCarbonKg;
    acc.annualCarbonTons += building.annualCarbonTons;
    return acc;
  }, {
    liveDemandKw: 0,
    estimatedDailyKwh: 0,
    estimatedMonthlyKwh: 0,
    estimatedAnnualKwh: 0,
    currentCostPerHour: 0,
    dailyCost: 0,
    monthlyCost: 0,
    annualCost: 0,
    dailyCarbonKg: 0,
    monthlyCarbonKg: 0,
    annualCarbonKg: 0,
    annualCarbonTons: 0,
  });

  Object.keys(totals).forEach((key) => {
    totals[key] = Number(totals[key].toFixed(2));
  });

  return {
    source: "node-api-building-footprint",
    generatedAt: new Date().toISOString(),
    assumptions: {
      electricityPriceUsdPerKwh: electricityPrice,
      emissionsKgPerKwh,
      occupiedHoursPerDay,
      monthlyDays,
      note: "Uses live power/energy points when available; otherwise estimates load from commissioned device state for simulator and early commissioning.",
    },
    totals,
    buildings: buildingsOut.sort((a, b) => b.annualCost - a.annualCost),
  };
}

function buildEnergyServiceSignals(rows = [], footprint = null) {
  const generatedAt = new Date().toISOString();
  const signals = [];

  rows.forEach((row) => {
    const value = Number(row.value ?? row.metricValue);
    if (!Number.isFinite(value)) return;
    const configuration = parseJsonField(row.configuration, {});
    signals.push({
      id: `device:${row.deviceId || row.deviceInstance || "unknown"}:present-value`,
      name: row.deviceName || row.name || "Present Value",
      path: [
        row.buildingName,
        row.floorName,
        row.roomName,
        row.zoneName,
        row.deviceName || row.name,
      ].filter(Boolean).join(" / "),
      sourceProtocol: row.sourceProtocol || configuration.sourceProtocol || (row.bacnetInstance ? "BACnet/IP" : "database"),
      bacnet: row.bacnetInstance ? {
        deviceInstance: row.bacnetInstance,
        objectType: row.objectType,
        objectInstance: row.objectInstance,
        property: "present-value",
      } : null,
      nrf52840Bacnet: configuration.chipset === "nRF52840" ? {
        chipset: configuration.chipset,
        transport: configuration.transport || configuration.radio,
        bacnetDevice: configuration.bacnetDevice === true,
        batteryPercent: configuration.batteryPercent,
        firmware: configuration.firmware,
      } : null,
      powerMeter: configuration.communicationProfile === "5-in-1" ? {
        selectableProtocols: configuration.fieldSelectableProtocols || [],
        serialInterface: configuration.serialInterface,
        ethernetProtocols: configuration.ethernetProtocols || [],
        pulseOutputCount: configuration.pulseOutputCount,
        pulseInputCount: configuration.pulseInputCount,
        pulseInputs: configuration.pulseInputs || [],
        pulseOutput: configuration.pulseOutput,
      } : null,
      units: row.units || "",
      value,
      status: row.status || "normal",
      timestamp: row.loggedAt || generatedAt,
    });
  });

  if (footprint?.totals) {
    signals.push(
      {
        id: "building:portfolio:monthly-cost",
        name: "Portfolio Monthly Energy Cost",
        path: "Portfolio / Energy / Cost",
        sourceProtocol: "analytics",
        units: "USD",
        value: footprint.totals.monthlyCost,
        status: "normal",
        timestamp: footprint.generatedAt,
      },
      {
        id: "building:portfolio:annual-carbon",
        name: "Portfolio Annual Carbon",
        path: "Portfolio / Energy / Carbon",
        sourceProtocol: "analytics",
        units: "metric_tons_co2e",
        value: footprint.totals.annualCarbonTons,
        status: "normal",
        timestamp: footprint.generatedAt,
      }
    );
  }

  return signals;
}

function buildEnergyServiceInterface(signals = []) {
  return {
    service: "IntelliBuild Energy Services Interface",
    generatedAt: new Date().toISOString(),
    standardAlignment: "BACnet Standard 135-2020 Energy Services Interface / BACnet Web Services concept",
    protocol: {
      name: "BACnet Web Services style JSON facade",
      abbreviation: "B/WS",
      role: "Generic web-services access to building energy and control information",
      note: "This facade normalizes complex structured energy data for external clients. It does not require the underlying field network to be BACnet.",
    },
    supportedSources: ["BACnet/IP", "Modbus RTU adapter", "CAN adapter", "simulator", "trend logs", "analytics"],
    capabilities: [
      "structured_energy_signals",
      "portfolio_energy_cost",
      "carbon_footprint",
      "device_present_value_context",
      "external_energy_protocol_integration_path",
    ],
    signalCount: signals.length,
  };
}

function buildSmartGridAiContext(input = {}) {
  const context = buildWeatherPricingContext(input);
  const currentDemandKw = Number(input.currentDemandKw ?? process.env.GRID_CURRENT_DEMAND_KW ?? 284);
  const demandLimitKw = Number(input.demandLimitKw ?? process.env.GRID_DEMAND_LIMIT_KW ?? 320);
  const renewableAvailableKw = Number(input.renewableAvailableKw ?? process.env.GRID_RENEWABLE_AVAILABLE_KW ?? 42);
  const storageAvailableKw = Number(input.storageAvailableKw ?? process.env.GRID_STORAGE_AVAILABLE_KW ?? 28);
  const demandRatio = demandLimitKw > 0 ? currentDemandKw / demandLimitKw : 0;
  const demandRisk = context.pricing.gridSignal === "demand_response" || demandRatio >= 0.92
    ? "critical"
    : demandRatio >= 0.8 || context.pricing.priceSignal === "elevated"
      ? "elevated"
      : "normal";
  const targetReductionKw = demandRisk === "critical"
    ? Math.max(12, currentDemandKw - (demandLimitKw * 0.86))
    : demandRisk === "elevated"
      ? Math.max(4, currentDemandKw - (demandLimitKw * 0.78))
      : 0;
  const actions = [
    {
      system: "HVAC",
      action: demandRisk === "normal" ? "maintain_comfort_band" : "pre-cool_or_setpoint_bias",
      reductionKw: Number((targetReductionKw * 0.48).toFixed(1)),
      comfortGuard: "respect occupied zones and maintenance lockouts",
    },
    {
      system: "Lighting",
      action: demandRisk === "normal" ? "normal_schedule" : "dim_noncritical_areas",
      reductionKw: Number((targetReductionKw * 0.18).toFixed(1)),
      comfortGuard: "exclude life-safety lighting",
    },
    {
      system: "Power",
      action: demandRisk === "normal" ? "monitor_meters" : "shed_or_delay_deferrable_loads",
      reductionKw: Number((targetReductionKw * 0.22).toFixed(1)),
      comfortGuard: "protect critical circuits",
    },
    {
      system: "Storage",
      action: storageAvailableKw > 0 && demandRisk !== "normal" ? "discharge_peak_support" : "standby",
      reductionKw: demandRisk === "normal" ? 0 : Number(Math.min(storageAvailableKw, targetReductionKw * 0.12).toFixed(1)),
      comfortGuard: "preserve reserve threshold",
    },
  ];
  const integrations = [
    {
      system: "Fire",
      status: "life_safety_priority",
      policy: "Fire alarm state overrides demand response and prevents nonessential automatic curtailment.",
    },
    {
      system: "Security",
      status: "occupancy_context",
      policy: "Access and occupancy state can bias schedules, ventilation, and after-hours load decisions.",
    },
    {
      system: "HVAC",
      status: "active_control",
      policy: "Setpoint, fan, damper, and plant actions are optimized for comfort, energy, and peak demand.",
    },
    {
      system: "Lighting",
      status: "coordinated_control",
      policy: "Lighting load is available for noncritical demand response and schedule coordination.",
    },
    {
      system: "Power",
      status: "metered",
      policy: "Power meters, smart breakers, and VFDs provide demand, kWh, and load-shed context.",
    },
  ];

  return {
    source: "node-api-smart-grid-ai",
    generatedAt: new Date().toISOString(),
    bestFor: ["smart_buildings", "energy_focused_facilities", "mixed_hvac_power_systems"],
    grid: {
      signal: context.pricing.gridSignal,
      priceSignal: context.pricing.priceSignal,
      currentDemandKw,
      demandLimitKw,
      demandRatio: Number(demandRatio.toFixed(3)),
      reserveMarginKw: Number((demandLimitKw - currentDemandKw).toFixed(1)),
      renewableAvailableKw,
      storageAvailableKw,
      demandRisk,
      targetReductionKw: Number(targetReductionKw.toFixed(1)),
    },
    integrations,
    actions,
    recommendation: demandRisk === "critical"
      ? "Start demand response mode, protect fire/security priorities, bias HVAC setpoints, reduce noncritical lighting, and shed deferrable loads."
      : demandRisk === "elevated"
        ? "Prepare peak avoidance mode, pre-cool if useful, and monitor power meters for fast response."
        : "Maintain normal comfort operation while tracking price, weather, and demand headroom.",
  };
}

function buildAirflowGraphModel(rows) {
  const zones = new Map();
  rows.forEach((row) => {
    if (!zones.has(row.zoneId)) {
      zones.set(row.zoneId, {
        zoneId: row.zoneId,
        zoneName: buildZonePath(row),
        controlZoneName: row.zoneName,
        buildingName: row.buildingName,
        floorName: row.floorName,
        roomName: row.roomName,
        supplyFlow: 0,
        temperature: 22,
        deviceCount: 0,
        neighbors: [],
      });
    }
    const zone = zones.get(row.zoneId);
    zone.deviceCount += 1;
    const type = String(row.type || "").toLowerCase();
    const units = String(row.units || "").toLowerCase();
    const value = Number(row.value);
    if (Number.isFinite(value) && (type.includes("vav") || units.includes("percent"))) {
      zone.supplyFlow += value;
    }
    if (Number.isFinite(value) && units.includes("celsius")) {
      zone.temperature = value;
    }
  });

  const zoneList = Array.from(zones.values());
  zoneList.forEach((zone, index) => {
    zone.neighbors = zoneList
      .filter((candidate, candidateIndex) => Math.abs(candidateIndex - index) === 1 || candidate.buildingName === zone.buildingName)
      .filter((candidate) => candidate.zoneId !== zone.zoneId)
      .slice(0, 3)
      .map((candidate) => candidate.zoneId);
  });

  const propagated = zoneList.map((zone) => {
    const neighbors = zone.neighbors
      .map((zoneId) => zoneList.find((candidate) => candidate.zoneId === zoneId))
      .filter(Boolean);
    const neighborFlow = neighbors.reduce((sum, item) => sum + item.supplyFlow, 0) / Math.max(1, neighbors.length);
    const neighborTemp = neighbors.reduce((sum, item) => sum + item.temperature, 0) / Math.max(1, neighbors.length);
    const airflowScore = (zone.supplyFlow * 0.62) + (neighborFlow * 0.28) - Math.abs(zone.temperature - neighborTemp) * 0.8;
    const comfortRisk = Math.max(0, Math.abs(zone.temperature - 22) * 0.18 - airflowScore * 0.002);
    return {
      ...zone,
      predictedAirflowScore: Number(airflowScore.toFixed(3)),
      predictedComfortRisk: Number(comfortRisk.toFixed(3)),
      recommendedFlowBias: Number(clamp((22 - zone.temperature) * 1.4, -8, 8).toFixed(2)),
    };
  });

  return {
    generatedAt: new Date().toISOString(),
    model: "graph_message_passing_airflow_v1",
    upgradePath: "train a graph neural network over zone adjacency, VAV flow, AHU SAT, occupancy, weather, and measured comfort labels",
    nodes: propagated,
    edges: propagated.flatMap((zone) => zone.neighbors.map((neighborId) => ({ fromZoneId: zone.zoneId, toZoneId: neighborId }))),
  };
}

function predictTemperatureTrend(rows, input = {}) {
  const horizonHours = Number(input.horizonHours || 8);
  const context = buildWeatherPricingContext(input);
  const grouped = new Map();
  rows.forEach((row) => {
    const zoneId = row.zoneId || 0;
    if (!grouped.has(zoneId)) {
      grouped.set(zoneId, {
        zoneId,
        zoneName: row.zoneName || "Unassigned",
        buildingName: row.buildingName || "Unknown building",
        samples: [],
      });
    }
    const value = Number(row.metricValue ?? row.value);
    if (Number.isFinite(value)) {
      grouped.get(zoneId).samples.push(value);
    }
  });

  const outdoor = context.weather.outdoorTemperature;
  return {
    generatedAt: new Date().toISOString(),
    model: "thermal_trend_projection_v1",
    upgradePath: "train ML temperature forecasting or EnergyPlus-calibrated surrogate models using trend_logs",
    horizonHours,
    zones: Array.from(grouped.values()).map((zone) => {
      const samples = zone.samples.length ? zone.samples : [22.0];
      const current = samples[0];
      const previous = samples[samples.length - 1] ?? current;
      const measuredSlope = (current - previous) / Math.max(1, samples.length);
      const weatherDrift = clamp((outdoor - current) * 0.018, -0.22, 0.22);
      const projected = Array.from({ length: horizonHours }, (_, index) => {
        const hour = index + 1;
        const predictedTemperature = current + (measuredSlope + weatherDrift) * hour;
        return {
          hour,
          predictedTemperature: Number(predictedTemperature.toFixed(2)),
          comfortRisk: Number(Math.max(0, Math.abs(predictedTemperature - 22) * 0.18).toFixed(3)),
        };
      });
      return {
        zoneId: zone.zoneId,
        zoneName: zone.zoneName,
        buildingName: zone.buildingName,
        currentTemperature: Number(current.toFixed(2)),
        sampleCount: samples.length,
        projected,
      };
    }),
  };
}

function buildPhysicsSimulation(input = {}, rows = []) {
  const horizonHours = Number(input.horizonHours || 24);
  const context = buildWeatherPricingContext(input);
  const energyPlusBinary = process.env.ENERGYPLUS_BINARY || "";
  const weatherFile = input.weatherFile || process.env.ENERGYPLUS_WEATHER_FILE || "";
  const modelFile = input.modelFile || process.env.ENERGYPLUS_MODEL_FILE || "";
  const baseLoadKw = rows.reduce((sum, row) => sum + estimateDeviceLoadKw(row), 0);
  const weatherFactor = 1 + Math.max(0, context.weather.outdoorTemperature - 24) * 0.018;
  const demandFactor = context.pricing.gridSignal === "demand_response" ? 0.92 : 1.0;
  const timeline = Array.from({ length: horizonHours }, (_, index) => {
    const hour = index + 1;
    const occupancyFactor = hour >= 7 && hour <= 18 ? 1.0 : 0.62;
    const simulatedKw = baseLoadKw * weatherFactor * occupancyFactor * demandFactor;
    return {
      hour,
      simulatedDemandKw: Number(simulatedKw.toFixed(2)),
      simulatedEnergyKwh: Number((simulatedKw * 1.0).toFixed(2)),
      estimatedCost: Number((simulatedKw * context.pricing.electricityPrice).toFixed(2)),
    };
  });
  return {
    generatedAt: new Date().toISOString(),
    engine: energyPlusBinary ? "energyplus_adapter_ready" : "internal_physics_surrogate",
    energyPlus: {
      configured: Boolean(energyPlusBinary && modelFile && weatherFile),
      binary: energyPlusBinary || null,
      modelFile: modelFile || null,
      weatherFile: weatherFile || null,
      note: "When EnergyPlus paths are configured, this adapter can run calibrated IDF/EPW simulations before applying controls.",
    },
    horizonHours,
    assumptions: {
      baseLoadKw: Number(baseLoadKw.toFixed(2)),
      weatherFactor: Number(weatherFactor.toFixed(3)),
      demandFactor,
    },
    totals: {
      energyKwh: Number(timeline.reduce((sum, item) => sum + item.simulatedEnergyKwh, 0).toFixed(2)),
      cost: Number(timeline.reduce((sum, item) => sum + item.estimatedCost, 0).toFixed(2)),
    },
    timeline,
  };
}

function buildUtilityDemandResponse(input = {}) {
  const context = buildSmartGridAiContext(input);
  const eventActive = booleanInput(input.active ?? input.eventActive ?? context.grid.demandRisk === "critical");
  const requestedReductionKw = Number(input.requestedReductionKw || context.grid.targetReductionKw || 0);
  const event = {
    eventId: input.eventId || `DR-${new Date().toISOString().slice(0, 10)}`,
    utility: input.utility || process.env.UTILITY_PROVIDER || "Utility integration",
    protocol: input.protocol || process.env.UTILITY_DR_PROTOCOL || "OpenADR-ready REST adapter",
    active: eventActive,
    startAt: input.startAt || new Date().toISOString(),
    endAt: input.endAt || new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
    requestedReductionKw: Number(requestedReductionKw.toFixed(1)),
  };
  return {
    generatedAt: new Date().toISOString(),
    event,
    grid: context.grid,
    dispatchPlan: context.actions.map((action) => ({
      ...action,
      enabled: eventActive && action.reductionKw > 0,
      dispatchCommand: eventActive && action.reductionKw > 0 ? "stage_for_safe_writeback" : "monitor_only",
    })),
    safetyPolicy: [
      "Fire and life-safety systems override demand response.",
      "Security occupancy state guards comfort-critical zones.",
      "Maintenance mode blocks automatic writeback.",
      "BACnet writes use safe rollback-aware writeback.",
    ],
  };
}

async function fetchOptimizationRows() {
  return dbQuery(
    `SELECT b.name AS buildingName,
            f.name AS floorName,
            r.name AS roomName,
            z.zone_id AS zoneId,
            z.name AS zoneName,
            d.device_id AS deviceId,
            d.name AS deviceName,
            d.type,
            d.present_value AS value,
            d.units,
            d.configuration AS configuration,
            ${maintenanceModeActiveSql} AS maintenanceMode
     FROM buildings b
     JOIN zones z ON b.building_id = z.building_id
     LEFT JOIN floors f ON z.floor_id = f.floor_id
     LEFT JOIN rooms r ON z.room_id = r.room_id
     JOIN devices d ON z.zone_id = d.zone_id
     ORDER BY b.building_id, f.level, r.room_number, z.zone_id, d.device_id`
  );
}

async function fetchFullDeviceRows() {
  return dbQuery(
    `SELECT b.building_id AS buildingId,
            b.name AS buildingName,
            f.floor_id AS floorId,
            f.name AS floorName,
            f.level AS floorLevel,
            r.room_id AS roomId,
            r.name AS roomName,
            r.room_number AS roomNumber,
            z.zone_id AS zoneId,
            z.name AS zoneName,
            d.device_id AS deviceId,
            d.name AS deviceName,
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
            ${maintenanceModeActiveSql} AS maintenanceMode
     FROM buildings b
     JOIN zones z ON b.building_id = z.building_id
     LEFT JOIN floors f ON z.floor_id = f.floor_id
     LEFT JOIN rooms r ON z.room_id = r.room_id
     JOIN devices d ON z.zone_id = d.zone_id
     ORDER BY b.building_id, f.level, r.room_number, z.zone_id, d.device_id`
  );
}

function buildGlobalState(rows, context = {}) {
  const zoneMap = new Map();
  rows.forEach((row) => {
    if (!zoneMap.has(row.zoneId)) {
      zoneMap.set(row.zoneId, {
        zoneId: row.zoneId,
        zoneName: buildZonePath(row),
        controlZoneName: row.zoneName,
        buildingName: row.buildingName,
        floorName: row.floorName,
        roomName: row.roomName,
        devices: [],
        averageValue: null,
        activeFaults: 0,
      });
    }
    const configuration = parseJsonField(row.configuration);
    zoneMap.get(row.zoneId).devices.push({ ...row, configuration });
  });

  const zones = Array.from(zoneMap.values()).map((zone) => {
    const numericValues = zone.devices
      .map((device) => device.value)
      .filter((value) => typeof value === "number");
    return {
      ...zone,
      averageValue: numericValues.length
        ? Number((numericValues.reduce((sum, value) => sum + value, 0) / numericValues.length).toFixed(2))
        : null,
      deviceCount: zone.devices.length,
    };
  });

  return {
    generatedAt: new Date().toISOString(),
    context,
    buildings: [...new Set(rows.map((row) => row.buildingName))],
    zones,
    totals: {
      zoneCount: zones.length,
      deviceCount: rows.length,
      averageZoneValue: zones.filter((zone) => zone.averageValue != null).length
        ? Number((zones
          .filter((zone) => zone.averageValue != null)
          .reduce((sum, zone) => sum + zone.averageValue, 0) / zones.filter((zone) => zone.averageValue != null).length).toFixed(2))
        : null,
    },
  };
}

async function runControlLoopIteration(options = {}) {
  const apply = booleanInput(options.apply);
  const context = buildWeatherPricingContext(options.context || options);
  const rows = await fetchOptimizationRows();
  const normalizedRows = rows.map((row) => ({ ...row, configuration: parseJsonField(row.configuration) }));
  const globalState = buildGlobalState(normalizedRows, context);
  await loadRlPolicyFromDb();

  const mode = evaluateAutonomousMode({
    ...(options.mode || {}),
    weatherCondition: options.mode?.weatherCondition || context.weather.condition,
    demandResponseEvent: options.mode?.demandResponseEvent ?? context.pricing.gridSignal === "demand_response",
  });
  const optimization =
    (await callPythonAi("/optimize", { mode, rows: normalizedRows, rlPolicy: exportRlPolicy(), context })) ||
    buildBuildingOptimization(normalizedRows, mode.inputs);

  const actionTrace = [];
  for (const zone of optimization.zonePlans || []) {
    const reward = Number((
      (zone.energySavingsKwh * 0.45) +
      (zone.costSavings * 0.35) -
      (zone.comfortPenalty * 0.2) -
      (context.pricing.priceSignal === "critical" ? 0.1 : 0)
    ).toFixed(4));
    const policyResult = updateRlPolicy({ zoneId: zone.zoneId, action: zone.learnedAction, reward });
    await persistRlPolicy(policyResult);

    for (const device of zone.devices || []) {
      const blockedByMaintenance = !!device.maintenanceMode;
      if (apply && !blockedByMaintenance) {
        await dbQuery(
          `UPDATE devices
           SET configuration = JSON_SET(COALESCE(configuration, JSON_OBJECT()), '$.setpoint', ?)
           WHERE device_id = ?`,
          [device.targetSetpoint, device.deviceId]
        );
      }
      actionTrace.push({
        zoneId: zone.zoneId,
        zoneName: zone.zoneName,
        deviceId: device.deviceId,
        deviceName: device.deviceName,
        action: "setpoint_adjustment",
        targetSetpoint: device.targetSetpoint,
        reward,
        qValue: policyResult.qValue,
        applied: apply && !blockedByMaintenance,
        blockedByMaintenance,
      });
    }
  }

  const measuredRows = await fetchOptimizationRows();
  const measuredState = buildGlobalState(
    measuredRows.map((row) => ({ ...row, configuration: parseJsonField(row.configuration) })),
    context
  );
  const result = {
    generatedAt: new Date().toISOString(),
    loop: [
      "collect_zone_data",
      "build_global_state",
      "compute_optimal_actions",
      apply ? "apply_control_to_devices" : "simulate_only",
      "measure_results",
      "compute_reward",
      "update_model",
    ],
    apply,
    context,
    globalState,
    optimization,
    actions: actionTrace,
    measuredState,
    rewardSummary: {
      zoneCount: optimization.zonePlans?.length || 0,
      averageReward: actionTrace.length
        ? Number((actionTrace.reduce((sum, item) => sum + item.reward, 0) / actionTrace.length).toFixed(4))
        : 0,
    },
    nextStep: controlLoopState.running ? "repeat_continuously" : "manual_or_start_continuous_loop",
  };

  await persistOptimizationHistory(apply ? "ai_control_loop_apply" : "ai_control_loop_simulation", optimization);
  await dbQuery(
    `INSERT INTO analytics_events (event_type, metric_name, metric_value, payload)
     VALUES ('ai_control_loop', 'action_count', ?, ?)`,
    [actionTrace.length, JSON.stringify({ apply, rewardSummary: result.rewardSummary })]
  );
  eventBus.publish("bems.ai.control", {
    eventType: "ai_control_loop",
    apply,
    actionCount: actionTrace.length,
    rewardSummary: result.rewardSummary,
  }).catch(() => {});
  controlLoopState.lastRunAt = result.generatedAt;
  controlLoopState.lastResult = result;
  controlLoopState.lastError = null;
  return result;
}

function startControlLoop(intervalMs, options = {}) {
  if (controlLoopState.timer) {
    clearInterval(controlLoopState.timer);
  }
  controlLoopState.running = true;
  controlLoopState.intervalMs = intervalMs;
  controlLoopState.timer = setInterval(async () => {
    try {
      await runControlLoopIteration(options);
    } catch (error) {
      controlLoopState.lastError = error.message;
      console.error("Continuous AI control loop failed:", error);
    }
  }, intervalMs);
}

const rlPolicyState = new Map();
const rlActions = [-1.5, -0.5, 0, 0.5, 1.5];
const ppoAlgorithm = "ppo_clipped_policy_optimization";
const ppoClipEpsilon = 0.2;
const ppoLearningRate = 0.22;
let rlPolicyLoaded = false;

function qKey(zoneId, action) {
  return `${zoneId}:${action}`;
}

function qValue(zoneId, action) {
  return rlPolicyState.get(qKey(zoneId, action)) || 0;
}

function ppoActionProbabilities(zoneId) {
  const logits = rlActions.map((action) => qValue(zoneId, action));
  const maxLogit = Math.max(...logits);
  const weights = logits.map((logit) => Math.exp(Math.max(-30, Math.min(30, logit - maxLogit))));
  const total = weights.reduce((sum, weight) => sum + weight, 0) || 1;
  return rlActions.map((action, index) => ({
    action,
    probability: weights[index] / total,
    policyValue: qValue(zoneId, action),
  }));
}

function ppoProbability(zoneId, action) {
  return ppoActionProbabilities(zoneId).find((item) => item.action === action)?.probability || (1 / rlActions.length);
}

function bestZoneAction(zoneId) {
  return ppoActionProbabilities(zoneId).reduce((best, candidate) => {
    if (candidate.probability > best.probability) return candidate;
    if (candidate.probability === best.probability && Math.abs(candidate.action) < Math.abs(best.action)) return candidate;
    return best;
  }).action;
}

function updateRlPolicy({ zoneId, action, reward }) {
  const key = qKey(zoneId, action);
  const current = rlPolicyState.get(key) || 0;
  const oldProbability = ppoProbability(zoneId, Number(action));
  const advantage = Number(reward) - current;
  const proposed = current + ppoLearningRate * advantage;
  rlPolicyState.set(key, proposed);
  const newProbability = ppoProbability(zoneId, Number(action));
  rlPolicyState.set(key, current);
  const ratio = newProbability / Math.max(oldProbability, 1e-9);
  const clippedRatio = clamp(ratio, 1 - ppoClipEpsilon, 1 + ppoClipEpsilon);
  const next = current + ppoLearningRate * clippedRatio * advantage;
  const qValueNext = Number(next.toFixed(4));
  rlPolicyState.set(key, qValueNext);
  return {
    zoneId,
    action,
    reward,
    qValue: qValueNext,
    algorithm: ppoAlgorithm,
    clipEpsilon: ppoClipEpsilon,
    policyRatio: Number(ratio.toFixed(4)),
    clippedPolicyRatio: Number(clippedRatio.toFixed(4)),
  };
}

async function loadRlPolicyFromDb() {
  if (rlPolicyLoaded) return;
  try {
    const rows = await dbQuery(
      `SELECT zone_id AS zoneId, action, q_value AS qValue
       FROM rl_q_values`
    );
    rows.forEach((row) => {
      rlPolicyState.set(qKey(row.zoneId, Number(row.action)), Number(row.qValue || 0));
    });
    rlPolicyLoaded = true;
  } catch (error) {
    console.error("Unable to load RL policy from DB:", error.message);
  }
}

function exportRlPolicy() {
  return Array.from(rlPolicyState.entries()).map(([key, qValue]) => {
    const [zoneId, action] = key.split(":");
    return {
      zoneId: Number(zoneId),
      action: Number(action),
      qValue: Number(qValue),
    };
  });
}

async function persistRlPolicy(result) {
  if (!result || result.zoneId == null || result.action == null || result.qValue == null) return;
  const zoneId = Number(result.zoneId);
  const action = Number(result.action);
  const qValueNext = Number(result.qValue);
  rlPolicyState.set(qKey(zoneId, action), qValueNext);
  await dbQuery(
    `INSERT INTO rl_q_values (zone_id, action, q_value, sample_count)
     VALUES (?, ?, ?, 1)
     ON DUPLICATE KEY UPDATE
       q_value = VALUES(q_value),
       sample_count = sample_count + 1`,
    [zoneId, action, qValueNext]
  );
}

async function persistOptimizationHistory(source, optimization) {
  await dbQuery(
    `INSERT INTO optimization_history
       (source, profile, mode, objective, recommendations, estimated_savings_kwh)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      source,
      optimization.mode?.profile || null,
      JSON.stringify(optimization.mode || {}),
      JSON.stringify(optimization.objective || {}),
      JSON.stringify(optimization.zonePlans || optimization.recommendations || []),
      optimization.objective?.estimatedSavingsKwh || optimization.summary?.estimatedSavingsKwh || null,
    ]
  );
}

async function logAlarmEvent(alarmId, eventType, actor, payload = {}) {
  const rows = await dbQuery(
    `SELECT id, device_id AS deviceId, severity, status, message
     FROM alarms
     WHERE id = ?`,
    [alarmId]
  );
  const alarm = rows[0];
  if (!alarm) return;
  await dbQuery(
    `INSERT INTO alarm_logs
       (alarm_id, device_id, event_type, severity, status, actor, message, payload)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      alarm.id,
      alarm.deviceId,
      eventType,
      alarm.severity,
      alarm.status,
      actor || "operator",
      alarm.message,
      JSON.stringify(payload),
    ]
  );
  eventBus.publish("bems.alarms", {
    eventType,
    actor: actor || "operator",
    alarm,
    payload,
  }, alarm.id).catch(() => {});
}

async function queueAlarmEmailNotification(alarmId) {
  const enabled = await isFeatureEnabled("email_notifications");
  if (!enabled) return { queued: 0, disabled: true };
  const recipients = String(process.env.BEMS_ALARM_EMAIL_RECIPIENTS || "facilities@example.com")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  if (recipients.length === 0) return { queued: 0 };

  const rows = await dbQuery(
    `SELECT a.id,
            a.message,
            a.severity,
            a.status,
            d.name AS deviceName
     FROM alarms a
     LEFT JOIN devices d ON a.device_id = d.device_id
     WHERE a.id = ?`,
    [alarmId]
  );
  const alarm = rows[0];
  if (!alarm || !["critical", "warning"].includes(String(alarm.severity || "").toLowerCase())) {
    return { queued: 0 };
  }

  for (const recipient of recipients) {
    await dbQuery(
      `INSERT INTO notification_outbox
         (channel, recipient, subject, body, severity, status, related_alarm_id)
       VALUES ('email', ?, ?, ?, ?, 'queued', ?)`,
      [
        recipient,
        `[BEMS ${String(alarm.severity).toUpperCase()}] ${alarm.deviceName || "Device alarm"}`,
        `${alarm.message}\n\nDevice: ${alarm.deviceName || "N/A"}\nStatus: ${alarm.status}\nAlarm ID: ${alarm.id}`,
        alarm.severity,
        alarm.id,
      ]
    );
  }
  return { queued: recipients.length };
}

async function isFeatureEnabled(featureKey) {
  const definition = defaultFeatureFlags.find(([key]) => key === featureKey);
  if (!definition) return true;
  const rows = await dbQuery("SELECT enabled FROM feature_flags WHERE feature_key = ? LIMIT 1", [featureKey]);
  return rows.length === 0 ? true : Boolean(rows[0].enabled);
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
      if (device.maintenanceMode) {
        return {
          deviceId: device.deviceId,
          deviceName: device.deviceName,
          currentSetpoint,
          targetSetpoint: currentSetpoint,
          energySavings: 0,
          comfortPenalty: 0,
          maintenanceMode: true,
        };
      }
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
        maintenanceMode: false,
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
      algorithm: ppoAlgorithm,
      actions: rlActions,
      clipEpsilon: ppoClipEpsilon,
      mdp: {
        state: "hourly building environmental, occupancy, pricing, demand, and device context",
        action: "airflow or temperature/setpoint adjustment",
        reward: "comfort, energy, cost, peak-demand, and carbon-aware objective score",
      },
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
      eventBus.publish("bems.alarms.snapshot", {
        eventType: "alarm_snapshot",
        alarms: results,
      }).catch(() => {});
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
        floors: [],
        zones: [],
      };
      buildingMap.set(row.buildingId, building);
      buildings.push(building);
    }

    if (!row.zoneId) continue;

    let floor = null;
    if (row.floorId) {
      floor = building.floors.find((item) => item.id === row.floorId);
      if (!floor) {
        floor = {
          id: row.floorId,
          name: row.floorName,
          level: row.floorLevel,
          description: row.floorDescription,
          rooms: [],
        };
        building.floors.push(floor);
      }
    }

    let room = null;
    if (floor && row.roomId) {
      room = floor.rooms.find((item) => item.id === row.roomId);
      if (!room) {
        room = {
          id: row.roomId,
          name: row.roomName,
          roomNumber: row.roomNumber,
          description: row.roomDescription,
          zones: [],
        };
        floor.rooms.push(room);
      }
    }

    let zone = building.zones.find((item) => item.id === row.zoneId);
    if (!zone) {
      zone = {
        id: row.zoneId,
        name: row.zoneName,
        path: buildZonePath(row),
        displayName: buildZonePath(row),
        description: row.zoneDescription,
        floorId: row.floorId,
        floorName: row.floorName,
        floorLevel: row.floorLevel,
        roomId: row.roomId,
        roomName: row.roomName,
        roomNumber: row.roomNumber,
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
      if (room) {
        room.zones.push(zone);
      }
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
      maintenanceMode: !!row.maintenanceMode,
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
            f.floor_id AS floorId,
            f.name AS floorName,
            f.level AS floorLevel,
            f.description AS floorDescription,
            r.room_id AS roomId,
            r.name AS roomName,
            r.room_number AS roomNumber,
            r.description AS roomDescription,
            z.zone_id AS zoneId,
            z.name AS zoneName,
            z.description AS zoneDescription,
            d.device_id AS deviceId,
            d.name AS deviceName,
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
            ${maintenanceModeActiveSql} AS maintenanceMode,
            d.description AS deviceDescription
     FROM buildings b
     LEFT JOIN floors f ON b.building_id = f.building_id
     LEFT JOIN rooms r ON f.floor_id = r.floor_id
     LEFT JOIN zones z ON b.building_id = z.building_id
       AND (z.floor_id = f.floor_id OR z.floor_id IS NULL)
       AND (z.room_id = r.room_id OR z.room_id IS NULL)
     LEFT JOIN devices d ON z.zone_id = d.zone_id
     ORDER BY b.building_id, f.level, r.room_number, z.zone_id, d.device_id`
  ).then(buildTwin);
}

function collectTrendSamples(twin, source = "telemetry_snapshot") {
  const samples = [];
  (twin.buildings || []).forEach((building) => {
    (building.zones || []).forEach((zone) => {
      (zone.devices || []).forEach((device) => {
        if (typeof device.value !== "number") return;
        samples.push([
          building.id,
          zone.id,
          device.id,
          device.bacnet?.objectType || null,
          device.bacnet?.objectInstance || null,
          "present_value",
          device.value,
          device.units || "",
          source,
        ]);
      });
    });
  });
  return samples;
}

async function persistTrendSnapshot(twin, source = "telemetry_snapshot") {
  const samples = collectTrendSamples(twin, source);
  if (samples.length === 0) return { inserted: 0 };
  const placeholders = samples.map(() => "(?, ?, ?, ?, ?, ?, ?, ?, ?)").join(", ");
  await dbQuery(
    `INSERT INTO trend_logs
       (building_id, zone_id, device_id, object_type, object_instance, metric_name, metric_value, units, source)
     VALUES ${placeholders}`,
    samples.flat()
  );
  eventBus.publish("bems.telemetry", {
    eventType: "trend_snapshot",
    source,
    inserted: samples.length,
    summary: twin.summary,
    samples: samples.slice(0, 100).map((sample) => ({
      buildingId: sample[0],
      zoneId: sample[1],
      deviceId: sample[2],
      objectType: sample[3],
      objectInstance: sample[4],
      metricName: sample[5],
      metricValue: sample[6],
      units: sample[7],
    })),
  }).catch(() => {});
  return { inserted: samples.length };
}

function buildFddCandidates(devices) {
  const findings = [];
  const normalStatuses = new Set(["normal", "on", "off", "provisioned", "commissioned"]);
  const byZone = new Map();

  const pushFinding = (finding) => findings.push(finding);
  const includesAny = (device, patterns) => {
    const haystack = `${device.deviceName || ""} ${device.type || ""} ${device.objectType || ""} ${device.units || ""}`.toLowerCase();
    return patterns.some((pattern) => haystack.includes(pattern));
  };
  const numericConfig = (config, key) => {
    const value = Number(config?.[key]);
    return Number.isFinite(value) ? value : null;
  };
  const asBinary = (device) => {
    const status = String(device.status || "").toLowerCase();
    const value = Number(device.value);
    if (status.includes("on") || status.includes("true")) return 1;
    if (status.includes("off") || status.includes("false")) return 0;
    if (Number.isFinite(value)) return value >= 0.5 ? 1 : 0;
    return null;
  };

  devices.forEach((device) => {
    const configuration = parseJsonField(device.configuration);
    const status = String(device.status || "unknown").toLowerCase();
    const value = device.value == null ? null : Number(device.value);
    const minSetpoint = configuration.minSetpoint;
    const maxSetpoint = configuration.maxSetpoint;
    if (!byZone.has(device.zoneId)) byZone.set(device.zoneId, []);
    byZone.get(device.zoneId).push({ ...device, configuration, value });

    if (status.includes("alarm") || status.includes("critical")) {
      pushFinding({
        deviceId: device.deviceId,
        zoneId: device.zoneId,
        severity: "critical",
        faultCode: "DEVICE_ALARM_STATUS",
        message: `${device.deviceName} reports ${device.status}.`,
        payload: { status: device.status },
      });
    } else if (!normalStatuses.has(status)) {
      pushFinding({
        deviceId: device.deviceId,
        zoneId: device.zoneId,
        severity: "warning",
        faultCode: "DEVICE_STATUS_ANOMALY",
        message: `${device.deviceName} is in unexpected status ${device.status || "unknown"}.`,
        payload: { status: device.status },
      });
    }

    if (!device.provisioned) {
      pushFinding({
        deviceId: device.deviceId,
        zoneId: device.zoneId,
        severity: "info",
        faultCode: "PROVISIONING_PENDING",
        message: `${device.deviceName} is not provisioned.`,
        payload: { provisioned: false },
      });
    } else if (!device.commissioned) {
      pushFinding({
        deviceId: device.deviceId,
        zoneId: device.zoneId,
        severity: "info",
        faultCode: "COMMISSIONING_PENDING",
        message: `${device.deviceName} is provisioned but not commissioned.`,
        payload: { provisioned: true, commissioned: false },
      });
    }

    if (Number.isFinite(value) && minSetpoint != null && value < Number(minSetpoint)) {
      pushFinding({
        deviceId: device.deviceId,
        zoneId: device.zoneId,
        severity: "warning",
        faultCode: "VALUE_BELOW_RANGE",
        message: `${device.deviceName} value ${value} is below minimum range ${minSetpoint}.`,
        payload: { value, minSetpoint, units: device.units },
      });
    }

    if (Number.isFinite(value) && maxSetpoint != null && value > Number(maxSetpoint)) {
      pushFinding({
        deviceId: device.deviceId,
        zoneId: device.zoneId,
        severity: "warning",
        faultCode: "VALUE_ABOVE_RANGE",
        message: `${device.deviceName} value ${value} is above maximum range ${maxSetpoint}.`,
        payload: { value, maxSetpoint, units: device.units },
      });
    }

    const setpoint = numericConfig(configuration, "setpoint");
    const actual = Number.isFinite(value) ? value : null;
    if (includesAny(device, ["temp", "temperature"]) && setpoint != null && actual != null && Math.abs(actual - setpoint) >= 2.5) {
      pushFinding({
        deviceId: device.deviceId,
        zoneId: device.zoneId,
        severity: "warning",
        faultCode: "TEMP_NOT_REACHING_SETPOINT",
        message: `${device.deviceName} is ${Math.abs(actual - setpoint).toFixed(1)} ${device.units || "units"} from setpoint.`,
        payload: { actual, setpoint, delta: Number((actual - setpoint).toFixed(2)), units: device.units },
      });
    }

    const previousValue = numericConfig(configuration, "previousValue");
    const valveCommand = numericConfig(configuration, "valveCommand");
    const tempChange = previousValue != null && actual != null ? Math.abs(actual - previousValue) : null;
    if (includesAny(device, ["valve", "damper", "vav"]) && Number.isFinite(value) && value >= 95 && tempChange != null && tempChange < 0.2) {
      pushFinding({
        deviceId: device.deviceId,
        zoneId: device.zoneId,
        severity: "critical",
        faultCode: "STUCK_VALVE_OR_DAMPER",
        message: `${device.deviceName} is commanded near 100% but measured response is not changing.`,
        payload: { command: value, previousValue, tempChange },
      });
    }
    if (valveCommand != null && valveCommand >= 95 && tempChange != null && tempChange < 0.2) {
      pushFinding({
        deviceId: device.deviceId,
        zoneId: device.zoneId,
        severity: "critical",
        faultCode: "STUCK_VALVE",
        message: `${device.deviceName} valve command is 100% but zone temperature is not changing.`,
        payload: { valveCommand, previousValue, actual, tempChange },
      });
    }

    const fanCommand = numericConfig(configuration, "fanCommand");
    const fanFeedback = numericConfig(configuration, "fanFeedback");
    if (includesAny(device, ["fan"]) && fanCommand === 1 && fanFeedback === 0) {
      pushFinding({
        deviceId: device.deviceId,
        zoneId: device.zoneId,
        severity: "critical",
        faultCode: "FAN_FAILURE",
        message: `${device.deviceName} fan command is ON but feedback is OFF.`,
        payload: { fanCommand, fanFeedback },
      });
    }

    const offHours = configuration.offHours === true || configuration.occupied === false || configuration.scheduleState === "unoccupied";
    if (offHours && (asBinary(device) === 1 || (Number.isFinite(value) && value > 20 && includesAny(device, ["vav", "fan", "valve", "damper", "light"])))) {
      pushFinding({
        deviceId: device.deviceId,
        zoneId: device.zoneId,
        severity: "warning",
        faultCode: "OFF_HOURS_ENERGY_WASTE",
        message: `${device.deviceName} appears active during unoccupied/off-hours operation.`,
        payload: { status: device.status, value, scheduleState: configuration.scheduleState, occupied: configuration.occupied },
      });
    }
  });

  byZone.forEach((zoneDevices, zoneId) => {
    const heating = zoneDevices.find((device) => includesAny(device, ["heat", "heating"]) && ((Number.isFinite(device.value) && device.value > 5) || asBinary(device) === 1));
    const cooling = zoneDevices.find((device) => includesAny(device, ["cool", "cooling"]) && ((Number.isFinite(device.value) && device.value > 5) || asBinary(device) === 1));
    if (heating && cooling) {
      pushFinding({
        deviceId: heating.deviceId,
        zoneId,
        severity: "critical",
        faultCode: "SIMULTANEOUS_HEATING_COOLING",
        message: `Zone ${zoneId} has heating and cooling active at the same time.`,
        payload: {
          heatingDeviceId: heating.deviceId,
          coolingDeviceId: cooling.deviceId,
          heatingValue: heating.value,
          coolingValue: cooling.value,
        },
      });
    }
  });

  return findings;
}

async function createFddFinding(finding) {
  const existing = await dbQuery(
    `SELECT finding_id AS id
     FROM fdd_findings
     WHERE device_id <=> ?
       AND fault_code = ?
       AND status = 'open'
     LIMIT 1`,
    [finding.deviceId, finding.faultCode]
  );
  if (existing.length > 0) {
    return { ...finding, id: existing[0].id, duplicate: true };
  }

  const result = await dbQuery(
    `INSERT INTO fdd_findings
       (device_id, zone_id, severity, fault_code, message, status, payload)
     VALUES (?, ?, ?, ?, ?, 'open', ?)`,
    [
      finding.deviceId,
      finding.zoneId,
      finding.severity,
      finding.faultCode,
      finding.message,
      JSON.stringify(finding.payload || {}),
    ]
  );
  const inserted = { ...finding, id: result.insertId, duplicate: false };

  if (finding.severity === "warning" || finding.severity === "critical") {
    await dbQuery(
      `INSERT INTO maintenance_tickets
         (finding_id, device_id, title, description, priority, status)
       VALUES (?, ?, ?, ?, ?, 'open')`,
      [
        result.insertId,
        finding.deviceId,
        `${finding.faultCode}: device ${finding.deviceId || "unknown"}`,
        finding.message,
        finding.severity === "critical" ? "high" : "medium",
      ]
    );
  }

  return inserted;
}

function buildEdgePlatformCapabilities() {
  const mqttBrokerUrl = process.env.MQTT_BROKER_URL || "";
  const azureHost = process.env.AZURE_IOT_HUB_HOSTNAME || "";
  const awsEndpoint = process.env.AWS_IOT_ENDPOINT || "";
  const nodeRedUrl = process.env.NODE_RED_URL || "";
  const pythonLogicEnabled = process.env.EDGE_PYTHON_LOGIC_ENABLED === "true";
  const sedonaEnabled = process.env.SEDONA_RUNTIME_ENABLED === "true";

  return {
    generatedAt: new Date().toISOString(),
    platformRole: "BACnet edge platform",
    capabilities: [
      {
        key: "multi_protocol_translation",
        label: "Multi-Protocol Translation",
        status: "ready",
        fieldProtocols: ["BACnet/IP", "BACnet/IPv6", "BACnet MS/TP over EIA-485 serial adapter", "Modbus TCP", "Modbus RTU over EIA-485", "CAN bus", "KNX/IP", "DALI-2", "LonWorks", "OPC UA", "SNMP", "nRF52840 BACnet devices over wireless or wired field transport"],
        webProtocols: ["HTTP", "REST API", "Server-Sent Events", "MQTT over TLS"],
        apiSurfaces: ["/api/bacnet/discovery", "/api/bacnet/mstp/read", "/api/bacnet/mstp/write", "/api/modbus/rtu/read", "/api/modbus/rtu/write", "/api/canbus/send", "/api/protocols/catalog", "/api/protocols/smoke-test", "/api/energy-services/bws"],
      },
      {
        key: "field_selectable_power_meter",
        label: "Field-Selectable Power Meter",
        status: "ready",
        communicationProfile: "5-in-1",
        selectableProtocols: ["BACnet/IP", "BACnet/IPv6", "Modbus TCP", "Modbus RTU over EIA-485", "REST API"],
        interfaces: {
          serial: "EIA-485",
          ethernet: ["BACnet/IP", "Modbus TCP"],
        },
        pulseIo: {
          configurablePulseOutputs: 1,
          configurablePulseInputs: 2,
        },
        normalizedObjects: ["analogValue", "analogInput", "binaryInput"],
      },
      {
        key: "nrf52840_bacnet_devices",
        label: "nRF52840 BACnet Devices",
        status: "ready",
        chipset: "Nordic Semiconductor nRF52840",
        transportProfiles: ["Wireless BLE/Thread/IEEE 802.15.4 bridge", "Wired BACnet MS/TP", "Wired EIA-485 adapter"],
        runtimeProfile: "Bare-metal firmware exposes BACnet objects directly",
        gatewayPath: "nRF52840 BACnet device -> wireless or wired BACnet transport -> Node API/digital twin",
        normalizedObjects: ["analogInput", "binaryInput", "analogValue", "binaryValue"],
      },
      {
        key: "cloud_connectivity",
        label: "Cloud Connectivity",
        status: mqttBrokerUrl || azureHost || awsEndpoint ? "configured" : "available",
        secureTransports: ["MQTT over TLS", "HTTPS REST"],
        targets: {
          mqttBrokerUrl: mqttBrokerUrl || null,
          azureIoTHubHostname: azureHost || null,
          awsIoTEndpoint: awsEndpoint || null,
        },
        eventStreams: ["telemetry", "alarms", "analytics", "demand_response", "building_footprint"],
      },
      {
        key: "local_edge_processing",
        label: "Local Edge Processing",
        status: "ready",
        runtimes: [
          { name: "C++ Edge Core", enabled: true, role: "BACnet polling, discovery, COV, writeback, and forecasts" },
          { name: "Python AI Service", enabled: !!process.env.AI_GRPC_ENDPOINT || !!aiServiceUrl, role: "whole-building optimization and reinforcement learning" },
          { name: "Node-RED", enabled: !!nodeRedUrl, endpoint: nodeRedUrl || null, role: "optional local programming workflows" },
          { name: "Edge Python Logic", enabled: pythonLogicEnabled, role: "optional site-specific scripts" },
          { name: "Sedona Function Blocks", enabled: sedonaEnabled, role: "optional function-block control runtime" },
        ],
        offlinePolicy: "Critical BACnet read/write, scheduling context, watchdog health, and deterministic fallback logic continue locally when cloud links are offline.",
      },
      {
        key: "device_persistent_storage",
        label: "Device Persistent Storage",
        status: "ready",
        media: ["EEPROM", "Flash NVS", "FRAM", "Filesystem"],
        retainedKeys: ["identity", "commissioning", "setpoint", "schedule", "range", "calibration", "pulse counters", "fault history"],
        policies: ["on_change", "on_schedule", "manual", "disabled"],
        integrity: ["crc16", "bounded defaults", "wear leveling metadata"],
      },
      {
        key: "bacnet_bare_metal_field_devices",
        label: "BACnet Bare-Metal Field Devices",
        status: "ready",
        runtimeProfile: "Bare-metal C++ local firmware exposes BACnet objects directly.",
        designPrinciples: ["SOLID", "Strategy", "Adapter", "Repository", "Facade", "Dependency Injection"],
        responsibilities: ["sensor IO", "local control", "BACnet protocol", "persistent storage", "watchdog", "OTA update"],
        deviceClasses: ["BACnet bare-metal controllers", "nRF52840 BACnet devices", "field-selectable power meters"],
      },
      {
        key: "bacnet_device_resident_schedules",
        label: "BACnet Device-Resident Schedules",
        status: "ready",
        objectType: "schedule",
        persistence: "Device-scoped schedules are mirrored to BACnet device configuration for persistent local execution.",
        writePath: "Scheduler/API -> BACnet WriteProperty -> device Schedule object",
        fallback: "Server stores the authoritative audit copy while the BACnet device retains the runnable schedule.",
      },
      {
        key: "commissioning_tools",
        label: "Commissioning Tools",
        status: "ready",
        workflows: ["readiness scoring", "point checkout", "protocol smoke testing", "device acceptance evidence", "trend/alarm/FDD verification"],
        apiSurfaces: ["/api/commissioning/readiness", "/api/commissioning/devices/:deviceId/checklist", "/api/commissioning/devices/:deviceId/acceptance"],
      },
      {
        key: "field_hardening",
        label: "Long-Run Field Hardening",
        status: "ready",
        profiles: ["24h commissioning soak", "7d site acceptance soak", "30d warranty burn-in"],
        checks: ["watchdog dependencies", "telemetry freshness", "alarm churn", "offline recovery", "OTA rollback readiness", "persistent schedule retention"],
        apiSurfaces: ["/api/field-hardening/profile", "/api/field-hardening/soak-test"],
      },
      {
        key: "data_standardization",
        label: "Data Standardization",
        status: "ready",
        normalizedModel: "Building -> Floor -> Room -> Zone -> Device -> BACnet Object -> present-value",
        normalizedObjects: ["analogInput", "analogOutput", "analogValue", "binaryInput", "binaryOutput", "binaryValue", "schedule", "nRF52840 BACnet device objects", "device persistent storage"],
        apiSurfaces: ["/api/digital-twin", "/api/energy-services/signals", "/api/energy-services/esi"],
      },
    ],
  };
}

function buildEventDrivenArchitecture() {
  return {
    style: "event-driven",
    commandPath: "HTTP/JSON requests mutate state or trigger edge actions, then publish domain events.",
    realtimePath: "Server-Sent Events stream live telemetry and alarm events to browsers; WebSockets are not used.",
    backendEventBus: "Kafka and RabbitMQ",
    cloudEventBus: process.env.MQTT_BROKER_URL ? "MQTT over TLS" : "MQTT over TLS available",
    topics: eventTopics,
    eventFamilies: [
      "telemetry",
      "live_telemetry",
      "alarms",
      "alarm_snapshots",
      "analytics",
      "ai_control",
      "ai_simulation",
      "demand_response",
      "building_footprint",
    ],
    producers: ["C++ edge core via Node API", "Node API", "Python AI service via Node API", "operator commands"],
    consumers: ["React dashboard via SSE", "Kafka subscribers", "RabbitMQ AMQP consumers", "MQTT cloud subscribers", "audit/history/reporting stores"],
    guarantees: {
      localFirst: true,
      offlineTolerance: "Edge and Node fallback logic continue local operation; event publishing resumes when configured transports are available.",
      browserTransport: "SSE only",
      noWebSockets: true,
    },
  };
}

function buildProtocolCatalog() {
  return {
    generatedAt: new Date().toISOString(),
    normalizedPointModel: "BACnet-style object identity plus present-value, units, status, timestamp, and source protocol metadata",
    protocols: [
      { key: "bacnet-ip", name: "BACnet/IP", status: "implemented", surfaces: ["/api/bacnet/discovery", "/api/edge/read-point", "/api/edge/read-points-batch", "/api/edge/subscribe-cov"] },
      { key: "bacnet-mstp", name: "BACnet MS/TP over EIA-485", status: "implemented", surfaces: ["/api/bacnet/mstp/read", "/api/bacnet/mstp/write"] },
      { key: "modbus-rtu", name: "Modbus RTU over EIA-485", status: "implemented", surfaces: ["/api/modbus/rtu/read", "/api/modbus/rtu/write"] },
      { key: "modbus-tcp", name: "Modbus TCP", status: "adapter-ready", mapping: "register map to normalized analogValue/analogInput points" },
      { key: "canbus", name: "CAN bus", status: "implemented", surfaces: ["/api/canbus/send"] },
      { key: "knx-ip", name: "KNX/IP", status: "adapter-ready", mapping: "group address to binaryValue/analogValue points" },
      { key: "dali-2", name: "DALI-2", status: "adapter-ready", mapping: "short address and control gear state to lighting BACnet-style points" },
      { key: "lonworks", name: "LonWorks", status: "adapter-ready", mapping: "network variables to normalized point metadata" },
      { key: "opc-ua", name: "OPC UA", status: "adapter-ready", mapping: "NodeId reads to normalized external equipment points" },
      { key: "snmp", name: "SNMP", status: "adapter-ready", mapping: "OID polling/traps to equipment status and alarm points" },
      { key: "rest", name: "REST API", status: "implemented", surfaces: ["/api/energy-services/bws", "/api/energy-services/signals"] },
      { key: "mqtt", name: "MQTT over TLS", status: "implemented", role: "cloud telemetry and alert bridge" },
    ],
  };
}

function buildProtocolSmokeTest(input = {}) {
  const protocol = String(input.protocol || "bacnet-ip").toLowerCase();
  const target = input.target || {};
  const generatedAt = new Date().toISOString();
  const common = {
    protocol,
    generatedAt,
    target,
    normalizedResult: {
      objectType: target.objectType || "analogValue",
      objectInstance: Number(target.objectInstance || 1),
      property: target.property || "present-value",
      units: target.units || "",
      status: "smoke_test_generated",
    },
  };
  const smoke = {
    "bacnet-ip": { command: "ReadPropertyMultiple", route: "/api/edge/read-points-batch", payload: { points: [target] } },
    "bacnet-mstp": { command: "BACnet MS/TP ReadProperty", route: "/api/bacnet/mstp/read", media: "EIA-485" },
    "modbus-rtu": { command: "Modbus RTU Read Holding Registers", route: "/api/modbus/rtu/read", functionCode: 3 },
    "modbus-tcp": { command: "Modbus TCP Read Holding Registers", adapter: "tcp-register-map", port: 502 },
    canbus: { command: "CAN data frame", route: "/api/canbus/send", arbitrationId: target.arbitrationId || "0x120" },
    "knx-ip": { command: "KNXnet/IP group read", groupAddress: target.groupAddress || "1/1/1", datapointType: target.datapointType || "DPT-9" },
    "dali-2": { command: "DALI query/control gear", shortAddress: Number(target.shortAddress || 1), opcode: target.opcode || "QUERY_STATUS" },
    lonworks: { command: "LonWorks network variable poll", networkVariable: target.networkVariable || "nvoSpaceTemp" },
    "opc-ua": { command: "OPC UA Read", endpoint: target.endpoint || "opc.tcp://controller:4840", nodeId: target.nodeId || "ns=2;s=PresentValue" },
    snmp: { command: "SNMP GET", oid: target.oid || "1.3.6.1.2.1.1.3.0", version: target.version || "v3" },
    rest: { command: "REST GET", route: target.route || "/api/energy-services/signals" },
    mqtt: { command: "MQTT telemetry publish", topic: target.topic || "bems/telemetry/site/edge" },
  };
  return {
    ...common,
    supported: !!smoke[protocol],
    smokeTest: smoke[protocol] || { command: "unsupported", message: "Use GET /api/protocols/catalog for supported protocol keys." },
  };
}

function buildDeviceCommissioningChecklist(device = {}) {
  const configuration = parseJsonField(device.configuration, {});
  return {
    deviceId: device.deviceId || device.id,
    name: device.deviceName || device.name,
    status: device.status,
    provisioned: !!device.provisioned,
    commissioned: !!device.commissioned,
    protocol: configuration.sourceProtocol || (device.bacnetInstance ? "BACnet/IP" : "unassigned"),
    requiredChecks: [
      { key: "identity", label: "BACnet/device identity assigned", passed: !!(device.bacnetInstance || configuration.bacnetDevice || configuration.sourceProtocol) },
      { key: "object_mapping", label: "Object type and object instance mapped", passed: !!(device.objectType && device.objectInstance != null) },
      { key: "present_value", label: "Present value available", passed: device.value != null },
      { key: "protocol_smoke", label: "Protocol smoke test completed", passed: !!configuration.commissioningEvidence?.protocolSmokePassed },
      { key: "trend_sample", label: "Trend sample or telemetry freshness verified", passed: !!configuration.commissioningEvidence?.trendSampleVerified },
      { key: "alarm_path", label: "Alarm path verified", passed: !!configuration.commissioningEvidence?.alarmPathVerified },
      { key: "schedule_retention", label: "Persistent schedule/setpoint retention verified", passed: !!configuration.bacnetScheduleStorage || !!configuration.setpointStorage },
      { key: "operator_acceptance", label: "Operator acceptance recorded", passed: !!configuration.commissioningEvidence?.acceptedBy },
    ],
  };
}

function buildFieldHardeningProfile(input = {}) {
  const profile = String(input.profile || "site-acceptance-7d").toLowerCase();
  const hours = profile.includes("30d") ? 720 : profile.includes("24h") ? 24 : Number(input.hours || 168);
  return {
    profile,
    durationHours: hours,
    sampleIntervalSeconds: Number(input.sampleIntervalSeconds || 60),
    acceptanceThresholds: {
      watchdogAvailabilityPercent: 99.5,
      telemetryFreshnessSeconds: 180,
      commandQueueBacklogMax: 100,
      bacnetReadSuccessPercent: 98,
      covEventGapMinutesMax: 30,
      otaRollbackDrillRequired: true,
      persistentScheduleRetentionRequired: true,
    },
    evidence: [
      "GET /api/watchdog",
      "GET /api/metrics",
      "GET /api/reports/summary",
      "GET /api/firmware/ota-jobs",
      "scripts/production_board_flash_update_test.sh full-cycle",
    ],
  };
}

function buildCommercialReadinessCatalog() {
  return {
    generatedAt: new Date().toISOString(),
    fieldDeployment: {
      stages: ["site survey", "network readiness", "panel installation", "protocol checkout", "commissioning acceptance", "operator handover", "warranty soak"],
      evidence: ["physical hardware validation", "commissioning readiness", "protocol smoke tests", "field hardening soak", "cybersecurity review"],
    },
    vendorGatewayTesting: {
      adapters: ["BACnet router", "EIA-485 USB/RS-485", "Modbus TCP gateway", "KNX/IP gateway", "DALI-2 gateway", "LonWorks interface", "OPC UA server", "SNMP manager"],
      checks: ["connectivity", "read", "write where allowed", "event/alarm path", "timestamp quality", "normalized point mapping"],
    },
    cybersecurityReview: {
      controls: ["RBAC", "session auth", "management token", "TLS termination", "network segmentation", "audit events", "backup/restore", "least-privilege operations"],
      evidence: ["GET /api/v1/audit-events", "GET /api/events/status", "GET /api/watchdog", "GET /api/metrics"],
    },
    operatorEngineeringWorkflows: {
      operator: ["alarm triage", "trend review", "schedule override", "setpoint approval", "maintenance mode", "report export"],
      engineering: ["device discovery", "protocol mapping", "commissioning checklist", "graphics/floorplan binding", "BACnet object map", "acceptance sign-off"],
    },
  };
}

function buildApiStatus(req) {
  return {
    name: "IntelliBuild Energy Web API",
    version: "v1",
    time: new Date().toISOString(),
    tenant: {
      organizationId: req.auth?.organizationId || 1,
      siteId: req.auth?.siteId || null,
      actor: req.auth?.actor || "system",
      authenticated: !!req.auth?.authenticated,
    },
    transports: {
      browserRealtime: "sse",
      aiService: process.env.AI_GRPC_ENDPOINT ? "grpc" : "http-fallback",
      edgeCore: "rabbitmq_amqp",
      backendEvents: eventBus.status().kafka?.enabled ? "kafka" : "disabled",
      cloudEvents: eventBus.status().mqtt?.enabled ? "mqtt_tls" : "available",
      workQueueEvents: eventBus.status().rabbitmq?.enabled ? "rabbitmq_amqp" : "available",
    },
    eventDriven: buildEventDrivenArchitecture(),
    capabilities: [
      "multi_tenant_saas_context",
      "session_authentication",
      "role_based_access_control",
      "admin_console",
      "event_driven_architecture",
      "domain_event_publication",
      "kafka_event_bus",
      "rabbitmq_amqp_event_bus",
      "mqtt_tls_event_bridge",
      "nrf52840_bacnet_devices",
      "bacnet_bare_metal_field_devices",
      "ota_firmware_update",
      "swupdate_signed_ota",
      "field_selectable_power_meter",
      "device_persistent_storage",
      "audit_events",
      "bacnet_discovery",
      "bacnet_cov",
      "digital_twin",
      "sse_telemetry",
      "alarms",
      "schedules",
      "bacnet_device_resident_schedules",
      "holiday_schedules",
      "special_events",
      "smart_grid_ai",
      "ai_optimization",
      "persistent_reinforcement_learning",
      "fault_detection_diagnostics",
      "maintenance_ticketing",
      "maintenance_mode_lockout",
      "multi_protocol_translation",
      "mqtt_tls_cloud_connectivity",
      "local_edge_processing",
      "data_standardization",
      "remote_management",
    ],
  };
}

function buildOpenApiDocument() {
  return {
    openapi: "3.0.3",
    info: {
      title: "IntelliBuild Energy Web API",
      version: "1.0.0",
      description: "HTTP/JSON API for IntelliBuild Energy. Browser real-time updates use Server-Sent Events, edge orchestration uses RabbitMQ AMQP, and AI optimization can use gRPC.",
    },
    servers: [{ url: "/api" }],
    components: {
      securitySchemes: {
        SessionAuth: {
          type: "apiKey",
          in: "header",
          name: "X-Session-Token",
        },
      },
    },
    paths: {
      "/v1/status": { get: { summary: "Enterprise API status and capabilities" } },
      "/v1/auth/context": { get: { summary: "Public login context for organizations, sites, and buildings" } },
      "/v1/auth/login": { post: { summary: "Create a UI session from a username/password" } },
      "/v1/organizations": { get: { summary: "List organizations" } },
      "/v1/sites": { get: { summary: "List sites for the active organization" } },
      "/v1/admin/summary": { get: { summary: "Admin console summary" } },
      "/v1/audit-events": { get: { summary: "List recent audit events" } },
      "/edge/capabilities": { get: { summary: "BACnet edge platform protocol, cloud, local logic, and normalization capabilities" } },
      "/bacnet/object-map": { get: { summary: "BACnet object-list point map from provisioned devices" } },
      "/bacnet/equipment-map": { get: { summary: "BACnet AHU/VAV/zone equipment relationship map" } },
      "/bacnet/vendor-metadata": { get: { summary: "BACnet vendor, model, firmware, and transport metadata enrichment" } },
      "/bacnet/mstp/read": { post: { summary: "Generate BACnet MS/TP ReadProperty present-value frame for EIA-485 serial adapter" } },
      "/bacnet/mstp/write": { post: { summary: "Generate BACnet MS/TP WriteProperty present-value frame for EIA-485 serial adapter" } },
      "/commissioning/readiness": { get: { summary: "Commissioning readiness dashboard with device checklist status" } },
      "/commissioning/devices/{deviceId}/checklist": { get: { summary: "Commissioning checklist for one device" } },
      "/commissioning/devices/{deviceId}/acceptance": { post: { summary: "Record commissioning acceptance evidence for one device" } },
      "/protocols/catalog": { get: { summary: "Protocol adapter catalog for BACnet, Modbus, CAN, KNX, DALI, LonWorks, OPC UA, SNMP, REST, and MQTT" } },
      "/protocols/smoke-test": { post: { summary: "Generate a protocol smoke-test command and normalized point mapping" } },
      "/field-hardening/profile": { get: { summary: "Long-run field hardening and soak-test profile" } },
      "/field-hardening/soak-test": { post: { summary: "Create a long-run field hardening soak-test plan" } },
      "/commercial-readiness/catalog": { get: { summary: "Field deployment, vendor gateway, cybersecurity, operator, and engineering workflow readiness catalog" } },
      "/commercial-readiness/review": { post: { summary: "Create commercial readiness review evidence plan" } },
      "/buildings/{buildingId}/floors": { get: { summary: "List floors for a building" } },
      "/floors/{floorId}/rooms": { get: { summary: "List rooms for a floor" } },
      "/rooms/{roomId}/zones": { get: { summary: "List zones for a room" } },
      "/hierarchy": { get: { summary: "Building, floor, room, zone, and device hierarchy" } },
      "/digital-twin": { get: { summary: "Digital twin with floorplan/device overlay metadata" } },
      "/firmware/artifacts": { get: { summary: "List signed SWUpdate firmware artifacts" }, post: { summary: "Create a signed SWUpdate .swu firmware artifact manifest" } },
      "/firmware/artifacts/{artifactId}/sw-description": { get: { summary: "Fetch SWUpdate sw-description for a signed artifact" } },
      "/firmware/ota-jobs": { get: { summary: "List SWUpdate device OTA bootloader jobs" } },
      "/devices/{deviceId}/ota-update": { post: { summary: "Queue signed SWUpdate OTA firmware update for a BACnet bare-metal field device" } },
      "/energy-services/esi": { get: { summary: "Energy Services Interface profile for B/WS-style energy data access" } },
      "/energy-services/signals": { get: { summary: "Structured energy/control signals from BACnet, fieldbus, simulator, trends, and analytics" } },
      "/energy-services/bws": { get: { summary: "BACnet Web Services style structured energy payload" } },
      "/telemetry/stream": { get: { summary: "Telemetry Server-Sent Events stream" } },
      "/trends": { get: { summary: "List persisted BMS trend log samples" } },
      "/trends/snapshot": { post: { summary: "Record a trend snapshot from the current digital twin" } },
      "/reports/summary": { get: { summary: "Reporting summary for trends, alarms, FDD, optimization, and exports" } },
      "/reports/heat-map": { get: { summary: "Filtered zone-level report heat map" } },
      "/reports/export": { get: { summary: "Filtered JSON or CSV report export" } },
      "/reports/exports": { get: { summary: "Report export audit history" } },
      "/reports/schedules": { get: { summary: "List scheduled reports" }, post: { summary: "Create scheduled report delivery" } },
      "/reports/schedule-runs": { get: { summary: "List scheduled report execution history" } },
      "/reports/schedules/run-due": { post: { summary: "Run due scheduled reports" } },
      "/reports/schedules/{scheduleId}/run": { post: { summary: "Run one scheduled report now" } },
      "/reports/trends.csv": { get: { summary: "CSV trend report export" } },
      "/reports/energy.pdf": { get: { summary: "PDF energy report export" } },
      "/alarms/stream": { get: { summary: "Alarm Server-Sent Events stream" } },
      "/alarm-logs": { get: { summary: "Append-only alarm event log" } },
      "/ai/reinforcement/policy": { get: { summary: "Persisted PPO reinforcement policy state" } },
      "/ai/optimization-history": { get: { summary: "Persisted optimization run history" } },
      "/ai/decision-loop": { post: { summary: "Run basic energy decision engine and optionally apply setpoint decisions" } },
      "/ai/predictive-simulation": { post: { summary: "Predict outcomes in the digital twin before applying controls" } },
      "/ai/control/status": { get: { summary: "AI control loop status" } },
      "/ai/control/iterate": { post: { summary: "Run one collect-optimize-apply-measure-reward-update loop" } },
      "/ai/control/start": { post: { summary: "Start continuous AI control loop" } },
      "/ai/control/stop": { post: { summary: "Stop continuous AI control loop" } },
      "/ai/weather-pricing": { get: { summary: "Current weather and pricing optimization context" } },
      "/ai/smart-grid": { get: { summary: "Smart Grid AI demand, price, and mixed-system optimization context" } },
      "/ai/demand-response": { get: { summary: "Utility demand response event adapter and dispatch plan" } },
      "/ai/temperature-trends": { get: { summary: "Predict zone temperature trends from 30 days of history" } },
      "/ai/airflow-graph": { get: { summary: "Graph message-passing airflow model with GNN upgrade path" } },
      "/ai/optimize-operation": { post: { summary: "Run physics simulation, demand response planning, and AI operation optimization together" } },
      "/fdd/findings": { get: { summary: "Fault detection and diagnostics findings" } },
      "/fdd/analyze": { post: { summary: "Run device FDD checks and create findings/tickets" } },
      "/maintenance/tickets": { get: { summary: "List maintenance tickets" }, post: { summary: "Create maintenance ticket" } },
      "/maintenance/modes": { get: { summary: "List maintenance modes" }, post: { summary: "Enable scoped maintenance mode" } },
      "/maintenance/modes/{modeId}/disable": { patch: { summary: "Disable maintenance mode" } },
      "/holiday-schedules": { get: { summary: "List holiday schedules" }, post: { summary: "Create holiday schedule" } },
      "/special-events": { get: { summary: "List special event schedule overrides" }, post: { summary: "Create special event override" } },
      "/edge/read-points-batch": { post: { summary: "Read BACnet points with ReadPropertyMultiple and single ReadProperty fallback" } },
      "/edge/subscribe-cov": { post: { summary: "Queue BACnet change-of-value subscription through RabbitMQ edge orchestration" } },
      "/edge/cov-notifications": { post: { summary: "Ingest BACnet ConfirmedCOVNotification or UnconfirmedCOVNotification events" } },
      "/events/status": { get: { summary: "MQTT, Kafka, and RabbitMQ event streaming status and BEMS topic list" } },
    },
  };
}

function sessionPayload(auth, siteId = null, session = {}) {
  return {
    authenticated: !!auth.authenticated,
    actor: auth.actor || "operator",
    userId: auth.userId || null,
    roleName: auth.roleName || null,
    organizationId: auth.organizationId || 1,
    siteId,
    scopes: auth.scopes || [],
    sessionToken: session.token || null,
    expiresAt: session.expiresAt || null,
    realtime: "sse",
  };
}

app.get("/api/v1/status", (req, res) => {
  res.json(buildApiStatus(req));
});

app.get("/api/events/status", (req, res) => {
  res.json({
    ...eventBus.status(),
    topics: eventTopics,
    architecture: {
      ...buildEventDrivenArchitecture(),
      browserRealtime: "Server-Sent Events",
      backendStreaming: "Kafka",
      workQueueStreaming: "RabbitMQ AMQP",
      cloudStreaming: "MQTT over TLS",
      noWebSockets: true,
      edgeMode: "Site gateways keep local control offline and publish telemetry, alarms, analytics, and AI events when connected.",
    },
  });
});

app.get("/api/v1/openapi.json", (req, res) => {
  res.json(buildOpenApiDocument());
});

app.get("/api/v1/auth/context", async (req, res) => {
  try {
    const [organizations, sites, buildings] = await Promise.all([
      dbQuery(
        `SELECT organization_id AS id, name, slug, plan, status
         FROM organizations
         WHERE status = 'active'
         ORDER BY organization_id`
      ),
      dbQuery(
        `SELECT site_id AS id,
                organization_id AS organizationId,
                name,
                timezone,
                edge_gateway_id AS edgeGatewayId,
                status
         FROM sites
         WHERE status = 'active'
         ORDER BY organization_id, site_id`
      ),
      dbQuery(
        `SELECT b.building_id AS id,
                b.name,
                b.address,
                b.description,
                COUNT(DISTINCT f.floor_id) AS floorCount,
                COUNT(DISTINCT r.room_id) AS roomCount,
                COUNT(DISTINCT z.zone_id) AS zoneCount,
                COUNT(DISTINCT d.device_id) AS deviceCount
         FROM buildings b
         LEFT JOIN floors f ON b.building_id = f.building_id
         LEFT JOIN rooms r ON f.floor_id = r.floor_id
         LEFT JOIN zones z ON b.building_id = z.building_id
         LEFT JOIN devices d ON z.zone_id = d.zone_id
         GROUP BY b.building_id, b.name, b.address, b.description
         ORDER BY b.building_id`
      ),
    ]);

    res.json({
      organizations,
      sites,
      buildings,
      defaultOrganizationId: organizations[0]?.id || 1,
      defaultSiteId: sites[0]?.id || null,
      defaultBuildingId: buildings[0]?.id || null,
      realtime: "sse",
    });
  } catch (error) {
    console.error("Login context failed:", error);
    res.status(500).json({ error: "Unable to load login context." });
  }
});

app.post("/api/v1/auth/login", async (req, res) => {
  const { username = "operator", password = "", organizationId = 1, siteId = null } = req.body || {};

  try {
    if (!username || !password) {
      return res.status(400).json({ error: "Username and password are required." });
    }

    const [rows] = await db.promise().query(
      `SELECT u.user_id AS userId,
              u.organization_id AS organizationId,
              u.site_id AS siteId,
              u.username,
              u.password_hash AS passwordHash,
              u.active,
              r.name AS roleName,
              r.permissions
       FROM users u
       LEFT JOIN roles r ON u.role_id = r.role_id
       WHERE u.username = ?
       LIMIT 1`,
      [username]
    );

    if (rows.length === 0 || !rows[0].active || !verifyPassword(password, rows[0].passwordHash)) {
      return res.status(401).json({ error: "Invalid username or password." });
    }

    const user = rows[0];
    const auth = {
      authenticated: true,
      userId: user.userId,
      organizationId: user.organizationId || Number(organizationId || 1),
      siteId: siteId || user.siteId || null,
      actor: user.username,
      roleName: user.roleName || "User",
      scopes: parseJsonField(user.permissions, []),
    };
    const session = await createUserSession(db, auth, auth.siteId);
    await db.promise().query("UPDATE users SET last_login_at = CURRENT_TIMESTAMP WHERE user_id = ?", [user.userId]);
    auditEvent(db, { auth }, "login", "session", username, { method: "password" });
    res.json({ session: sessionPayload(auth, auth.siteId, session), tokenMode: "session" });
  } catch (error) {
    console.error("Login failed:", error);
    res.status(500).json({ error: "Login unavailable." });
  }
});

app.post("/api/v1/auth/logout", (req, res) => {
  const sessionToken = req.get("X-Session-Token") || "";
  if (sessionToken) {
    db.query("DELETE FROM user_sessions WHERE token_hash = ?", [hashToken(sessionToken)], (error) => {
      if (error) console.error("Session logout failed:", error);
    });
  }
  auditEvent(db, req, "logout", "session", req.auth?.actor || "operator");
  res.json({ loggedOut: true });
});

app.get("/api/v1/organizations", (req, res) => {
  handleQuery(
    res,
    `SELECT organization_id AS id, name, slug, plan, status, created_at AS createdAt
     FROM organizations
     ORDER BY organization_id`
  );
});

app.get("/api/v1/sites", (req, res) => {
  handleQuery(
    res,
    `SELECT site_id AS id,
            organization_id AS organizationId,
            name,
            timezone,
            edge_gateway_id AS edgeGatewayId,
            status,
            created_at AS createdAt
     FROM sites
     WHERE organization_id = ?
     ORDER BY site_id`,
    [req.auth?.organizationId || 1]
  );
});

app.get("/api/v1/admin/summary", requirePermission("users:manage"), async (req, res) => {
  try {
    const organizationId = req.auth?.organizationId || 1;
    const [organizations, sites, users, roles, auditEvents, counts, featureRows] = await Promise.all([
      dbQuery(
        `SELECT organization_id AS id, name, slug, plan, status, created_at AS createdAt
         FROM organizations
         ORDER BY organization_id`
      ),
      dbQuery(
        `SELECT site_id AS id, organization_id AS organizationId, name, timezone, edge_gateway_id AS edgeGatewayId, status
         FROM sites
         WHERE organization_id = ?
         ORDER BY site_id`,
        [organizationId]
      ),
      dbQuery(
        `SELECT u.user_id AS id,
                u.organization_id AS organizationId,
                u.site_id AS siteId,
                u.username,
                u.email,
                u.active,
                u.role_id AS roleId,
                u.created_at AS createdAt,
                u.last_login_at AS lastLoginAt,
                r.name AS roleName
         FROM users u
         LEFT JOIN roles r ON u.role_id = r.role_id
         WHERE u.organization_id = ?
         ORDER BY u.user_id`,
        [organizationId]
      ),
      dbQuery("SELECT role_id AS id, name, description, permissions FROM roles ORDER BY role_id"),
      dbQuery(
        `SELECT audit_id AS id, actor, action, resource_type AS resourceType, resource_id AS resourceId, payload, created_at AS createdAt
         FROM audit_events
         WHERE organization_id = ?
         ORDER BY audit_id DESC
         LIMIT 25`,
        [organizationId]
      ),
      dbQuery(
        `SELECT
           (SELECT COUNT(*) FROM buildings) AS buildings,
           (SELECT COUNT(*) FROM floors) AS floors,
           (SELECT COUNT(*) FROM rooms) AS rooms,
           (SELECT COUNT(*) FROM zones) AS zones,
           (SELECT COUNT(*) FROM devices) AS devices,
           (SELECT COUNT(*) FROM alarms WHERE status <> 'Cleared') AS activeAlarms,
           (SELECT COUNT(*) FROM schedules WHERE enabled = 1) AS activeSchedules`
      ),
      dbQuery("SELECT feature_key AS featureKey, label, description, enabled, updated_at AS updatedAt FROM feature_flags"),
    ]);
    const featureMap = new Map(featureRows.map((feature) => [feature.featureKey, feature]));
    const features = defaultFeatureFlags.map(([featureKey, label, description]) => ({
      featureKey,
      label,
      description,
      enabled: featureMap.has(featureKey) ? Boolean(featureMap.get(featureKey).enabled) : true,
      updatedAt: featureMap.get(featureKey)?.updatedAt || null,
    }));

    res.json({
      status: buildApiStatus(req),
      organizations,
      sites,
      users,
      roles: roles.map((role) => ({ ...role, permissions: parseJsonField(role.permissions, []) })),
      availablePermissions,
      auditEvents: auditEvents.map((event) => ({ ...event, payload: parseJsonField(event.payload, {}) })),
      features,
      counts: counts[0],
    });
  } catch (error) {
    console.error("Admin summary failed:", error);
    res.status(500).json({ error: "Unable to load admin summary." });
  }
});

app.patch("/api/v1/admin/features/:featureKey", requirePermission("users:manage"), async (req, res) => {
  const featureKey = req.params.featureKey;
  const definition = defaultFeatureFlags.find(([key]) => key === featureKey);
  if (!definition) {
    return res.status(404).json({ error: "Feature flag not found." });
  }
  const enabled = Boolean(req.body?.enabled);
  try {
    await dbQuery(
      `INSERT INTO feature_flags (feature_key, label, description, enabled)
       VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE enabled = VALUES(enabled), label = VALUES(label), description = VALUES(description)`,
      [definition[0], definition[1], definition[2], enabled ? 1 : 0]
    );
    auditEvent(db, req, "update_feature", "feature_flag", featureKey, { enabled });
    res.json({ featureKey, label: definition[1], description: definition[2], enabled });
  } catch (error) {
    console.error("Feature flag update failed:", error);
    res.status(500).json({ error: "Unable to update feature flag." });
  }
});

app.get("/api/v1/audit-events", (req, res) => {
  db.query(
    `SELECT audit_id AS id,
            actor,
            action,
            resource_type AS resourceType,
            resource_id AS resourceId,
            payload,
            created_at AS createdAt
     FROM audit_events
     WHERE organization_id = ?
     ORDER BY audit_id DESC
     LIMIT 100`,
    [req.auth?.organizationId || 1],
    (error, rows) => {
      if (error) {
        console.error("Audit event query failed:", error);
        return res.status(500).json({ error: "Unable to load audit events." });
      }
      res.json(rows.map((event) => ({ ...event, payload: parseJsonField(event.payload, {}) })));
    }
  );
});

app.get("/api/buildings", (req, res) => {
  handleQuery(
    res,
    `SELECT b.building_id AS id,
            b.name,
            b.address,
            b.description,
            COUNT(DISTINCT f.floor_id) AS floorCount,
            COUNT(DISTINCT r.room_id) AS roomCount,
            COUNT(DISTINCT z.zone_id) AS zoneCount,
            COUNT(DISTINCT d.device_id) AS deviceCount
     FROM buildings b
     LEFT JOIN floors f ON b.building_id = f.building_id
     LEFT JOIN rooms r ON f.floor_id = r.floor_id
     LEFT JOIN zones z ON b.building_id = z.building_id
     LEFT JOIN devices d ON z.zone_id = d.zone_id
     GROUP BY b.building_id, b.name, b.address, b.description
     ORDER BY b.building_id`
  );
});

app.get("/api/buildings/:buildingId/zones", (req, res) => {
  const buildingId = Number(req.params.buildingId);
  handleQuery(
    res,
    `SELECT z.zone_id AS id,
            z.name,
            z.description,
            z.floor_id AS floorId,
            f.name AS floorName,
            z.room_id AS roomId,
            r.name AS roomName,
            r.room_number AS roomNumber,
            COALESCE(NULLIF(CONCAT_WS(' / ', f.name, r.name), ''), z.name) AS zonePath
     FROM zones z
     LEFT JOIN floors f ON z.floor_id = f.floor_id
     LEFT JOIN rooms r ON z.room_id = r.room_id
     WHERE z.building_id = ?
     ORDER BY f.level, r.room_number, z.zone_id`,
    [buildingId]
  );
});

app.get("/api/buildings/:buildingId/floors", (req, res) => {
  const buildingId = Number(req.params.buildingId);
  handleQuery(
    res,
    "SELECT floor_id AS id, name, level, description FROM floors WHERE building_id = ? ORDER BY level, floor_id",
    [buildingId]
  );
});

app.get("/api/floors/:floorId/rooms", (req, res) => {
  const floorId = Number(req.params.floorId);
  handleQuery(
    res,
    "SELECT room_id AS id, name, room_number AS roomNumber, description FROM rooms WHERE floor_id = ? ORDER BY room_number, room_id",
    [floorId]
  );
});

app.get("/api/rooms/:roomId/zones", (req, res) => {
  const roomId = Number(req.params.roomId);
  handleQuery(
    res,
    `SELECT z.zone_id AS id,
            z.name,
            z.description,
            z.floor_id AS floorId,
            f.name AS floorName,
            z.room_id AS roomId,
            r.name AS roomName,
            r.room_number AS roomNumber,
            COALESCE(NULLIF(CONCAT_WS(' / ', f.name, r.name), ''), z.name) AS zonePath
     FROM zones z
     LEFT JOIN floors f ON z.floor_id = f.floor_id
     LEFT JOIN rooms r ON z.room_id = r.room_id
     WHERE z.room_id = ?
     ORDER BY z.zone_id`,
    [roomId]
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
            ${maintenanceModeActiveSql} AS maintenanceMode,
            d.description,
            z.zone_id AS zoneId,
            z.name AS zoneName,
            COALESCE(NULLIF(CONCAT_WS(' / ', f.name, r.name), ''), z.name) AS zonePath,
            f.floor_id AS floorId,
            f.name AS floorName,
            r.room_id AS roomId,
            r.name AS roomName,
            r.room_number AS roomNumber,
            b.building_id AS buildingId,
            b.name AS buildingName
     FROM devices d
     JOIN zones z ON d.zone_id = z.zone_id
     LEFT JOIN floors f ON z.floor_id = f.floor_id
     LEFT JOIN rooms r ON z.room_id = r.room_id
     JOIN buildings b ON z.building_id = b.building_id
     ORDER BY b.building_id, f.level, r.room_number, z.zone_id, d.device_id`
  );
});

app.post("/api/devices/provision", requirePermission("devices:manage"), (req, res) => {
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

app.patch("/api/devices/:deviceId/configuration", requirePermission("devices:manage"), (req, res) => {
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

app.patch("/api/devices/:deviceId/setpoint", requirePermission("devices:manage"), (req, res) => {
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

app.patch("/api/devices/:deviceId/range", requirePermission("devices:manage"), (req, res) => {
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

app.get("/api/firmware/artifacts", requirePermission("devices:manage"), async (req, res) => {
  try {
    const rows = await dbQuery(
      `SELECT artifact_id AS id,
              version,
              channel,
              artifact_uri AS artifactUri,
              checksum,
              signature,
              signing_key_id AS signingKeyId,
              manifest,
              created_by AS createdBy,
              created_at AS createdAt
       FROM firmware_artifacts
       ORDER BY artifact_id DESC
       LIMIT 100`
    );
    res.json(rows.map((row) => ({ ...row, manifest: parseJsonField(row.manifest, {}) })));
  } catch (error) {
    console.error("List firmware artifacts failed:", error);
    res.status(500).json({ error: "Unable to list firmware artifacts." });
  }
});

app.post("/api/firmware/artifacts", requirePermission("devices:manage"), async (req, res) => {
  const {
    version,
    channel = "stable",
    artifactUri = "",
    swuArtifactUri = "",
    imageBase64 = "",
    checksum: suppliedChecksum = "",
    softwareSet = swupdateDefaultSoftwareSet,
    softwareMode = swupdateDefaultMode,
    hardwareCompatibility = ["edge-core", "nrf52840-bacnet"],
    rootfsFilename = swupdateDefaultRootfs,
    targetDevice = swupdateDefaultDevice,
    systemPackages = [],
    packageManager = "auto",
  } = req.body || {};
  if (!version) {
    return res.status(400).json({ error: "Firmware version is required." });
  }
  const resolvedArtifactUri = swuArtifactUri || artifactUri;
  if (!resolvedArtifactUri && !imageBase64) {
    return res.status(400).json({ error: "artifactUri, swuArtifactUri, or imageBase64 is required." });
  }

  const imageBuffer = imageBase64 ? Buffer.from(imageBase64, "base64") : null;
  const checksum = suppliedChecksum || sha256Hex(imageBuffer || resolvedArtifactUri);
  const signature = signFirmwareManifest({ version, channel, checksum });
  const manifest = buildSwupdateManifest({
    version,
    channel,
    artifactUri: resolvedArtifactUri,
    checksum,
    signature,
    softwareSet,
    softwareMode,
    hardwareCompatibility,
    rootfsFilename,
    targetDevice,
    systemPackages,
    packageManager,
  });

  try {
    const result = await dbQuery(
      `INSERT INTO firmware_artifacts (version, channel, artifact_uri, checksum, signature, signing_key_id, manifest, created_by)
       VALUES (?, ?, ?, ?, ?, ?, CAST(? AS JSON), ?)
       ON DUPLICATE KEY UPDATE
         artifact_uri = VALUES(artifact_uri),
         checksum = VALUES(checksum),
         signature = VALUES(signature),
         signing_key_id = VALUES(signing_key_id),
         manifest = VALUES(manifest),
         created_by = VALUES(created_by)`,
      [version, channel, manifest.artifactUri, checksum, signature, otaSigningKeyId, JSON.stringify(manifest), req.auth?.actor || "system"]
    );
    const artifactId = result.insertId || (await dbQuery("SELECT artifact_id AS id FROM firmware_artifacts WHERE version = ? AND channel = ? LIMIT 1", [version, channel]))[0]?.id;
    auditEvent(db, req, "sign", "firmware_artifact", artifactId, { version, channel, checksum });
    res.status(201).json({ id: artifactId, ...manifest });
  } catch (error) {
    console.error("Create firmware artifact failed:", error);
    res.status(500).json({ error: "Unable to create signed firmware artifact." });
  }
});

app.get("/api/firmware/artifacts/:artifactId/sw-description", requirePermission("devices:manage"), async (req, res) => {
  try {
    const rows = await dbQuery("SELECT manifest FROM firmware_artifacts WHERE artifact_id = ? LIMIT 1", [Number(req.params.artifactId)]);
    if (rows.length === 0) {
      return res.status(404).json({ error: "Firmware artifact not found." });
    }
    const manifest = parseJsonField(rows[0].manifest, {});
    if (!manifest.swDescription) {
      return res.status(404).json({ error: "SWUpdate sw-description is not available for this artifact." });
    }
    res.type("text/plain").send(manifest.swDescription);
  } catch (error) {
    console.error("Fetch SWUpdate sw-description failed:", error);
    res.status(500).json({ error: "Unable to fetch SWUpdate sw-description." });
  }
});

app.get("/api/firmware/ota-jobs", requirePermission("devices:manage"), async (req, res) => {
  try {
    const rows = await dbQuery(
      `SELECT j.ota_job_id AS id,
              j.device_id AS deviceId,
              d.name AS deviceName,
              j.artifact_id AS artifactId,
              a.version,
              a.channel,
              j.status,
              j.rollback_allowed AS rollbackAllowed,
              j.manifest,
              j.requested_by AS requestedBy,
              j.requested_at AS requestedAt,
              j.staged_at AS stagedAt,
              j.applied_at AS appliedAt,
              j.last_error AS lastError
       FROM firmware_update_jobs j
       JOIN firmware_artifacts a ON j.artifact_id = a.artifact_id
       JOIN devices d ON j.device_id = d.device_id
       ORDER BY j.ota_job_id DESC
       LIMIT 100`
    );
    res.json(rows.map((row) => ({ ...row, rollbackAllowed: !!row.rollbackAllowed, manifest: parseJsonField(row.manifest, {}) })));
  } catch (error) {
    console.error("List OTA jobs failed:", error);
    res.status(500).json({ error: "Unable to list OTA jobs." });
  }
});

app.post("/api/devices/:deviceId/ota-update", requirePermission("devices:manage"), async (req, res) => {
  const deviceId = Number(req.params.deviceId);
  const {
    artifactId = null,
    version,
    channel = "stable",
    artifactUri = "",
    swuArtifactUri = "",
    checksum = "",
    signature = "",
    rollbackAllowed = true,
    softwareSet = swupdateDefaultSoftwareSet,
    softwareMode = swupdateDefaultMode,
    hardwareCompatibility = ["edge-core", "nrf52840-bacnet"],
    rootfsFilename = swupdateDefaultRootfs,
    targetDevice = swupdateDefaultDevice,
    systemPackages = [],
    packageManager = "auto",
  } = req.body || {};

  try {
    let artifact = null;
    if (artifactId) {
      const artifacts = await dbQuery("SELECT * FROM firmware_artifacts WHERE artifact_id = ? LIMIT 1", [artifactId]);
      artifact = artifacts[0] || null;
    } else if (version) {
      const resolvedArtifactUri = swuArtifactUri || artifactUri;
      const computedChecksum = checksum || sha256Hex(resolvedArtifactUri || version);
      const computedSignature = signature || signFirmwareManifest({ version, channel, checksum: computedChecksum });
      const manifest = buildSwupdateManifest({
        version,
        channel,
        artifactUri: resolvedArtifactUri,
        checksum: computedChecksum,
        signature: computedSignature,
        softwareSet,
        softwareMode,
        hardwareCompatibility,
        rootfsFilename,
        targetDevice,
        systemPackages,
        packageManager,
      });
      const insert = await dbQuery(
        `INSERT INTO firmware_artifacts (version, channel, artifact_uri, checksum, signature, signing_key_id, manifest, created_by)
         VALUES (?, ?, ?, ?, ?, ?, CAST(? AS JSON), ?)
         ON DUPLICATE KEY UPDATE artifact_uri = VALUES(artifact_uri), checksum = VALUES(checksum), signature = VALUES(signature), manifest = VALUES(manifest)`,
        [version, channel, manifest.artifactUri, computedChecksum, computedSignature, otaSigningKeyId, JSON.stringify(manifest), req.auth?.actor || "system"]
      );
      const resolvedId = insert.insertId || (await dbQuery("SELECT artifact_id AS artifact_id FROM firmware_artifacts WHERE version = ? AND channel = ? LIMIT 1", [version, channel]))[0]?.artifact_id;
      artifact = { artifact_id: resolvedId, version, channel, artifact_uri: manifest.artifactUri, checksum: computedChecksum, signature: computedSignature, signing_key_id: otaSigningKeyId, manifest: JSON.stringify(manifest) };
    }
    if (!artifact) {
      return res.status(400).json({ error: "artifactId or firmware version is required." });
    }
    const devices = await dbQuery("SELECT device_id FROM devices WHERE device_id = ? LIMIT 1", [deviceId]);
    if (devices.length === 0) {
      return res.status(404).json({ error: "Device not found." });
    }

    const manifest = parseJsonField(artifact.manifest, {});
    const installCommand = manifest.swupdate?.installCommand
      || `swupdate -i ${manifest.swuFilename || swupdateFilename(artifact.version, artifact.channel)} -e ${manifest.softwareSet || swupdateDefaultSoftwareSet},${manifest.softwareMode || swupdateDefaultMode}`;
    const otaUpdate = {
      status: "queued",
      artifactId: artifact.artifact_id,
      version: artifact.version,
      channel: artifact.channel,
      artifactUri: artifact.artifact_uri,
      swuArtifactUri: manifest.swuArtifactUri || artifact.artifact_uri,
      swuFilename: manifest.swuFilename || swupdateFilename(artifact.version, artifact.channel),
      checksum: artifact.checksum,
      signature: artifact.signature,
      signingKeyId: artifact.signing_key_id || otaSigningKeyId,
      rollbackAllowed: rollbackAllowed !== false,
      updateFramework: manifest.updateFramework || "SWUpdate",
      packageFormat: manifest.packageFormat || "swu",
      swDescription: manifest.swDescription || "",
      softwareSet: manifest.softwareSet || swupdateDefaultSoftwareSet,
      softwareMode: manifest.softwareMode || swupdateDefaultMode,
      hardwareCompatibility: manifest.hardwareCompatibility || ["edge-core", "nrf52840-bacnet"],
      systemPackageUpdate: manifest.systemPackageUpdate || { enabled: false, packages: [], packageManager: "auto" },
      swupdate: {
        ...(manifest.swupdate || {}),
        client: "swupdate",
        installCommand,
        progressCommand: manifest.swupdate?.progressCommand || "swupdate-progress -w",
      },
      stagedBootloader: true,
      partitionScheme: manifest.partitionScheme || "A/B",
      bootSlots: manifest.bootSlots || ["A", "B"],
      activeSlot: "reported-by-device",
      targetSlot: "inactive-slot",
      bootConfirmationRequired: true,
      rollbackTrigger: "watchdog or unconfirmed boot",
      signedDelivery: true,
      signatureAlgorithm: manifest.algorithm || firmwareSignatureAlgorithm(),
      preservesDeviceSchedules: true,
      preservesRetainedSetpoints: true,
      requestedAt: new Date().toISOString(),
      flow: "BEMS API -> signed SWUpdate .swu artifact -> RabbitMQ swupdate.install -> swupdate client -> inactive A/B boot slot -> bootloader commit/rollback -> BACnet status report",
    };

    const job = await dbQuery(
      `INSERT INTO firmware_update_jobs (device_id, artifact_id, status, requested_by, rollback_allowed, manifest)
       VALUES (?, ?, 'queued', ?, ?, CAST(? AS JSON))`,
      [deviceId, artifact.artifact_id, req.auth?.actor || "system", rollbackAllowed !== false, JSON.stringify(otaUpdate)]
    );
    const result = await dbQuery(
      `UPDATE devices
       SET configuration = JSON_SET(COALESCE(configuration, JSON_OBJECT()), '$.otaUpdate', CAST(? AS JSON))
       WHERE device_id = ?`,
      [JSON.stringify(otaUpdate), deviceId]
    );
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: "Device not found." });
    }
    eventBus.publish("bems.devices.ota_update", { deviceId, otaJobId: job.insertId, otaUpdate }, deviceId).catch(() => {});
    queueEdgeCommand("swupdate.install", { deviceId, otaJobId: job.insertId, otaUpdate }, `swupdate:${deviceId}`).catch(() => {});
    queueEdgeCommand("nrf52840.ota_update", { deviceId, otaJobId: job.insertId, otaUpdate }, `ota:${deviceId}`).catch(() => {});
    auditEvent(db, req, "queue", "firmware_update_job", job.insertId, { deviceId, artifactId: artifact.artifact_id });
    res.status(202).json({ id: deviceId, otaJobId: job.insertId, otaUpdate });
  } catch (error) {
    console.error("Queue device OTA update failed:", error);
    res.status(500).json({ error: "Unable to queue device OTA update." });
  }
});

app.patch("/api/devices/:deviceId/provision", requirePermission("devices:manage"), (req, res) => {
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

app.patch("/api/devices/:deviceId/commission", requirePermission("devices:manage"), (req, res) => {
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

app.get("/api/commissioning/readiness", requirePermission("devices:manage"), async (req, res) => {
  try {
    const rows = await dbQuery(
      `SELECT device_id AS deviceId,
              name AS deviceName,
              status,
              provisioned,
              commissioned,
              bacnet_instance AS bacnetInstance,
              object_type AS objectType,
              object_instance AS objectInstance,
              present_value AS value,
              configuration
       FROM devices
       ORDER BY device_id`
    );
    const checklists = rows.map(buildDeviceCommissioningChecklist);
    const totals = checklists.reduce((acc, item) => {
      acc.devices += 1;
      if (item.provisioned) acc.provisioned += 1;
      if (item.commissioned) acc.commissioned += 1;
      if (item.requiredChecks.every((check) => check.passed)) acc.readyForAcceptance += 1;
      return acc;
    }, { devices: 0, provisioned: 0, commissioned: 0, readyForAcceptance: 0 });
    res.json({
      generatedAt: new Date().toISOString(),
      workflow: "richer commissioning tools",
      totals,
      checklists,
    });
  } catch (error) {
    console.error("Commissioning readiness failed:", error);
    res.status(500).json({ error: "Unable to build commissioning readiness." });
  }
});

app.get("/api/commissioning/devices/:deviceId/checklist", requirePermission("devices:manage"), async (req, res) => {
  try {
    const rows = await dbQuery(
      `SELECT device_id AS deviceId,
              name AS deviceName,
              status,
              provisioned,
              commissioned,
              bacnet_instance AS bacnetInstance,
              object_type AS objectType,
              object_instance AS objectInstance,
              present_value AS value,
              configuration
       FROM devices
       WHERE device_id = ?
       LIMIT 1`,
      [Number(req.params.deviceId)]
    );
    if (rows.length === 0) return res.status(404).json({ error: "Device not found." });
    res.json(buildDeviceCommissioningChecklist(rows[0]));
  } catch (error) {
    console.error("Commissioning checklist failed:", error);
    res.status(500).json({ error: "Unable to build commissioning checklist." });
  }
});

app.post("/api/commissioning/devices/:deviceId/acceptance", requirePermission("devices:manage"), async (req, res) => {
  const deviceId = Number(req.params.deviceId);
  const {
    acceptedBy = req.auth?.actor || "system",
    protocolSmokePassed = true,
    trendSampleVerified = true,
    alarmPathVerified = true,
    notes = "",
    evidence = {},
  } = req.body || {};
  const commissioningEvidence = {
    acceptedBy,
    acceptedAt: new Date().toISOString(),
    protocolSmokePassed: !!protocolSmokePassed,
    trendSampleVerified: !!trendSampleVerified,
    alarmPathVerified: !!alarmPathVerified,
    notes,
    evidence,
  };
  try {
    const result = await dbQuery(
      `UPDATE devices
       SET commissioned = 1,
           provisioned = 1,
           status = 'Commissioned',
           configuration = JSON_SET(COALESCE(configuration, JSON_OBJECT()), '$.commissioningEvidence', CAST(? AS JSON))
       WHERE device_id = ?`,
      [JSON.stringify(commissioningEvidence), deviceId]
    );
    if (result.affectedRows === 0) return res.status(404).json({ error: "Device not found." });
    auditEvent(db, req, "accept", "commissioning", deviceId, commissioningEvidence);
    res.json({ id: deviceId, commissioned: true, provisioned: true, status: "Commissioned", commissioningEvidence });
  } catch (error) {
    console.error("Commissioning acceptance failed:", error);
    res.status(500).json({ error: "Unable to record commissioning acceptance." });
  }
});

app.get("/api/edge/health", async (req, res) => {
  res.json(await edgeClient.health());
});

app.get("/api/edge/capabilities", (req, res) => {
  res.json(buildEdgePlatformCapabilities());
});

app.get("/api/energy/forecast", async (req, res) => {
  const hours = Number(req.query.hours || 3);
  res.json(await edgeClient.getEnergyForecast(hours));
});

app.get("/api/buildings/footprint", async (req, res) => {
  try {
    const [deviceRows, trendRows] = await Promise.all([
      dbQuery(
        `SELECT b.building_id AS buildingId,
                b.name AS buildingName,
                d.device_id AS deviceId,
                d.name AS deviceName,
                d.type,
                d.present_value AS value,
                d.units,
                d.status
         FROM buildings b
         LEFT JOIN zones z ON b.building_id = z.building_id
         LEFT JOIN devices d ON z.zone_id = d.zone_id
         ORDER BY b.building_id, d.device_id`
      ),
      dbQuery(
        `SELECT building_id AS buildingId,
                metric_value AS metricValue,
                units
         FROM trend_logs
         WHERE logged_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)
           AND building_id IS NOT NULL
           AND (
             LOWER(COALESCE(units, '')) LIKE '%kw%'
             OR LOWER(COALESCE(metric_name, '')) LIKE '%energy%'
             OR LOWER(COALESCE(metric_name, '')) LIKE '%power%'
           )
         ORDER BY logged_at DESC
         LIMIT 500`
      ),
    ]);
    const footprint = buildBuildingFootprint(deviceRows, trendRows, req.query);
    eventBus.publish("bems.building.footprint", {
      eventType: "building_footprint",
      totals: footprint.totals,
      assumptions: footprint.assumptions,
      buildingCount: footprint.buildings.length,
    }).catch(() => {});
    res.json(footprint);
  } catch (error) {
    console.error("Building footprint failed:", error);
    res.status(500).json({ error: "Unable to calculate building cost and carbon footprint." });
  }
});

app.get("/api/energy-services/esi", async (req, res) => {
  try {
    const rows = await fetchFullDeviceRows();
    const footprint = buildBuildingFootprint(rows, [], req.query);
    const signals = buildEnergyServiceSignals(rows, footprint);
    res.json(buildEnergyServiceInterface(signals));
  } catch (error) {
    console.error("Energy Services Interface profile failed:", error);
    res.status(500).json({ error: "Unable to build Energy Services Interface profile." });
  }
});

app.get("/api/energy-services/signals", async (req, res) => {
  try {
    const rows = await fetchFullDeviceRows();
    const footprint = buildBuildingFootprint(rows, [], req.query);
    res.json({
      generatedAt: new Date().toISOString(),
      interface: "Energy Services Interface",
      format: "structured_energy_signals",
      signals: buildEnergyServiceSignals(rows, footprint),
    });
  } catch (error) {
    console.error("Energy Services signals failed:", error);
    res.status(500).json({ error: "Unable to build structured energy signals." });
  }
});

app.get("/api/energy-services/bws", async (req, res) => {
  try {
    const rows = await fetchFullDeviceRows();
    const footprint = buildBuildingFootprint(rows, [], req.query);
    const signals = buildEnergyServiceSignals(rows, footprint);
    res.json({
      bws: {
        version: "project-profile-1",
        service: "BACnet Web Services style energy data facade",
        generatedAt: new Date().toISOString(),
      },
      esi: buildEnergyServiceInterface(signals),
      data: {
        complexSignalData: signals,
        portfolio: footprint.totals,
        buildings: footprint.buildings,
      },
      integrationPolicy: {
        fieldNetworkAgnostic: true,
        acceptedSources: ["BACnet/IP", "Modbus RTU", "CAN", "simulator", "analytics"],
        externalEnergyProtocolPath: "Map utility, grid, pricing, and demand-response payloads into structured B/WS-style signal objects.",
      },
    });
  } catch (error) {
    console.error("B/WS energy facade failed:", error);
    res.status(500).json({ error: "Unable to build B/WS energy facade." });
  }
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

app.post("/api/edge/read-points-batch", async (req, res) => {
  const { points = [], maxRetries = 2, criticalOnly = true } = req.body || {};
  if (!Array.isArray(points) || points.length === 0) {
    return res.status(400).json({ error: "points must be a non-empty array." });
  }

  const normalizedPoints = points
    .filter((point) => !criticalOnly || point.critical !== false)
    .map((point) => ({
      deviceInstance: Number(point.deviceInstance),
      objectType: bacnetObjectTypeNumber(point.objectType),
      objectInstance: Number(point.objectInstance),
    }))
    .filter((point) => Number.isFinite(point.deviceInstance) && Number.isFinite(point.objectInstance));

  if (normalizedPoints.length === 0) {
    return res.status(400).json({ error: "No readable points remain after criticalOnly filtering." });
  }

  const batch = await edgeClient.readPoints({
    points: normalizedPoints,
    maxRetries: Number(maxRetries),
    criticalOnly: Boolean(criticalOnly),
  });

  res.json({
    ...batch,
    protocol: "BACnet/IP",
    service: "ReadPropertyMultiple",
    preferredService: "ReadPropertyMultiple",
    fallbackService: "ReadProperty",
    errorHandling: {
      offlineDetection: "Points that fail after retry budget are returned with status=offline and offline=true.",
      retryLogic: `maxRetries=${Number(maxRetries)}`,
    },
    performancePolicy: {
      covFirst: true,
      pollOnlyCriticalPoints: Boolean(criticalOnly),
    },
  });
});

app.post("/api/edge/cov-notifications", async (req, res) => {
  const {
    deviceInstance,
    objectType,
    objectInstance,
    value,
    subscriberProcessId = 1,
    confirmed = false,
    source = "bacnet_cov_notification",
  } = req.body || {};
  if (deviceInstance == null || objectType == null || objectInstance == null || value == null) {
    return res.status(400).json({ error: "deviceInstance, objectType, objectInstance, and value are required." });
  }

  const normalized = {
    eventType: confirmed ? "ConfirmedCOVNotification" : "UnconfirmedCOVNotification",
    deviceInstance: Number(deviceInstance),
    objectType: bacnetObjectTypeNumber(objectType),
    objectTypeName: bacnetObjectTypeCanonical(objectType),
    objectInstance: Number(objectInstance),
    value: Number(value),
    subscriberProcessId: Number(subscriberProcessId || 1),
    confirmed: Boolean(confirmed),
    source,
    receivedAt: new Date().toISOString(),
  };

  const [matches] = await dbQuery(
    `SELECT d.device_id AS deviceId, d.zone_id AS zoneId, z.floor_id AS floorId, f.building_id AS buildingId, d.units
       FROM devices d
       JOIN zones z ON z.zone_id = d.zone_id
       JOIN floors f ON f.floor_id = z.floor_id
      WHERE d.bacnet_instance = ?
        AND d.object_type = ?
        AND d.object_instance = ?
      LIMIT 1`,
    [normalized.deviceInstance, normalized.objectTypeName, normalized.objectInstance]
  );

  let trendInserted = false;
  if (matches.length) {
    const match = matches[0];
    await dbQuery(
      `INSERT INTO trend_logs
         (building_id, zone_id, device_id, object_type, object_instance, metric_name, metric_value, units, source)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        match.buildingId,
        match.zoneId,
        match.deviceId,
        normalized.objectTypeName,
        normalized.objectInstance,
        "present_value",
        normalized.value,
        match.units || "",
        source,
      ]
    );
    trendInserted = true;
    normalized.deviceId = match.deviceId;
    normalized.zoneId = match.zoneId;
    normalized.buildingId = match.buildingId;
  }

  await eventBus.publish("bems.telemetry", normalized, `${normalized.deviceInstance}:${normalized.objectType}:${normalized.objectInstance}`);
  res.status(202).json({
    accepted: true,
    service: normalized.eventType,
    eventTopic: "bems.telemetry",
    trendInserted,
    notification: normalized,
  });
});

app.post("/api/edge/write-point", async (req, res) => {
  const { deviceInstance, objectType, objectInstance, value, mode = "WRITE_MODE_ABSOLUTE" } = req.body;
  if (deviceInstance == null || objectType == null || objectInstance == null || value == null) {
    return res.status(400).json({ error: "deviceInstance, objectType, objectInstance, and value are required." });
  }

  const command = {
    deviceInstance: Number(deviceInstance),
    objectType: bacnetObjectTypeNumber(objectType),
    objectInstance: Number(objectInstance),
    value: Number(value),
    mode,
  };
  if (useRabbitEdgeCommands()) {
    return res.status(202).json(await queueEdgeCommand("bacnet.write_property", command, `${deviceInstance}:${objectType}:${objectInstance}`));
  }

  res.json(await edgeClient.writePoint(command));
});

app.post("/api/edge/commands", requirePermission("devices:manage"), async (req, res) => {
  const { commandType = "field_device.command", payload = {}, key = null } = req.body || {};
  res.status(202).json(await queueEdgeCommand(commandType, payload, key));
});

app.get("/api/edge/command-transport", (req, res) => {
  res.json({
    transport: edgeCommandTransport,
    rabbitmqPreferred: useRabbitEdgeCommands(),
    commandTopic: "bems.edge.commands",
    routingKey: "edge.commands",
    responseModel: "event-driven telemetry and provisioning events",
    supportedCommands: ["bacnet.read_property", "bacnet.read_property_multiple", "bacnet.write_property", "bacnet.subscribe_cov", "swupdate.install", "nrf52840.ota_update", "field_device.command"],
  });
});

app.post("/api/edge/subscribe-cov", requirePermission("devices:manage"), async (req, res) => {
  const {
    deviceInstance,
    objectType,
    objectInstance,
    subscriberProcessId = 1,
    lifetimeSeconds = 300,
    confirmedNotifications = false,
  } = req.body || {};
  if (deviceInstance == null || objectType == null || objectInstance == null) {
    return res.status(400).json({ error: "deviceInstance, objectType, and objectInstance are required." });
  }

  const command = {
    deviceInstance: Number(deviceInstance),
    objectType: bacnetObjectTypeNumber(objectType),
    objectInstance: Number(objectInstance),
    subscriberProcessId: Number(subscriberProcessId || 1),
    lifetimeSeconds: Number(lifetimeSeconds || 300),
    confirmedNotifications: !!confirmedNotifications,
  };
  if (useRabbitEdgeCommands()) {
    return res.status(202).json(await queueEdgeCommand("bacnet.subscribe_cov", command, `${deviceInstance}:${objectType}:${objectInstance}`));
  }

  res.json(await edgeClient.subscribeCov(command));
});

app.post("/api/modbus/rtu/read", async (req, res) => {
  const { slaveAddress = 1, registerAddress, quantity = 1 } = req.body || {};
  if (registerAddress == null) {
    return res.status(400).json({ error: "registerAddress is required." });
  }
  const frame = buildModbusReadFrame(Number(slaveAddress), Number(registerAddress), Number(quantity));
  res.json({
    protocol: "Modbus RTU",
    transport: "RS-485",
    service: "Read Holding Registers",
    functionCode: 3,
    frame,
    hex: frameToHex(frame),
    simulator: {
      enabled: true,
      note: "Frame generation is ready for serial adapter wiring on edge hardware.",
    },
  });
});

app.post("/api/modbus/rtu/write", requirePermission("devices:manage"), async (req, res) => {
  const { slaveAddress = 1, registerAddress, value } = req.body || {};
  if (registerAddress == null || value == null) {
    return res.status(400).json({ error: "registerAddress and value are required." });
  }
  const frame = buildModbusWriteFrame(Number(slaveAddress), Number(registerAddress), Number(value));
  res.json({
    protocol: "Modbus RTU",
    transport: "RS-485",
    service: "Write Single Register",
    functionCode: 6,
    frame,
    hex: frameToHex(frame),
    accepted: true,
  });
});

app.post("/api/bacnet/mstp/read", async (req, res) => {
  const { macAddress, sourceAddress = 1, deviceInstance, objectType, objectInstance } = req.body || {};
  if (macAddress == null || deviceInstance == null || objectType == null || objectInstance == null) {
    return res.status(400).json({ error: "macAddress, deviceInstance, objectType, and objectInstance are required." });
  }
  const mac = Number(macAddress);
  if (!Number.isInteger(mac) || mac < 1 || mac > 254) {
    return res.status(400).json({ error: "BACnet MS/TP MAC address must be 1-254." });
  }
  const frame = buildBacnetMstpFrame({
    macAddress: mac,
    sourceAddress: Number(sourceAddress),
    serviceChoice: 0x0C,
    deviceInstance: Number(deviceInstance),
    objectType,
    objectInstance: Number(objectInstance),
  });
  res.json({
    protocol: "BACnet MS/TP",
    transport: "EIA-485",
    service: "ReadProperty present-value",
    frame,
    hex: frameToHex(frame),
    accepted: true,
    adapter: "edge-core SimulatorFieldbusGateway BACnet MS/TP serial adapter",
  });
});

app.post("/api/bacnet/mstp/write", requirePermission("devices:manage"), async (req, res) => {
  const { macAddress, sourceAddress = 1, deviceInstance, objectType, objectInstance, value } = req.body || {};
  if (macAddress == null || deviceInstance == null || objectType == null || objectInstance == null || value == null) {
    return res.status(400).json({ error: "macAddress, deviceInstance, objectType, objectInstance, and value are required." });
  }
  const mac = Number(macAddress);
  if (!Number.isInteger(mac) || mac < 1 || mac > 254) {
    return res.status(400).json({ error: "BACnet MS/TP MAC address must be 1-254." });
  }
  const frame = buildBacnetMstpFrame({
    macAddress: mac,
    sourceAddress: Number(sourceAddress),
    serviceChoice: 0x0F,
    deviceInstance: Number(deviceInstance),
    objectType,
    objectInstance: Number(objectInstance),
    value: Number(value),
  });
  res.json({
    protocol: "BACnet MS/TP",
    transport: "EIA-485",
    service: "WriteProperty present-value",
    frame,
    hex: frameToHex(frame),
    accepted: true,
    adapter: "edge-core SimulatorFieldbusGateway BACnet MS/TP serial adapter",
  });
});

app.post("/api/canbus/send", requirePermission("devices:manage"), async (req, res) => {
  const validation = validateCanFrame(req.body || {});
  if (!validation.valid) {
    return res.status(400).json({ error: validation.error });
  }
  res.json({
    protocol: "CAN bus",
    transport: "SocketCAN-ready",
    arbitrationId: validation.id,
    extended: validation.extended,
    data: validation.data,
    dlc: validation.data.length,
    status: "accepted_by_simulator",
  });
});

app.get("/api/protocols/catalog", (req, res) => {
  res.json(buildProtocolCatalog());
});

app.post("/api/protocols/smoke-test", requirePermission("devices:manage"), async (req, res) => {
  const smoke = buildProtocolSmokeTest(req.body || {});
  if (!smoke.supported) {
    return res.status(400).json(smoke);
  }
  res.json(smoke);
});

app.get("/api/field-hardening/profile", requirePermission("devices:manage"), (req, res) => {
  res.json(buildFieldHardeningProfile(req.query || {}));
});

app.post("/api/field-hardening/soak-test", requirePermission("devices:manage"), async (req, res) => {
  const profile = buildFieldHardeningProfile(req.body || {});
  const plan = {
    ...profile,
    status: "planned",
    startedBy: req.auth?.actor || "system",
    plannedAt: new Date().toISOString(),
    collectionPlan: [
      { source: "watchdog", route: "/api/watchdog", intervalSeconds: profile.sampleIntervalSeconds },
      { source: "metrics", route: "/api/metrics", intervalSeconds: profile.sampleIntervalSeconds },
      { source: "commissioning", route: "/api/commissioning/readiness", intervalSeconds: 900 },
      { source: "protocols", route: "/api/protocols/smoke-test", intervalSeconds: 3600 },
      { source: "ota", route: "/api/firmware/ota-jobs", intervalSeconds: 3600 },
    ],
  };
  auditEvent(db, req, "plan", "field_hardening_soak", profile.profile, plan);
  res.status(202).json(plan);
});

app.get("/api/commercial-readiness/catalog", requirePermission("devices:manage"), (req, res) => {
  res.json(buildCommercialReadinessCatalog());
});

app.post("/api/commercial-readiness/review", requirePermission("devices:manage"), async (req, res) => {
  const catalog = buildCommercialReadinessCatalog();
  const {
    site = "unassigned",
    reviewer = req.auth?.actor || "system",
    includeCybersecurityReview = true,
    includeVendorGatewayTesting = true,
    includeOperatorWorkflow = true,
    includeEngineeringWorkflow = true,
  } = req.body || {};
  const review = {
    site,
    reviewer,
    generatedAt: new Date().toISOString(),
    status: "planned",
    evidencePlan: {
      fieldDeployment: catalog.fieldDeployment.evidence,
      vendorGatewayTesting: includeVendorGatewayTesting ? catalog.vendorGatewayTesting.adapters : [],
      cybersecurityReview: includeCybersecurityReview ? catalog.cybersecurityReview.controls : [],
      operatorWorkflow: includeOperatorWorkflow ? catalog.operatorEngineeringWorkflows.operator : [],
      engineeringWorkflow: includeEngineeringWorkflow ? catalog.operatorEngineeringWorkflows.engineering : [],
    },
  };
  auditEvent(db, req, "plan", "commercial_readiness_review", site, review);
  res.status(202).json(review);
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

app.get("/api/ai/weather-pricing", (req, res) => {
  res.json(buildWeatherPricingContext(req.query));
});

app.get("/api/ai/smart-grid", (req, res) => {
  res.json(buildSmartGridAiContext(req.query));
});

app.get("/api/ai/demand-response", (req, res) => {
  const payload = buildUtilityDemandResponse(req.query);
  eventBus.publish("bems.ai.demand_response", {
    eventType: "demand_response_status",
    event: payload.event,
    grid: payload.grid,
  }).catch(() => {});
  res.json(payload);
});

app.get("/api/ai/airflow-graph", async (req, res) => {
  try {
    const rows = await fetchFullDeviceRows();
    res.json(buildAirflowGraphModel(rows));
  } catch (error) {
    console.error("Airflow graph failed:", error);
    res.status(500).json({ error: "Unable to build airflow graph." });
  }
});

app.get("/api/ai/temperature-trends", async (req, res) => {
  try {
    const rows = await dbQuery(
      `SELECT b.name AS buildingName,
              COALESCE(NULLIF(CONCAT_WS(' / ', f.name, r.name), ''), z.name) AS zoneName,
              z.zone_id AS zoneId,
              tl.metric_value AS metricValue,
              tl.logged_at AS loggedAt
       FROM trend_logs tl
       LEFT JOIN zones z ON tl.zone_id = z.zone_id
       LEFT JOIN buildings b ON tl.building_id = b.building_id
       LEFT JOIN floors f ON z.floor_id = f.floor_id
       LEFT JOIN rooms r ON z.room_id = r.room_id
       WHERE tl.logged_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
         AND (
           LOWER(COALESCE(tl.units, '')) LIKE '%celsius%'
           OR LOWER(COALESCE(tl.metric_name, '')) LIKE '%temp%'
         )
       ORDER BY tl.zone_id, tl.logged_at DESC
       LIMIT 1000`
    );
    res.json(predictTemperatureTrend(rows, req.query));
  } catch (error) {
    console.error("Temperature trend prediction failed:", error);
    res.status(500).json({ error: "Unable to predict temperature trends." });
  }
});

app.post("/api/ai/decision-loop", requirePermission("devices:manage"), async (req, res) => {
  try {
    const devices = await dbQuery(
      `SELECT d.device_id AS id,
              d.name,
              d.type,
              d.present_value AS value,
              d.units,
              d.configuration AS configuration,
              z.name AS zoneName,
              ${maintenanceModeActiveSql} AS maintenanceMode
       FROM devices d
       LEFT JOIN zones z ON d.zone_id = z.zone_id
       ORDER BY d.device_id`
    );
    const optimization = buildOptimization(devices, req.body?.mode || {});
    const decisions = buildEnergyDecisions(optimization, req.body || {});

    if (booleanInput(req.body?.apply)) {
      for (const decision of decisions) {
        const device = devices.find((item) => item.id === decision.deviceId);
        if (device?.maintenanceMode) {
          decision.applied = false;
          decision.blockedByMaintenance = true;
          continue;
        }
        await dbQuery(
          `UPDATE devices
           SET configuration = JSON_SET(COALESCE(configuration, JSON_OBJECT()), '$.setpoint', ?)
           WHERE device_id = ?`,
          [decision.targetSetpoint, decision.deviceId]
        );
        decision.applied = true;
        decision.blockedByMaintenance = false;
      }
    }

    await dbQuery(
      `INSERT INTO analytics_events (event_type, metric_name, metric_value, payload)
       VALUES ('ai_decision_loop', 'decision_count', ?, ?)`,
      [decisions.length, JSON.stringify({ apply: booleanInput(req.body?.apply), decisions })]
    );

    res.json({
      generatedAt: new Date().toISOString(),
      engine: "basic_decision_engine",
      upgradePath: "ML models through Python AI service and gRPC optimization",
      apply: booleanInput(req.body?.apply),
      optimizationSummary: optimization.summary,
      decisionCount: decisions.length,
      decisions,
    });
  } catch (error) {
    console.error("AI decision loop failed:", error);
    res.status(500).json({ error: "Unable to run AI decision loop." });
  }
});

app.post("/api/ai/optimize-operation", requirePermission("devices:manage"), async (req, res) => {
  try {
    const [rows, twin] = await Promise.all([
      fetchFullDeviceRows(),
      fetchTwin(),
    ]);
    const simulation = buildPhysicsSimulation(req.body || {}, rows);
    const demandResponse = buildUtilityDemandResponse(req.body || {});
    const control = await runControlLoopIteration({
      ...(req.body || {}),
      apply: false,
      context: {
        ...(req.body?.context || {}),
        gridSignal: demandResponse.event.active ? "demand_response" : req.body?.gridSignal,
      },
    });
    const payload = {
      generatedAt: new Date().toISOString(),
      objective: {
        comfort: "keep people comfortable",
        energy: "minimize energy",
        peak: "avoid overload peaks",
      },
      digitalTwinSummary: twin.summary,
      simulation,
      demandResponse,
      control,
      applyPath: "POST /api/ai/control/iterate with apply=true after operator approval",
    };
    eventBus.publish("bems.ai.control", {
      eventType: "operation_optimized",
      objective: payload.objective,
      simulationTotals: simulation.totals,
      actionCount: control.actions?.length || 0,
    }).catch(() => {});
    res.json(payload);
  } catch (error) {
    console.error("Optimize operation failed:", error);
    res.status(500).json({ error: "Unable to optimize operation." });
  }
});

app.get("/api/ai/control/status", (req, res) => {
  res.json({
    running: controlLoopState.running,
    intervalMs: controlLoopState.intervalMs,
    lastRunAt: controlLoopState.lastRunAt,
    lastError: controlLoopState.lastError,
    lastResult: controlLoopState.lastResult,
    objectives: {
      comfort: "keep people comfortable",
      energy: "minimize energy",
      peak: "avoid overload peaks",
    },
  });
});

app.post("/api/ai/control/iterate", requirePermission("devices:manage"), async (req, res) => {
  try {
    const result = await runControlLoopIteration({
      ...(req.body || {}),
      apply: booleanInput(req.body?.apply),
    });
    res.json(result);
  } catch (error) {
    controlLoopState.lastError = error.message;
    console.error("AI control iterate failed:", error);
    res.status(500).json({ error: "Unable to run AI control loop." });
  }
});

app.post("/api/ai/control/start", requirePermission("devices:manage"), async (req, res) => {
  const intervalMs = Number(req.body?.intervalMs || controlLoopState.intervalMs);
  const options = {
    ...(req.body || {}),
    apply: booleanInput(req.body?.apply),
  };
  startControlLoop(intervalMs, options);
  try {
    const firstRun = await runControlLoopIteration(options);
    res.json({
      running: controlLoopState.running,
      intervalMs: controlLoopState.intervalMs,
      firstRun,
    });
  } catch (error) {
    controlLoopState.lastError = error.message;
    res.status(500).json({ error: "Control loop started but first iteration failed." });
  }
});

app.post("/api/ai/control/stop", requirePermission("devices:manage"), (req, res) => {
  if (controlLoopState.timer) {
    clearInterval(controlLoopState.timer);
    controlLoopState.timer = null;
  }
  controlLoopState.running = false;
  res.json({
    running: false,
    lastRunAt: controlLoopState.lastRunAt,
    lastError: controlLoopState.lastError,
  });
});

app.post("/api/ai/predictive-simulation", async (req, res) => {
  try {
    const devices = await dbQuery(
      `SELECT d.device_id AS id,
              d.name,
              d.type,
              d.present_value AS value,
              d.units,
              d.configuration AS configuration,
              z.name AS zoneName
       FROM devices d
       LEFT JOIN zones z ON d.zone_id = z.zone_id
       ORDER BY d.device_id`
    );
    const optimization = buildOptimization(devices, req.body?.mode || {});
    const decisions = buildEnergyDecisions(optimization, { ...(req.body || {}), apply: false });
    const horizonHours = Number(req.body?.horizonHours || 4);
    const comfortWeight = Number(req.body?.comfortWeight ?? 0.2);
    const timeline = Array.from({ length: horizonHours }, (_, index) => {
      const hour = index + 1;
      const savings = decisions.reduce((sum, decision) => (
        sum + (decision.estimatedSavingsKwh * (0.72 + hour * 0.06))
      ), 0);
      const comfortRisk = decisions.reduce((sum, decision) => (
        sum + Math.abs(decision.delta) * comfortWeight
      ), 0) / Math.max(1, decisions.length);
      return {
        hour,
        estimatedSavingsKwh: Number(savings.toFixed(2)),
        estimatedCostSavings: Number((savings * 0.14).toFixed(2)),
        comfortRisk: Number(comfortRisk.toFixed(3)),
        objectiveScore: Number((savings * 0.45 + savings * 0.14 * 0.35 - comfortRisk * 0.2).toFixed(3)),
      };
    });

    await dbQuery(
      `INSERT INTO analytics_events (event_type, metric_name, metric_value, payload)
       VALUES ('predictive_simulation', 'horizon_hours', ?, ?)`,
      [horizonHours, JSON.stringify({ decisionCount: decisions.length, timeline })]
    );

    const physics = buildPhysicsSimulation(req.body || {}, devices);
    eventBus.publish("bems.ai.simulation", {
      eventType: "predictive_simulation",
      horizonHours,
      decisionCount: decisions.length,
      physicsTotals: physics.totals,
    }).catch(() => {});

    res.json({
      generatedAt: new Date().toISOString(),
      engine: "predictive_digital_twin_simulation",
      appliesToRealSystems: false,
      upgradePath: "replace the basic model with trained ML/MPC models through the Python AI service",
      horizonHours,
      decisionCount: decisions.length,
      decisions,
      timeline,
      physics,
    });
  } catch (error) {
    console.error("Predictive simulation failed:", error);
    res.status(500).json({ error: "Unable to run predictive simulation." });
  }
});

app.get("/api/ai/building-optimization", (req, res) => {
  db.query(
    `SELECT b.name AS buildingName,
            f.name AS floorName,
            r.name AS roomName,
            z.zone_id AS zoneId,
            z.name AS zoneName,
            d.device_id AS deviceId,
            d.name AS deviceName,
            d.type,
            d.present_value AS value,
            d.units,
            d.configuration AS configuration
            , ${maintenanceModeActiveSql} AS maintenanceMode
     FROM buildings b
     JOIN zones z ON b.building_id = z.building_id
     LEFT JOIN floors f ON z.floor_id = f.floor_id
     LEFT JOIN rooms r ON z.room_id = r.room_id
     JOIN devices d ON z.zone_id = d.zone_id
     ORDER BY b.building_id, f.level, r.room_number, z.zone_id, d.device_id`,
    async (error, rows) => {
      if (error) {
        console.error("Building optimization query failed:", error);
        return res.status(500).json({ error: "Unable to build whole-building optimization." });
      }
      const mode = evaluateAutonomousMode(req.query);
      const normalizedRows = rows.map((row) => ({ ...row, configuration: parseJsonField(row.configuration) }));
      await loadRlPolicyFromDb();
      const optimization =
        (await callPythonAi("/optimize", { mode, rows: normalizedRows, rlPolicy: exportRlPolicy() })) ||
        buildBuildingOptimization(rows, req.query);
      const optimizationSource = optimization.source || "node-api-fallback";
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
      persistOptimizationHistory(optimizationSource, optimization).catch((insertError) => {
        console.error("Unable to persist optimization history:", insertError);
      });
      res.json(optimization);
    }
  );
});

app.get("/api/ai/reinforcement/policy", async (req, res) => {
  try {
    await loadRlPolicyFromDb();
    const rows = await dbQuery(
      `SELECT q.q_value_id AS id,
              q.zone_id AS zoneId,
              z.name AS zoneName,
              q.action,
              q.q_value AS qValue,
              q.sample_count AS sampleCount,
              q.updated_at AS updatedAt
       FROM rl_q_values q
       JOIN zones z ON q.zone_id = z.zone_id
       ORDER BY q.updated_at DESC, q.zone_id, q.action`
    );
    res.json(rows);
  } catch (error) {
    console.error("RL policy query failed:", error);
    res.status(500).json({ error: "Unable to load reinforcement policy." });
  }
});

app.get("/api/ai/optimization-history", async (req, res) => {
  try {
    const rows = await dbQuery(
      `SELECT history_id AS id,
              source,
              profile,
              mode,
              objective,
              recommendations,
              estimated_savings_kwh AS estimatedSavingsKwh,
              created_at AS createdAt
       FROM optimization_history
       ORDER BY created_at DESC
       LIMIT 50`
    );
    res.json(rows.map((row) => ({
      ...row,
      mode: parseJsonField(row.mode, {}),
      objective: parseJsonField(row.objective, {}),
      recommendations: parseJsonField(row.recommendations, []),
    })));
  } catch (error) {
    console.error("Optimization history query failed:", error);
    res.status(500).json({ error: "Unable to load optimization history." });
  }
});

app.post("/api/ai/reinforcement/feedback", async (req, res) => {
  const { zoneId, action, reward } = req.body;
  if (zoneId == null || action == null || reward == null) {
    return res.status(400).json({ error: "zoneId, action, and reward are required." });
  }
  try {
    await loadRlPolicyFromDb();
    const result = (await callPythonAi("/feedback", { zoneId, action, reward })) ||
      updateRlPolicy({ zoneId, action, reward });
    await persistRlPolicy(result);
    res.json({ ...result, persisted: true });
  } catch (error) {
    console.error("RL feedback failed:", error);
    res.status(500).json({ error: "Unable to process reinforcement feedback." });
  }
});

function normalizeDiscoveryRange(source = {}) {
  const lowInstance = Number(source.lowInstance || 1);
  const highInstance = Number(source.highInstance || lowInstance);
  return {
    lowInstance: Number.isFinite(lowInstance) && lowInstance > 0 ? lowInstance : 1,
    highInstance: Number.isFinite(highInstance) && highInstance >= lowInstance ? highInstance : lowInstance,
  };
}

async function runBacnetDeviceDiscovery(source = {}) {
  const { lowInstance, highInstance } = normalizeDiscoveryRange(source);
  const discovery = await edgeClient.discoverDevices(lowInstance, highInstance);
  return {
    ...discovery,
    protocol: "BACnet/IP",
    feature: "Device Discovery",
    services: ["Who-Is", "I-Am"],
    exchange: [
      "Edge core sends BACnet Who-Is for the requested device instance range.",
      "BACnet devices respond with I-Am.",
      "Edge core normalizes discovered devices for provisioning, telemetry, and graphics.",
    ],
    range: { lowInstance, highInstance },
    discoveredCount: discovery.devices?.length || 0,
  };
}

async function fetchBacnetDeviceRows() {
  return dbQuery(
    `SELECT d.device_id AS id,
            d.name,
            d.type,
            d.bacnet_instance AS bacnetInstance,
            d.object_instance AS objectInstance,
            d.object_type AS objectType,
            d.vendor,
            d.model,
            d.ip_address AS address,
            d.units,
            d.status,
            d.configuration,
            z.zone_id AS zoneId,
            z.name AS zoneName,
            b.building_id AS buildingId,
            b.name AS buildingName,
            f.name AS floorName,
            r.name AS roomName
     FROM devices d
     JOIN zones z ON d.zone_id = z.zone_id
     JOIN buildings b ON z.building_id = b.building_id
     LEFT JOIN floors f ON z.floor_id = f.floor_id
     LEFT JOIN rooms r ON z.room_id = r.room_id
     ORDER BY b.name, f.level, r.name, z.name, d.bacnet_instance, d.object_instance`
  );
}

function buildBacnetObjectMap(rows) {
  return rows.map((row) => {
    const configuration = parseJsonField(row.configuration, {});
    return {
      deviceId: row.id,
      deviceName: row.name,
      buildingId: row.buildingId,
      buildingName: row.buildingName,
      zoneId: row.zoneId,
      zonePath: [row.floorName, row.roomName].filter(Boolean).join(" / ") || row.zoneName,
      bacnetInstance: row.bacnetInstance,
      objectType: row.objectType,
      objectInstance: row.objectInstance,
      property: "present-value",
      units: row.units,
      vendor: row.vendor,
      model: row.model,
      firmware: configuration.firmware || configuration.otaUpdate?.version || null,
      transport: configuration.transport || configuration.sourceProtocol || "BACnet/IP",
      scheduleObject: row.objectType === "schedule" || !!configuration.bacnetScheduleStorage,
    };
  });
}

function buildBacnetEquipmentMap(rows) {
  const ahus = rows.filter((row) => /ahu|air handler|air-handling/i.test(`${row.name} ${row.type} ${row.model}`));
  const vavs = rows.filter((row) => /vav|damper|terminal/i.test(`${row.name} ${row.type} ${row.model}`));
  const zones = new Map();
  rows.forEach((row) => {
    const zone = zones.get(row.zoneId) || {
      zoneId: row.zoneId,
      zonePath: [row.floorName, row.roomName].filter(Boolean).join(" / ") || row.zoneName,
      buildingName: row.buildingName,
      devices: [],
      vavs: [],
    };
    zone.devices.push(row.id);
    if (vavs.some((vav) => vav.id === row.id)) {
      zone.vavs.push({ deviceId: row.id, deviceName: row.name, bacnetInstance: row.bacnetInstance });
    }
    zones.set(row.zoneId, zone);
  });
  return {
    ahuToVav: ahus.map((ahu) => ({
      ahuDeviceId: ahu.id,
      ahuName: ahu.name,
      downstreamVavs: vavs.filter((vav) => vav.buildingId === ahu.buildingId).map((vav) => ({
        deviceId: vav.id,
        deviceName: vav.name,
        zoneId: vav.zoneId,
        bacnetInstance: vav.bacnetInstance,
      })),
    })),
    vavToZone: Array.from(zones.values()).filter((zone) => zone.vavs.length > 0),
    heuristic: "building-and-zone metadata with AHU/VAV/model naming classification",
  };
}

function buildBacnetVendorMetadata(rows) {
  const vendors = new Map();
  rows.forEach((row) => {
    const configuration = parseJsonField(row.configuration, {});
    const key = `${row.vendor || "Unknown"}|${row.model || "Unknown"}`;
    const entry = vendors.get(key) || {
      vendor: row.vendor || "Unknown",
      model: row.model || "Unknown",
      deviceCount: 0,
      objectTypes: new Set(),
      transports: new Set(),
      firmwareVersions: new Set(),
    };
    entry.deviceCount += 1;
    entry.objectTypes.add(row.objectType);
    entry.transports.add(configuration.transport || configuration.sourceProtocol || "BACnet/IP");
    if (configuration.firmware || configuration.otaUpdate?.version) {
      entry.firmwareVersions.add(configuration.firmware || configuration.otaUpdate.version);
    }
    vendors.set(key, entry);
  });
  return Array.from(vendors.values()).map((entry) => ({
    ...entry,
    objectTypes: Array.from(entry.objectTypes),
    transports: Array.from(entry.transports),
    firmwareVersions: Array.from(entry.firmwareVersions),
  }));
}

app.get("/api/bacnet/device-discovery", async (req, res) => {
  if (!(await isFeatureEnabled("bacnet_auto_learn"))) {
    return res.status(403).json({ error: "BACnet auto-learn is disabled by admin configuration." });
  }
  res.json(await runBacnetDeviceDiscovery(req.query));
});

app.get("/api/bacnet/discovery", async (req, res) => {
  if (!(await isFeatureEnabled("bacnet_auto_learn"))) {
    return res.status(403).json({ error: "BACnet auto-learn is disabled by admin configuration." });
  }
  res.json(await runBacnetDeviceDiscovery(req.query));
});

app.get("/api/bacnet/object-map", requirePermission("devices:view"), async (req, res) => {
  try {
    const rows = await fetchBacnetDeviceRows();
    res.json({
      generatedAt: new Date().toISOString(),
      count: rows.length,
      objects: buildBacnetObjectMap(rows),
    });
  } catch (error) {
    console.error("BACnet object map failed:", error);
    res.status(500).json({ error: "Unable to build BACnet object map." });
  }
});

app.get("/api/bacnet/equipment-map", requirePermission("devices:view"), async (req, res) => {
  try {
    const rows = await fetchBacnetDeviceRows();
    res.json({
      generatedAt: new Date().toISOString(),
      ...buildBacnetEquipmentMap(rows),
    });
  } catch (error) {
    console.error("BACnet equipment map failed:", error);
    res.status(500).json({ error: "Unable to build BACnet equipment map." });
  }
});

app.get("/api/bacnet/vendor-metadata", requirePermission("devices:view"), async (req, res) => {
  try {
    const rows = await fetchBacnetDeviceRows();
    res.json({
      generatedAt: new Date().toISOString(),
      vendors: buildBacnetVendorMetadata(rows),
    });
  } catch (error) {
    console.error("BACnet vendor metadata failed:", error);
    res.status(500).json({ error: "Unable to build BACnet vendor metadata." });
  }
});

app.post("/api/provisioning/discover", async (req, res) => {
  if (!(await isFeatureEnabled("bacnet_auto_learn"))) {
    return res.status(403).json({ error: "BACnet auto-learn is disabled by admin configuration." });
  }
  const discovery = await runBacnetDeviceDiscovery(req.body);
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

app.get("/api/fdd/findings", async (req, res) => {
  try {
    const rows = await dbQuery(
      `SELECT f.finding_id AS id,
              f.device_id AS deviceId,
              d.name AS deviceName,
              f.zone_id AS zoneId,
              z.name AS zoneName,
              f.severity,
              f.fault_code AS faultCode,
              f.message,
              f.status,
              f.payload,
              f.created_at AS createdAt,
              f.updated_at AS updatedAt
       FROM fdd_findings f
       LEFT JOIN devices d ON f.device_id = d.device_id
       LEFT JOIN zones z ON f.zone_id = z.zone_id
       ORDER BY f.created_at DESC
       LIMIT 100`
    );
    res.json(rows.map((row) => ({ ...row, payload: parseJsonField(row.payload, {}) })));
  } catch (error) {
    console.error("FDD findings query failed:", error);
    res.status(500).json({ error: "Unable to load FDD findings." });
  }
});

app.post("/api/fdd/analyze", requirePermission("alarms:manage"), async (req, res) => {
  try {
    if (!(await isFeatureEnabled("fault_detection_ai"))) {
      return res.status(403).json({ error: "Fault Detection AI is disabled by admin configuration." });
    }
    const devices = await dbQuery(
      `SELECT d.device_id AS deviceId,
              d.zone_id AS zoneId,
              d.name AS deviceName,
              d.type,
              d.present_value AS value,
              d.units,
              d.status,
              d.provisioned AS provisioned,
              d.commissioned AS commissioned,
              d.configuration AS configuration
       FROM devices d
       ORDER BY d.device_id`
    );
    const candidates = buildFddCandidates(devices);
    const findings = [];
    for (const candidate of candidates) {
      findings.push(await createFddFinding(candidate));
    }
    await dbQuery(
      `INSERT INTO analytics_events (event_type, metric_name, metric_value, payload)
       VALUES ('fdd_analysis', 'findings_created', ?, ?)`,
      [
        findings.filter((finding) => !finding.duplicate).length,
        JSON.stringify({ candidateCount: candidates.length, findings }),
      ]
    );
    res.json({
      analyzedDevices: devices.length,
      candidateCount: candidates.length,
      createdCount: findings.filter((finding) => !finding.duplicate).length,
      findings,
    });
  } catch (error) {
    console.error("FDD analysis failed:", error);
    res.status(500).json({ error: "Unable to run FDD analysis." });
  }
});

app.get("/api/maintenance/tickets", async (req, res) => {
  try {
    const rows = await dbQuery(
      `SELECT t.ticket_id AS id,
              t.finding_id AS findingId,
              t.device_id AS deviceId,
              d.name AS deviceName,
              t.title,
              t.description,
              t.priority,
              t.status,
              t.assigned_to AS assignedTo,
              t.created_at AS createdAt,
              t.updated_at AS updatedAt
       FROM maintenance_tickets t
       LEFT JOIN devices d ON t.device_id = d.device_id
       ORDER BY t.created_at DESC
       LIMIT 100`
    );
    res.json(rows);
  } catch (error) {
    console.error("Maintenance ticket query failed:", error);
    res.status(500).json({ error: "Unable to load maintenance tickets." });
  }
});

app.post("/api/maintenance/tickets", requirePermission("alarms:manage"), async (req, res) => {
  const {
    findingId = null,
    deviceId = null,
    title,
    description = "",
    priority = "medium",
    assignedTo = null,
  } = req.body || {};

  if (!title) {
    return res.status(400).json({ error: "title is required." });
  }

  try {
    const result = await dbQuery(
      `INSERT INTO maintenance_tickets
         (finding_id, device_id, title, description, priority, status, assigned_to)
       VALUES (?, ?, ?, ?, ?, 'open', ?)`,
      [findingId, deviceId, title, description, priority, assignedTo]
    );
    auditEvent(db, req, "create", "maintenance_ticket", result.insertId, { title, priority });
    res.status(201).json({ id: result.insertId, title, priority, status: "open" });
  } catch (error) {
    console.error("Maintenance ticket create failed:", error);
    res.status(500).json({ error: "Unable to create maintenance ticket." });
  }
});

app.patch("/api/maintenance/tickets/:ticketId/status", requirePermission("alarms:manage"), async (req, res) => {
  const ticketId = Number(req.params.ticketId);
  const { status } = req.body || {};
  if (!status) {
    return res.status(400).json({ error: "status is required." });
  }

  try {
    const result = await dbQuery(
      `UPDATE maintenance_tickets
       SET status = ?
       WHERE ticket_id = ?`,
      [status, ticketId]
    );
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: "Ticket not found." });
    }
    auditEvent(db, req, "update_status", "maintenance_ticket", ticketId, { status });
    res.json({ id: ticketId, status });
  } catch (error) {
    console.error("Maintenance ticket status update failed:", error);
    res.status(500).json({ error: "Unable to update maintenance ticket." });
  }
});

app.get("/api/maintenance/modes", async (req, res) => {
  try {
    const rows = await dbQuery(
      `SELECT mm.maintenance_mode_id AS id,
              mm.scope_type AS scopeType,
              mm.building_id AS buildingId,
              b.name AS buildingName,
              mm.zone_id AS zoneId,
              z.name AS zoneName,
              COALESCE(NULLIF(CONCAT_WS(' / ', f.name, r.name), ''), z.name) AS zonePath,
              mm.device_id AS deviceId,
              d.name AS deviceName,
              mm.enabled,
              mm.reason,
              mm.started_at AS startedAt,
              mm.ends_at AS endsAt,
              mm.created_by AS createdBy,
              mm.updated_at AS updatedAt
       FROM maintenance_modes mm
       LEFT JOIN buildings b ON mm.building_id = b.building_id
       LEFT JOIN zones z ON mm.zone_id = z.zone_id
       LEFT JOIN floors f ON z.floor_id = f.floor_id
       LEFT JOIN rooms r ON z.room_id = r.room_id
       LEFT JOIN devices d ON mm.device_id = d.device_id
       ORDER BY mm.enabled DESC, mm.started_at DESC
       LIMIT 100`
    );
    res.json(rows);
  } catch (error) {
    console.error("Maintenance mode query failed:", error);
    res.status(500).json({ error: "Unable to load maintenance modes." });
  }
});

app.post("/api/maintenance/modes", requirePermission("devices:manage"), async (req, res) => {
  const {
    buildingId = null,
    zoneId = null,
    deviceId = null,
    reason = "",
    endsAt = null,
  } = req.body || {};
  const scopeType = maintenanceScopeFromTargets({ buildingId, zoneId, deviceId });
  if (!scopeType) {
    return res.status(400).json({ error: "Select a building, zone, or device for maintenance mode." });
  }

  try {
    const normalizedEndsAt = endsAt ? String(endsAt).replace("T", " ") : null;
    const result = await dbQuery(
      `INSERT INTO maintenance_modes
         (scope_type, building_id, zone_id, device_id, enabled, reason, ends_at, created_by)
       VALUES (?, ?, ?, ?, 1, ?, ?, ?)`,
      [scopeType, buildingId || null, zoneId || null, deviceId || null, reason, normalizedEndsAt, req.auth?.actor || "operator"]
    );
    auditEvent(db, req, "enable", "maintenance_mode", result.insertId, { scopeType, buildingId, zoneId, deviceId, reason });
    res.status(201).json({ id: result.insertId, scopeType, buildingId, zoneId, deviceId, enabled: true, reason, endsAt: normalizedEndsAt });
  } catch (error) {
    console.error("Maintenance mode enable failed:", error);
    res.status(500).json({ error: "Unable to enable maintenance mode." });
  }
});

app.patch("/api/maintenance/modes/:modeId/disable", requirePermission("devices:manage"), async (req, res) => {
  const modeId = Number(req.params.modeId);
  try {
    const result = await dbQuery(
      `UPDATE maintenance_modes
       SET enabled = 0
       WHERE maintenance_mode_id = ?`,
      [modeId]
    );
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: "Maintenance mode not found." });
    }
    auditEvent(db, req, "disable", "maintenance_mode", modeId);
    res.json({ id: modeId, enabled: false });
  } catch (error) {
    console.error("Maintenance mode disable failed:", error);
    res.status(500).json({ error: "Unable to disable maintenance mode." });
  }
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
      eventBus.publish("bems.analytics", {
        eventType,
        buildingId,
        zoneId,
        deviceId,
        metricName,
        metricValue,
        payload,
      }, result.insertId).catch(() => {});
      res.json({ id: result.insertId, eventType });
    }
  );
});

app.get("/api/trends", async (req, res) => {
  const limit = Math.min(Number(req.query.limit || 100), 500);
  try {
    const rows = await dbQuery(
      `SELECT t.trend_id AS id,
              t.building_id AS buildingId,
              b.name AS buildingName,
              t.zone_id AS zoneId,
              z.name AS zoneName,
              COALESCE(NULLIF(CONCAT_WS(' / ', f.name, r.name), ''), z.name) AS zonePath,
              t.device_id AS deviceId,
              d.name AS deviceName,
              t.object_type AS objectType,
              t.object_instance AS objectInstance,
              t.metric_name AS metricName,
              t.metric_value AS metricValue,
              t.units,
              t.source,
              t.logged_at AS loggedAt
       FROM trend_logs t
       LEFT JOIN buildings b ON t.building_id = b.building_id
       LEFT JOIN zones z ON t.zone_id = z.zone_id
       LEFT JOIN floors f ON z.floor_id = f.floor_id
       LEFT JOIN rooms r ON z.room_id = r.room_id
       LEFT JOIN devices d ON t.device_id = d.device_id
       ORDER BY t.logged_at DESC
       LIMIT ?`,
      [limit]
    );
    res.json(rows);
  } catch (error) {
    console.error("Trend query failed:", error);
    res.status(500).json({ error: "Unable to load trend logs." });
  }
});

app.post("/api/trends/snapshot", requirePermission("devices:manage"), async (req, res) => {
  try {
    const twin = await fetchTwin();
    const result = await persistTrendSnapshot(twin, req.body?.source || "manual_snapshot");
    res.status(201).json({ ...result, source: req.body?.source || "manual_snapshot" });
  } catch (error) {
    console.error("Trend snapshot failed:", error);
    res.status(500).json({ error: "Unable to record trend snapshot." });
  }
});

app.get("/api/reports/summary", requirePermission("reports:view"), async (req, res) => {
  try {
    const filters = normalizeReportFilters(req.query);
    const trendParams = [];
    const trendWhere = appendReportTrendFilters(filters, trendParams, "t");
    const [trendSummary, alarmSummary, optimizationSummary, fddSummary, buildingRows] = await Promise.all([
      dbQuery(
        `SELECT COUNT(*) AS sampleCount,
                MIN(logged_at) AS firstSampleAt,
                MAX(logged_at) AS lastSampleAt,
                AVG(metric_value) AS averageValue,
                MIN(metric_value) AS minimumValue,
                MAX(metric_value) AS maximumValue
         FROM trend_logs t
         WHERE ${trendWhere}`,
        trendParams
      ),
      dbQuery(
        `SELECT severity, COUNT(*) AS count
         FROM alarms
         WHERE status <> 'Cleared' ${filters.severity ? "AND severity = ?" : ""}
         GROUP BY severity`,
        filters.severity ? [filters.severity] : []
      ),
      dbQuery(
        `SELECT COUNT(*) AS runCount,
                SUM(estimated_savings_kwh) AS estimatedSavingsKwh,
                MAX(created_at) AS lastRunAt
         FROM optimization_history
         WHERE created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)`,
        [filters.days]
      ),
      dbQuery(
        `SELECT severity, COUNT(*) AS count
         FROM fdd_findings
         WHERE status <> 'closed'
         GROUP BY severity`
      ),
      dbQuery(`SELECT COUNT(*) AS buildings FROM buildings`),
    ]);

    const activeAlarms = alarmSummary.reduce((sum, row) => sum + Number(row.count || 0), 0);
    const openFindings = fddSummary.reduce((sum, row) => sum + Number(row.count || 0), 0);
    const trend = trendSummary[0] || {};
    const optimization = optimizationSummary[0] || {};
    res.json({
      generatedAt: new Date().toISOString(),
      periodDays: filters.days,
      filters,
      buildings: Number(buildingRows[0]?.buildings || 0),
      trendSamples: {
        count: Number(trend.sampleCount || 0),
        firstSampleAt: trend.firstSampleAt || null,
        lastSampleAt: trend.lastSampleAt || null,
        averageValue: trend.averageValue == null ? null : Number(Number(trend.averageValue).toFixed(2)),
        minimumValue: trend.minimumValue == null ? null : Number(trend.minimumValue),
        maximumValue: trend.maximumValue == null ? null : Number(trend.maximumValue),
      },
      alarms: {
        activeCount: activeAlarms,
        bySeverity: alarmSummary,
      },
      fdd: {
        openCount: openFindings,
        bySeverity: fddSummary,
      },
      optimization: {
        runCount: Number(optimization.runCount || 0),
        estimatedSavingsKwh: Number(Number(optimization.estimatedSavingsKwh || 0).toFixed(2)),
        lastRunAt: optimization.lastRunAt || null,
      },
      exports: {
        pdf: "/api/reports/energy.pdf",
        trendsCsv: `/api/reports/trends.csv?days=${filters.days}`,
        json: `/api/reports/export?format=json&days=${filters.days}`,
      },
      schedules: "/api/reports/schedules",
      sources: ["trend_logs", "alarms", "fdd_findings", "optimization_history", "building_footprint"],
    });
  } catch (error) {
    console.error("Report summary failed:", error);
    res.status(500).json({ error: "Unable to generate report summary." });
  }
});

app.get("/api/reports/heat-map", requirePermission("reports:view"), async (req, res) => {
  try {
    const filters = normalizeReportFilters(req.query);
    const params = [];
    const trendWhere = appendReportTrendFilters(filters, params, "t");
    const rows = await dbQuery(
      `SELECT b.building_id AS buildingId,
              b.name AS buildingName,
              z.zone_id AS zoneId,
              COALESCE(NULLIF(CONCAT_WS(' / ', f.name, r.name), ''), z.name) AS zonePath,
              COUNT(t.trend_id) AS sampleCount,
              AVG(t.metric_value) AS averageValue,
              MIN(t.metric_value) AS minimumValue,
              MAX(t.metric_value) AS maximumValue,
              MAX(t.logged_at) AS lastSampleAt
       FROM zones z
       JOIN buildings b ON z.building_id = b.building_id
       LEFT JOIN floors f ON z.floor_id = f.floor_id
       LEFT JOIN rooms r ON z.room_id = r.room_id
       LEFT JOIN trend_logs t ON z.zone_id = t.zone_id AND ${trendWhere}
       GROUP BY b.building_id, b.name, z.zone_id, zonePath
       ORDER BY b.name, zonePath`,
      params
    );
    const values = rows.map((row) => Number(row.averageValue)).filter((value) => Number.isFinite(value));
    const min = values.length ? Math.min(...values) : 0;
    const max = values.length ? Math.max(...values) : 0;
    const spread = Math.max(1, max - min);
    res.json({
      generatedAt: new Date().toISOString(),
      filters,
      scale: { min, max },
      zones: rows.map((row) => {
        const averageValue = row.averageValue == null ? null : Number(Number(row.averageValue).toFixed(2));
        const intensity = averageValue == null ? 0 : Number(((averageValue - min) / spread).toFixed(3));
        return {
          buildingId: row.buildingId,
          buildingName: row.buildingName,
          zoneId: row.zoneId,
          zonePath: row.zonePath,
          sampleCount: Number(row.sampleCount || 0),
          averageValue,
          minimumValue: row.minimumValue == null ? null : Number(row.minimumValue),
          maximumValue: row.maximumValue == null ? null : Number(row.maximumValue),
          lastSampleAt: row.lastSampleAt || null,
          intensity,
        };
      }),
    });
  } catch (error) {
    console.error("Report heat map failed:", error);
    res.status(500).json({ error: "Unable to build report heat map." });
  }
});

app.get("/api/reports/trends.csv", requirePermission("reports:export"), async (req, res) => {
  try {
    const filters = normalizeReportFilters(req.query);
    const params = [];
    const trendWhere = appendReportTrendFilters(filters, params, "t");
    const rows = await dbQuery(
      `SELECT t.logged_at AS loggedAt,
              b.name AS buildingName,
              COALESCE(NULLIF(CONCAT_WS(' / ', f.name, r.name), ''), z.name) AS zonePath,
              d.name AS deviceName,
              t.object_type AS objectType,
              t.object_instance AS objectInstance,
              t.metric_name AS metricName,
              t.metric_value AS metricValue,
              t.units,
              t.source
       FROM trend_logs t
       LEFT JOIN buildings b ON t.building_id = b.building_id
       LEFT JOIN zones z ON t.zone_id = z.zone_id
       LEFT JOIN floors f ON z.floor_id = f.floor_id
       LEFT JOIN rooms r ON z.room_id = r.room_id
       LEFT JOIN devices d ON t.device_id = d.device_id
       WHERE ${trendWhere}
       ORDER BY t.logged_at DESC
       LIMIT 1000`,
      params
    );
    const headers = ["loggedAt", "buildingName", "zonePath", "deviceName", "objectType", "objectInstance", "metricName", "metricValue", "units", "source"];
    const csv = [
      headers.join(","),
      ...rows.map((row) => headers.map((header) => escapeCsvValue(row[header])).join(",")),
    ].join("\n");
    await dbQuery(
      `INSERT INTO report_exports (report_type, format, filters, download_path, requested_by)
       VALUES ('trends', 'csv', CAST(? AS JSON), ?, ?)`,
      [JSON.stringify(filters), `/api/reports/trends.csv?days=${filters.days}`, req.auth?.actor || "system"]
    );
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename=bems-trends-${filters.days}d.csv`);
    res.send(`${csv}\n`);
  } catch (error) {
    console.error("Trend CSV report failed:", error);
    res.status(500).json({ error: "Unable to export trend report." });
  }
});

app.get("/api/reports/energy.pdf", requirePermission("reports:export"), async (req, res) => {
  try {
    if (!(await isFeatureEnabled("pdf_energy_reports"))) {
      return res.status(403).json({ error: "PDF energy reports are disabled by admin configuration." });
    }
    const filters = normalizeReportFilters(req.query);
    const trendParams = [];
    const trendWhere = appendReportTrendFilters(filters, trendParams, "t");
    const [trendRows, alarmRows, buildingRows] = await Promise.all([
      dbQuery(
        `SELECT b.name AS buildingName,
                d.name AS deviceName,
                t.metric_value AS metricValue,
                t.units,
                t.logged_at AS loggedAt
         FROM trend_logs t
         LEFT JOIN buildings b ON t.building_id = b.building_id
         LEFT JOIN devices d ON t.device_id = d.device_id
         WHERE ${trendWhere}
         ORDER BY t.logged_at DESC
         LIMIT 12`,
        trendParams
      ),
      dbQuery(`SELECT severity, COUNT(*) AS count FROM alarms WHERE status <> 'Cleared' GROUP BY severity`),
      dbQuery(`SELECT COUNT(*) AS buildings FROM buildings`),
    ]);

    const lines = [
      `Generated: ${new Date().toISOString()}`,
      `Campus buildings: ${buildingRows[0]?.buildings || 0}`,
      "",
      "Recent energy / telemetry trend samples:",
      ...trendRows.map((row) => `${row.buildingName || "Building"} | ${row.deviceName || "Device"} | ${row.metricValue} ${row.units || ""} | ${row.loggedAt}`),
      "",
      "Open alarm summary:",
      ...(alarmRows.length ? alarmRows.map((row) => `${row.severity}: ${row.count}`) : ["No open alarms"]),
      "",
      "Fault Detection AI: run POST /api/fdd/analyze before report generation for current diagnostics.",
    ];
    const pdf = buildSimplePdf("BEMS Energy Report", lines);
    await dbQuery(
      `INSERT INTO report_exports (report_type, format, filters, download_path, requested_by)
       VALUES ('energy', 'pdf', CAST(? AS JSON), '/api/reports/energy.pdf', ?)`,
      [JSON.stringify(filters), req.auth?.actor || "system"]
    );
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", "inline; filename=bems-energy-report.pdf");
    res.send(pdf);
  } catch (error) {
    console.error("Energy PDF report failed:", error);
    res.status(500).json({ error: "Unable to generate energy PDF report." });
  }
});

app.get("/api/reports/export", requirePermission("reports:export"), async (req, res) => {
  try {
    const format = String(req.query.format || "json").toLowerCase();
    const filters = normalizeReportFilters(req.query);
    const params = [];
    const trendWhere = appendReportTrendFilters(filters, params, "t");
    const rows = await dbQuery(
      `SELECT t.logged_at AS loggedAt,
              b.name AS buildingName,
              z.name AS zoneName,
              d.name AS deviceName,
              t.metric_name AS metricName,
              t.metric_value AS metricValue,
              t.units,
              t.source
       FROM trend_logs t
       LEFT JOIN buildings b ON t.building_id = b.building_id
       LEFT JOIN zones z ON t.zone_id = z.zone_id
       LEFT JOIN devices d ON t.device_id = d.device_id
       WHERE ${trendWhere}
       ORDER BY t.logged_at DESC
       LIMIT 1000`,
      params
    );
    const downloadPath = `/api/reports/export?format=${encodeURIComponent(format)}&days=${filters.days}`;
    await dbQuery(
      `INSERT INTO report_exports (report_type, format, filters, download_path, requested_by)
       VALUES ('trends', ?, CAST(? AS JSON), ?, ?)`,
      [format, JSON.stringify(filters), downloadPath, req.auth?.actor || "system"]
    );
    if (format === "csv") {
      const headers = ["loggedAt", "buildingName", "zoneName", "deviceName", "metricName", "metricValue", "units", "source"];
      const csv = [headers.join(","), ...rows.map((row) => headers.map((header) => escapeCsvValue(row[header])).join(","))].join("\n");
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename=bems-report-${filters.days}d.csv`);
      return res.send(`${csv}\n`);
    }
    res.json({ generatedAt: new Date().toISOString(), filters, rows });
  } catch (error) {
    console.error("Report export failed:", error);
    res.status(500).json({ error: "Unable to export report." });
  }
});

app.get("/api/reports/exports", requirePermission("reports:view"), async (req, res) => {
  try {
    const rows = await dbQuery(
      `SELECT report_export_id AS id,
              report_type AS reportType,
              format,
              filters,
              status,
              download_path AS downloadPath,
              requested_by AS requestedBy,
              created_at AS createdAt
       FROM report_exports
       ORDER BY report_export_id DESC
       LIMIT 100`
    );
    res.json(rows.map((row) => ({ ...row, filters: parseJsonField(row.filters, {}) })));
  } catch (error) {
    console.error("List report exports failed:", error);
    res.status(500).json({ error: "Unable to list report exports." });
  }
});

app.get("/api/reports/schedules", requirePermission("reports:view"), async (req, res) => {
  try {
    const rows = await dbQuery(
      `SELECT report_schedule_id AS id,
              name,
              report_type AS reportType,
              cadence,
              recipients,
              filters,
              enabled,
              created_by AS createdBy,
              last_run_at AS lastRunAt,
              next_run_at AS nextRunAt,
              created_at AS createdAt,
              updated_at AS updatedAt
       FROM report_schedules
       ORDER BY report_schedule_id DESC`
    );
    res.json(rows.map((row) => ({
      ...row,
      enabled: !!row.enabled,
      recipients: parseJsonField(row.recipients, []),
      filters: parseJsonField(row.filters, {}),
    })));
  } catch (error) {
    console.error("List report schedules failed:", error);
    res.status(500).json({ error: "Unable to list report schedules." });
  }
});

app.post("/api/reports/schedules", requirePermission("reports:manage"), async (req, res) => {
  const {
    name,
    reportType = "energy",
    cadence = "weekly",
    recipients = [],
    filters = {},
    enabled = true,
  } = req.body || {};
  if (!name) {
    return res.status(400).json({ error: "Report schedule name is required." });
  }
  if (!Array.isArray(recipients)) {
    return res.status(400).json({ error: "recipients must be an array." });
  }
  try {
    const result = await dbQuery(
      `INSERT INTO report_schedules (name, report_type, cadence, recipients, filters, enabled, created_by, next_run_at)
       VALUES (?, ?, ?, CAST(? AS JSON), CAST(? AS JSON), ?, ?, ?)`,
      [name, reportType, cadence, JSON.stringify(recipients), JSON.stringify(filters), enabled !== false, req.auth?.actor || "system", nextReportRunDate(cadence)]
    );
    auditEvent(db, req, "create", "report_schedule", result.insertId, { name, reportType, cadence });
    res.status(201).json({ id: result.insertId, name, reportType, cadence, recipients, filters, enabled: enabled !== false });
  } catch (error) {
    console.error("Create report schedule failed:", error);
    res.status(500).json({ error: "Unable to create report schedule." });
  }
});

app.patch("/api/reports/schedules/:scheduleId", requirePermission("reports:manage"), async (req, res) => {
  const scheduleId = Number(req.params.scheduleId);
  const {
    name = null,
    reportType = null,
    cadence = null,
    recipients = null,
    filters = null,
    enabled = null,
  } = req.body || {};
  if (recipients != null && !Array.isArray(recipients)) {
    return res.status(400).json({ error: "recipients must be an array." });
  }
  try {
    const result = await dbQuery(
      `UPDATE report_schedules
       SET name = COALESCE(?, name),
           report_type = COALESCE(?, report_type),
           cadence = COALESCE(?, cadence),
           recipients = COALESCE(CAST(? AS JSON), recipients),
           filters = COALESCE(CAST(? AS JSON), filters),
           enabled = COALESCE(?, enabled)
       WHERE report_schedule_id = ?`,
      [
        name,
        reportType,
        cadence,
        recipients == null ? null : JSON.stringify(recipients),
        filters == null ? null : JSON.stringify(filters),
        enabled == null ? null : enabled !== false,
        scheduleId,
      ]
    );
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: "Report schedule not found." });
    }
    auditEvent(db, req, "update", "report_schedule", scheduleId, { name, reportType, cadence, enabled });
    res.json({ id: scheduleId, updated: true });
  } catch (error) {
    console.error("Update report schedule failed:", error);
    res.status(500).json({ error: "Unable to update report schedule." });
  }
});

app.get("/api/reports/schedule-runs", requirePermission("reports:view"), async (req, res) => {
  try {
    const rows = await dbQuery(
      `SELECT r.report_schedule_run_id AS id,
              r.report_schedule_id AS scheduleId,
              s.name AS scheduleName,
              r.report_export_id AS exportId,
              e.download_path AS downloadPath,
              r.status,
              r.recipients,
              r.message,
              r.created_at AS createdAt
       FROM report_schedule_runs r
       JOIN report_schedules s ON r.report_schedule_id = s.report_schedule_id
       LEFT JOIN report_exports e ON r.report_export_id = e.report_export_id
       ORDER BY r.report_schedule_run_id DESC
       LIMIT 100`
    );
    res.json(rows.map((row) => ({ ...row, recipients: parseJsonField(row.recipients, []) })));
  } catch (error) {
    console.error("List report schedule runs failed:", error);
    res.status(500).json({ error: "Unable to list report schedule runs." });
  }
});

app.post("/api/reports/schedules/run-due", requirePermission("reports:manage"), async (req, res) => {
  try {
    const schedules = await dbQuery(
      `SELECT report_schedule_id AS id,
              name,
              report_type AS reportType,
              cadence,
              recipients,
              filters
       FROM report_schedules
       WHERE enabled = 1 AND (next_run_at IS NULL OR next_run_at <= CURRENT_TIMESTAMP)
       ORDER BY next_run_at ASC, report_schedule_id ASC
       LIMIT 25`
    );
    const runs = [];
    for (const schedule of schedules) {
      runs.push({ scheduleId: schedule.id, ...(await executeReportSchedule(schedule, req.auth?.actor || "system")) });
    }
    auditEvent(db, req, "run_due", "report_schedule", "due", { count: runs.length });
    res.json({ ran: runs.length, runs });
  } catch (error) {
    console.error("Run due report schedules failed:", error);
    res.status(500).json({ error: "Unable to run due report schedules." });
  }
});

app.post("/api/reports/schedules/:scheduleId/run", requirePermission("reports:manage"), async (req, res) => {
  const scheduleId = Number(req.params.scheduleId);
  try {
    const schedules = await dbQuery(
      `SELECT report_schedule_id AS id,
              name,
              report_type AS reportType,
              cadence,
              recipients,
              filters
       FROM report_schedules
       WHERE report_schedule_id = ?`,
      [scheduleId]
    );
    if (schedules.length === 0) {
      return res.status(404).json({ error: "Report schedule not found." });
    }
    const run = await executeReportSchedule(schedules[0], req.auth?.actor || "system");
    auditEvent(db, req, "run", "report_schedule", scheduleId, run);
    res.status(202).json({ scheduleId, ...run });
  } catch (error) {
    console.error("Run report schedule failed:", error);
    res.status(500).json({ error: "Unable to run report schedule." });
  }
});

app.get("/api/history", async (req, res) => {
  try {
    const requestedDays = Number(req.query.days || 30);
    const days = Number.isFinite(requestedDays) && requestedDays > 0 ? Math.min(requestedDays, 365) : 30;
    const [alarmHistory, trendHistory, optimizationHistoryRows] = await Promise.all([
      dbQuery(
        `SELECT 'alarm' AS type,
                alarm_log_id AS id,
                event_type AS label,
                message AS detail,
                severity,
                created_at AS occurredAt
         FROM alarm_logs
         WHERE created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
         ORDER BY alarm_log_id DESC
         LIMIT 75`,
        [days]
      ),
      dbQuery(
        `SELECT 'trend' AS type,
                trend_id AS id,
                metric_name AS label,
                CONCAT(COALESCE(metric_value, ''), ' ', COALESCE(units, '')) AS detail,
                source AS severity,
                logged_at AS occurredAt
         FROM trend_logs
         WHERE logged_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
         ORDER BY trend_id DESC
         LIMIT 75`,
        [days]
      ),
      dbQuery(
        `SELECT 'optimization' AS type,
                history_id AS id,
                COALESCE(profile, source) AS label,
                CONCAT('estimated savings ', COALESCE(estimated_savings_kwh, 0), ' kWh') AS detail,
                source AS severity,
                created_at AS occurredAt
         FROM optimization_history
         WHERE created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
         ORDER BY history_id DESC
         LIMIT 75`,
        [days]
      ),
    ]);

    res.json({
      days,
      events: [...alarmHistory, ...trendHistory, ...optimizationHistoryRows]
        .sort((a, b) => new Date(b.occurredAt) - new Date(a.occurredAt))
        .slice(0, 150),
    });
  } catch (error) {
    console.error("History query failed:", error);
    res.status(500).json({ error: "Unable to load history." });
  }
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

app.post("/api/autonomous-mode/schedule-setpoints", requirePermission("schedules:manage"), async (req, res) => {
  if (req.body?.apply && !(await isFeatureEnabled("ai_setpoint_writeback"))) {
    return res.status(403).json({ error: "AI setpoint writeback is disabled by admin configuration." });
  }
  const mode = evaluateAutonomousMode(req.body?.mode || req.body || {});
  const apply = Boolean(req.body?.apply);
  const rows = await dbQuery(
    `SELECT d.device_id AS id,
            d.name,
            d.bacnet_instance AS bacnetInstance,
            d.object_instance AS objectInstance,
            d.object_type AS objectType,
            d.units,
            d.configuration,
            z.name AS zoneName,
            f.name AS floorName,
            r.name AS roomName
     FROM devices d
     LEFT JOIN zones z ON d.zone_id = z.zone_id
     LEFT JOIN floors f ON z.floor_id = f.floor_id
     LEFT JOIN rooms r ON z.room_id = r.room_id
     WHERE d.bacnet_instance IS NOT NULL
     ORDER BY d.device_id`
  );

  const actions = [];
  for (const device of rows) {
    const configuration = parseJsonField(device.configuration, {});
    if (configuration.setpoint == null) continue;

    const baseSetpoint = Number(configuration.setpoint);
    const minSetpoint = configuration.minSetpoint == null ? baseSetpoint - 3 : Number(configuration.minSetpoint);
    const maxSetpoint = configuration.maxSetpoint == null ? baseSetpoint + 3 : Number(configuration.maxSetpoint);
    const targetSetpoint = clamp(baseSetpoint + Number(mode.actions?.setpointBias || 0), minSetpoint, maxSetpoint);
    const action = {
      deviceId: device.id,
      deviceName: device.name,
      zonePath: [device.floorName, device.roomName].filter(Boolean).join(" / ") || device.zoneName,
      bacnetInstance: device.bacnetInstance,
      objectType: device.objectType,
      objectInstance: device.objectInstance,
      baseSetpoint,
      targetSetpoint,
      units: device.units,
      profile: mode.profile,
      service: "WriteProperty",
      applied: false,
    };

    const writable = ["analogOutput", "analogValue", "binaryOutput", "binaryValue"].includes(device.objectType);
    if (apply && writable) {
      const write = await edgeClient.writePoint({
        deviceInstance: Number(device.bacnetInstance),
        objectType: bacnetObjectTypeNumber(device.objectType),
        objectInstance: Number(device.objectInstance || 1),
        value: targetSetpoint,
        mode: "WRITE_MODE_ABSOLUTE",
      });
      action.applied = Boolean(write.accepted);
      action.writeResult = write;
    }

    actions.push(action);
  }

  res.json({
    source: "autonomous-schedule-setpoint-engine",
    generatedAt: new Date().toISOString(),
    mode,
    apply,
    flow: "Scheduler/AI -> Node API -> RabbitMQ edge command -> BACnet WriteProperty -> Device changes",
    actions,
  });
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
            ${maintenanceModeActiveSql} AS maintenanceMode,
            d.description,
            z.zone_id AS zoneId,
            z.name AS zoneName,
            COALESCE(NULLIF(CONCAT_WS(' / ', f.name, r.name), ''), z.name) AS zonePath,
            f.floor_id AS floorId,
            f.name AS floorName,
            f.level AS floorLevel,
            r.room_id AS roomId,
            r.name AS roomName,
            r.room_number AS roomNumber,
            b.building_id AS buildingId,
            b.name AS buildingName,
            b.address AS buildingAddress,
            b.description AS buildingDescription
     FROM devices d
     JOIN zones z ON d.zone_id = z.zone_id
     LEFT JOIN floors f ON z.floor_id = f.floor_id
     LEFT JOIN rooms r ON z.room_id = r.room_id
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
            f.floor_id AS floorId,
            f.name AS floorName,
            f.level AS floorLevel,
            f.description AS floorDescription,
            r.room_id AS roomId,
            r.name AS roomName,
            r.room_number AS roomNumber,
            r.description AS roomDescription,
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
            d.configuration AS configuration,
            ${maintenanceModeActiveSql} AS maintenanceMode
     FROM buildings b
     LEFT JOIN floors f ON b.building_id = f.building_id
     LEFT JOIN rooms r ON f.floor_id = r.floor_id
     LEFT JOIN zones z ON b.building_id = z.building_id
       AND (z.floor_id = f.floor_id OR z.floor_id IS NULL)
       AND (z.room_id = r.room_id OR z.room_id IS NULL)
     LEFT JOIN devices d ON z.zone_id = d.zone_id
     ORDER BY b.building_id, f.level, r.room_number, z.zone_id, d.device_id`,
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
            description: row.buildingDescription,
            floors: [],
            zones: [],
          };
          buildingMap.set(row.buildingId, building);
          hierarchy.push(building);
        }

        if (row.zoneId) {
          let floor = null;
          if (row.floorId) {
            floor = building.floors.find((item) => item.id === row.floorId);
            if (!floor) {
              floor = {
                id: row.floorId,
                name: row.floorName,
                level: row.floorLevel,
                description: row.floorDescription,
                rooms: [],
              };
              building.floors.push(floor);
            }
          }

          let room = null;
          if (floor && row.roomId) {
            room = floor.rooms.find((item) => item.id === row.roomId);
            if (!room) {
              room = {
                id: row.roomId,
                name: row.roomName,
                roomNumber: row.roomNumber,
                description: row.roomDescription,
                zones: [],
              };
              floor.rooms.push(room);
            }
          }

          let zone = building.zones.find((z) => z.id === row.zoneId);
          if (!zone) {
            zone = {
              id: row.zoneId,
              name: row.zoneName,
              path: buildZonePath(row),
              displayName: buildZonePath(row),
              description: row.zoneDescription,
              floorId: row.floorId,
              floorName: row.floorName,
              floorLevel: row.floorLevel,
              roomId: row.roomId,
              roomName: row.roomName,
              roomNumber: row.roomNumber,
              devices: [],
            };
            building.zones.push(zone);
            if (room) {
              room.zones.push(zone);
            }
          }

          if (row.deviceId) {
            zone.devices.push({
              id: row.deviceId,
              name: row.deviceName,
              type: row.type,
              bacnetInstance: row.bacnetInstance,
              objectInstance: row.objectInstance,
              objectType: row.objectType,
              vendor: row.vendor,
              model: row.model,
              ipAddress: row.ipAddress,
              value: row.value,
              units: row.units,
              status: row.status,
              provisioned: !!row.provisioned,
              commissioned: !!row.commissioned,
              maintenanceMode: !!row.maintenanceMode,
              configuration: parseJsonField(row.configuration),
              description: row.deviceDescription,
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
      eventBus.publish("bems.telemetry.live", {
        eventType: "telemetry_live",
        summary: twin.summary,
        generatedAt: twin.generatedAt,
      }).catch(() => {});
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

app.post("/api/roles", requirePermission("roles:manage"), (req, res) => {
  const { name, description = "", permissions = [] } = req.body || {};
  if (!name) {
    return res.status(400).json({ error: "Role name is required." });
  }
  if (!Array.isArray(permissions)) {
    return res.status(400).json({ error: "permissions must be an array." });
  }

  db.query(
    `INSERT INTO roles (name, description, permissions) VALUES (?, ?, ?)`,
    [name, description, JSON.stringify(permissions)],
    (error, result) => {
      if (error) {
        console.error("Create role failed:", error);
        return res.status(500).json({ error: "Unable to create role." });
      }
      auditEvent(db, req, "create", "role", result.insertId, { name, permissions });
      res.status(201).json({ id: result.insertId, name, description, permissions });
    }
  );
});

app.patch("/api/roles/:roleId", requirePermission("roles:manage"), (req, res) => {
  const roleId = Number(req.params.roleId);
  const { name = null, description = null, permissions = null } = req.body || {};
  if (permissions != null && !Array.isArray(permissions)) {
    return res.status(400).json({ error: "permissions must be an array." });
  }

  db.query(
    `UPDATE roles
     SET name = COALESCE(?, name),
         description = COALESCE(?, description),
         permissions = COALESCE(?, permissions)
     WHERE role_id = ?`,
    [name, description, permissions == null ? null : JSON.stringify(permissions), roleId],
    (error, result) => {
      if (error) {
        console.error("Update role failed:", error);
        return res.status(500).json({ error: "Unable to update role." });
      }
      if (result.affectedRows === 0) {
        return res.status(404).json({ error: "Role not found." });
      }
      auditEvent(db, req, "update", "role", roleId, { name, description, permissions });
      res.json({ id: roleId, updated: true });
    }
  );
});

app.delete("/api/roles/:roleId", requirePermission("roles:manage"), async (req, res) => {
  const roleId = Number(req.params.roleId);
  try {
    const [usage] = await db.promise().query("SELECT COUNT(*) AS count FROM users WHERE role_id = ?", [roleId]);
    if (usage[0].count > 0) {
      return res.status(409).json({ error: "Role is assigned to users and cannot be deleted." });
    }
    const [result] = await db.promise().query("DELETE FROM roles WHERE role_id = ?", [roleId]);
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: "Role not found." });
    }
    auditEvent(db, req, "delete", "role", roleId);
    res.json({ id: roleId, deleted: true });
  } catch (error) {
    console.error("Delete role failed:", error);
    res.status(500).json({ error: "Unable to delete role." });
  }
});

app.get("/api/users", requirePermission("users:manage"), (req, res) => {
  handleQuery(
    res,
    `SELECT u.user_id AS id,
            u.organization_id AS organizationId,
            u.site_id AS siteId,
            u.username,
            u.email,
            u.active,
            u.role_id AS roleId,
            u.last_login_at AS lastLoginAt,
            r.name AS roleName,
            r.permissions
     FROM users u
     LEFT JOIN roles r ON u.role_id = r.role_id
     WHERE u.organization_id = ?
     ORDER BY u.user_id`,
    [req.auth?.organizationId || 1]
  );
});

app.post("/api/users", requirePermission("users:manage"), (req, res) => {
  const {
    username,
    password,
    email = "",
    roleId = null,
    organizationId = req.auth?.organizationId || 1,
    siteId = req.auth?.siteId || null,
    active = true,
  } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: "Username and password are required." });
  }

  const query = `INSERT INTO users (organization_id, site_id, username, email, role_id, password_hash, active)
                 VALUES (?, ?, ?, ?, ?, ?, ?)`;
  db.query(query, [organizationId, siteId || null, username, email, roleId || null, hashPassword(password), active ? 1 : 0], (error, result) => {
    if (error) {
      console.error("Create user failed:", error);
      return res.status(500).json({ error: "Unable to create user." });
    }
    auditEvent(db, req, "create", "user", result.insertId, { username, roleId, organizationId, siteId });
    res.json({ id: result.insertId, username, email, roleId, organizationId, siteId, active });
  });
});

app.patch("/api/users/:userId/role", requirePermission("users:manage"), async (req, res) => {
  const userId = Number(req.params.userId);
  const { roleId = null } = req.body;
  const organizationId = req.auth?.organizationId || 1;
  try {
    const currentUser = await fetchUserManagementState(userId, organizationId);
    if (!currentUser) {
      return res.status(404).json({ error: "User not found." });
    }

    if (currentUser.active && permissionListIncludes(currentUser.permissions, "users:manage")) {
      const nextRoleRows = roleId
        ? await dbQuery("SELECT permissions FROM roles WHERE role_id = ? LIMIT 1", [roleId])
        : [];
      const nextKeepsUserManagement = roleId && nextRoleRows.length > 0 && permissionListIncludes(nextRoleRows[0].permissions, "users:manage");
      if (!nextKeepsUserManagement && await activeUserManagerCount(organizationId) <= 1) {
        return res.status(409).json({ error: "At least one active admin user with users:manage permission is required." });
      }
    }

    const result = await dbQuery(
      `UPDATE users SET role_id = ? WHERE user_id = ? AND organization_id = ?`,
      [roleId || null, userId, organizationId]
    );
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: "User not found." });
    }
    auditEvent(db, req, "update_role", "user", userId, { roleId });
    res.json({ id: userId, roleId });
  } catch (error) {
    console.error("Update user role failed:", error);
    res.status(500).json({ error: "Unable to update user role." });
  }
});

app.patch("/api/users/:userId/active", requirePermission("users:manage"), async (req, res) => {
  const userId = Number(req.params.userId);
  const organizationId = req.auth?.organizationId || 1;
  const { active } = req.body;
  if (active == null) {
    return res.status(400).json({ error: "active is required." });
  }
  try {
    if (!active) {
      await assertCanRemoveUserManager(userId, organizationId);
    }
    const result = await dbQuery(
      `UPDATE users SET active = ? WHERE user_id = ? AND organization_id = ?`,
      [active ? 1 : 0, userId, organizationId]
    );
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: "User not found." });
    }
    auditEvent(db, req, active ? "activate" : "deactivate", "user", userId);
    res.json({ id: userId, active: !!active });
  } catch (error) {
    console.error("Update user active state failed:", error);
    res.status(error.statusCode || 500).json({ error: error.statusCode ? error.message : "Unable to update user state." });
  }
});

app.patch("/api/users/:userId/password", requirePermission("users:manage"), (req, res) => {
  const userId = Number(req.params.userId);
  const { password } = req.body;
  if (!password || password.length < 8) {
    return res.status(400).json({ error: "Password must be at least 8 characters." });
  }
  db.query(
    `UPDATE users SET password_hash = ? WHERE user_id = ?`,
    [hashPassword(password), userId],
    (error, result) => {
      if (error) {
        console.error("Update user password failed:", error);
        return res.status(500).json({ error: "Unable to update password." });
      }
      if (result.affectedRows === 0) {
        return res.status(404).json({ error: "User not found." });
      }
      auditEvent(db, req, "update_password", "user", userId);
      res.json({ id: userId, passwordUpdated: true });
    }
  );
});

app.delete("/api/users/:userId", requirePermission("users:manage"), async (req, res) => {
  const userId = Number(req.params.userId);
  const organizationId = req.auth?.organizationId || 1;
  try {
    await assertCanRemoveUserManager(userId, organizationId);
    const result = await dbQuery(`DELETE FROM users WHERE user_id = ? AND organization_id = ?`, [userId, organizationId]);
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: "User not found." });
    }
    auditEvent(db, req, "delete", "user", userId);
    res.json({ id: userId, deleted: true });
  } catch (error) {
    console.error("Delete user failed:", error);
    res.status(error.statusCode || 500).json({ error: error.statusCode ? error.message : "Unable to delete user." });
  }
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

app.get("/api/alarm-logs", async (req, res) => {
  try {
    const rows = await dbQuery(
      `SELECT l.alarm_log_id AS id,
              l.alarm_id AS alarmId,
              l.device_id AS deviceId,
              d.name AS deviceName,
              l.event_type AS eventType,
              l.severity,
              l.status,
              l.actor,
              l.message,
              l.payload,
              l.created_at AS createdAt
       FROM alarm_logs l
       LEFT JOIN devices d ON l.device_id = d.device_id
       ORDER BY l.created_at DESC, l.alarm_log_id DESC
       LIMIT 200`
    );
    res.json(rows.map((row) => ({ ...row, payload: parseJsonField(row.payload, {}) })));
  } catch (error) {
    console.error("Alarm log query failed:", error);
    res.status(500).json({ error: "Unable to load alarm logs." });
  }
});

app.get("/api/notifications/email", requirePermission("alarms:manage"), async (req, res) => {
  try {
    const rows = await dbQuery(
      `SELECT notification_id AS id,
              channel,
              recipient,
              subject,
              severity,
              status,
              related_alarm_id AS alarmId,
              attempts,
              last_error AS lastError,
              created_at AS createdAt,
              sent_at AS sentAt
       FROM notification_outbox
       WHERE channel = 'email'
       ORDER BY notification_id DESC
       LIMIT 100`
    );
    res.json(rows);
  } catch (error) {
    console.error("Email notification query failed:", error);
    res.status(500).json({ error: "Unable to load email notifications." });
  }
});

app.post("/api/alarms", requirePermission("alarms:manage"), (req, res) => {
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
    logAlarmEvent(result.insertId, "created", req.auth?.actor, { source: "api", deviceId, severity })
      .catch((logError) => console.error("Alarm log insert failed:", logError));
    queueAlarmEmailNotification(result.insertId)
      .catch((notifyError) => console.error("Alarm email notification queue failed:", notifyError));
    res.json(responsePayload);
    broadcastAlarmUpdate();
  });
});

app.patch("/api/alarms/:alarmId/ack", requirePermission("alarms:manage"), (req, res) => {
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
      logAlarmEvent(alarmId, "acknowledged", req.auth?.actor, { source: "api" })
        .catch((logError) => console.error("Alarm log insert failed:", logError));
      res.json({ id: alarmId, acked: true, status: "Acknowledged" });
      broadcastAlarmUpdate();
    }
  );
});

app.patch("/api/alarms/:alarmId/clear", requirePermission("alarms:manage"), (req, res) => {
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
      logAlarmEvent(alarmId, "cleared", req.auth?.actor, { source: "api" })
        .catch((logError) => console.error("Alarm log insert failed:", logError));
      res.json({ id: alarmId, status: "Cleared" });
      broadcastAlarmUpdate();
    }
  );
});

app.get("/api/holiday-schedules", async (req, res) => {
  try {
    const rows = await dbQuery(
      `SELECT h.holiday_id AS id,
              h.building_id AS buildingId,
              b.name AS buildingName,
              h.name,
              h.event_date AS eventDate,
              h.month,
              h.day_of_month AS dayOfMonth,
              h.recurring,
              h.enabled,
              h.start_time AS startTime,
              h.end_time AS endTime,
              h.action,
              h.target_value AS targetValue,
              h.units,
              h.description,
              h.created_at AS createdAt,
              h.updated_at AS updatedAt
       FROM holiday_schedules h
       LEFT JOIN buildings b ON h.building_id = b.building_id
       ORDER BY h.enabled DESC, h.month, h.day_of_month, h.event_date, h.name`
    );
    res.json(rows);
  } catch (error) {
    console.error("Holiday schedule query failed:", error);
    res.status(500).json({ error: "Unable to load holiday schedules." });
  }
});

app.post("/api/holiday-schedules", requirePermission("schedules:manage"), async (req, res) => {
  const {
    buildingId = null,
    name,
    eventDate = null,
    month = null,
    dayOfMonth = null,
    recurring = true,
    enabled = true,
    startTime = "00:00",
    endTime = "23:59",
    action = "setpoint_bias",
    targetValue = null,
    units = "",
    description = "",
  } = req.body || {};

  if (!name) return res.status(400).json({ error: "name is required." });
  if (!eventDate && (!month || !dayOfMonth)) {
    return res.status(400).json({ error: "Use eventDate or month/dayOfMonth for holiday schedules." });
  }

  try {
    const result = await dbQuery(
      `INSERT INTO holiday_schedules
         (building_id, name, event_date, month, day_of_month, recurring, enabled, start_time, end_time, action, target_value, units, description)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        buildingId || null,
        name,
        eventDate || null,
        month || null,
        dayOfMonth || null,
        recurring ? 1 : 0,
        enabled ? 1 : 0,
        startTime,
        endTime,
        action,
        targetValue,
        units,
        description,
      ]
    );
    auditEvent(db, req, "create", "holiday_schedule", result.insertId, { name, buildingId, eventDate, month, dayOfMonth });
    res.status(201).json({ id: result.insertId, name, buildingId, eventDate, month, dayOfMonth, recurring, enabled });
  } catch (error) {
    console.error("Holiday schedule create failed:", error);
    res.status(500).json({ error: "Unable to create holiday schedule." });
  }
});

app.patch("/api/holiday-schedules/:holidayId/disable", requirePermission("schedules:manage"), async (req, res) => {
  const holidayId = Number(req.params.holidayId);
  try {
    const result = await dbQuery("UPDATE holiday_schedules SET enabled = 0 WHERE holiday_id = ?", [holidayId]);
    if (result.affectedRows === 0) return res.status(404).json({ error: "Holiday schedule not found." });
    auditEvent(db, req, "disable", "holiday_schedule", holidayId);
    res.json({ id: holidayId, enabled: false });
  } catch (error) {
    console.error("Holiday schedule disable failed:", error);
    res.status(500).json({ error: "Unable to disable holiday schedule." });
  }
});

app.get("/api/special-events", async (req, res) => {
  try {
    const rows = await dbQuery(
      `SELECT e.special_event_id AS id,
              e.building_id AS buildingId,
              b.name AS buildingName,
              e.zone_id AS zoneId,
              z.name AS zoneName,
              COALESCE(NULLIF(CONCAT_WS(' / ', f.name, r.name), ''), z.name) AS zonePath,
              e.device_id AS deviceId,
              d.name AS deviceName,
              e.name,
              e.start_at AS startAt,
              e.end_at AS endAt,
              e.priority,
              e.enabled,
              e.action,
              e.target_value AS targetValue,
              e.units,
              e.description,
              e.created_at AS createdAt,
              e.updated_at AS updatedAt
       FROM special_events e
       LEFT JOIN buildings b ON e.building_id = b.building_id
       LEFT JOIN zones z ON e.zone_id = z.zone_id
       LEFT JOIN floors f ON z.floor_id = f.floor_id
       LEFT JOIN rooms r ON z.room_id = r.room_id
       LEFT JOIN devices d ON e.device_id = d.device_id
       ORDER BY e.enabled DESC, e.start_at DESC, e.priority DESC`
    );
    res.json(rows);
  } catch (error) {
    console.error("Special event query failed:", error);
    res.status(500).json({ error: "Unable to load special events." });
  }
});

app.post("/api/special-events", requirePermission("schedules:manage"), async (req, res) => {
  const {
    buildingId = null,
    zoneId = null,
    deviceId = null,
    name,
    startAt,
    endAt,
    priority = 400,
    enabled = true,
    action = "setpoint_bias",
    targetValue = null,
    units = "",
    description = "",
  } = req.body || {};

  if (!name || !startAt || !endAt) {
    return res.status(400).json({ error: "name, startAt, and endAt are required." });
  }

  try {
    const result = await dbQuery(
      `INSERT INTO special_events
         (building_id, zone_id, device_id, name, start_at, end_at, priority, enabled, action, target_value, units, description)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        buildingId || null,
        zoneId || null,
        deviceId || null,
        name,
        normalizeDateTimeString(startAt),
        normalizeDateTimeString(endAt),
        priority,
        enabled ? 1 : 0,
        action,
        targetValue,
        units,
        description,
      ]
    );
    auditEvent(db, req, "create", "special_event", result.insertId, { name, buildingId, zoneId, deviceId, startAt, endAt });
    res.status(201).json({ id: result.insertId, name, buildingId, zoneId, deviceId, startAt, endAt, enabled });
  } catch (error) {
    console.error("Special event create failed:", error);
    res.status(500).json({ error: "Unable to create special event." });
  }
});

app.patch("/api/special-events/:eventId/disable", requirePermission("schedules:manage"), async (req, res) => {
  const eventId = Number(req.params.eventId);
  try {
    const result = await dbQuery("UPDATE special_events SET enabled = 0 WHERE special_event_id = ?", [eventId]);
    if (result.affectedRows === 0) return res.status(404).json({ error: "Special event not found." });
    auditEvent(db, req, "disable", "special_event", eventId);
    res.json({ id: eventId, enabled: false });
  } catch (error) {
    console.error("Special event disable failed:", error);
    res.status(500).json({ error: "Unable to disable special event." });
  }
});

app.get("/api/schedules", (req, res) => {
  handleQuery(
    res,
    `SELECT s.schedule_id AS id,
            s.name,
            s.enabled,
            s.scope_type AS scopeType,
            s.recurrence,
            s.month,
            s.day_of_month AS dayOfMonth,
            s.override_priority AS overridePriority,
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
            COALESCE(NULLIF(CONCAT_WS(' / ', f.name, r.name), ''), z.name) AS zonePath,
            s.device_id AS deviceId,
            d.name AS deviceName,
            s.created_at AS createdAt,
            s.updated_at AS updatedAt
     FROM schedules s
     LEFT JOIN buildings b ON s.building_id = b.building_id
     LEFT JOIN zones z ON s.zone_id = z.zone_id
     LEFT JOIN floors f ON z.floor_id = f.floor_id
     LEFT JOIN rooms r ON z.room_id = r.room_id
     LEFT JOIN devices d ON s.device_id = d.device_id
     ORDER BY s.enabled DESC, s.override_priority DESC, s.start_time, s.name`
  );
});

app.get("/api/schedules/effective", async (req, res) => {
  const buildingId = Number(req.query.buildingId || 0) || null;
  const zoneId = Number(req.query.zoneId || 0) || null;
  const deviceId = Number(req.query.deviceId || 0) || null;
  const effectiveDate = normalizeDateString(req.query.date);
  const effectiveDateTime = `${effectiveDate} 12:00:00`;

  try {
    const [rows, holidayRows, specialEventRows] = await Promise.all([
      dbQuery(
      `SELECT s.schedule_id AS id,
              s.name,
              s.enabled,
              s.scope_type AS scopeType,
              s.recurrence,
              s.month,
              s.day_of_month AS dayOfMonth,
              s.override_priority AS overridePriority,
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
              COALESCE(NULLIF(CONCAT_WS(' / ', f.name, r.name), ''), z.name) AS zonePath,
              s.device_id AS deviceId,
              d.name AS deviceName
       FROM schedules s
       LEFT JOIN buildings b ON s.building_id = b.building_id
       LEFT JOIN zones z ON s.zone_id = z.zone_id
       LEFT JOIN floors f ON z.floor_id = f.floor_id
       LEFT JOIN rooms r ON z.room_id = r.room_id
       LEFT JOIN devices d ON s.device_id = d.device_id
       WHERE s.enabled = 1
         AND (
           (s.device_id IS NOT NULL AND s.device_id = ?)
           OR (s.device_id IS NULL AND s.zone_id IS NOT NULL AND s.zone_id = ?)
           OR (s.device_id IS NULL AND s.zone_id IS NULL AND s.building_id IS NOT NULL AND s.building_id = ?)
           OR (s.device_id IS NULL AND s.zone_id IS NULL AND s.building_id IS NULL)
         )
       ORDER BY s.override_priority DESC, s.start_time, s.name`,
        [deviceId, zoneId, buildingId]
      ),
      dbQuery(
        `SELECT h.holiday_id AS id,
                h.building_id AS buildingId,
                b.name AS buildingName,
                h.name,
                h.event_date AS eventDate,
                h.month,
                h.day_of_month AS dayOfMonth,
                h.recurring,
                h.enabled,
                h.start_time AS startTime,
                h.end_time AS endTime,
                h.action,
                h.target_value AS targetValue,
                h.units,
                h.description
         FROM holiday_schedules h
         LEFT JOIN buildings b ON h.building_id = b.building_id
         WHERE h.enabled = 1
           AND (h.building_id IS NULL OR h.building_id = ?)
           AND (
             (h.event_date IS NOT NULL AND h.event_date = ?)
             OR (h.recurring = 1 AND h.month = MONTH(?) AND h.day_of_month = DAYOFMONTH(?))
           )
         ORDER BY h.building_id DESC, h.start_time, h.name`,
        [buildingId, effectiveDate, effectiveDate, effectiveDate]
      ),
      dbQuery(
        `SELECT e.special_event_id AS id,
                e.building_id AS buildingId,
                b.name AS buildingName,
                e.zone_id AS zoneId,
                z.name AS zoneName,
                COALESCE(NULLIF(CONCAT_WS(' / ', f.name, r.name), ''), z.name) AS zonePath,
                e.device_id AS deviceId,
                d.name AS deviceName,
                e.name,
                e.start_at AS startAt,
                e.end_at AS endAt,
                e.priority,
                e.enabled,
                e.action,
                e.target_value AS targetValue,
                e.units,
                e.description
         FROM special_events e
         LEFT JOIN buildings b ON e.building_id = b.building_id
         LEFT JOIN zones z ON e.zone_id = z.zone_id
         LEFT JOIN floors f ON z.floor_id = f.floor_id
         LEFT JOIN rooms r ON z.room_id = r.room_id
         LEFT JOIN devices d ON e.device_id = d.device_id
         WHERE e.enabled = 1
           AND ? BETWEEN e.start_at AND e.end_at
           AND (
             (e.device_id IS NOT NULL AND e.device_id = ?)
             OR (e.device_id IS NULL AND e.zone_id IS NOT NULL AND e.zone_id = ?)
             OR (e.device_id IS NULL AND e.zone_id IS NULL AND e.building_id IS NOT NULL AND e.building_id = ?)
             OR (e.device_id IS NULL AND e.zone_id IS NULL AND e.building_id IS NULL)
           )
         ORDER BY e.priority DESC, e.start_at, e.name`,
        [effectiveDateTime, deviceId, zoneId, buildingId]
      ),
    ]);

    const effectiveByWindow = new Map();
    rows.forEach((schedule) => {
      const key = [schedule.action, schedule.startTime, schedule.endTime, schedule.recurrence, schedule.month || "", schedule.dayOfMonth || ""].join("|");
      if (!effectiveByWindow.has(key)) {
        effectiveByWindow.set(key, schedule);
      }
    });

    const holidayExceptions = holidayRows.map((schedule) => ({
      ...schedule,
      source: "holiday",
      scopeType: schedule.buildingId ? "building" : "global",
      overridePriority: 1000,
      recurrence: schedule.recurring ? "yearly" : "single",
      days: "Holiday",
    }));
    const eventExceptions = specialEventRows.map((event) => ({
      ...event,
      source: "special_event",
      scopeType: event.deviceId ? "device" : event.zoneId ? "zone" : event.buildingId ? "building" : "global",
      overridePriority: event.priority,
      recurrence: "special_event",
      startTime: event.startAt,
      endTime: event.endAt,
      days: "Event window",
    }));

    res.json({
      target: { buildingId, zoneId, deviceId },
      date: effectiveDate,
      overrideOrder: ["device", "zone", "building", "global"],
      schedules: rows,
      activeHolidaySchedules: holidayRows,
      activeSpecialEvents: specialEventRows,
      effectiveExceptions: [...eventExceptions, ...holidayExceptions],
      effectiveSchedules: [...eventExceptions, ...holidayExceptions, ...Array.from(effectiveByWindow.values())],
    });
  } catch (error) {
    console.error("Effective schedule query failed:", error);
    res.status(500).json({ error: "Unable to resolve effective schedules." });
  }
});

app.post("/api/schedules", requirePermission("schedules:manage"), async (req, res) => {
  const {
    name,
    buildingId = null,
    zoneId = null,
    deviceId = null,
    enabled = true,
    startTime,
    endTime,
    days,
    recurrence = "daily",
    month = null,
    dayOfMonth = null,
    action = "setpoint",
    targetValue = null,
    units = "",
    description = "",
  } = req.body;

  if (!name || !startTime || !endTime || !days) {
    return res.status(400).json({ error: "Name, startTime, endTime, and days are required." });
  }

  const normalizedRecurrence = normalizeRecurrence(recurrence);
  const { scopeType, overridePriority } = scheduleScopeFromTargets({ buildingId, zoneId, deviceId });
  const query = `INSERT INTO schedules
      (name, building_id, zone_id, device_id, scope_type, recurrence, month, day_of_month, override_priority, enabled, start_time, end_time, days, action, target_value, units, description)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
  const params = [
    name,
    buildingId || null,
    zoneId || null,
    deviceId || null,
    scopeType,
    normalizedRecurrence,
    normalizedRecurrence === "yearly" ? month : null,
    normalizedRecurrence === "monthly" || normalizedRecurrence === "yearly" ? dayOfMonth : null,
    overridePriority,
    enabled ? 1 : 0,
    startTime,
    endTime,
    days,
    action,
    targetValue,
    units,
    description,
  ];

  try {
    const result = await dbQuery(query, params);
    const deviceSchedulePersistence = deviceId ? await syncDeviceResidentSchedules(Number(deviceId)) : null;
    res.json({ id: result.insertId, name, enabled, scopeType, recurrence: normalizedRecurrence, month, dayOfMonth, overridePriority, startTime, endTime, days, action, targetValue, units, description, buildingId, zoneId, deviceId, deviceSchedulePersistence });
  } catch (error) {
    console.error("Create schedule failed:", error);
    res.status(500).json({ error: "Unable to create schedule." });
  }
});

app.patch("/api/schedules/:scheduleId", requirePermission("schedules:manage"), async (req, res) => {
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
    recurrence,
    month,
    dayOfMonth,
    action,
    targetValue,
    units,
    description,
  } = req.body;
  const normalizedRecurrence = recurrence == null ? null : normalizeRecurrence(recurrence);
  const { scopeType, overridePriority } = scheduleScopeFromTargets({ buildingId, zoneId, deviceId });

  const query = `UPDATE schedules SET
      name = COALESCE(?, name),
      building_id = COALESCE(?, building_id),
      zone_id = COALESCE(?, zone_id),
      device_id = COALESCE(?, device_id),
      scope_type = COALESCE(?, scope_type),
      recurrence = COALESCE(?, recurrence),
      month = COALESCE(?, month),
      day_of_month = COALESCE(?, day_of_month),
      override_priority = COALESCE(?, override_priority),
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
    req.body.buildingId !== undefined || req.body.zoneId !== undefined || req.body.deviceId !== undefined ? scopeType : null,
    normalizedRecurrence,
    month,
    dayOfMonth,
    req.body.buildingId !== undefined || req.body.zoneId !== undefined || req.body.deviceId !== undefined ? overridePriority : null,
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

  try {
    const existing = await dbQuery("SELECT device_id AS deviceId FROM schedules WHERE schedule_id = ?", [scheduleId]);
    const previousDeviceId = existing[0]?.deviceId || null;
    const result = await dbQuery(query, params);
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: "Schedule not found." });
    }
    const deviceSchedulePersistence = await syncScheduleResidentDevices(scheduleId, previousDeviceId);
    res.json({ id: scheduleId, updated: true, deviceSchedulePersistence });
  } catch (error) {
    console.error("Update schedule failed:", error);
    res.status(500).json({ error: "Unable to update schedule." });
  }
});

app.patch("/api/schedules/:scheduleId/enable", requirePermission("schedules:manage"), async (req, res) => {
  const scheduleId = Number(req.params.scheduleId);
  try {
    const result = await dbQuery(`UPDATE schedules SET enabled = 1 WHERE schedule_id = ?`, [scheduleId]);
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: "Schedule not found." });
    }
    const deviceSchedulePersistence = await syncScheduleResidentDevices(scheduleId);
    res.json({ id: scheduleId, enabled: true, deviceSchedulePersistence });
  } catch (error) {
    console.error("Enable schedule failed:", error);
    res.status(500).json({ error: "Unable to enable schedule." });
  }
});

app.patch("/api/schedules/:scheduleId/disable", requirePermission("schedules:manage"), async (req, res) => {
  const scheduleId = Number(req.params.scheduleId);
  try {
    const result = await dbQuery(`UPDATE schedules SET enabled = 0 WHERE schedule_id = ?`, [scheduleId]);
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: "Schedule not found." });
    }
    const deviceSchedulePersistence = await syncScheduleResidentDevices(scheduleId);
    res.json({ id: scheduleId, enabled: false, deviceSchedulePersistence });
  } catch (error) {
    console.error("Disable schedule failed:", error);
    res.status(500).json({ error: "Unable to disable schedule." });
  }
});

app.delete("/api/schedules/:scheduleId", requirePermission("schedules:manage"), async (req, res) => {
  const scheduleId = Number(req.params.scheduleId);
  try {
    const existing = await dbQuery("SELECT device_id AS deviceId FROM schedules WHERE schedule_id = ?", [scheduleId]);
    const previousDeviceId = existing[0]?.deviceId || null;
    const result = await dbQuery(`DELETE FROM schedules WHERE schedule_id = ?`, [scheduleId]);
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: "Schedule not found." });
    }
    const deviceSchedulePersistence = previousDeviceId ? await syncDeviceResidentSchedules(previousDeviceId) : null;
    res.json({ id: scheduleId, deleted: true, deviceSchedulePersistence });
  } catch (error) {
    console.error("Delete schedule failed:", error);
    res.status(500).json({ error: "Unable to delete schedule." });
  }
});

app.get("/api/health", (req, res) => {
  const statusCode = watchdogState.status === "ok" || watchdogState.status === "starting" ? 200 : 503;
  res.status(statusCode).json({
    status: watchdogState.status,
    checkedAt: watchdogState.lastRunAt,
    appliance: applianceProfile,
  });
});

app.get("/metrics", async (req, res) => {
  const lines = [
    "# HELP bems_api_uptime_seconds Node API process uptime in seconds.",
    "# TYPE bems_api_uptime_seconds gauge",
    `bems_api_uptime_seconds ${Math.round((Date.now() - processStartedAt) / 1000)}`,
    "# HELP bems_api_http_requests_total HTTP requests observed by the Node API.",
    "# TYPE bems_api_http_requests_total counter",
    `bems_api_http_requests_total ${httpMetrics.total}`,
    "# HELP bems_watchdog_dependency_up Dependency health from backend watchdog.",
    "# TYPE bems_watchdog_dependency_up gauge",
  ];

  httpMetrics.byRoute.forEach((metric) => {
    const route = metric.routeKey.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    lines.push(`bems_api_http_requests_by_route_total{route="${route}",status_family="${metric.statusFamily}"} ${metric.count}`);
    lines.push(`bems_api_http_request_duration_ms_sum{route="${route}",status_family="${metric.statusFamily}"} ${metric.durationMs}`);
  });

  Object.entries(watchdogState.dependencies || {}).forEach(([name, dependency]) => {
    lines.push(`bems_watchdog_dependency_up{name="${name}"} ${normalizeHealthStatus(dependency.status) ? 1 : 0}`);
  });

  try {
    const [alarmRows, deviceRows, findingRows] = await Promise.all([
      dbQuery("SELECT COUNT(*) AS count FROM alarms WHERE status <> 'Cleared'"),
      dbQuery("SELECT COUNT(*) AS count FROM devices"),
      dbQuery("SELECT COUNT(*) AS count FROM fdd_findings WHERE status = 'open'"),
    ]);
    lines.push("# HELP bems_active_alarms Active uncleared BEMS alarms.");
    lines.push("# TYPE bems_active_alarms gauge");
    lines.push(`bems_active_alarms ${Number(alarmRows[0]?.count || 0)}`);
    lines.push("# HELP bems_devices_total Configured BEMS devices.");
    lines.push("# TYPE bems_devices_total gauge");
    lines.push(`bems_devices_total ${Number(deviceRows[0]?.count || 0)}`);
    lines.push("# HELP bems_open_fdd_findings Open fault detection findings.");
    lines.push("# TYPE bems_open_fdd_findings gauge");
    lines.push(`bems_open_fdd_findings ${Number(findingRows[0]?.count || 0)}`);
  } catch (error) {
    lines.push("# HELP bems_metrics_database_up Database availability during metrics scrape.");
    lines.push("# TYPE bems_metrics_database_up gauge");
    lines.push("bems_metrics_database_up 0");
  }

  res.setHeader("Content-Type", "text/plain; version=0.0.4");
  res.send(`${lines.join("\n")}\n`);
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
