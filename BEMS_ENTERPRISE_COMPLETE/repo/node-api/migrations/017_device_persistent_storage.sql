UPDATE devices
SET configuration = JSON_SET(
  COALESCE(configuration, JSON_OBJECT()),
  '$.persistentStorage',
  JSON_OBJECT(
    'enabled', TRUE,
    'medium', COALESCE(JSON_UNQUOTE(JSON_EXTRACT(configuration, '$.persistentStorage.medium')), 'EEPROM'),
    'namespace', COALESCE(JSON_UNQUOTE(JSON_EXTRACT(configuration, '$.persistentStorage.namespace')), 'device_config'),
    'wearLeveling', TRUE,
    'retainedKeys', JSON_ARRAY('identity', 'commissioning', 'setpoint', 'schedule', 'range', 'calibration', 'counters')
  )
)
WHERE JSON_EXTRACT(configuration, '$.persistentStorage') IS NULL;
