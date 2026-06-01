SET @sql = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'report_schedules' AND COLUMN_NAME = 'last_run_at') = 0, 'ALTER TABLE report_schedules ADD COLUMN last_run_at TIMESTAMP NULL DEFAULT NULL', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'report_schedules' AND COLUMN_NAME = 'next_run_at') = 0, 'ALTER TABLE report_schedules ADD COLUMN next_run_at TIMESTAMP NULL DEFAULT NULL', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

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
