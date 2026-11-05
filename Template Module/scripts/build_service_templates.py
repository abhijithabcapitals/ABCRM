"""Builds the Word templates for service quotations and engagement letters into Template Module/templates.
Reuses the layout helpers of the Banking templates, which also rebuilds those.
    .venv\\Scripts\\python.exe "Template Module\\scripts\\build_service_templates.py"
"""
import runpy
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
b = runpy.run_path(str(ROOT / "Banking Module" / "scripts" / "build_templates.py"))
para, table, cell, heading, build = b["para"], b["table"], b["cell"], b["heading"], b["build"]
LETTERHEAD, PAYMENT, logo = b["LETTERHEAD"], b["PAYMENT"], b["logo"]
OUT = ROOT / "Template Module" / "templates"
OUT.mkdir(exist_ok=True)

# The Net and VAT rows show only when show_breakdown is set (a Business Setup quote or letter with line VAT); every other document keeps one Total row.
# scope_note is a Business Setup line's scope of work; other departments never send it, so their rows print the description alone.
FEES = lambda total_label: table([
    [cell("#", 500, True, fill="EEF2F3"), cell("Service", 6700, True, fill="EEF2F3"), cell("Fee (AED)", 1800, True, "right", "EEF2F3")],
    [cell("{#lines}{no}", 500), cell("{description}{#scope_note}: {scope_note}{/scope_note}", 6700), cell("{amount}{/lines}", 1800, align="right")],
    [cell("{#show_breakdown}", 500), cell("Net amount", 6700, True), cell("{net}{/show_breakdown}", 1800, True, "right")],
    [cell("{#show_breakdown}", 500), cell("VAT", 6700, True), cell("{vat}{/show_breakdown}", 1800, True, "right")],
    [cell("", 500, fill="EEF2F3"), cell(total_label, 6700, True, fill="EEF2F3"), cell("{total}", 1800, True, "right", "EEF2F3")],
], [500, 6700, 1800])

QUOTE = LETTERHEAD + para("Quotation", bold=True, size=32, color="13363D", after=120) + table([
    [cell("Quotation no.", 1800, True), cell("{document_number}", 2700), cell("Date", 1800, True), cell("{document_date}", 2700)],
    [cell("Client", 1800, True), cell("{client_name}", 2700), cell("Valid until", 1800, True), cell("{valid_until}", 2700)],
    [cell("Attention", 1800, True), cell("{contact_name}", 2700), cell("Department", 1800, True), cell("{department}", 2700)],
    [cell("Email", 1800, True), cell("{contact_email}", 2700), cell("Phone", 1800, True), cell("{contact_phone}", 2700)],
    [cell("Licence no.", 1800, True), cell("{license_number}", 2700), cell("VAT TRN", 1800, True), cell("{vat_trn}", 2700)],
    [cell("Address", 1800, True), cell("{client_address}", 2700), cell("", 1800), cell("", 2700)],
], [1800, 2700, 1800, 2700]) + FEES("Total quotation amount") + para("{vat_statement}{#has_vat} VAT: AED {vat}.{/has_vat}", size=18) + para("{notes}") + PAYMENT + para("Government, authority and other third-party fees are excluded unless listed above. Outcomes rest with the relevant authority or third party.", size=17, color="46565C")

LETTER = LETTERHEAD + table([
    [cell("To", 1200, True), cell("{client_name}", 3800), cell("Date", 1200, True), cell("{document_date}", 2800)],
    [cell("Attention", 1200, True), cell("{contact_name}", 3800), cell("Ref", 1200, True), cell("{document_number}", 2800)],
    [cell("Address", 1200, True), cell("{client_address}", 3800), cell("Licence no.", 1200, True), cell("{license_number}", 2800)],
    [cell("Email", 1200, True), cell("{contact_email}", 3800), cell("Phone", 1200, True), cell("{contact_phone}", 2800)],
], [1200, 3800, 1200, 2800]) + para("Dear Sir / Madam,") + para("Sub: Engagement Letter", bold=True) + para("Greetings from {company_short}.") + para("Thank you for providing us with the opportunity to add value to your business.") + heading("A. OUR UNDERSTANDING OF YOUR REQUIREMENTS") + para("{understanding}") + heading("B. SCOPE OF SERVICE") + para("{#scope}{text}{/scope}", bullet=True) + heading("C. OUR FEES") + para("{fee_intro}") + FEES("Total") + heading("D. PAYMENT TERMS") + para("{#payment_terms}{text}{/payment_terms}", bullet=True) + heading("E. RESPONSIBILITIES OF AB CAPITAL SERVICES FZE") + para("{#ab_responsibilities}{text}{/ab_responsibilities}", bullet=True) + heading("F. RESPONSIBILITIES OF THE CLIENT") + para("{#client_responsibilities}{text}{/client_responsibilities}", bullet=True) + heading("G. LIMITATIONS AND DISCLAIMERS") + para("{limitations}") + heading("H. REPS & WARRANTIES") + para("{reps}") + PAYMENT + table([
    [cell("Sincerely,", 4500, True), cell("Accepted By", 4500, True)],
    [cell(" ", 4500), cell(" ", 4500)], [cell(" ", 4500), cell(" ", 4500)],
    [cell("Authorized Signatory, {company_short}", 4500), cell("Client Signature, {client_name}", 4500)],
    [cell("Date:", 4500), cell("Date:", 4500)],
], [4500, 4500])

for name, body in (("Service_Quotation_Template.docx", QUOTE), ("Service_Engagement_Template.docx", LETTER)):
    build(OUT / name, body, logo)
    print("built", name)
