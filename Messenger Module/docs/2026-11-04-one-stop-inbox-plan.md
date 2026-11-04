# One-stop inbox: plan

Written 2026-11-04. Draft for approval. Nothing is built. Platform facts come from a first search, partly from vendors with something to sell, so confirm each on the platform's own pages before building it.

## What it is

A new Inbox section in Messenger: one list of conversations from email, WhatsApp, Telegram, Instagram and LinkedIn, each answered from the same screen, assigned to a person, and linkable to a client or lead.

Only official APIs with the company's own accounts. No tools that drive a logged-in account or reverse a private API: they risk a ban on the account they run on.

## What each platform allows

| Channel | Official route | What works | What does not | Needs from you | Confidence |
|---|---|---|---|---|---|
| Email, many mailboxes | Already in the CRM (`email_base`, the CEO Agent inbox, Microsoft and Google links) | Read and reply in one list | Depends on the mailboxes already connected | Which mailboxes, and who may see each | High: the CRM already does most of it |
| WhatsApp | Meta's WhatsApp Business Platform (Cloud API) | Business number send and receive. Coexistence lets one number stay on the Business app as well | Personal WhatsApp accounts. Business-initiated messages use paid templates, priced per message by country | Meta Business account, verified business, the number | Medium |
| Telegram | Telegram Bot API | Staff reply to people who messaged the bot, or who are in a group with it | A bot cannot message someone first. It cannot read a person's existing personal chats. Using a personal account (TDLib) is not assessed yet | A bot made through BotFather; how customers reach it | Medium |
| Instagram | Meta's Instagram Messaging API | Professional accounts: receive and reply to DMs. An app serving only your own accounts generally avoids full App Review | Personal accounts. Replies are limited to a 24-hour window after the customer's message | A professional account you own, a Meta app | Medium |
| LinkedIn | Messages API, for approved partners only | Nothing without LinkedIn's approval | No public way to read or send inbox messages. Third-party tools work outside LinkedIn's approved API and risk restricting the account | A decision: apply to the partner programme, or keep a link out | Medium |

**LinkedIn is the real gap.** Until LinkedIn approves us, the Inbox can only offer a button that opens LinkedIn in a new tab, as the dock's WhatsApp and Telegram buttons do today. Expect no unread count either.

## Design

Tables in a new `inbox` area, separate from staff chat, as this is client data with different access rules:

- `inbox_accounts`: one connected mailbox, number, bot or Instagram account. Tokens stay in Vault, never in a table or the browser.
- `inbox_account_access`: who may see each account. There is no default access.
- `inbox_threads`: channel, account, the outside person, status, assigned person, linked client or lead, last message time.
- `inbox_messages`: direction, sender, text, attachments in R2, the channel's own message id, unique, so a repeated webhook cannot add a message twice.

Edge Functions:

- One webhook per channel. Each checks the platform's signature before storing anything.
- One `inbox-send` function: checks access, applies the channel's rules (such as the 24-hour window) and sends.

Screens: thread list with channel filter and assignment, conversation with the channel's rules shown, connect-an-account screen for admins. The docked rail's WhatsApp and Telegram buttons would open the Inbox once those channels are connected.

## Order

Each ships alone, and each live step needs approval.

| Step | Delivers | Rough size |
|---|---|---|
| A | Inbox screens and tables, with email from the existing mail data | 1 to 2 weeks |
| B | WhatsApp | 1 week, plus Meta's business verification, which we do not control |
| C | Telegram bot | Days |
| D | Instagram | 1 week, plus Meta's setup |
| E | LinkedIn link out; partner application if you choose it | Days; approval is LinkedIn's decision |

## Risks

- **Client data.** Messages from clients would be stored in this database. Who sees what, how long it is kept, and UAE privacy duties need a decision, and qualified advice, before step B.
- **Database size.** The database is above its free limit. Long-term message volume needs a retention rule, and attachments go to R2.
- **Running cost.** WhatsApp business-initiated templates cost per message. Confirm current rates on Meta's rate card.
- **Overlap.** The Mail tab on branch `profile-menu` and the CEO Agent inbox already cover email. Step A must reuse them, not make a third copy.

## Questions for you

1. Which accounts: which mailboxes, which WhatsApp number, which Instagram account, and do you have a Telegram bot?
2. Is the WhatsApp number on the Business app today, or a personal account? Only a Business number can connect.
3. Who may see each account: everyone, or named people?
4. For LinkedIn: apply to the partner programme, or link out only?
