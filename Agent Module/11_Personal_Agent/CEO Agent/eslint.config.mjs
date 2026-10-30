import { globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";

export default [
  ...nextVitals,
  globalIgnores([".next/**", ".open-next/**", ".wrangler/**", "supabase/functions/**", "out/**", "build/**", "next-env.d.ts"]),
];
