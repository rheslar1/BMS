const assert = require("node:assert/strict");
const test = require("node:test");
const { hashPassword, verifyPassword, requirePermission } = require("../auth");

test("password hashes verify only the original password", () => {
  const passwordHash = hashPassword("operator-secret");

  assert.equal(verifyPassword("operator-secret", passwordHash), true);
  assert.equal(verifyPassword("wrong-secret", passwordHash), false);
  assert.equal(passwordHash.includes("operator-secret"), false);
});

test("permission middleware accepts matching scopes", async () => {
  const middleware = requirePermission("devices:manage");
  const req = {
    auth: {
      authenticated: true,
      scopes: ["devices:manage"],
    },
  };
  const res = {};
  let called = false;

  await middleware(req, res, () => {
    called = true;
  });

  assert.equal(called, true);
});

test("permission middleware rejects missing scopes", () => {
  const middleware = requirePermission("users:manage");
  const req = {
    auth: {
      authenticated: true,
      scopes: ["devices:view"],
    },
  };
  const res = {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };

  middleware(req, res, () => {
    throw new Error("next should not be called");
  });

  assert.equal(res.statusCode, 403);
  assert.match(res.body.error, /Missing permission/);
});
