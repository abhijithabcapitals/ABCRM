// Builds the CRM on this PC and uploads it straight to Cloudflare as static files, with no GitHub Actions.
// First time only: npx wrangler@4.151.2 login
// Every deploy: npm run deploy:cloudflare
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const app = fileURLToPath(new URL("..", import.meta.url));
const WRANGLER = "npx --yes wrangler@4.151.2";
const PROJECTS = ["abcrm"];
const run = (command, env = {}) => execSync(command, { cwd: app, stdio: "inherit", env: { ...process.env, ...env } });

let settings = "";
try { settings = readFileSync(`${app}.env`, "utf8"); } catch { /* reported below */ }
const missing = ["VITE_SUPABASE_URL", "VITE_SUPABASE_ANON_KEY"].filter((key) => !new RegExp(`^${key}=.+`, "m").test(settings));
if (missing.length) {
  console.error(`Main Module/.env is missing ${missing.join(", ")}. Nothing was deployed.`);
  process.exit(1);
}

// GITHUB_PAGES empty: this site lives at the root of its address, not under /ABCRM/.
run("npm run build", { GITHUB_PAGES: "" });
for (const project of PROJECTS) run(`${WRANGLER} deploy --name ${project} --assets dist --compatibility-date 2026-10-19`);
run(`${WRANGLER} pages deploy dist --project-name crm-abcapital --branch main --commit-dirty=true`);
