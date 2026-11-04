# Supabase tools

The Supabase CLI for the CRM project `pnnakrhfzyxudjaghoxx`. It replaces the CLI that lived in the removed
standalone CEO Agent app.

First use, in Git Bash from this folder:

```bash
npm install
npx supabase login
npx supabase link --project-ref pnnakrhfzyxudjaghoxx
```

To deploy a function, copy it from its module folder (the module folder is the source of truth), then deploy:

```bash
mkdir -p supabase/functions/ceo-mail-sync
cp "../../Agent Module/11_Personal_Agent/CEO Agent Module/supabase/ceo-mail-sync/"* supabase/functions/ceo-mail-sync/
npx supabase functions deploy ceo-mail-sync --project-ref pnnakrhfzyxudjaghoxx --no-verify-jwt
```

`supabase/functions/` is ignored by git, so these copies never drift into the repository.
