UPDATE devices d
JOIN schedules s ON s.device_id = d.device_id
SET d.configuration = JSON_SET(
  COALESCE(d.configuration, JSON_OBJECT()),
  '$.persistentStorage',
  JSON_OBJECT(
    'enabled', true,
    'medium', COALESCE(JSON_UNQUOTE(JSON_EXTRACT(d.configuration, '$.persistentStorage.medium')), 'EEPROM'),
    'namespace', COALESCE(JSON_UNQUOTE(JSON_EXTRACT(d.configuration, '$.persistentStorage.namespace')), 'device_config'),
    'wearLeveling', COALESCE(JSON_EXTRACT(d.configuration, '$.persistentStorage.wearLeveling'), true),
    'retainedKeys', JSON_ARRAY('identity', 'commissioning', 'setpoint', 'schedule', 'range', 'calibration', 'counters')
  ),
  '$.bacnetScheduleStorage',
  JSON_OBJECT(
    'enabled', true,
    'persistentOnDevice', true,
    'objectType', 'schedule',
    'storagePolicy', 'device_resident',
    'writePath', 'BACnet WriteProperty to the device Schedule object',
    'scheduleCount', 1,
    'lastSyncedAt', CURRENT_TIMESTAMP,
    'schedules', JSON_ARRAY(JSON_OBJECT(
      'id', s.schedule_id,
      'name', s.name,
      'enabled', s.enabled = 1,
      'recurrence', s.recurrence,
      'month', s.month,
      'dayOfMonth', s.day_of_month,
      'startTime', s.start_time,
      'endTime', s.end_time,
      'days', s.days,
      'action', s.action,
      'targetValue', s.target_value,
      'units', s.units,
      'overridePriority', s.override_priority,
      'objectType', 'schedule',
      'persistentOnBacnetDevice', true
    ))
  )
)
WHERE s.scope_type = 'device';
