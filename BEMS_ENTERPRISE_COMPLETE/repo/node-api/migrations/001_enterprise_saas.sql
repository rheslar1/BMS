CREATE TABLE IF NOT EXISTS organizations (
  organization_id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  slug VARCHAR(120) NOT NULL UNIQUE,
  plan VARCHAR(50) NOT NULL DEFAULT 'enterprise',
  status VARCHAR(50) NOT NULL DEFAULT 'active',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS sites (
  site_id INT AUTO_INCREMENT PRIMARY KEY,
  organization_id INT NOT NULL,
  name VARCHAR(120) NOT NULL,
  timezone VARCHAR(80) NOT NULL DEFAULT 'America/New_York',
  edge_gateway_id VARCHAR(120),
  status VARCHAR(50) NOT NULL DEFAULT 'active',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (organization_id) REFERENCES organizations(organization_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS api_keys (
  key_id INT AUTO_INCREMENT PRIMARY KEY,
  organization_id INT NOT NULL,
  name VARCHAR(120) NOT NULL,
  token_hash CHAR(64) NOT NULL UNIQUE,
  scopes JSON,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_used_at TIMESTAMP NULL DEFAULT NULL,
  FOREIGN KEY (organization_id) REFERENCES organizations(organization_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS audit_events (
  audit_id INT AUTO_INCREMENT PRIMARY KEY,
  organization_id INT DEFAULT NULL,
  actor VARCHAR(120) NOT NULL,
  action VARCHAR(120) NOT NULL,
  resource_type VARCHAR(120) NOT NULL,
  resource_id VARCHAR(120),
  payload JSON,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (organization_id) REFERENCES organizations(organization_id) ON DELETE SET NULL
);

INSERT INTO organizations (organization_id, name, slug, plan, status)
VALUES (1, 'Acme Facilities', 'acme-facilities', 'enterprise', 'active')
ON DUPLICATE KEY UPDATE name = VALUES(name), plan = VALUES(plan), status = VALUES(status);

INSERT INTO sites (site_id, organization_id, name, timezone, edge_gateway_id, status)
VALUES
  (1, 1, 'Main Campus', 'America/New_York', 'edge-imx93-main', 'active'),
  (2, 1, 'Research Annex', 'America/New_York', 'edge-imx93-annex', 'active')
ON DUPLICATE KEY UPDATE
  name = VALUES(name),
  timezone = VALUES(timezone),
  edge_gateway_id = VALUES(edge_gateway_id),
  status = VALUES(status);
