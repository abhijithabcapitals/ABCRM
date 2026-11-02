-- Undo of 015, to use together with reverting the Banking Module code.
-- Timeline entries are ordinary application status history, so the old screens still read them.
-- banking_client_accounts and the extra history columns stay, so saved account details are not lost.
drop function if exists public.banking_complete_case(uuid, text);
drop function if exists public.banking_account_details_save(uuid, jsonb);
drop function if exists public.banking_bank_event(uuid, text, date, text, text, date, jsonb, text);
