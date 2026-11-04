# Calls: setup

Nothing here is live. Each step needs approval. Until the secrets are set, starting a call says "Calls are not set up yet." and the rest of Messenger keeps working.

## Order

1. Run `Database Module/Messanger Base/migrations/006_calls.sql` on the live database, after 004 and 005.
2. Create a LiveKit Cloud project. Confirm the free plan's current limits on LiveKit's pricing page first.
3. Set the secrets. Never commit them; this repository is public.

```bash
supabase secrets set LIVEKIT_URL=wss://... LIVEKIT_API_KEY=... LIVEKIT_API_SECRET=... --project-ref pnnakrhfzyxudjaghoxx
```

4. Deploy the function.

```bash
supabase functions deploy messenger-calls --project-ref pnnakrhfzyxudjaghoxx --use-api --no-verify-jwt
```

5. In LiveKit, set the webhook to `https://pnnakrhfzyxudjaghoxx.supabase.co/functions/v1/messenger-calls`.
6. Schedule the clean-up job, once approved, so calls left open by a crashed window close. It needs pg_cron.

```sql
select cron.schedule('messenger-close-stale-calls', '* * * * *', $$select public.messenger_close_stale_calls()$$);
```

7. Release the CRM, including `npm run deploy:cloudflare`. Rebuild and reinstall the Windows app.

## Rules

- A join token is good for 10 minutes, one person, one room, with no admin rights.
- Room names are random and only the function hands them out.
- The webhook is refused unless LiveKit's signature and the body's hash both match.

## If you move to your own LiveKit server

Only the three secrets change for the CRM. The Windows app also lists `*.livekit.cloud` in `security.csp`, so add the new address there and rebuild it.

## Known gaps

- Calls have never run against a real LiveKit server or between two real people.
- A browser can block the ring sound until the page has been clicked once.
- A closed browser tab cannot ring. The Windows app can, while it runs in the tray.
