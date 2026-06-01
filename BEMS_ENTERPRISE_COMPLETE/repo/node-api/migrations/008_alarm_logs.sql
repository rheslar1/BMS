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

INSERT INTO alarm_logs (alarm_id, device_id, event_type, severity, status, actor, message, payload, created_at)
SELECT a.id,
       a.device_id,
       'created',
       a.severity,
       a.status,
       'migration',
       a.message,
       JSON_OBJECT('source', 'existing_alarm_backfill', 'acked', a.acked),
       a.created_at
FROM alarms a
WHERE NOT EXISTS (
  SELECT 1 FROM alarm_logs l WHERE l.alarm_id = a.id AND l.event_type = 'created'
);
