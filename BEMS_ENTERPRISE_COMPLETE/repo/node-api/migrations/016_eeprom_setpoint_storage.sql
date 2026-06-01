UPDATE devices
SET configuration = JSON_SET(
  COALESCE(configuration, JSON_OBJECT()),
  '$.eepromEnabled', TRUE,
  '$.eepromAddress', COALESCE(JSON_UNQUOTE(JSON_EXTRACT(configuration, '$.eepromAddress')), '0x0100'),
  '$.eepromSizeBytes', COALESCE(JSON_EXTRACT(configuration, '$.eepromSizeBytes'), 256),
  '$.eepromWritePolicy', COALESCE(JSON_UNQUOTE(JSON_EXTRACT(configuration, '$.eepromWritePolicy')), 'on_change'),
  '$.setpointStorage',
  JSON_OBJECT(
    'address', COALESCE(JSON_UNQUOTE(JSON_EXTRACT(configuration, '$.eepromAddress')), '0x0100'),
    'sizeBytes', COALESCE(JSON_EXTRACT(configuration, '$.eepromSizeBytes'), 256),
    'writePolicy', COALESCE(JSON_UNQUOTE(JSON_EXTRACT(configuration, '$.eepromWritePolicy')), 'on_change'),
    'retainedSetpoint', JSON_EXTRACT(configuration, '$.setpoint'),
    'checksum', 'crc16'
  )
)
WHERE JSON_EXTRACT(configuration, '$.setpoint') IS NOT NULL;
