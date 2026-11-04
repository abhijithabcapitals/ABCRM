# Chat files: setup

Nothing here is live. Each step needs approval. Until the secrets are set, sharing a file shows "File sharing is not set up yet." and the rest of chat keeps working.

## Order

1. Run `Database Module/Messanger Base/migrations/004_chat_parity.sql` on the live database.
2. Create a private Cloudflare R2 bucket, `messenger-files`. Do not turn on public access.
3. Add a CORS rule on the bucket: allow `PUT` and `GET` with the `content-type` header, from the CRM's addresses only.
4. Create an R2 API token limited to that bucket, with object read and write.
5. Set the secrets. Never commit them; this repository is public.

```bash
supabase secrets set R2_ACCOUNT_ID=... R2_ACCESS_KEY_ID=... R2_SECRET_ACCESS_KEY=... R2_BUCKET=messenger-files --project-ref pnnakrhfzyxudjaghoxx
```

6. Deploy the function.

```bash
supabase functions deploy messenger-files --project-ref pnnakrhfzyxudjaghoxx --use-api
```

7. Release the CRM, including `npm run deploy:cloudflare`.

## Rules

- At most 25 MB per file. Program and script types are refused, by the browser and again by the function.
- The stored file is measured before the message is sent, as an upload link cannot limit the size.
- Links last 5 minutes. A file always downloads, and never opens as a page on the storage address.

## Known gaps

- Storage is not cleaned up yet. These files stay in R2 until a cleanup job exists: uploads never sent, files whose message was deleted (they stop downloading at once, but the object remains), and files of messages removed by the 365-day prune.
- There is no virus scanning. Treat downloaded files as you would email attachments.
