begin;

alter table email_base.threads
  add column if not exists assistant_search_vector tsvector generated always as (
    to_tsvector(
      'english',
      coalesce(subject, '') || ' ' || coalesce(summary, '') || ' ' || coalesce(key_points::text, '')
    )
  ) stored;
create index if not exists threads_assistant_search_idx
  on email_base.threads using gin(assistant_search_vector);

alter table email_base.messages
  add column if not exists body_search_vector tsvector generated always as (
    to_tsvector('english', coalesce(body_text, ''))
  ) stored;

create index if not exists messages_body_search_idx
  on email_base.messages using gin(body_search_vector);

commit;
