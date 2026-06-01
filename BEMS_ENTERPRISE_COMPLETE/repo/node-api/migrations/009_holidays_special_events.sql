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

INSERT INTO holiday_schedules
  (building_id, name, event_date, month, day_of_month, recurring, enabled, start_time, end_time, action, target_value, units, description)
SELECT 1, 'New Year setback', NULL, 1, 1, TRUE, TRUE, '00:00:00', '23:59:00', 'setpoint_bias', 2.0, 'Celsius', 'Recurring holiday schedule for New Year operation'
WHERE NOT EXISTS (
  SELECT 1 FROM holiday_schedules WHERE name = 'New Year setback'
);

INSERT INTO special_events
  (building_id, zone_id, device_id, name, start_at, end_at, priority, enabled, action, target_value, units, description)
SELECT 1, 2, NULL, 'After-hours auditorium event', '2026-06-15 18:00:00', '2026-06-15 22:00:00', 400, TRUE, 'setpoint', 22.0, 'Celsius', 'Special occupancy event for zone comfort override'
WHERE NOT EXISTS (
  SELECT 1 FROM special_events WHERE name = 'After-hours auditorium event'
);
