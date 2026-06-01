UPDATE devices
SET
  name = 'nRF52840 Lobby Temp BACnet Device',
  type = 'BACnet Device',
  ip_address = 'wireless-bacnet-1',
  description = 'nRF52840 BACnet temperature device using wireless transport and direct BACnet objects',
  configuration = JSON_OBJECT(
    'sourceProtocol', 'BACnet nRF52840',
    'chipset', 'nRF52840',
    'transport', 'Wireless BLE/Thread/802.15.4 bridge',
    'bacnetDevice', true,
    'batteryPercent', 91,
    'firmware', 'bems-bacnet-node-1.0.0',
    'normalizedAs', 'BACnet Analog Input present-value'
  )
WHERE name IN ('nRF52840 Lobby Temp Node', 'nRF52840 Lobby Temp BACnet Device')
  AND bacnet_instance = 401;

UPDATE devices
SET
  name = 'nRF52840 Wired Occupancy BACnet Device',
  type = 'BACnet Device',
  ip_address = 'mstp-trunk-1',
  description = 'nRF52840 BACnet occupancy device using wired field transport and direct BACnet objects',
  configuration = JSON_OBJECT(
    'sourceProtocol', 'BACnet nRF52840',
    'chipset', 'nRF52840',
    'transport', 'Wired BACnet MS/TP or EIA-485 adapter',
    'bacnetDevice', true,
    'batteryPercent', 100,
    'firmware', 'bems-bacnet-node-1.0.0',
    'normalizedAs', 'BACnet Binary Input present-value'
  )
WHERE name IN ('nRF52840 Occupancy Node', 'nRF52840 Wired Occupancy BACnet Device')
  AND bacnet_instance = 402;
