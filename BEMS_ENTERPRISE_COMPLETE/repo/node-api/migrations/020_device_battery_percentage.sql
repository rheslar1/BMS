UPDATE devices
SET configuration = JSON_SET(COALESCE(configuration, JSON_OBJECT()), '$.batteryPercent', 91)
WHERE name = 'nRF52840 Lobby Temp BACnet Device'
  AND JSON_EXTRACT(COALESCE(configuration, JSON_OBJECT()), '$.batteryPercent') IS NULL;

UPDATE devices
SET configuration = JSON_SET(COALESCE(configuration, JSON_OBJECT()), '$.batteryPercent', 100)
WHERE name = 'nRF52840 Wired Occupancy BACnet Device'
  AND JSON_EXTRACT(COALESCE(configuration, JSON_OBJECT()), '$.batteryPercent') IS NULL;
