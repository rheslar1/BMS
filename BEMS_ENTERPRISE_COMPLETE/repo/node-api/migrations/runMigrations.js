const fs = require("fs");
const path = require("path");
const mysql = require("mysql2/promise");

const migrationDir = __dirname;

function splitSqlStatements(sql) {
  return sql
    .split(";")
    .map((statement) => statement.trim())
    .filter(Boolean);
}

async function connectWithRetry(retries = 30) {
  let lastError;
  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      return await mysql.createConnection({
        host: process.env.MYSQL_HOST || "db",
        user: process.env.MYSQL_USER || "root",
        password: process.env.MYSQL_PASSWORD || "root",
        database: process.env.MYSQL_DATABASE || "bems",
        multipleStatements: false,
      });
    } catch (error) {
      lastError = error;
      console.log(`Database not ready for migrations, retry ${attempt}/${retries}: ${error.message}`);
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
  throw lastError;
}

async function run() {
  const db = await connectWithRetry();
  await db.execute(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      migration_id VARCHAR(180) PRIMARY KEY,
      applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  const files = fs
    .readdirSync(migrationDir)
    .filter((file) => /^\d+.*\.sql$/.test(file))
    .sort();

  for (const file of files) {
    const [rows] = await db.execute("SELECT migration_id FROM schema_migrations WHERE migration_id = ?", [file]);
    if (rows.length > 0) {
      console.log(`Migration already applied: ${file}`);
      continue;
    }

    console.log(`Applying migration: ${file}`);
    const sql = fs.readFileSync(path.join(migrationDir, file), "utf8");
    for (const statement of splitSqlStatements(sql)) {
      await db.query(statement);
    }
    await db.execute("INSERT INTO schema_migrations (migration_id) VALUES (?)", [file]);
  }

  await db.end();
}

run().catch((error) => {
  console.error("Migration failed:", error);
  process.exit(1);
});
