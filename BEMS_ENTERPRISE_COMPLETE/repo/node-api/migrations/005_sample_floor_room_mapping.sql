UPDATE floors f
JOIN buildings b ON f.building_id = b.building_id
SET f.description = 'Tower A public lobby and entry floor'
WHERE b.name = 'Tower A'
  AND f.name = 'Ground Floor';

UPDATE floors f
JOIN buildings b ON f.building_id = b.building_id
SET f.description = 'Tower B lobby and shared services floor'
WHERE b.name = 'Tower B'
  AND f.name = 'Ground Floor';

INSERT INTO floors (building_id, name, level, description)
SELECT b.building_id, 'Floor 1', 1, 'Tower A first occupied office floor'
FROM buildings b
WHERE b.name = 'Tower A'
  AND NOT EXISTS (
    SELECT 1 FROM floors f WHERE f.building_id = b.building_id AND f.name = 'Floor 1'
  );

INSERT INTO floors (building_id, name, level, description)
SELECT b.building_id, 'Floor 2', 2, 'Tower A second occupied office floor'
FROM buildings b
WHERE b.name = 'Tower A'
  AND NOT EXISTS (
    SELECT 1 FROM floors f WHERE f.building_id = b.building_id AND f.name = 'Floor 2'
  );

INSERT INTO floors (building_id, name, level, description)
SELECT b.building_id, 'Floor 1', 1, 'Tower B first occupied floor'
FROM buildings b
WHERE b.name = 'Tower B'
  AND NOT EXISTS (
    SELECT 1 FROM floors f WHERE f.building_id = b.building_id AND f.name = 'Floor 1'
  );

UPDATE rooms r
JOIN floors f ON r.floor_id = f.floor_id
JOIN buildings b ON f.building_id = b.building_id
SET r.name = 'Main Lobby',
    r.room_number = 'A-000',
    r.description = 'Public lobby and reception'
WHERE b.name = 'Tower A'
  AND f.name = 'Ground Floor'
  AND r.name = 'Default Room';

UPDATE rooms r
JOIN floors f ON r.floor_id = f.floor_id
JOIN buildings b ON f.building_id = b.building_id
SET r.name = 'Tower B Lobby',
    r.room_number = 'B-000',
    r.description = 'Secondary lobby'
WHERE b.name = 'Tower B'
  AND f.name = 'Ground Floor'
  AND r.name = 'Default Room';

INSERT INTO rooms (floor_id, name, room_number, description)
SELECT f.floor_id, 'Open Office East', 'A-101', 'First floor office zone'
FROM floors f
JOIN buildings b ON f.building_id = b.building_id
WHERE b.name = 'Tower A'
  AND f.name = 'Floor 1'
  AND NOT EXISTS (
    SELECT 1 FROM rooms r WHERE r.floor_id = f.floor_id AND r.room_number = 'A-101'
  );

INSERT INTO rooms (floor_id, name, room_number, description)
SELECT f.floor_id, 'Open Office West', 'A-201', 'Second floor office zone'
FROM floors f
JOIN buildings b ON f.building_id = b.building_id
WHERE b.name = 'Tower A'
  AND f.name = 'Floor 2'
  AND NOT EXISTS (
    SELECT 1 FROM rooms r WHERE r.floor_id = f.floor_id AND r.room_number = 'A-201'
  );

INSERT INTO rooms (floor_id, name, room_number, description)
SELECT f.floor_id, 'Mechanical Room', 'B-101', 'Tower B floor 1 HVAC equipment room'
FROM floors f
JOIN buildings b ON f.building_id = b.building_id
WHERE b.name = 'Tower B'
  AND f.name = 'Floor 1'
  AND NOT EXISTS (
    SELECT 1 FROM rooms r WHERE r.floor_id = f.floor_id AND r.room_number = 'B-101'
  );

UPDATE zones z
JOIN buildings b ON z.building_id = b.building_id
JOIN floors f ON f.building_id = b.building_id AND f.name = 'Ground Floor'
JOIN rooms r ON r.floor_id = f.floor_id AND r.room_number = 'A-000'
SET z.floor_id = f.floor_id,
    z.room_id = r.room_id
WHERE b.name = 'Tower A'
  AND z.name = 'Lobby';

UPDATE zones z
JOIN buildings b ON z.building_id = b.building_id
JOIN floors f ON f.building_id = b.building_id AND f.name = 'Floor 1'
JOIN rooms r ON r.floor_id = f.floor_id AND r.room_number = 'A-101'
SET z.floor_id = f.floor_id,
    z.room_id = r.room_id
WHERE b.name = 'Tower A'
  AND z.name IN ('Floor 1', 'Floor 1 East');

UPDATE zones z
JOIN buildings b ON z.building_id = b.building_id
JOIN floors f ON f.building_id = b.building_id AND f.name = 'Floor 2'
JOIN rooms r ON r.floor_id = f.floor_id AND r.room_number = 'A-201'
SET z.floor_id = f.floor_id,
    z.room_id = r.room_id
WHERE b.name = 'Tower A'
  AND z.name IN ('Floor 2', 'Floor 2 West');

UPDATE zones z
JOIN buildings b ON z.building_id = b.building_id
JOIN floors f ON f.building_id = b.building_id AND f.name = 'Ground Floor'
JOIN rooms r ON r.floor_id = f.floor_id AND r.room_number = 'B-000'
SET z.floor_id = f.floor_id,
    z.room_id = r.room_id
WHERE b.name = 'Tower B'
  AND z.name = 'Lobby';

UPDATE zones z
JOIN buildings b ON z.building_id = b.building_id
JOIN floors f ON f.building_id = b.building_id AND f.name = 'Floor 1'
JOIN rooms r ON r.floor_id = f.floor_id AND r.room_number = 'B-101'
SET z.floor_id = f.floor_id,
    z.room_id = r.room_id
WHERE b.name = 'Tower B'
  AND z.name IN ('Floor 1', 'Mechanical');
