CREATE DATABASE IF NOT EXISTS bems;
USE bems;

CREATE TABLE IF NOT EXISTS schema_migrations (
  migration_id VARCHAR(180) PRIMARY KEY,
  applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS organizations (
  organization_id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  slug VARCHAR(120) NOT NULL UNIQUE,
  plan VARCHAR(50) NOT NULL DEFAULT 'enterprise',
  status VARCHAR(50) NOT NULL DEFAULT 'active',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS sites (
  site_id INT AUTO_INCREMENT PRIMARY KEY,
  organization_id INT NOT NULL,
  name VARCHAR(120) NOT NULL,
  timezone VARCHAR(80) NOT NULL DEFAULT 'America/New_York',
  edge_gateway_id VARCHAR(120),
  status VARCHAR(50) NOT NULL DEFAULT 'active',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (organization_id) REFERENCES organizations(organization_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS audit_events (
  audit_id INT AUTO_INCREMENT PRIMARY KEY,
  organization_id INT DEFAULT NULL,
  actor VARCHAR(120) NOT NULL,
  action VARCHAR(120) NOT NULL,
  resource_type VARCHAR(120) NOT NULL,
  resource_id VARCHAR(120),
  payload JSON,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (organization_id) REFERENCES organizations(organization_id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS feature_flags (
  feature_key VARCHAR(80) PRIMARY KEY,
  label VARCHAR(160) NOT NULL,
  description TEXT,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS buildings (
  building_id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  address VARCHAR(255),
  description TEXT
);

CREATE TABLE IF NOT EXISTS floors (
  floor_id INT AUTO_INCREMENT PRIMARY KEY,
  building_id INT NOT NULL,
  name VARCHAR(100) NOT NULL,
  level INT NOT NULL DEFAULT 0,
  description TEXT,
  FOREIGN KEY (building_id) REFERENCES buildings(building_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS rooms (
  room_id INT AUTO_INCREMENT PRIMARY KEY,
  floor_id INT NOT NULL,
  name VARCHAR(100) NOT NULL,
  room_number VARCHAR(40),
  description TEXT,
  FOREIGN KEY (floor_id) REFERENCES floors(floor_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS zones (
  zone_id INT AUTO_INCREMENT PRIMARY KEY,
  building_id INT NOT NULL,
  floor_id INT DEFAULT NULL,
  room_id INT DEFAULT NULL,
  name VARCHAR(100) NOT NULL,
  description TEXT,
  FOREIGN KEY (building_id) REFERENCES buildings(building_id) ON DELETE CASCADE,
  CONSTRAINT fk_zones_floor_id FOREIGN KEY (floor_id) REFERENCES floors(floor_id) ON DELETE SET NULL,
  CONSTRAINT fk_zones_room_id FOREIGN KEY (room_id) REFERENCES rooms(room_id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS devices (
  device_id INT AUTO_INCREMENT PRIMARY KEY,
  zone_id INT NOT NULL,
  name VARCHAR(100) NOT NULL,
  type VARCHAR(50) NOT NULL,
  bacnet_instance INT NOT NULL,
  object_instance INT NOT NULL DEFAULT 1,
  object_type VARCHAR(50) NOT NULL,
  vendor VARCHAR(100),
  model VARCHAR(100),
  ip_address VARCHAR(50),
  present_value DOUBLE,
  units VARCHAR(50),
  status VARCHAR(50),
  description TEXT,
  provisioned BOOLEAN NOT NULL DEFAULT FALSE,
  commissioned BOOLEAN NOT NULL DEFAULT FALSE,
  configuration JSON,
  FOREIGN KEY (zone_id) REFERENCES zones(zone_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS roles (
  role_id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(64) NOT NULL UNIQUE,
  description TEXT,
  permissions JSON
);

CREATE TABLE IF NOT EXISTS users (
  user_id INT AUTO_INCREMENT PRIMARY KEY,
  organization_id INT NOT NULL DEFAULT 1,
  site_id INT DEFAULT NULL,
  username VARCHAR(64) NOT NULL UNIQUE,
  email VARCHAR(120),
  role_id INT DEFAULT NULL,
  password_hash VARCHAR(255) DEFAULT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_login_at TIMESTAMP NULL DEFAULT NULL,
  FOREIGN KEY (organization_id) REFERENCES organizations(organization_id) ON DELETE CASCADE,
  FOREIGN KEY (site_id) REFERENCES sites(site_id) ON DELETE SET NULL,
  FOREIGN KEY (role_id) REFERENCES roles(role_id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS user_sessions (
  session_id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  organization_id INT NOT NULL,
  site_id INT DEFAULT NULL,
  token_hash CHAR(64) NOT NULL UNIQUE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen_at TIMESTAMP NULL DEFAULT NULL,
  expires_at TIMESTAMP NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id) REFERENCES organizations(organization_id) ON DELETE CASCADE,
  FOREIGN KEY (site_id) REFERENCES sites(site_id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS schedules (
  schedule_id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  building_id INT DEFAULT NULL,
  zone_id INT DEFAULT NULL,
  device_id INT DEFAULT NULL,
  scope_type VARCHAR(20) NOT NULL DEFAULT 'building',
  recurrence VARCHAR(20) NOT NULL DEFAULT 'daily',
  month INT DEFAULT NULL,
  day_of_month INT DEFAULT NULL,
  override_priority INT NOT NULL DEFAULT 100,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  start_time TIME,
  end_time TIME,
  days VARCHAR(100),
  action VARCHAR(100) DEFAULT 'setpoint',
  target_value DOUBLE,
  units VARCHAR(50),
  description TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (building_id) REFERENCES buildings(building_id) ON DELETE CASCADE,
  FOREIGN KEY (zone_id) REFERENCES zones(zone_id) ON DELETE CASCADE,
  FOREIGN KEY (device_id) REFERENCES devices(device_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS holiday_schedules (
  holiday_id INT AUTO_INCREMENT PRIMARY KEY,
  building_id INT DEFAULT NULL,
  name VARCHAR(120) NOT NULL,
  event_date DATE DEFAULT NULL,
  month INT DEFAULT NULL,
  day_of_month INT DEFAULT NULL,
  recurring BOOLEAN NOT NULL DEFAULT TRUE,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  start_time TIME DEFAULT '00:00:00',
  end_time TIME DEFAULT '23:59:00',
  action VARCHAR(100) DEFAULT 'setpoint_bias',
  target_value DOUBLE,
  units VARCHAR(50),
  description TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (building_id) REFERENCES buildings(building_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS special_events (
  special_event_id INT AUTO_INCREMENT PRIMARY KEY,
  building_id INT DEFAULT NULL,
  zone_id INT DEFAULT NULL,
  device_id INT DEFAULT NULL,
  name VARCHAR(120) NOT NULL,
  start_at DATETIME NOT NULL,
  end_at DATETIME NOT NULL,
  priority INT NOT NULL DEFAULT 400,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  action VARCHAR(100) DEFAULT 'setpoint_bias',
  target_value DOUBLE,
  units VARCHAR(50),
  description TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (building_id) REFERENCES buildings(building_id) ON DELETE CASCADE,
  FOREIGN KEY (zone_id) REFERENCES zones(zone_id) ON DELETE CASCADE,
  FOREIGN KEY (device_id) REFERENCES devices(device_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS alarms (
  id INT AUTO_INCREMENT PRIMARY KEY,
  device_id INT,
  message TEXT,
  severity VARCHAR(50) NOT NULL DEFAULT 'critical',
  status VARCHAR(50) NOT NULL DEFAULT 'Active',
  acked BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (device_id) REFERENCES devices(device_id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS alarm_logs (
  alarm_log_id INT AUTO_INCREMENT PRIMARY KEY,
  alarm_id INT DEFAULT NULL,
  device_id INT DEFAULT NULL,
  event_type VARCHAR(50) NOT NULL,
  severity VARCHAR(50),
  status VARCHAR(50),
  actor VARCHAR(120),
  message TEXT,
  payload JSON,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (alarm_id) REFERENCES alarms(id) ON DELETE SET NULL,
  FOREIGN KEY (device_id) REFERENCES devices(device_id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS notification_outbox (
  notification_id BIGINT AUTO_INCREMENT PRIMARY KEY,
  channel VARCHAR(40) NOT NULL DEFAULT 'email',
  recipient VARCHAR(180) NOT NULL,
  subject VARCHAR(255) NOT NULL,
  body TEXT NOT NULL,
  severity VARCHAR(50),
  status VARCHAR(50) NOT NULL DEFAULT 'queued',
  related_alarm_id INT DEFAULT NULL,
  attempts INT NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  sent_at TIMESTAMP NULL DEFAULT NULL,
  FOREIGN KEY (related_alarm_id) REFERENCES alarms(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS trend_logs (
  trend_id BIGINT AUTO_INCREMENT PRIMARY KEY,
  building_id INT DEFAULT NULL,
  zone_id INT DEFAULT NULL,
  device_id INT DEFAULT NULL,
  object_type VARCHAR(50),
  object_instance INT DEFAULT NULL,
  metric_name VARCHAR(100) NOT NULL DEFAULT 'present_value',
  metric_value DOUBLE,
  units VARCHAR(50),
  source VARCHAR(100) NOT NULL DEFAULT 'telemetry_snapshot',
  logged_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (building_id) REFERENCES buildings(building_id) ON DELETE SET NULL,
  FOREIGN KEY (zone_id) REFERENCES zones(zone_id) ON DELETE SET NULL,
  FOREIGN KEY (device_id) REFERENCES devices(device_id) ON DELETE SET NULL,
  INDEX idx_trend_device_time (device_id, logged_at),
  INDEX idx_trend_zone_time (zone_id, logged_at),
  INDEX idx_trend_building_time (building_id, logged_at)
);

CREATE TABLE IF NOT EXISTS analytics_events (
  event_id INT AUTO_INCREMENT PRIMARY KEY,
  event_type VARCHAR(80) NOT NULL,
  building_id INT DEFAULT NULL,
  zone_id INT DEFAULT NULL,
  device_id INT DEFAULT NULL,
  metric_name VARCHAR(120),
  metric_value DOUBLE,
  payload JSON,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (building_id) REFERENCES buildings(building_id) ON DELETE SET NULL,
  FOREIGN KEY (zone_id) REFERENCES zones(zone_id) ON DELETE SET NULL,
  FOREIGN KEY (device_id) REFERENCES devices(device_id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS building_optimization_runs (
  run_id INT AUTO_INCREMENT PRIMARY KEY,
  profile VARCHAR(50) NOT NULL,
  objective JSON,
  recommendations JSON,
  estimated_savings_kwh DOUBLE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS rl_q_values (
  q_value_id INT AUTO_INCREMENT PRIMARY KEY,
  zone_id INT NOT NULL,
  action DOUBLE NOT NULL,
  q_value DOUBLE NOT NULL DEFAULT 0,
  sample_count INT NOT NULL DEFAULT 0,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_rl_zone_action (zone_id, action),
  FOREIGN KEY (zone_id) REFERENCES zones(zone_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS optimization_history (
  history_id INT AUTO_INCREMENT PRIMARY KEY,
  source VARCHAR(80) NOT NULL,
  profile VARCHAR(50),
  mode JSON,
  objective JSON,
  recommendations JSON,
  estimated_savings_kwh DOUBLE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS fdd_findings (
  finding_id INT AUTO_INCREMENT PRIMARY KEY,
  device_id INT DEFAULT NULL,
  zone_id INT DEFAULT NULL,
  severity VARCHAR(50) NOT NULL,
  fault_code VARCHAR(80) NOT NULL,
  message TEXT NOT NULL,
  status VARCHAR(50) NOT NULL DEFAULT 'open',
  payload JSON,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (device_id) REFERENCES devices(device_id) ON DELETE SET NULL,
  FOREIGN KEY (zone_id) REFERENCES zones(zone_id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS firmware_artifacts (
  artifact_id INT AUTO_INCREMENT PRIMARY KEY,
  version VARCHAR(80) NOT NULL,
  channel VARCHAR(40) NOT NULL DEFAULT 'stable',
  artifact_uri TEXT NOT NULL,
  checksum CHAR(64) NOT NULL,
  signature TEXT NOT NULL,
  signing_key_id VARCHAR(80) NOT NULL DEFAULT 'default',
  manifest JSON,
  created_by VARCHAR(120),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_firmware_artifact_version_channel (version, channel)
);

CREATE TABLE IF NOT EXISTS firmware_update_jobs (
  ota_job_id INT AUTO_INCREMENT PRIMARY KEY,
  device_id INT NOT NULL,
  artifact_id INT NOT NULL,
  status VARCHAR(40) NOT NULL DEFAULT 'queued',
  requested_by VARCHAR(120),
  requested_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  staged_at TIMESTAMP NULL DEFAULT NULL,
  applied_at TIMESTAMP NULL DEFAULT NULL,
  rollback_allowed BOOLEAN NOT NULL DEFAULT TRUE,
  manifest JSON,
  last_error TEXT,
  FOREIGN KEY (device_id) REFERENCES devices(device_id) ON DELETE CASCADE,
  FOREIGN KEY (artifact_id) REFERENCES firmware_artifacts(artifact_id) ON DELETE CASCADE,
  INDEX idx_firmware_jobs_device_status (device_id, status)
);

CREATE TABLE IF NOT EXISTS report_schedules (
  report_schedule_id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(160) NOT NULL,
  report_type VARCHAR(50) NOT NULL DEFAULT 'energy',
  cadence VARCHAR(40) NOT NULL DEFAULT 'weekly',
  recipients JSON,
  filters JSON,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_by VARCHAR(120),
  last_run_at TIMESTAMP NULL DEFAULT NULL,
  next_run_at TIMESTAMP NULL DEFAULT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS report_exports (
  report_export_id INT AUTO_INCREMENT PRIMARY KEY,
  report_type VARCHAR(50) NOT NULL,
  format VARCHAR(20) NOT NULL,
  filters JSON,
  status VARCHAR(40) NOT NULL DEFAULT 'ready',
  download_path TEXT,
  requested_by VARCHAR(120),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS report_schedule_runs (
  report_schedule_run_id INT AUTO_INCREMENT PRIMARY KEY,
  report_schedule_id INT NOT NULL,
  report_export_id INT DEFAULT NULL,
  status VARCHAR(40) NOT NULL DEFAULT 'queued',
  recipients JSON,
  message TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (report_schedule_id) REFERENCES report_schedules(report_schedule_id) ON DELETE CASCADE,
  FOREIGN KEY (report_export_id) REFERENCES report_exports(report_export_id) ON DELETE SET NULL,
  INDEX idx_report_schedule_runs_schedule_time (report_schedule_id, created_at)
);

CREATE TABLE IF NOT EXISTS maintenance_tickets (
  ticket_id INT AUTO_INCREMENT PRIMARY KEY,
  finding_id INT DEFAULT NULL,
  device_id INT DEFAULT NULL,
  title VARCHAR(180) NOT NULL,
  description TEXT,
  priority VARCHAR(50) NOT NULL DEFAULT 'medium',
  status VARCHAR(50) NOT NULL DEFAULT 'open',
  assigned_to VARCHAR(120),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (finding_id) REFERENCES fdd_findings(finding_id) ON DELETE SET NULL,
  FOREIGN KEY (device_id) REFERENCES devices(device_id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS maintenance_modes (
  maintenance_mode_id INT AUTO_INCREMENT PRIMARY KEY,
  scope_type VARCHAR(20) NOT NULL,
  building_id INT DEFAULT NULL,
  zone_id INT DEFAULT NULL,
  device_id INT DEFAULT NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  reason TEXT,
  started_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ends_at TIMESTAMP NULL DEFAULT NULL,
  created_by VARCHAR(120),
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (building_id) REFERENCES buildings(building_id) ON DELETE CASCADE,
  FOREIGN KEY (zone_id) REFERENCES zones(zone_id) ON DELETE CASCADE,
  FOREIGN KEY (device_id) REFERENCES devices(device_id) ON DELETE CASCADE
);

INSERT INTO organizations (organization_id, name, slug, plan, status) VALUES
  (1, 'Acme Facilities', 'acme-facilities', 'enterprise', 'active');

INSERT INTO sites (site_id, organization_id, name, timezone, edge_gateway_id, status) VALUES
  (1, 1, 'Main Campus', 'America/New_York', 'edge-imx93-main', 'active'),
  (2, 1, 'Research Annex', 'America/New_York', 'edge-imx93-annex', 'active');

INSERT INTO buildings (name, address, description) VALUES
  ('Tower A', '123 Main St', 'Main office tower'),
  ('Tower B', '456 Market Ave', 'Secondary building');

INSERT INTO floors (building_id, name, level, description) VALUES
  (1, 'Ground Floor', 0, 'Tower A public lobby and entry floor'),
  (1, 'Floor 1', 1, 'Tower A first occupied office floor'),
  (1, 'Floor 2', 2, 'Tower A second occupied office floor'),
  (2, 'Ground Floor', 0, 'Tower B lobby and shared services floor'),
  (2, 'Floor 1', 1, 'Tower B first occupied floor');

INSERT INTO rooms (floor_id, name, room_number, description) VALUES
  (1, 'Main Lobby', 'A-000', 'Public lobby and reception'),
  (2, 'Open Office East', 'A-101', 'First floor office zone'),
  (3, 'Open Office West', 'A-201', 'Second floor office zone'),
  (4, 'Tower B Lobby', 'B-000', 'Secondary lobby'),
  (5, 'Mechanical Room', 'B-101', 'Tower B floor 1 HVAC equipment room');

INSERT INTO zones (building_id, floor_id, room_id, name, description) VALUES
  (1, 1, 1, 'Lobby', 'Main lobby area'),
  (1, 2, 2, 'Floor 1 East', 'First floor east thermal zone'),
  (1, 3, 3, 'Floor 2 West', 'Second floor west thermal zone'),
  (2, 4, 4, 'Lobby', 'Secondary lobby'),
  (2, 5, 5, 'Mechanical', 'First floor mechanical zone');

INSERT INTO devices (zone_id, name, type, bacnet_instance, object_instance, object_type, vendor, model, ip_address, present_value, units, status, description, configuration) VALUES
  (1, 'Lobby Temp Sensor', 'Analog Input', 101, 1, 'analogInput', 'VendorA', 'TS-100', '192.168.1.11', 22.5, 'Celsius', 'Normal', 'Room lobby temperature sensor', JSON_OBJECT('setpoint', 22.0, 'minSetpoint', 19.0, 'maxSetpoint', 25.0)),
  (2, 'Floor 1 VAV', 'Analog Output', 102, 1, 'analogOutput', 'VendorA', 'VAV-200', '192.168.1.12', 58.0, 'Percent', 'Normal', 'Zone airflow VAV unit', JSON_OBJECT('setpoint', 55.0, 'minSetpoint', 35.0, 'maxSetpoint', 80.0, 'bacnetScheduleStorage', JSON_OBJECT('enabled', true, 'persistentOnDevice', true, 'objectType', 'schedule', 'storagePolicy', 'device_resident', 'writePath', 'BACnet WriteProperty to the device Schedule object', 'scheduleCount', 1, 'schedules', JSON_ARRAY(JSON_OBJECT('name', 'Morning warm-up', 'enabled', true, 'recurrence', 'daily', 'startTime', '06:00:00', 'endTime', '08:00:00', 'days', 'Mon,Tue,Wed,Thu,Fri', 'action', 'setpoint', 'targetValue', 55.0, 'units', 'Percent'))))),
  (2, 'Floor 1 Fan', 'Binary Output', 201, 1, 'binaryOutput', 'VendorB', 'FAN-75', '192.168.1.13', NULL, 'On/Off', 'On', 'Fan control for floor 1', JSON_OBJECT('setpoint', 1.0, 'minSetpoint', 0.0, 'maxSetpoint', 1.0)),
  (3, 'Floor 2 Temp Sensor', 'Analog Input', 103, 1, 'analogInput', 'VendorB', 'TS-200', '192.168.1.14', 21.8, 'Celsius', 'Normal', 'Floor 2 temperature sensor', JSON_OBJECT('setpoint', 22.0, 'minSetpoint', 19.0, 'maxSetpoint', 25.0)),
  (4, 'Tower B Lobby Light', 'Binary Output', 301, 1, 'binaryOutput', 'VendorC', 'LIGHT-50', '192.168.2.11', NULL, 'On/Off', 'Off', 'Lighting relay in Tower B lobby', JSON_OBJECT('setpoint', 0.0, 'minSetpoint', 0.0, 'maxSetpoint', 1.0)),
  (5, 'Tower B Floor 1 Damper', 'Analog Output', 302, 1, 'analogOutput', 'VendorC', 'DAMPER-30', '192.168.2.12', 42.0, 'Percent', 'Normal', 'Zone damper actuator for Tower B floor 1', JSON_OBJECT('setpoint', 45.0, 'minSetpoint', 20.0, 'maxSetpoint', 90.0)),
  (1, 'nRF52840 Lobby Temp BACnet Device', 'BACnet Device', 401, 1, 'analogInput', 'Nordic Semiconductor', 'nRF52840', 'wireless-bacnet-1', 22.3, 'Celsius', 'Normal', 'nRF52840 BACnet temperature device using wireless transport and direct BACnet objects', JSON_OBJECT('sourceProtocol', 'BACnet nRF52840', 'chipset', 'nRF52840', 'transport', 'Wireless BLE/Thread/802.15.4 bridge', 'bacnetDevice', true, 'batteryPercent', 91, 'firmware', 'bems-bacnet-node-1.0.0', 'normalizedAs', 'BACnet Analog Input present-value')),
  (2, 'nRF52840 Wired Occupancy BACnet Device', 'BACnet Device', 402, 1, 'binaryInput', 'Nordic Semiconductor', 'nRF52840', 'mstp-trunk-1', 1.0, 'Occupied', 'Normal', 'nRF52840 BACnet occupancy device using wired field transport and direct BACnet objects', JSON_OBJECT('sourceProtocol', 'BACnet nRF52840', 'chipset', 'nRF52840', 'transport', 'Wired BACnet MS/TP or EIA-485 adapter', 'bacnetDevice', true, 'batteryPercent', 100, 'firmware', 'bems-bacnet-node-1.0.0', 'normalizedAs', 'BACnet Binary Input present-value')),
  (5, 'Main Switchboard 5-in-1 Power Meter', 'Power Meter', 501, 1, 'analogValue', 'VendorPower', 'PM-5IN1', '192.168.2.50', 128.4, 'kW', 'Normal', 'Field-selectable BACnet/Modbus/REST power meter with Ethernet, EIA-485, pulse output, and pulse inputs', JSON_OBJECT('sourceProtocol', 'Field Selectable Power Meter', 'communicationProfile', '5-in-1', 'fieldSelectableProtocols', JSON_ARRAY('BACnet/IP', 'BACnet/IPv6', 'Modbus TCP', 'Modbus RTU over EIA-485', 'REST API'), 'serialInterface', 'EIA-485', 'ethernetProtocols', JSON_ARRAY('BACnet/IP', 'Modbus TCP'), 'pulseOutputCount', 1, 'pulseInputCount', 2, 'pulseInputs', JSON_ARRAY('water_meter_pulse', 'gas_meter_pulse'), 'pulseOutput', 'energy_totalizer_kwh', 'normalizedAs', 'BACnet Analog Value present-value'));

INSERT INTO roles (name, description, permissions) VALUES
  ('Admin', 'Full system administration and configuration access.', JSON_ARRAY('devices:manage', 'users:manage', 'roles:manage', 'alarms:manage', 'schedules:manage', 'reports:view', 'reports:export', 'reports:manage')),
  ('Operator', 'Day-to-day operations and commissioning access.', JSON_ARRAY('devices:manage', 'alarms:manage', 'schedules:view', 'reports:view', 'reports:export')),
  ('Viewer', 'Read-only access to dashboards and reporting.', JSON_ARRAY('devices:view', 'alarms:view', 'schedules:view', 'reports:view'));

INSERT INTO users (user_id, organization_id, site_id, username, email, role_id, password_hash, active) VALUES
  (1, 1, 1, 'admin', 'admin@example.com', 1, 'scrypt$16384$8$1$YmVtcy1kZXYtYWRtaW4tc2FsdA$-haED76r128QZkKBWcY6cchzGbho6Ng8Pc7n526cpQV3AAC9Zazm_sKnYPGpGn5oKsIKvolIkZHQnMi4odnZ3g', TRUE);

INSERT INTO schedules (name, building_id, zone_id, device_id, scope_type, recurrence, month, day_of_month, override_priority, enabled, start_time, end_time, days, action, target_value, units, description) VALUES
  ('Morning warm-up', 1, 2, 2, 'device', 'daily', NULL, NULL, 300, TRUE, '06:00:00', '08:00:00', 'Mon,Tue,Wed,Thu,Fri', 'setpoint', 55.0, 'Percent', 'Device-level warm-up override for Floor 1 VAV'),
  ('Demand response shed', 1, NULL, NULL, 'building', 'daily', NULL, NULL, 100, TRUE, '15:00:00', '18:00:00', 'Mon,Tue,Wed,Thu,Fri', 'setpoint_bias', 1.5, 'Celsius', 'Building-level peak-period conservative profile adjustment'),
  ('Monthly IAQ flush', 1, 2, NULL, 'zone', 'monthly', NULL, 1, 200, TRUE, '05:00:00', '06:00:00', 'Mon,Tue,Wed,Thu,Fri,Sat,Sun', 'ventilation_flush', 1.0, 'cycle', 'Monthly zone override for fresh-air purge'),
  ('Yearly holiday setback', 1, NULL, NULL, 'building', 'yearly', 1, 1, 100, TRUE, '00:00:00', '23:59:00', 'Mon,Tue,Wed,Thu,Fri,Sat,Sun', 'setpoint_bias', 2.0, 'Celsius', 'Yearly building holiday setback');

INSERT INTO holiday_schedules (building_id, name, event_date, month, day_of_month, recurring, enabled, start_time, end_time, action, target_value, units, description) VALUES
  (1, 'New Year setback', NULL, 1, 1, TRUE, TRUE, '00:00:00', '23:59:00', 'setpoint_bias', 2.0, 'Celsius', 'Recurring holiday schedule for New Year operation');

INSERT INTO special_events (building_id, zone_id, device_id, name, start_at, end_at, priority, enabled, action, target_value, units, description) VALUES
  (1, 2, NULL, 'After-hours auditorium event', '2026-06-15 18:00:00', '2026-06-15 22:00:00', 400, TRUE, 'setpoint', 22.0, 'Celsius', 'Special occupancy event for zone comfort override');
