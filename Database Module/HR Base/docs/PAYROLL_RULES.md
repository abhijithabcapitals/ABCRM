# UAE Payroll Rules: Official Sources

Date read: 2026-11-01 (Asia/Dubai). Prepared for CRM HR Module Task 6. A later payroll task must take every value from this file and from nothing else.

## Scope and limits

- In scope: mainland private-sector employees, Federal Decree-Law No. (33) of 2021 on the Regulation of Employment Relationships ("the Law") and Cabinet Resolution No. (1) of 2022, its Implementing Regulation ("the Regulation").
- Out of scope: free-zone employers. DIFC and ADGM have their own employment laws and end-of-service rules. These were not researched. Do not apply this file to them.
- UAE nationals: Art. 51(1) sends their end of service to the pension and social security legislation. Not researched. The gratuity rules below are for foreign workers.
- Not legal advice. A qualified UAE labour adviser should confirm before go-live.

## Evidence levels and status

- E1: full official text read. E2: official page read. E3: official listing only.
- VERIFIED: stated in an official text I read. UNVERIFIED: official text does not state it, or I could not obtain the official text. Nothing UNVERIFIED was filled from memory or from firm blogs.
- "Company policy decision": the Law is silent. The payroll task must not hard-code a value until the user decides.

## Sources actually read

| Ref | Document | URL | Evidence |
|---|---|---|---|
| S-LAW | Federal Decree-Law No. 33 of 2021 "and its amendments" together with Cabinet Resolution No. 1 of 2022 (one consolidated PDF, MOHRE) | https://www.mohre.gov.ae/assets/download/e82f7872/Federal%20Decree-Law%20No.%2033%20of%202021%20Regarding%20the%20Regulation%20of%20Employment%20Relationship%20and%20its%20amendments_638990571068264034.pdf.aspx | E1 |
| S-LAW2 | Second MOHRE PDF of the Law. It is an older consolidation than S-LAW (it carries no Decree-Law 9 of 2024 footnotes). Art. 29 was cross-read from it because Art. 29 is garbled by overlapping text in S-LAW; the Art. 29 text agrees | https://mohre.gov.ae/assets/download/8cd7cf08/Federal%20Decree-Law%20No.%2033%20of%202021%20Regarding%20the%20Regulation%20of%20Employment%20Relationship%20and%20its%20amendments.pdf.aspx | E1 (Art. 29 only cross-checked) |
| S-UAE-EOS | u.ae, End of service benefits for workers in the private sector (page says "Updated on 15 Oct 2026") | https://u.ae/en/information-and-services/jobs/Sector-of-employment/employment-in-the-private-sector/end-of-service-benefits-for-employees-in-the-private-sector | E2 |
| S-UAE-WAGE | u.ae, Payment of salaries/wages (page says "Updated on 14 Oct 2026") | https://u.ae/en/information-and-services/jobs/Sector-of-employment/employment-in-the-private-sector/payment-of-wages | E2 |
| S-WPS340 | MOHRE Ministerial Resolution No. (0340) of 2026 Concerning the Wage Protection System | https://www.mohre.gov.ae/assets/download/9e530b2e/Ministerial%20Resolution%20No.%200340%20of%202026.pdf.aspx | E1 |
| S-WPSNEWS | MOHRE news, "MoHRE launches new update for the Wage Protection System", 10 Dec 2025 | https://www.mohre.gov.ae/en/media-center/news/10/12/2025/mohre-launches-new-update-for-the-wage-protection-system | E2 |
| S-ULAWS | u.ae, Employment laws and regulations in the private sector | https://u.ae/en/information-and-services/jobs/Sector-of-employment/employment-in-the-private-sector/employment-laws-and-regulations-in-the-private-sector | E2 (amendment list only) |

Version note for S-LAW: it is MOHRE's consolidated copy. Footnotes show amendment by Federal Decree-Law No. (9) of 2024 on Art. 54 and Art. 60, and by Federal Decree-Law No. (14) of 2022 on a work-pattern provision. Arts. 29, 31, 32, 33, 51, 52, 53 and 67 carry no amendment footnote in this copy. u.ae also lists Federal Decree-Law No. (20) of 2023 as an amending law. I did not read that amending law separately, and I could not use uaelegislation.gov.ae to confirm the amendment history (see Gaps). Re-check on every release.

## Rule register

Columns: ID, rule, status. Detail follows each group.

| ID | Rule | Status |
|---|---|---|
| P1 | Month = 30 days, year = 365 days for periods in the Law | VERIFIED |
| P2 | Definitions of "basic wage" and "wage" | VERIFIED |
| P3 | Daily rate for a monthly-paid worker | UNVERIFIED (company policy decision) |
| P4 | Legal effect of unpaid leave and unpaid absence | VERIFIED |
| P5 | How much to deduct per unpaid day | UNVERIFIED (company policy decision) |
| P6 | Proration for mid-month joiner and leaver | UNVERIFIED (company policy decision) |
| G1 | Gratuity formula and service bands | VERIFIED |
| G2 | Gratuity basis wage | VERIFIED |
| G3a | A cap exists: "two years' wage" (Art. 51(6) wording) | VERIFIED |
| G3b | Cap amount (2 years of total wage or of basic wage) | UNVERIFIED (company policy decision) |
| G4 | Part years count once one year is completed | VERIFIED |
| G5 | Exact method for the part-year fraction | UNVERIFIED (company policy decision) |
| G6 | Effect of contract type and resignation on gratuity | VERIFIED as: no condition found in the text read |
| G7 | Gratuity for part-time workers | VERIFIED |
| G8 | Deductions from gratuity | VERIFIED |
| G9 | Voluntary Savings Scheme contributions | VERIFIED (E2) |
| S1 | Final settlement payment deadline | VERIFIED |
| S2 | Unused annual leave paid at exit | VERIFIED |
| S3 | Notice period allowance | VERIFIED |
| S4 | Other final-settlement items (air ticket, etc.) | UNVERIFIED |
| S5 | Limits on deductions from wages | VERIFIED |
| L1 | Annual leave entitlement | VERIFIED |
| L2 | Carry forward and cash in lieu | VERIFIED |
| L3 | Sick leave | VERIFIED |
| L4 | Maternity leave | VERIFIED |
| L5 | Bereavement, parental, study leave | VERIFIED |
| W1 | WPS due date and 85% threshold | VERIFIED |
| W2 | WPS exclusions | VERIFIED |
| W3 | WPS file (SIF) layout | UNVERIFIED |

Totals: 22 VERIFIED, 7 UNVERIFIED (29 rules; G3 was split into G3a verified and G3b unverified).

---

## A. Wage basis, daily rate, unpaid leave, proration

### P1 Calendar convention. VERIFIED, E1
- Law, Art. 67: periods and dates follow the Gregorian calendar; "the Gregorian year ... shall include (365) three hundred and sixty-five days, while the month represents (30) thirty days."
- Source S-LAW. Read 2026-11-01.
- Analysis, not law: this is the only place the Law fixes a month length. It applies to "periods and dates stipulated herein". It does not say it is the divisor for converting a monthly salary to a daily rate.

### P2 Definitions. VERIFIED, E1
- Law, Art. 1. "Basic Wage": the wage stated in the employment contract, paid for the work on a monthly, weekly, daily, hourly or piecework basis, "and which does not include any other allowances or benefits in-kind."
- "Wage": the basic wage plus cash allowances and in-kind benefits allocated under the contract or the Law (includes cost-of-living allowances, sales commission and profit share).
- Source S-LAW.

### P3 Daily rate for a monthly-paid worker. UNVERIFIED, company policy decision
- The Law gives a daily-wage method only for piecework workers (Law Art. 23: average received for actual working days in the six months before the claim). For monthly-paid workers, neither text states a divisor (30, calendar days in the month, or working days).
- Art. 43(4) (notice allowance) and Art. 51(5) (gratuity) refer to "last wage" or "last basic wage" and do not define a daily conversion.
- Analysis, not law: Art. 67's 30-day month supports dividing by 30 and is the only textual hook. It is not an instruction to do so.
- Decision needed from the user (see end).

### P4 Legal effect of unpaid leave and absence. VERIFIED, E1
- Art. 33(1): unpaid leave (other than leaves the Law lists) needs the employer's approval.
- Art. 33(2): unpaid leave is not counted in the service term at the employer or in the pension-contribution period.
- Art. 34: a worker who does not return after leave ends, without a legitimate reason, is not entitled to wage for the absence period after the leave.
- Art. 51(4): unpaid days of absence are not counted in the service term for gratuity.
- Art. 31(3): sick leave beyond the paid tiers is unpaid (see L3).
- Source S-LAW.

### P5 Deduction amount per unpaid day. UNVERIFIED, company policy decision
- The Law says unpaid days earn no wage and do not count as service. It does not state the formula for how much salary to withhold per unpaid day. Do not assume basic only or total wage, and do not assume a divisor. Art. 25 (S5) limits deductions from wage for listed purposes; no wage is earned for an unpaid day, which is a different mechanism, but the Law does not spell this out.

### P6 Mid-month joiner and leaver proration. UNVERIFIED, company policy decision
- Not addressed in the Law or Regulation text read. Policy options (30-day month per Art. 67, actual calendar days, working days) are not law. The final month of a leaver also feeds S1 to S3.

---

## B. End-of-service gratuity (foreign workers, full-time)

All from Law Art. 51, source S-LAW, E1. u.ae page S-UAE-EOS (E2) restates the same rules; it is consistent with the Law.

### G1 Formula and bands. VERIFIED
- Art. 51(2): a full-time foreign worker with a year or more of continuous service is entitled to gratuity "calculated according to the basic wage": (a) 21 days' wage for each year of the first five years of service; (b) 30 days' wage for each year exceeding that period.
- Under one year of continuous service: no gratuity. u.ae page: "If a worker has served for less than 1 year, he is not entitled to any gratuity pay."

### G2 Basis wage. VERIFIED
- Art. 51(2) and 51(5): the last basic wage the worker was entitled to (monthly, weekly or daily paid), or the piecework average daily wage. Allowances are excluded by the definition in P2. u.ae page: allowances such as housing and transport are excluded.
- The Law says "last basic wage". It does not say how a monthly basic wage becomes "a day's wage". See P3.

### G3a A cap exists. VERIFIED
- Art. 51(6): total gratuity for the foreign worker "does not exceed two years' wage". u.ae: "the total gratuity shall not exceed the wage of 2 years." Source S-LAW, E1; S-UAE-EOS, E2.

### G3b Cap amount. UNVERIFIED, company policy decision
- Art. 51(6) says "wage". "Wage" is a defined term in Art. 1 (P2) and includes allowances, while gratuity itself is calculated on the basic wage (Art. 51(2)). The Law does not say which one the cap uses. Two readings: two years of total wage (24 x monthly total wage), or two years of basic wage (24 x monthly basic wage). The Law does not resolve it. Not decided here.

### G4 Part years. VERIFIED (principle)
- Art. 51(3): a benefit for parts of a year in proportion to the period at work, provided one year of continuous service was completed.
- Art. 51(4): unpaid absence days are not counted in service.

### G5 Method of the part-year fraction. UNVERIFIED, company policy decision
- The Law says "in proportion" but not whether the fraction is months/12, days/365 (Art. 67 year) or days/360. Pick one and apply it consistently.

### G6 Contract type and resignation. VERIFIED as: no condition found in the text read (E1, negative finding)
- Art. 51 conditions gratuity on foreign status, full-time pattern and one year of continuous service. It does not mention resignation, termination by the employer, or limited versus unlimited contracts as conditions or reductions.
- I searched the whole text of S-LAW for "resign", "forfeit" and "end of service". No other article reduces or removes gratuity. Art. 45 (worker leaves without notice for employer breach) states the worker "retain[s] his rights upon end of service". Art. 47(3) preserves end of service benefits after unlawful termination. Art. 44 (dismissal without notice) does not mention gratuity either way.
- Under this Law, contracts are fixed-term; Art. 68(2) required conversion of undefined-term contracts. Art. 68(3) lets the employer calculate end of service for undefined-term contracts under the old Federal Law No. 8 of 1980. I did not read that old law. Legacy undefined-term contracts: UNVERIFIED, take advice.
- Absence of a resignation or contract-type condition in the text is the finding. The employer's contract or by-laws may give more (Art. 53 refers to "the contract or the establishment's by-laws").

### G7 Part-time and other patterns. VERIFIED
- Art. 52 delegates to the Regulation. Regulation Art. 30: percentage = (contract hours per year / full-time contract hours per year) x 100, applied to the full-time gratuity amount; no gratuity for temporary employment shorter than one year. Also on u.ae.

### G8 Deductions from gratuity. VERIFIED
- Art. 51(7) and Regulation Art. 29: the employer may deduct amounts owed (loan repayments or overpayments; pension/insurance contributions; approved penalties; court-ordered debts; damage caused by the worker's fault). For penalties and damage the procedures in the Law must have been followed and not more than three months may have passed since the amount fell due, unless otherwise agreed.

### G9 Voluntary Savings Scheme. VERIFIED, E2
- u.ae (citing Cabinet Resolution No. 96 of 2023 and Ministerial Resolution No. 668 of 2023, which I did not read): if the employer enrols a worker, contributions replace gratuity going forward: 5.83% of monthly basic salary if under 5 years' service; 8.33% after that; paid into the fund within 15 days of the start of each calendar month. Gratuity accrued before enrolment is settled under the Law. Not modelled by default; flag as an employer option.

---

## C. Final settlement

### S1 Deadline. VERIFIED, E1
- Art. 53: within 14 days from the end date of the contract term, the employer pays wages and all other entitlements under the Law, the contract or the establishment's by-laws. u.ae agrees.

### S2 Unused annual leave. VERIFIED, E1
- Art. 29(9): paid for accrued leave days if the worker leaves before using them, and leave pay for the part-year worked in proportion, "calculated according to the basic wage". Regulation Art. 19(2): cash allowance for the legally due balance, "according to the basic wage".

### S3 Notice period allowance. VERIFIED, E1
- Art. 43(1): notice of 30 to 90 days as agreed in the contract. Art. 43(3): a party who does not observe notice pays the other the worker's wage for the full or remaining notice period. Art. 43(4): calculated on the last wage received (daily piecework: average daily wage). Note the base is "wage", not "basic wage".

### S4 Other items (air ticket, repatriation, bonuses, etc.). UNVERIFIED
- Not found in the Law articles read. I did not search the Regulation or MOHRE guidance for return-ticket rules. Treat contractual items as company data from the employment contract.

### S5 Limits on deductions from wages. VERIFIED, E1
- Art. 25(1): wages may be deducted only for listed cases: loan repayment (with written consent, within limits); overpayments (not more than 20% of wage); pension and insurance contributions; savings fund contributions; approved social-project instalments; penalties (not more than 5% of wage); court debts (not more than a quarter of wage, except alimony); damage by the worker (not more than 5 days' wage per month without court approval). Art. 25(2): total deduction or withholding in all cases may not exceed 50% of the wage.

---

## D. Statutory leave defaults (Law, source S-LAW, E1)

### L1 Annual leave. VERIFIED
- Art. 29(1): full-wage leave of not less than 30 days for each year of service; 2 days per month if service is over 6 months and under a year; leave for the part of the last year if service ends before the balance is used. Art. 29(6): wage is paid for the leave period. Art. 29(4): employer sets dates, with at least a month's notice. Art. 29(3): leave may be granted during probation; the worker keeps the right to pay for the rest if probation is failed. Part-time workers: Regulation Art. 18 (prorated by hours, minimum 5 working days a year).
- Not stated in the text read: whether the 30 days are calendar or working days. Company policy decision for deduction and encashment arithmetic.

### L2 Carry forward and cash in lieu. VERIFIED
- Regulation Art. 19(1): a worker may carry forward not more than half of the annual leave to the following year, or agree with the employer to a cash allowance in lieu, "according to the wage they receive at the time of their entitlement". Art. 29(5), (8): carry forward needs employer approval; the employer may not block leave accrued for more than two years unless the worker wishes to carry forward or take cash.

### L3 Sick leave. VERIFIED
- Art. 31: no paid sick leave during probation (unpaid leave may be granted on a medical report). After probation, up to 90 days per year (continuous or intermittent): first 15 days full pay; next 30 days half pay; remainder unpaid. Notice to the employer within 3 working days with a medical report. No wage if the sickness resulted from the worker's misconduct (Regulation Art. 20: alcohol or drugs, or breach of safety instructions, proven by a report from the competent authority for the alcohol/drug case).

### L4 Maternity leave. VERIFIED
- Art. 30: 60 days: first 45 days full wage, next 15 days half wage. Up to 45 further days unpaid, only if illness from pregnancy or childbirth is certified; that period is not counted in service for gratuity. Sick child: 30 days full pay after maternity leave plus up to 30 days unpaid. Conditions are in Art. 30(2)-(4).

### L5 Other paid leave. VERIFIED
- Art. 32(1): bereavement 5 days (spouse) or 3 days (mother, father, son, brother, sister, grandchild, grandparent), from the date of death; parental leave 5 working days within 6 months of the birth (either parent); other leaves specified by the Cabinet (not read). Art. 32(2): study leave up to 10 working days per year for enrolled students with at least two years' service. Art. 32(3): national service leave applies to UAE nationals and is out of scope here. Whether study leave is paid is not clear in the text read ("granted"); treat pay as UNVERIFIED for that item only.

---

## E. Wages Protection System (WPS)

### W1 Due date and compliance threshold. VERIFIED, E1
- Ministerial Resolution 0340 of 2026, Art. 1: the first day of each Gregorian month is the unified due date for wages of the preceding Gregorian month; late payment counts as delay; payment is made through the WPS or another Ministry-approved system. Art. 2: an establishment is compliant if no later than the due date it transfers at least 85% of the total wages due; a worker is not treated as unpaid if they receive at least 85% where the difference is lawful deductions or withholdings. Annex 1 sets the escalation steps (alerts from day 2; permit suspension day 5; and so on); u.ae restates them. Art. 7 repeals Ministerial Resolution No. (598) of 2022 and any conflicting provision. Art. 8: the Resolution comes into force on 1 June 2026 (issued 12/05/2026 per the PDF). Confirmed from the PDF on 2026-11-01. Wages for months from May 2026 paid on or after 1 June 2026 fall under it.
- Law Art. 22(2) (wages paid on due dates under Ministry regulations) and Regulation Art. 16(1)(b) (all registered establishments pay through the Wages Protection System or another Ministry-approved system) back this. 

### W2 Exclusions. VERIFIED, E1
- Resolution Art. 4: includes a worker on approved unpaid leave, if the Ministry is notified with documents; a worker with an absconding report during its validity; workers with wage claims in court or an executive instrument within its limits; others (seafarers on request, mission permits up to 3 months, and employer categories such as banks and places of worship).
- Payroll consequence: unpaid-leave employees may need the notification and be left out of the file. Do not invent how.

### W3 SIF layout. UNVERIFIED
- I did not obtain an official SIF specification. Resolution Art. 6 says the Undersecretary for Labour Market and Emiratisation Operations will issue a procedural guide; I did not find it. MOHRE's WPS guideline page (https://eservices.mohre.gov.ae/NewMolGateway/english/wpsGuidelineEng.aspx) appeared in search but returned HTTP 404 when fetched on 2026-11-01. The December 2025 upgrade (S-WPSNEWS, E2) says the new WPS integrates directly with institutions through the Central Bank. It gives no file layout and may change how SIF files are produced.
- Per the project decision, there is no field list here. A WPS sample or specification from the user's bank or from MOHRE is needed (see decisions).

---

## F. Worked gratuity examples (test fixtures)

The gratuity formula and cap existence (G1, G2, G3a) are VERIFIED. These examples additionally assume: daily wage = monthly basic wage / 30 (from P1/P3, analysis, not law), and the cap amount = 24 x monthly basic wage. That cap reading is an ASSUMPTION pending the user's decision on G3b; it does not affect Examples 1 and 2 (far below any cap) but decides Example 3. If the user decides differently on P3 or G3b, recompute. Whole completed years only, with no unpaid absence, so G5 does not arise.

Example 1: basic 5,000, 3 years' service.
1. Years in the 21-day band: min(3, 5) = 3. Days = 3 x 21 = 63.
2. Years in the 30-day band: 0. Days = 0.
3. Total days = 63. Daily wage = 5,000 / 30 = 166.666667.
4. Gratuity = 63 x 166.666667 = 10,500.00. Cap = 24 x 5,000 = 120,000. Not capped.

Example 2: basic 10,000, 8 years' service.
1. 21-day band: 5 years x 21 = 105 days.
2. 30-day band: 3 years x 30 = 90 days.
3. Total = 195 days. Daily wage = 10,000 / 30 = 333.333333.
4. Gratuity = 195 x 333.333333 = 65,000.00. Cap = 240,000. Not capped.

Example 3 (cap, assumes the basic-wage cap reading of G3b): basic 10,000, 30 years' service.
1. 21-day band: 105 days. 30-day band: 25 years x 30 = 750 days. Total = 855 days.
2. Daily wage = 333.333333. Uncapped = 855 x 333.333333 = 285,000.00.
3. Cap = 24 x 10,000 = 240,000.00. Gratuity = min(285,000; 240,000) = 240,000.00.

Boundary checks the task may add: service of 11 months 29 days = 0 (G1); exactly 1 year = 21 days.

---

## G. Gaps and failures

- uaelegislation.gov.ae returned HTTP 403 for automated access (page and download for legislation 1547). Not circumvented. The Law and Regulation were read from MOHRE's official PDFs instead. Legal-status and amendment history on that portal remain unchecked.
- The first fetch of a u.ae EOS URL I guessed returned 404; the correct URL came from a search result and is listed above. A guessed legislation id on uaelegislation.gov.ae returned 403.
- eservices.mohre.gov.ae WPS guideline: HTTP 404. No SIF specification obtained. Central Bank rulebook (WPS access article) appeared in search results but was not read.
- Federal Decree-Law No. (20) of 2023, Cabinet Resolution No. 96 of 2023 and Ministerial Resolution No. 668 of 2023 were not read directly.
- MOHRE's own gratuity calculator was not run. Search-result summaries were not treated as sources.
- Text in the consolidated PDF has some extraction noise (a dropped initial "T" shows as "e" in the raw text); quoted figures were checked against the cross-reference PDF and the u.ae pages.

## H. Decisions and inputs needed from the user

- Daily-rate divisor for monthly-paid staff (30, calendar days in the month, or working days) and whether it applies to basic or total wage. Drives P3, P5, P6 and the example fixtures.
- Unpaid-leave deduction rule (P5): which wage component, and the divisor.
- Mid-month joiner and leaver proration (P6).
- Part-year gratuity fraction method (G5): months/12, days/365 or other.
- Cap amount (G3b): two years of total wage or of basic wage.
- Whether any staff are on legacy undefined-term contracts (Art. 68(3)) or on the Savings Scheme (G9).
- Whether annual leave days are calendar or working days for encashment.
- Whether the client's contracts add terms (air ticket, bonuses) that belong in the final settlement (S4).
- A WPS sample file or specification from the bank or MOHRE, and a past payroll sheet. Without a WPS source, the WPS export step in Task 8 is skipped.
- Wage base for paid leave while in service (basic wage or total wage). The Law fixes basic wage only for leave paid at exit (S2).
- How service years are counted: start and end dates, whether inclusive, whether the notice period and probation count.
- Sick-leave year window (contract year or calendar year) for the 90-day limit.
- Money rounding rule (decimals, when to round).
- When the 14-day clock in S1 starts (last working day, contract end date, or end of notice).
- Not researched: overtime pay (Art. 19) and public-holiday pay (Art. 28). Do not build either from this file.
- A qualified UAE labour adviser's confirmation of the rules before go-live.
