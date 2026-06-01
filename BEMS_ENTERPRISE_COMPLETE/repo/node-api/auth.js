const crypto = require("crypto");

const publicApiPrefixes = [
  "/api/health",
  "/api/watchdog",
  "/api/telemetry/stream",
  "/api/alarms/stream",
  "/api/v1/auth/login",
  "/api/v1/auth/context",
  "/api/v1/status",
  "/api/v1/openapi.json",
];

function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$16384$8$1$${salt.toString("base64url")}$${key.toString("base64url")}`;
}

function verifyPassword(password, passwordHash) {
  if (!password || !passwordHash) return false;
  const [scheme, n, r, p, salt, storedKey] = String(passwordHash).split("$");
  if (scheme !== "scrypt" || !salt || !storedKey) return false;

  const expected = Buffer.from(storedKey, "base64url");
  const actual = crypto.scryptSync(password, Buffer.from(salt, "base64url"), expected.length, {
    N: Number(n),
    r: Number(r),
    p: Number(p),
  });
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

function hasScope(auth, permission) {
  const scopes = auth?.scopes || [];
  return scopes.includes("*") || scopes.includes(permission);
}

function requirePermission(permission) {
  return function authorizeRequest(req, res, next) {
    if (!req.auth?.authenticated) {
      return res.status(401).json({ error: "Authentication is required." });
    }
    if (!hasScope(req.auth, permission)) {
      return res.status(403).json({ error: `Missing permission: ${permission}` });
    }
    next();
  };
}

function isPublicPath(path) {
  return publicApiPrefixes.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}

function createAuthMiddleware(db, options = {}) {
  const requireAuth = options.requireAuth === true;

  return async function authenticateRequest(req, res, next) {
    req.auth = {
      authenticated: false,
      organizationId: Number(req.get("X-Organization-ID") || 1),
      siteId: req.get("X-Site-ID") ? Number(req.get("X-Site-ID")) : null,
      actor: req.get("X-Actor") || "system",
      scopes: [],
    };

    if (!req.path.startsWith("/api") || isPublicPath(req.path)) {
      return next();
    }

    const sessionToken = req.get("X-Session-Token") || "";
    if (!sessionToken && !requireAuth) {
      return next();
    }
    if (!sessionToken) {
      return res.status(401).json({ error: "X-Session-Token is required." });
    }

    try {
      const sessionAuth = await validateSessionToken(db, sessionToken);
      if (!sessionAuth) {
        return res.status(401).json({ error: "Invalid or expired session." });
      }
      req.auth = { ...req.auth, ...sessionAuth, siteId: req.auth.siteId || sessionAuth.siteId };
      return next();
    } catch (error) {
      console.error("Authentication failed:", error);
      return res.status(500).json({ error: "Authentication unavailable." });
    }
  };
}

async function validateSessionToken(db, token) {
  if (!token) return null;
  const [rows] = await db.promise().query(
    `SELECT s.session_id AS sessionId,
            s.user_id AS userId,
            s.organization_id AS organizationId,
            s.site_id AS siteId,
            u.username,
            u.active,
            r.name AS roleName,
            r.permissions
     FROM user_sessions s
     JOIN users u ON s.user_id = u.user_id
     LEFT JOIN roles r ON u.role_id = r.role_id
     WHERE s.token_hash = ? AND s.expires_at > CURRENT_TIMESTAMP AND u.active = 1
     LIMIT 1`,
    [hashToken(token)]
  );
  if (rows.length === 0) return null;
  const row = rows[0];
  await db.promise().query("UPDATE user_sessions SET last_seen_at = CURRENT_TIMESTAMP WHERE session_id = ?", [row.sessionId]);
  return {
    authenticated: true,
    userId: row.userId,
    organizationId: row.organizationId,
    siteId: row.siteId,
    actor: row.username,
    roleName: row.roleName || "User",
    scopes: typeof row.permissions === "string" ? JSON.parse(row.permissions) : row.permissions || [],
  };
}

async function createUserSession(db, user, siteId = null) {
  const token = `sess_${crypto.randomBytes(32).toString("hex")}`;
  const expiresAt = new Date(Date.now() + 12 * 60 * 60 * 1000);
  await db.promise().query(
    `INSERT INTO user_sessions (user_id, organization_id, site_id, token_hash, expires_at)
     VALUES (?, ?, ?, ?, ?)`,
    [user.userId, user.organizationId || 1, siteId || user.siteId || null, hashToken(token), expiresAt]
  );
  return { token, expiresAt: expiresAt.toISOString() };
}

function auditEvent(db, req, action, resourceType, resourceId, payload = {}) {
  const auth = req.auth || {};
  db.query(
    `INSERT INTO audit_events (organization_id, actor, action, resource_type, resource_id, payload)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      auth.organizationId || 1,
      auth.actor || "system",
      action,
      resourceType,
      resourceId == null ? null : String(resourceId),
      JSON.stringify(payload),
    ],
    (error) => {
      if (error) {
        console.error("Audit event insert failed:", error);
      }
    }
  );
}

module.exports = {
  createAuthMiddleware,
  auditEvent,
  hashToken,
  hashPassword,
  verifyPassword,
  requirePermission,
  createUserSession,
  validateSessionToken,
};
