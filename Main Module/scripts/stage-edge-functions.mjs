// Builds the temporary deploy folder for the admin-users and client-portal Edge Functions, so their
// relative imports resolve: `../_shared/credentialMail.ts` and, from there, `../ceo-mail-reply/smtp.ts`.
// It only copies files; it never deploys. Usage (from Main Module):
//   node scripts/stage-edge-functions.mjs [outDir]       default outDir: ../.edge-deploy (outside every module)
// Then, from <outDir>:  supabase functions deploy admin-users
//                       supabase functions deploy client-portal --no-verify-jwt
// See Client Login Module/README.md for the migration order and the business-setup-module caveat.
import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repo = (path) => fileURLToPath(new URL(`../../${path}`, import.meta.url))
const out = resolve(process.argv[2] || repo('.edge-deploy'))
const fns = `${out}/supabase/functions`

const sources = [
  [repo('Client Login Module/supabase/_shared'), `${fns}/_shared`],
  [repo('Agent Module/11_Personal_Agent/CEO Agent Module/supabase/ceo-mail-reply/smtp.ts'), `${fns}/ceo-mail-reply/smtp.ts`],
  [repo('Main Module/db/edge-function-admin-users.ts'), `${fns}/admin-users/index.ts`],
  [repo('Client Login Module/supabase/client-portal'), `${fns}/client-portal`],
]

for (const [from] of sources) {
  if (!existsSync(from)) throw new Error(`Missing source: ${from}`)
}
rmSync(fns, { recursive: true, force: true })
for (const [from, to] of sources) {
  mkdirSync(resolve(to, '..'), { recursive: true })
  cpSync(from, to, { recursive: true })
}
console.log(`Staged admin-users and client-portal in ${fns}`)
