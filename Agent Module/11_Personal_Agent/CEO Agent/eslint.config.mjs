import { globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";

export default [
  ...nextVitals,
  globalIgnores([".next/**", ".open-next/**", ".wrangler/**", "out/**", "build/**", "next-env.d.ts"]),
];
