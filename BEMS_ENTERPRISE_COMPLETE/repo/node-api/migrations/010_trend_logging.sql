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
