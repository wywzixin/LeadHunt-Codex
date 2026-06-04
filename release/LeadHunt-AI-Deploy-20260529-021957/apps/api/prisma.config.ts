import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, env } from "prisma/config";
import { config as loadDotenv } from "dotenv";

const configDir = dirname(fileURLToPath(import.meta.url));

loadDotenv({
  path: resolve(configDir, "../../.env"),
  quiet: true
});

export default defineConfig({
  schema: "prisma/schema.prisma",
  datasource: {
    url: env("DATABASE_URL")
  },
  migrations: {
    path: "prisma/migrations"
  }
});
