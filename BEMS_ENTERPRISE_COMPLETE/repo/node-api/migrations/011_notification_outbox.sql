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
