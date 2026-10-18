import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { config } from "dotenv";

export function loadEnv() {
  const candidates = [resolve(process.cwd(), ".env"), resolve(process.cwd(), "../../.env")];
  const envPath = candidates.find((candidate) => existsSync(candidate));

  if (envPath) {
    config({ path: envPath, quiet: true });
  }
}
