
import { DatabaseSync } from "node:sqlite";
import { resolve } from "node:path";
import { existsSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";

const databasePath = resolve(
  process.env.AUTH_DB_PATH ?? "data/modelverse-auth.sqlite"
);

if (!existsSync(databasePath)) {
  console.error("Database not found:", databasePath);
  process.exit(1);
}

const rl = createInterface({ input: stdin, output: stdout });

let db;

try {
  const email = (
    await rl.question("Enter your registered email: ")
  ).trim().toLowerCase();

  if (!email || !email.includes("@")) {
    throw new Error("Please enter a valid email.");
  }

  db = new DatabaseSync(databasePath);

  // Check whether an admin already exists.
  const existingAdmin = db.prepare(
    "SELECT id, email FROM users WHERE role = 'admin' LIMIT 1"
  ).get();

  if (existingAdmin) {
    throw new Error(
      `An admin already exists: ${existingAdmin.email}. Initial setup is closed.`
    );
  }

  // Find your registered account.
  const user = db.prepare(
    "SELECT id, email, role FROM users WHERE lower(email) = ?"
  ).get(email);

  if (!user) {
    throw new Error(
      "No account found with that email. Register first."
    );
  }

  // Promote the account.
  db.prepare(
    "UPDATE users SET role = 'admin' WHERE id = ?"
  ).run(user.id);

  console.log("\nAdmin account created successfully!");
  console.log("Email:", user.email);
  console.log("Previous role:", user.role);
  console.log("New role: admin");
  console.log("Database:", databasePath);

} catch (error) {
  console.error("\nSetup failed:", error.message);
  process.exitCode = 1;
} finally {
  db?.close();
  rl.close();
}
