-- Apply after email_signatures_shared.sql.
-- A signature can name the mailbox replies are sent from (Profile > Mail). The CEO Inbox
-- composer then sends from that mailbox. Mailbox ownership is checked when sending, so
-- naming a mailbox here gives no one the right to send from it.
begin;

alter table public.email_signatures add column if not exists sender_mailbox_address text
  check (sender_mailbox_address = lower(sender_mailbox_address));

update public.email_signatures set sender_mailbox_address = 'bharat@ardentaxit.tax'
  where name = 'Bharat Ardentax' and sender_mailbox_address is null;
update public.email_signatures set sender_mailbox_address = 'info@abcapital.ae'
  where name = 'Bharat AB Capital' and sender_mailbox_address is null;

notify pgrst, 'reload schema';

commit;
