import { resolve } from "node:path";
import { config } from "dotenv";

// Load monorepo-root .env so DATABASE_URL etc. is available in tests.
config({ path: resolve(__dirname, "../../.env") });
