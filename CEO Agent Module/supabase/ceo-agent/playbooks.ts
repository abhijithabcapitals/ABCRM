// CEO playbooks for the ceo-agent chat, served by the get_playbook tool.
//
// Distilled and adapted for a UAE accounting and tax consultancy from open
// skills installed in Agent Module/11_Personal_Agent/CEO Agent/.claude/skills:
// codealive-ai/ceo-ai-os (MIT), guia-matthieu/clawfu-skills (MIT),
// thecraighewitt/skills (MIT), w95/awesome-claude-corporate-skills (MIT),
// pollow/c-suite-skills (Apache-2.0), kangarooking/buffett-letters-skill (MIT).
// Static text only: the tool reads no data and makes no external calls.

export const PLAYBOOKS = {
  decisions: `DECISION PLAYBOOK (adapted from ceo-ai-os decision-playbook)
Give a clear call: action + timeline + what to measure + kill signal. Say if it is a one-way door (hard to reverse) or two-way door.
- Double down on a service line or client segment only when three proofs agree: pain (same trigger keeps appearing, e.g. FTA deadlines, penalties, CT registration), value (these clients onboard fast, pay on time, renew), repeatability (recent wins look alike: same buyer, objections, scope).
- Change target segment when the need is real but nobody owns the budget, clients need too much education, or another segment is clearly easier to win and keep. Not after one bad month.
- Stop a service when few target clients use it, it does not improve win rate, margin or retention, it adds complexity, and demand comes from one noisy client.
- Do not scale sales or hire business development yet if you cannot explain how the last 5 clients were won, onboarding still depends on the CEO, or retention is weak.
- The CEO keeps selling personally while the message, pricing and buyer are still being learned, and in strategic or high-value engagements.
- Hire for the current bottleneck (see the hiring playbook), not for the org chart.
- Pivot only when pain, value or repeatability is structurally broken across several attempts. Change, in order: target client, then the promise, then the service, then the direction.`,

  investigation: `ROOT-CAUSE INVESTIGATION (adapted from ceo-ai-os business-investigation)
Iron law: no solution before the root cause.
1. Define the symptom precisely with numbers and dates ("3 of 8 new VAT clients missed document deadlines in October", not "onboarding is slow"). When did it start, and what changed then?
2. Gather evidence: search_memory and get_overview for related notes, decisions and tasks; ask the CEO for the missing numbers.
3. Check common patterns: wrong client segment (everyone wants something different), wrong channel (high effort, low response), no urgent trigger ("interesting, not now"), wrong buyer (user likes it, owner will not pay), trust gap (stalls before engagement letter), capacity (work piles on one person).
4. Form 1-3 hypotheses. For each: evidence for, evidence against, a test doable in 1-2 days, and what you would see if true or false. After 3 failed hypotheses, stop: the problem is strategic, not tactical.
5. Report: Symptom / Root cause / Evidence / Recommendation (smallest fix) / Metric / Kill signal / Status (DONE, NEEDS DATA, BLOCKED).
Never claim a fix works without evidence. If data is missing, say exactly what is needed.`,

  weekly_review: `WEEKLY REVIEW (adapted from ceo-ai-os ceo-weekly-review and thecraighewitt weekly-review)
Run it as a short conversation, not a questionnaire. Pull get_overview first.
1. Scorecard, 3-5 numbers: new engagements and fees won, collections and overdue receivables, filings due or missed (VAT, CT, excise), team utilisation, pipeline. Flag anything that moved more than 10%.
2. Wins: what worked, and why. Can we do more of it?
3. Losses and lessons: what went wrong, and what changes next time. Flag issues repeating across weeks.
4. Priorities: for each quarterly priority, on track / at risk / stalled, and the blocker. Did most of the CEO's time go to priorities or to reactive work?
5. Honest questions: what changed our beliefs this week? Are recent client wins becoming more similar or more bespoke? What are we calling progress only because it feels good?
6. Self-deception check: only referrals convert; busy team but nothing changes; every client wants a different service; hiring because things feel slow; cannot explain the last 5 wins. Three or more true means flag it hard.
7. Next week: top 3 priorities (definition of done, first action Monday, what could block it), top 3 things to stop, top 3 asks.
8. Energy 1-10. Low for 3 weeks running is a burnout risk; say so.
Offer to save the priorities as tasks with save_item.`,

  daily_recap: `DAILY RECAP (adapted from ceo-ai-os daily-recap)
End-of-day summary from today's saved notes, meetings, tasks and decisions only. Never invent entries.
- Client conversations today, with the key outcome of each.
- Belief changes: was, became, and the evidence.
- Decisions made and what they change.
- Open threads: started but not finished, with the next step.
- Tomorrow's single most important action.
Keep it under 15 lines. If the day was empty, say so plainly and ask if anything should be recorded before closing.`,

  delegation: `DELEGATION (adapted from thecraighewitt delegation)
Stages: Doer (does everything) > Delegator (hired help, still the bottleneck) > Director (manages outcomes) > Designer (builds systems) > Decider (strategy only). Name the stage and the next transition.
1. Time dump: list a typical week concretely: recurring meetings, daily tasks, fires, decisions people bring to the CEO.
2. Sort every item into four buckets: Only you (strategy, key client relationships, senior hires; should be no more than 20-30% of time); Teach someone (who, what a 2-week handoff looks like, what "good enough" means); Hire for (full-time or outsourced, cost versus the CEO's hourly value times hours spent); Eliminate (meetings without decisions, unread reports).
3. Address resistance: 80% quality at 0% of your time beats 100% at 100%; teaching costs 3x once and saves forever; delegate the outcome and the why, not just the task; people grow into responsibility.
4. Plan per item: owner, outcome expected, check-in points, deadline, and how quality is reviewed (especially for tax filings and client advice, where a reviewer sign-off stays mandatory).
Offer to save handoffs as tasks.`,

  management: `HIGH OUTPUT MANAGEMENT (adapted from clawfu high-output-management, Andy Grove)
- A manager's output = the output of their team plus the teams they influence. Judge activities by leverage: output per hour of the CEO's time.
- High-leverage work: training (one session improves many future outputs), decisions that unblock others, timely information to the team, setting standards and examples.
- Low-leverage traps: doing work a team member could do, meetings without a decision, late decisions that stall people.
- One-on-ones: the report owns the agenda; 30-60 minutes; regular; focus on problems, progress, plans.
- Meetings: process meetings (regular reviews) and mission meetings (one decision, one owner, ends with who does what by when).
- OKRs: 3-5 objectives per quarter, each with 2-4 measurable key results; review weekly; ambitious but honest.
- Task-relevant maturity: new or junior staff need structure and close follow-up; experienced staff need goals and room. Match supervision to maturity for each task, not to seniority.
- Measure outputs (filings completed on time, client satisfaction, collections) not only activity.`,

  pricing: `PRICING (adapted from clawfu pricing-strategy, Monetizing Innovation)
For professional fees: price the value and risk removed (penalties avoided, audit defence, time saved), not just hours.
1. Diagnose: too many services bundled at a confusing price; strong demand but fees too low (money left on the table); a valuable service hidden inside another; no willingness to pay at any price.
2. Willingness to pay: ask clients what would be acceptable, expensive, and prohibitively expensive, and why. Do it before finalising a new service.
3. Segment by needs and willingness to pay (e.g. compliance-only SMEs, groups needing CT and transfer pricing, free-zone entities), not by size alone.
4. Packages: Good-Better-Best (e.g. VAT filing only; filing plus reconciliation and query handling; full tax function with advisory hours). Identify leaders (why they buy), fillers (nice to have), killers (things that put clients off).
5. Model: fixed monthly retainer, per-filing fee, project fee, or hourly advisory. Prefer predictable retainers for recurring compliance.
6. Integrity: avoid ad-hoc discounts; trade concessions for something (longer term, upfront payment, reduced scope). Review fees annually.
Never quote market rates or competitor fees as fact without a source.`,

  competition: `COMPETITION (adapted from ceo-ai-os competitive-analysis)
- The biggest competitor is often the status quo: in-house bookkeeping, the client's auditor, or doing nothing until a penalty arrives. Many deals are lost to "not now", not to rivals.
- Map the real alternatives: Big Four and mid-tier firms, other local consultancies, freelancers, software-only tools, in-house staff.
- Find asymmetries rivals cannot copy quickly: relationships, speed, specialised knowledge (e.g. free zone CT, excise), language, price model, responsiveness.
- Compare on what clients actually choose by (trust, responsiveness, outcome, price), not feature lists.
- Do not copy rivals blindly; their moves reflect their own clients and costs.
- Ground claims in evidence. Never state a competitor's fees or client list without a source; ask or mark as an assumption.`,

  finance: `FINANCE / CFO VIEW (adapted from pollow c-suite cfo)
Every decision has a financial side: find it, quantify it, state assumptions.
- Core numbers: monthly revenue and recurring retainer revenue, gross margin per service line, staff utilisation, cost per hire, collections and debtor days, cash runway, client concentration (share of fees from the top 5 clients).
- For any spend or hire: cost, expected return, payback period, and the downside if it fails.
- Pricing decisions: model scenarios (low, expected, high) with stated assumptions.
- Flag cross-functional financial risks even when not asked (e.g. one client is 30% of fees, receivables ageing past 90 days).
- Never invent figures. If numbers are missing, ask for them or label the estimate clearly. This is decision support, not audited financial advice.`,

  operations: `OPERATIONS / COO VIEW (adapted from pollow c-suite coo)
If the process cannot be described step by step, it is a wish, not a plan.
1. Map the current state, even if it is ad hoc.
2. Find the pain: what takes too long, gets dropped, or causes errors (missed filing deadlines, late client documents, rework).
3. Design the target state: trigger, owner, steps, handoffs, completion check, reviewer sign-off.
4. Build the bridge: what changes now, at 2x clients, at 5x.
5. Produce the artifact: a checklist or SOP someone can follow without asking.
Match the process to the firm's size: checklists before SOPs. Typical cadences: daily deadline check, weekly filing calendar review (VAT, CT, excise), monthly collections and utilisation review. Recommend specific tools only with a clear reason.`,

  hiring: `HIRING / PEOPLE (adapted from pollow c-suite chro)
Hire for the bottleneck you have now, not the org chart you want. The wrong hire at the wrong time is worse than no hire.
- Define the bottleneck first: whose time is the constraint, and which work would the hire take over?
- Job description: scope, 90-day outcomes, success measures, required qualifications (e.g. FTA tax agent registration, CA/ACCA, UAE VAT/CT experience), salary range.
- Sequence hires by the bottleneck each removes.
- Plan onboarding: access, first assignments, reviewer, checkpoints at 30/60/90 days.
- Do not state salary benchmarks as fact without a current source; mark estimates.`,

  risk: `RISK (adapted from buffett-letters-skill ceo-as-risk-officer)
The CEO is the chief risk officer; that responsibility cannot be delegated to a committee. "Noah did not wait for it to rain before building the ark."
- Can the CEO name the firm's top 3 risks right now, and when were they last reviewed?
- Typical risks for a tax practice: missed filing or payment deadlines and resulting penalties for clients; wrong advice and professional liability; key-person dependence; client concentration; data confidentiality and breaches; regulatory changes (FTA, MoF, Corporate Tax rules); cash flow from slow collections.
- For each risk: likelihood 1-5, impact 1-5, owner, mitigation, early warning sign. Offer to save it with save_item (type risk).
- Prepare in good times: cash buffer, documented processes, backup reviewer for every key person, professional indemnity cover.
- Ask: could the firm survive the worst plausible quarter without outside help?`,

  communication: `EXECUTIVE COMMUNICATION (adapted from w95 executive-communication)
- Start with the one core message: what should the audience know, feel and do? Lead with it.
- Structure: situation, what it means, what we are doing, what we need from you.
- Team updates: open with a hook, tell stories with numbers, close with a clear call to action.
- Partner, investor or stakeholder updates: headline numbers, wins, challenges with honest context, priorities, specific asks.
- Bad news and crises: communicate early, lead with impact on the people affected, be transparent, take accountability, explain the response and the next step. Never speculate or blame.
- Client communication on tax changes: what changed, who it affects, what they must do and by when, cite the official source.
- Label every draft "DRAFT". The agent never sends anything; the CEO reviews and sends.`,

  focus: `FOCUS (adapted from ceo-ai-os focus-keeper)
- Present ONE next action, not a menu. Size it to 5-15 minutes so it is easier to do than to skip.
- Prefer actions that serve the current constraint (usually winning and keeping the right clients) over busywork.
- Use if-then commitments: "When I open my laptop at 9:00, I send the proposal follow-up to X."
- Avoidance usually means friction, not laziness: shrink the step instead of pushing harder.
- After a missed day: acknowledge it, make tomorrow's step smaller, restart. No guilt.
- Never output internal reasoning; give the action, why it matters in one line, and ask "go or later?"`,
} as const;

export type PlaybookTopic = keyof typeof PLAYBOOKS;
export const PLAYBOOK_TOPICS = Object.keys(PLAYBOOKS) as PlaybookTopic[];
