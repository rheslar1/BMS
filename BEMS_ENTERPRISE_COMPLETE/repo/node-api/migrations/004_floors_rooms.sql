CREATE TABLE IF NOT EXISTS floors (
  floor_id INT AUTO_INCREMENT PRIMARY KEY,
  building_id INT NOT NULL,
  name VARCHAR(100) NOT NULL,
  level INT NOT NULL DEFAULT 0,
  description TEXT,
  FOREIGN KEY (building_id) REFERENCES buildings(building_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS rooms (
  room_id INT AUTO_INCREMENT PRIMARY KEY,
  floor_id INT NOT NULL,
  name VARCHAR(100) NOT NULL,
  room_number VARCHAR(40),
  description TEXT,
  FOREIGN KEY (floor_id) REFERENCES floors(floor_id) ON DELETE CASCADE
);

INSERT INTO floors (building_id, name, level, description)
SELECT b.building_id, 'Ground Floor', 0, CONCAT(b.name, ' ground floor')
FROM buildings b
WHERE NOT EXISTS (
  SELECT 1 FROM floors f WHERE f.building_id = b.building_id
);

INSERT INTO rooms (floor_id, name, room_number, description)
SELECT f.floor_id, 'Default Room', CONCAT('B', f.building_id, '-000'), CONCAT(f.name, ' default room')
FROM floors f
WHERE NOT EXISTS (
  SELECT 1 FROM rooms r WHERE r.floor_id = f.floor_id
);

SET @add_zone_floor_column = (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE zones ADD COLUMN floor_id INT DEFAULT NULL',
    'SELECT 1'
  )
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'zones'
    AND COLUMN_NAME = 'floor_id'
);

PREPARE zone_floor_column_stmt FROM @add_zone_floor_column;

EXECUTE zone_floor_column_stmt;

DEALLOCATE PREPARE zone_floor_column_stmt;

SET @add_zone_room_column = (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE zones ADD COLUMN room_id INT DEFAULT NULL',
    'SELECT 1'
  )
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'zones'
    AND COLUMN_NAME = 'room_id'
);

PREPARE zone_room_column_stmt FROM @add_zone_room_column;

EXECUTE zone_room_column_stmt;

DEALLOCATE PREPARE zone_room_column_stmt;

UPDATE zones z
JOIN floors f ON z.building_id = f.building_id
JOIN rooms r ON f.floor_id = r.floor_id
SET z.floor_id = f.floor_id,
    z.room_id = r.room_id
WHERE z.floor_id IS NULL
  AND z.room_id IS NULL;

SET @add_zone_floor_constraint = (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE zones ADD CONSTRAINT fk_zones_floor_id FOREIGN KEY (floor_id) REFERENCES floors(floor_id) ON DELETE SET NULL',
    'SELECT 1'
  )
  FROM information_schema.TABLE_CONSTRAINTS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'zones'
    AND CONSTRAINT_NAME = 'fk_zones_floor_id'
);

PREPARE zone_floor_constraint_stmt FROM @add_zone_floor_constraint;

EXECUTE zone_floor_constraint_stmt;

DEALLOCATE PREPARE zone_floor_constraint_stmt;

SET @add_zone_room_constraint = (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE zones ADD CONSTRAINT fk_zones_room_id FOREIGN KEY (room_id) REFERENCES rooms(room_id) ON DELETE SET NULL',
    'SELECT 1'
  )
  FROM information_schema.TABLE_CONSTRAINTS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'zones'
    AND CONSTRAINT_NAME = 'fk_zones_room_id'
);

PREPARE zone_room_constraint_stmt FROM @add_zone_room_constraint;

EXECUTE zone_room_constraint_stmt;

DEALLOCATE PREPARE zone_room_constraint_stmt;
