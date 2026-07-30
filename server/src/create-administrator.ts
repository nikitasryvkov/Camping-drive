import { database } from "./database.js";
import { runMigrations } from "./migrations.js";
import { hashPassword } from "./password.js";

const login = process.env.ADMIN_LOGIN?.trim();
const password = process.env.ADMIN_PASSWORD;

if (!login || login.length < 3 || login.length > 100) {
  throw new Error("ADMIN_LOGIN must contain between 3 and 100 characters");
}

if (!password || password.length < 12 || password.length > 1_024) {
  throw new Error("ADMIN_PASSWORD must contain between 12 and 1024 characters");
}

try {
  await runMigrations();
  const passwordHash = await hashPassword(password);
  const result = await database.query<{ id: string; login: string }>(
    `INSERT INTO administrators (login, password_hash, role)
     VALUES ($1, $2, 'administrator')
     RETURNING id::text, login`,
    [login, passwordHash],
  );
  const administrator = result.rows[0]!;
  console.log(`Created administrator ${administrator.login} (id ${administrator.id})`);
} catch (error) {
  if (
    error &&
    typeof error === "object" &&
    "code" in error &&
    error.code === "23505"
  ) {
    throw new Error(`Administrator ${login} already exists`, { cause: error });
  }

  throw error;
} finally {
  await database.end();
}
