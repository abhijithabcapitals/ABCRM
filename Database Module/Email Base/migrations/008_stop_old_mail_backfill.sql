-- Stops bringing older mail into the CRM. NOT APPLIED; needs approval.
-- Removes no mail. The old position stays in optimize_rollback for undo:
--   update email_base.mailbox_folders f set backfill_uid = b.backfill_uid,
--     backfill_floor_uid = b.backfill_floor_uid, backfill_resume_uid = b.backfill_resume_uid,
--     backfill_resume_floor_uid = b.backfill_resume_floor_uid
--   from optimize_rollback.mail_backfill_008 b where f.id = b.id;

begin;

create schema if not exists optimize_rollback;
revoke all on schema optimize_rollback from public;

create table optimize_rollback.mail_backfill_008 as
  select id, backfill_uid, backfill_floor_uid, backfill_resume_uid, backfill_resume_floor_uid
  from email_base.mailbox_folders
  where coalesce(backfill_uid, 0) > 0;

update email_base.mailbox_folders
  set backfill_uid = 0, backfill_floor_uid = 0, backfill_resume_uid = null, backfill_resume_floor_uid = null
  where coalesce(backfill_uid, 0) > 0;

commit;
