SET @sql = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'organization_id') = 0, 'ALTER TABLE users ADD COLUMN organization_id INT NOT NULL DEFAULT 1', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'site_id') = 0, 'ALTER TABLE users ADD COLUMN site_id INT DEFAULT NULL', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'password_hash') = 0, 'ALTER TABLE users ADD COLUMN password_hash VARCHAR(255) DEFAULT NULL', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'active') = 0, 'ALTER TABLE users ADD COLUMN active BOOLEAN NOT NULL DEFAULT TRUE', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'last_login_at') = 0, 'ALTER TABLE users ADD COLUMN last_login_at TIMESTAMP NULL DEFAULT NULL', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

CREATE TABLE IF NOT EXISTS user_sessions (
  session_id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  organization_id INT NOT NULL,
  site_id INT DEFAULT NULL,
  token_hash CHAR(64) NOT NULL UNIQUE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen_at TIMESTAMP NULL DEFAULT NULL,
  expires_at TIMESTAMP NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id) REFERENCES organizations(organization_id) ON DELETE CASCADE,
  FOREIGN KEY (site_id) REFERENCES sites(site_id) ON DELETE SET NULL
);

INSERT INTO users (user_id, organization_id, site_id, username, email, role_id, password_hash, active)
VALUES (
  1,
  1,
  1,
  'admin',
  'admin@example.com',
  (SELECT role_id FROM roles WHERE name = 'Admin' LIMIT 1),
  'scrypt$16384$8$1$YmVtcy1kZXYtYWRtaW4tc2FsdA$-haED76r128QZkKBWcY6cchzGbho6Ng8Pc7n526cpQV3AAC9Zazm_sKnYPGpGn5oKsIKvolIkZHQnMi4odnZ3g',
  TRUE
)
ON DUPLICATE KEY UPDATE
  organization_id = VALUES(organization_id),
  site_id = VALUES(site_id),
  email = VALUES(email),
  role_id = VALUES(role_id),
  password_hash = COALESCE(users.password_hash, VALUES(password_hash)),
  active = TRUE;
