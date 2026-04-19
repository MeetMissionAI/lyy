import { config } from "dotenv";
import { resolve } from "node:path";

// Load monorepo-root .env so DATABASE_URL etc. is available in tests.
config({ path: resolve(__dirname, "../../.env") });
