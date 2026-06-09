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
  password_hash = VALUES(password_hash),
  active = TRUE;
