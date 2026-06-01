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

UPDATE roles
SET permissions = JSON_ARRAY_APPEND(permissions, '$', 'reports:view')
WHERE JSON_CONTAINS(permissions, JSON_QUOTE('reports:view')) = 0
  AND (name IN ('Admin', 'Operator', 'Viewer') OR JSON_CONTAINS(permissions, JSON_QUOTE('*')));

UPDATE roles
SET permissions = JSON_ARRAY_APPEND(permissions, '$', 'reports:export')
WHERE JSON_CONTAINS(permissions, JSON_QUOTE('reports:export')) = 0
  AND name IN ('Admin', 'Operator');

UPDATE roles
SET permissions = JSON_ARRAY_APPEND(permissions, '$', 'reports:manage')
WHERE JSON_CONTAINS(permissions, JSON_QUOTE('reports:manage')) = 0
  AND name = 'Admin';
