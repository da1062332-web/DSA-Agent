# ADR-012: Performance Leaderboard Scoring Policy and Quality Guardrails

**Status:** `PROPOSED — NOT APPROVED`  
**Date:** 2026-10-14  
**Scope:** MOD-PERF SUB-PERF.03 (Leaderboards)  
**Authors:** Senior Full-Stack Engineer / Domain Architect  
**Required Decision Owners:** Product Head (CRM), Head of Credit & Risk, Operations & Performance Committee  

---

## 1. Context & Business Problem

`MOD-PERF SUB-PERF.03` defines a competitive performance leaderboard for DSA agents, sales officers, and branch teams. In NBFC lending operations, competitive scorecards drive field agent incentives and loan origination volumes.

However, raw volume ranking without risk and quality guardrails introduces severe adverse selection risks:
1. **Moral Hazard:** Agents prioritizing high-risk volume over credit quality to maximize ranking.
2. **Early Delinquency Risk:** Portfolio deterioration from First Payment Defaults (FPD) or 90-day Early Default Rates (EDR).
3. **Application Churn:** Submitting unviable leads causing operational bottlenecks and high lender rejection rates.

In accordance with repository governance and the Master Implementation Directive, **scoring formulas, weights, sample size thresholds, quality deductions, and ranking algorithms must never be invented by engineering**. They require formal sign-off from Credit Policy, Risk, and Product leadership.

---

## 2. Proposed Balanced Scorecard Framework

Until formal approval is granted, engineering has established the reporting infrastructure and unranked participant overview, while keeping competitive ranking and scores disabled (`rank: null`, `score: null`).

The following 9 policy decisions constitute the formal approval package submitted for committee sign-off:

| # | Governance Dimension | Proposed Policy Specification | Proposed Value / Formula | Decision Owner | Current Status |
|---|---|---|---|---|---|
| **1** | **Scorecard Weights** | Relative percentage weighting across Activity touchpoints, Origination Outcomes, and Credit Quality. | **Activity: 20%**<br>**Outcomes: 50%**<br>**Quality: 30%** | Product Head & Sales Strategy | `PROPOSED — NOT APPROVED` |
| **2** | **Minimum Volume Threshold** | Minimum volume required in the reporting period before an officer is eligible for ranked competition. | **>= 10 Leads Handled** AND **>= 5 Closed Outcome Records**.<br>Officers below threshold labeled `INSUFFICIENT_DATA`. | Product Head | `PROPOSED — NOT APPROVED` |
| **3** | **Early Default Rate (EDR) Penalty** | Measurement of loans defaulting within 90 days of initial disbursement. | **Threshold:** EDR > 2.0% of disbursed portfolio.<br>**Penalty:** -15% score haircut if 2-4% EDR; disqualification if > 4% EDR. | Head of Credit & Risk | `PROPOSED — NOT APPROVED` |
| **4** | **First Payment Default (FPD) Rule** | Policy on loans that fail to pay the very first EMI. | **Zero Tolerance:** Immediate disqualification from monthly/quarterly leaderboard awards on confirmed FPD. | Credit Policy Committee | `PROPOSED — NOT APPROVED` |
| **5** | **Application Rejection Rate Haircut** | Penalty scaling when submitted application decline rate exceeds credit threshold. | **Threshold:** > 20% lender decline rate.<br>**Penalty:** -10% deduction from Outcome score. | Operations Head | `PROPOSED — NOT APPROVED` |
| **6** | **Deterministic Tie-Breaking** | Deterministic hierarchy to resolve identical composite scores without non-deterministic ordering. | **Hierarchy:**<br>1. Quality Score (higher wins)<br>2. Outcome Score (higher wins)<br>3. Shared Rank if identical. | Product Head | `PROPOSED — NOT APPROVED` |
| **7** | **Role & Peer Visibility** | Visibility boundaries for peer ranking to maintain data protection and compliance. | **Branch-Scoped:** Full participant name and volume visible within own branch; peer records anonymized/masked outside branch. | Compliance & HR | `PROPOSED — NOT APPROVED` |
| **8** | **Product Normalization** | Fair comparison between high-ticket Secured loans (LAP/HL) and low-ticket Unsecured loans (BL/PL). | Target-relative achievement percentage used for scoring rather than raw rupee comparison. | Sales Strategy | `PROPOSED — NOT APPROVED` |
| **9** | **Cycle Reset & Carry-Over** | Lifecycle of scores and penalty carry-over across reporting periods. | Independent monthly (`YYYY-MM`) and quarterly (`YYYY-Q#`) calculation; zero carry-over of rank or score between periods. | Performance Committee | `PROPOSED — NOT APPROVED` |

---

## 3. Technical Implementation & Safety Guardrails

To prevent unauthorized or accidental ranking calculation prior to business sign-off:
1. **API Contract Enforcement:** `GET /v1/dashboards/LEADERBOARD` returns `rankingStatus: "BLOCKED_PENDING_APPROVAL"`, with every entry returning `rank: null` and `score: null`.
2. **Operational Transparency:** Real operational metrics (Lead count, Sanction count, Disbursed amount, Conversion rate) are accurately displayed so managers have operational visibility without unapproved competitive ranking.
3. **Threshold Guardrail:** Participants with fewer than 10 leads or 5 sanctions are explicitly marked `guardrailStatus: "INSUFFICIENT_DATA"`.
4. **UI Governance Banner:** The Web UI (`LeaderboardPage.tsx`) presents an alert banner detailing all 9 pending business decisions.
5. **Fail-Safe Switch:** Backend computation rejects ranking activation until a signed configuration or policy version is registered.

---

## 4. Required Next Steps for Sign-Off

1. Convene Joint Credit, Risk, and Sales Performance Committee.
2. Review the 9 proposed parameters in Section 2.
3. Record signed approval decision and version identifier.
4. Engineering will then activate the scoring engine and deploy ranking calculations with full regression tests.
