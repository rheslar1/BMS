CREATE DATABASE IF NOT EXISTS bems;
USE bems;

CREATE TABLE IF NOT EXISTS buildings (
  building_id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  address VARCHAR(255),
  description TEXT
);

CREATE TABLE IF NOT EXISTS zones (
  zone_id INT AUTO_INCREMENT PRIMARY KEY,
  building_id INT NOT NULL,
  name VARCHAR(100) NOT NULL,
  description TEXT,
  FOREIGN KEY (building_id) REFERENCES buildings(building_id) ON DELETE CASCADE
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
  username VARCHAR(64) NOT NULL UNIQUE,
  email VARCHAR(120),
  role_id INT DEFAULT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (role_id) REFERENCES roles(role_id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS schedules (
  schedule_id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  building_id INT DEFAULT NULL,
  zone_id INT DEFAULT NULL,
  device_id INT DEFAULT NULL,
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

INSERT INTO buildings (name, address, description) VALUES
  ('Tower A', '123 Main St', 'Main office tower'),
  ('Tower B', '456 Market Ave', 'Secondary building');

INSERT INTO zones (building_id, name, description) VALUES
  (1, 'Lobby', 'Main lobby area'),
  (1, 'Floor 1', 'First floor zone'),
  (1, 'Floor 2', 'Second floor zone'),
  (2, 'Lobby', 'Secondary lobby'),
  (2, 'Floor 1', 'First floor zone');

INSERT INTO devices (zone_id, name, type, bacnet_instance, object_instance, object_type, vendor, model, ip_address, present_value, units, status, description, configuration) VALUES
  (1, 'Lobby Temp Sensor', 'Analog Input', 101, 1, 'analogInput', 'VendorA', 'TS-100', '192.168.1.11', 22.5, 'Celsius', 'Normal', 'Room lobby temperature sensor', JSON_OBJECT('setpoint', 22.0, 'minSetpoint', 19.0, 'maxSetpoint', 25.0)),
  (2, 'Floor 1 VAV', 'Analog Output', 102, 1, 'analogOutput', 'VendorA', 'VAV-200', '192.168.1.12', 58.0, 'Percent', 'Normal', 'Zone airflow VAV unit', JSON_OBJECT('setpoint', 55.0, 'minSetpoint', 35.0, 'maxSetpoint', 80.0)),
  (2, 'Floor 1 Fan', 'Binary Output', 201, 1, 'binaryOutput', 'VendorB', 'FAN-75', '192.168.1.13', NULL, 'On/Off', 'On', 'Fan control for floor 1', JSON_OBJECT('setpoint', 1.0, 'minSetpoint', 0.0, 'maxSetpoint', 1.0)),
  (3, 'Floor 2 Temp Sensor', 'Analog Input', 103, 1, 'analogInput', 'VendorB', 'TS-200', '192.168.1.14', 21.8, 'Celsius', 'Normal', 'Floor 2 temperature sensor', JSON_OBJECT('setpoint', 22.0, 'minSetpoint', 19.0, 'maxSetpoint', 25.0)),
  (4, 'Tower B Lobby Light', 'Binary Output', 301, 1, 'binaryOutput', 'VendorC', 'LIGHT-50', '192.168.2.11', NULL, 'On/Off', 'Off', 'Lighting relay in Tower B lobby', JSON_OBJECT('setpoint', 0.0, 'minSetpoint', 0.0, 'maxSetpoint', 1.0)),
  (5, 'Tower B Floor 1 Damper', 'Analog Output', 302, 1, 'analogOutput', 'VendorC', 'DAMPER-30', '192.168.2.12', 42.0, 'Percent', 'Normal', 'Zone damper actuator for Tower B floor 1', JSON_OBJECT('setpoint', 45.0, 'minSetpoint', 20.0, 'maxSetpoint', 90.0));

INSERT INTO roles (name, description, permissions) VALUES
  ('Admin', 'Full system administration and configuration access.', JSON_ARRAY('devices:manage', 'users:manage', 'roles:manage', 'alarms:manage', 'schedules:manage')),
  ('Operator', 'Day-to-day operations and commissioning access.', JSON_ARRAY('devices:manage', 'alarms:manage', 'schedules:view')),
  ('Viewer', 'Read-only access to dashboards and reporting.', JSON_ARRAY('devices:view', 'alarms:view', 'schedules:view'));

INSERT INTO schedules (name, building_id, zone_id, device_id, enabled, start_time, end_time, days, action, target_value, units, description) VALUES
  ('Morning warm-up', 1, 2, 2, TRUE, '06:00:00', '08:00:00', 'Mon,Tue,Wed,Thu,Fri', 'setpoint', 55.0, 'Percent', 'Pre-occupancy airflow warm-up for Floor 1'),
  ('Demand response shed', 1, NULL, NULL, TRUE, '15:00:00', '18:00:00', 'Mon,Tue,Wed,Thu,Fri', 'setpoint_bias', 1.5, 'Celsius', 'Peak-period conservative profile adjustment');
