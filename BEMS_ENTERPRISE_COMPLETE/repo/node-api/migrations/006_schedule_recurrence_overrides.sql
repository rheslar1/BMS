SET @add_schedule_scope_type = (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE schedules ADD COLUMN scope_type VARCHAR(20) NOT NULL DEFAULT ''building''',
    'SELECT 1'
  )
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'schedules'
    AND COLUMN_NAME = 'scope_type'
);

PREPARE schedule_scope_type_stmt FROM @add_schedule_scope_type;
EXECUTE schedule_scope_type_stmt;
DEALLOCATE PREPARE schedule_scope_type_stmt;

SET @add_schedule_recurrence = (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE schedules ADD COLUMN recurrence VARCHAR(20) NOT NULL DEFAULT ''daily''',
    'SELECT 1'
  )
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'schedules'
    AND COLUMN_NAME = 'recurrence'
);

PREPARE schedule_recurrence_stmt FROM @add_schedule_recurrence;
EXECUTE schedule_recurrence_stmt;
DEALLOCATE PREPARE schedule_recurrence_stmt;

SET @add_schedule_month = (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE schedules ADD COLUMN month INT DEFAULT NULL',
    'SELECT 1'
  )
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'schedules'
    AND COLUMN_NAME = 'month'
);

PREPARE schedule_month_stmt FROM @add_schedule_month;
EXECUTE schedule_month_stmt;
DEALLOCATE PREPARE schedule_month_stmt;

SET @add_schedule_day_of_month = (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE schedules ADD COLUMN day_of_month INT DEFAULT NULL',
    'SELECT 1'
  )
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'schedules'
    AND COLUMN_NAME = 'day_of_month'
);

PREPARE schedule_day_of_month_stmt FROM @add_schedule_day_of_month;
EXECUTE schedule_day_of_month_stmt;
DEALLOCATE PREPARE schedule_day_of_month_stmt;

SET @add_schedule_override_priority = (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE schedules ADD COLUMN override_priority INT NOT NULL DEFAULT 100',
    'SELECT 1'
  )
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'schedules'
    AND COLUMN_NAME = 'override_priority'
);

PREPARE schedule_override_priority_stmt FROM @add_schedule_override_priority;
EXECUTE schedule_override_priority_stmt;
DEALLOCATE PREPARE schedule_override_priority_stmt;

UPDATE schedules
SET scope_type = CASE
      WHEN device_id IS NOT NULL THEN 'device'
      WHEN zone_id IS NOT NULL THEN 'zone'
      WHEN building_id IS NOT NULL THEN 'building'
      ELSE 'global'
    END,
    recurrence = COALESCE(NULLIF(recurrence, ''), 'daily'),
    override_priority = CASE
      WHEN device_id IS NOT NULL THEN 300
      WHEN zone_id IS NOT NULL THEN 200
      WHEN building_id IS NOT NULL THEN 100
      ELSE 0
    END;

INSERT INTO schedules
  (name, building_id, zone_id, device_id, scope_type, recurrence, month, day_of_month, override_priority, enabled, start_time, end_time, days, action, target_value, units, description)
SELECT 'Monthly IAQ flush', 1, 2, NULL, 'zone', 'monthly', NULL, 1, 200, TRUE, '05:00:00', '06:00:00', 'Mon,Tue,Wed,Thu,Fri,Sat,Sun', 'ventilation_flush', 1.0, 'cycle', 'Monthly zone override for fresh-air purge'
WHERE NOT EXISTS (
  SELECT 1 FROM schedules WHERE name = 'Monthly IAQ flush'
);

INSERT INTO schedules
  (name, building_id, zone_id, device_id, scope_type, recurrence, month, day_of_month, override_priority, enabled, start_time, end_time, days, action, target_value, units, description)
SELECT 'Yearly holiday setback', 1, NULL, NULL, 'building', 'yearly', 1, 1, 100, TRUE, '00:00:00', '23:59:00', 'Mon,Tue,Wed,Thu,Fri,Sat,Sun', 'setpoint_bias', 2.0, 'Celsius', 'Yearly building holiday setback'
WHERE NOT EXISTS (
  SELECT 1 FROM schedules WHERE name = 'Yearly holiday setback'
);
