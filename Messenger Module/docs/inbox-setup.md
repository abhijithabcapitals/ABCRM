# Inbox channels: setup

Each live step needs approval. Until they are done, the Inbox's channel buttons open each platform in a browser, and Settings cannot connect anything.

## Release

1. Run `Database Module/Messanger Base/migrations/007_inbox_channels.sql` on the live database.
2. Deploy the function.

```bash
supabase functions deploy messenger-inbox --project-ref pnnakrhfzyxudjaghoxx --use-api --no-verify-jwt
```

3. Merge to `main`, then run `npm run deploy:cloudflare`.

## Connecting an account

An admin does this, in Settings > Integrations > Messenger Inbox, or in Messenger under Settings. Type tokens yourself. Never paste them into a chat, including one with an AI assistant.

| Channel | You need | Then |
|---|---|---|
| Telegram | A bot token from BotFather | Nothing more. The app sets its own webhook |
| WhatsApp | Phone number ID, a permanent access token, and the app secret, all from your Meta app. A WhatsApp Business number | Paste the Callback URL and Verify token into the Meta app's Webhooks, and subscribe to `messages` |
| Instagram | An access token for a professional account, and the app secret | The same, in the Meta app's Instagram webhooks |
| LinkedIn | Cannot be connected: approved partners only | |

After connecting, choose who can see the account under People. Nobody else can, including other admins.

## Rules

- Tokens and app secrets sit in Vault, and only the function reads them. They are never shown again or sent to a browser.
- Every webhook is refused unless it proves itself: a signature made with the app secret for Meta, a secret header for Telegram.
- A repeated webhook cannot store a message twice.
- Message text stays out of the audit trail.
- WhatsApp and Instagram replies are limited to 24 hours after the person's last message.

## Known gaps

- Never run against a real account yet. API details come from the platforms' documentation on 2026-11-04.
- Text only. Photos, voice notes and files show as a placeholder saying to open the app.
- WhatsApp templates are not built, so you cannot message someone first or reply after 24 hours.
- Instagram shows the person's ID rather than their name.
- Messages sent from the phone apps do not appear here.
- Delivery and read receipts are ignored.
- Assignment exists; linking a conversation to a client or lead does not yet.
- Client messages have no retention limit. Decide one, with qualified privacy advice, before real use.
- Meta tokens can expire, depending on their type. Test shows when one stops working.
