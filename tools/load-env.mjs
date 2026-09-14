/**
 * Load machine-specific settings (ANVIL_BLENDER, ANVIL_GODOT, ANVIL_KIT_DIR) from the project's .env.
 * Import it for its side effect before reading process.env; child processes inherit the values.
 * Anything already set in the shell wins, and a missing file is ignored.
 * NODE_OPTIONS cannot carry --env-file, which is why this is a module rather than npm config.
 */
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const envFile = fileURLToPath(new URL("../.env", import.meta.url));
if (existsSync(envFile)) process.loadEnvFile(envFile);
