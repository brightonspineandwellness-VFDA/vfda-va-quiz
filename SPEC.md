# \# VFDA VA Quiz App — SPEC (v2: certification engine)

# 

# \## 1. What we're building

# 

# One web app for every VFDA office that certifies each VA on VFDA's standard workflows, adjusted to that office's own rules. It is a certification engine, not a chatbot.

# 

# \- \*\*Layer 1: standard workflow library (VFDA IP).\*\* 10 workflows every chiropractic office shares, each with the same fields. Stored in `seed/quiz-bank-v2.json` → `workflows`.

# \- \*\*Layer 2: office overlay.\*\* Each office's own rules, extracted from the doctor's Trello cards (uploaded as PDFs), plus a few profile questions and a short gap list. Stored as office rules, each with source, effective date, related workflow and doctor approval.

# \- \*\*Training order:\*\* the existing 2-week schedule (Week 1: green → orange cards; Week 2: yellow + extra cards). Each day tests the scenarios for that day's cards and moves the VA's workflow certifications forward.

# \- \*\*Navigation:\*\* VAs are never graded on exact buttons. When a task involves the EHR, texting or phone system, the VA describes how they'd do it; grading checks approach, order, verification and documentation.

# 

# | Decision | Choice |

# | --- | --- |

# | Stack | Next.js (App Router, TypeScript, Tailwind), Supabase (database, auth, storage), Vercel, Claude API (rule extraction, repeat scenarios, grading) |

# | Users | VFDA admins, doctors, VAs. One app for every office |

# | Pass | 80% first-try with zero critical errors, and every missed item corrected on an immediate repeat |

# | Results | Email (Resend) to VFDA and the doctor + Slack post to VFDA, including which items were repeated and both scores |

# | Data | Fake patients only. Never store real patient data, logins, passwords or card numbers |

# | Pilot | 5 offices |

# 

# \## 2. The 10 standard workflows

# 

# WF01 New patient scheduling · WF02 Existing patient scheduling · WF03 Cancellations and no-shows · WF04 Phone handling · WF05 Text responses · WF06 EHR documentation · WF07 Insurance verification (insurance offices) · WF08 Billing questions (offices with billing) · WF09 Patient escalation · WF10 Daily reporting.

# 

# Every workflow has the same fields: trigger, required information, step-by-step process, definition of done, what the VA can decide, what requires approval, what requires immediate escalation, common mistakes, prohibited actions, test scenarios, pass standard, SOP outline, and the office rule keys it uses.

# 

# Office foundations (basics of chiropractic, VA onboarding, patient journey) are folded into these workflows; their scenarios are tagged to the matching workflow.

# 

# Gray cards become extra office workflows (WF-G1, WF-G2, ...) with the same fields, filled from the gray card questions.

# 

# \## 3. How it works

# 

# \*\*Office setup (once per office)\*\*

# 

# 1\. VFDA adds the office and invites the doctor.

# 2\. Doctor answers 5 profile questions (bills insurance, billing type, re-exam card, gray cards, add-ons) and the office fields (doctor, team members, EHR, approved tools, general preferences).

# 3\. VFDA uploads the doctor's Trello cards as PDFs (and attached SOP PDFs). The Claude API extracts each rule slot as a proposed office rule with the exact quote and card it came from, and a status: found, partial, not found or conflicting.

# 4\. VFDA reviews proposed rules (accept, edit, reject). Rule slots with a VFDA default show "Keep VFDA default?".

# 5\. The app writes a short gap list for the doctor: only not found, partial or conflicting rules, plus one edge-case question per workflow where the cards are silent on a risk. Doctor answers; answers become accepted rules with doctor approval.

# 6\. The app builds the office's scenarios by filling every `{PLACEHOLDER}` with accepted rules, and generates repeat variants. VFDA approves each day's scenarios before release.

# 

# \*\*VA certification (per day, then per workflow)\*\*

# 

# 1\. App loads the standard workflow and the office's approved rules.

# 2\. App asks: "Show me how you do this" (one scenario per screen).

# 3\. VA answers (multiple choice, or situational written answer in parts).

# 4\. App checks required steps against the scenario's correct response and the office rules.

# 5\. App shows missing or incorrect steps.

# 6\. Any situational answer below 2/2 → the VA repeats immediately with a new scenario (same correct response, new details). Both scores are stored.

# 7\. After a workflow's last scheduled scenario, the VA writes that workflow's SOP in their own words (using the workflow's SOP outline).

# 8\. Doctor approves, corrects or rejects the SOP.

# 9\. App marks the workflow Certified, Retrain or Pending, with a recheck date.

# 

# \## 4. Database

# 

# | Layer | Table | One row is | Key fields |

# | --- | --- | --- | --- |

# | Master | `workflows` | One standard workflow | code, name, trigger, required\_information, steps, definition\_of\_done, va\_can\_decide, requires\_approval, immediate\_escalation, common\_mistakes, prohibited\_actions, pass\_standard, sop\_outline, bank\_refs, rule\_keys |

# | Master | `rule\_slots` | One office rule the app needs (e.g. LATE\_CANCEL\_RULE) | key, question, answer\_type, condition, card\_source, workflows\[], schedule\_day, default\_answer |

# | Master | `schedule\_days` | One training day (W1D1 ... W2D5) | code, week, day, title, cards, condition, max\_points, pass\_points, review\_min\_points, answer\_format, proof\_of\_work, workflows\[], notes |

# | Master | `scenarios` | One master scenario / edge case | schedule\_day, code, version, workflow, part, part\_title, condition, type (mc, situational), stem, options or options\_rule, answer, correct\_response (list, or Say/Do/Book object), critical\_fail, escalation\_level (none, approval, immediate), bank\_ref, points, answer\_format, repeat\_variant, test\_status |

# | Master | `settings` | JSON settings | conditions, derived\_placeholders, gray\_card\_questions, gray\_formulas, gray\_split, gray\_fill\_rule, certification, grading, sequence, skipped\_day\_rule, office\_fields |

# | Office | `offices` | One office | name, doctor, team\_members, ehr, approved\_tools, general\_preferences, profile flags (BILLS\_INSURANCE, BILLING\_TYPE, HAS\_REEXAM\_CARD, HAS\_GRAY\_CARDS, REMOTE\_ACCESS\_TOOL), status |

# | Office | `office\_documents` | One uploaded card PDF or SOP | office, file, uploaded\_by, extracted\_text, imported\_at |

# | Office | `office\_rules` | One office rule (Layer 2) | office, rule\_slot key, rule (value), source (card\_import, doctor, vfda\_default, vfda), source\_document, source\_quote, status (proposed, accepted, needs\_doctor, rejected), effective\_date, related workflows, doctor\_approved\_by/at, vfda\_reviewed\_by/at |

# | Office | `gap\_questions` | One clarifying or edge-case question for the doctor | office, rule\_slot key (or workflow for edge cases), question, reason (not\_found, partial, conflicting, edge\_case), answer, answered\_at |

# | Office | `office\_workflows` | Gray card workflows for one office | office, code (WF-G1...), same fields as workflows, risk\_tag, frequency |

# | Office | `office\_scenarios` | One filled scenario for one office | office, scenario, version, filled stem/options/answer/correct\_response/critical\_fail, is\_repeat\_variant, parent\_scenario, test\_status (draft, vfda\_reviewed, live), edited\_by\_vfda |

# | People | `profiles` | One login | role (vfda\_admin, doctor, va), office, name, email, va\_start\_date |

# | Progress | `day\_unlocks` | One VA's status on one day | va, schedule\_day, status (locked, open, submitted, passed, in\_review, retake), cards\_done\_at, unlocked\_at |

# | Progress | `attempts` | One day attempt | va, schedule\_day, version, started\_at, submitted\_at, first\_try\_points, result, critical\_errors, time\_spent |

# | Progress | `attempt\_items` | One scenario inside an attempt | attempt, office\_scenario, first\_answer, first\_score, first\_feedback (missed steps), repeat\_scenario, repeat\_answer, repeat\_score, repeat\_feedback, critical\_error, critical\_quote, ai\_confidence, time\_per\_item, vfda\_override |

# | Progress | `certifications` | One VA on one workflow | va, workflow (or office workflow), status (Pending, Retrain, Certified), attempts, errors, sop\_text, sop\_link, doctor\_decision (approved, corrected, rejected), doctor\_notes, certified\_at, recheck\_date |

# | Progress | `proof\_uploads` | One proof-of-work file | va, schedule\_day, file or link, status (pending, accepted, redo) |

# | Progress | `notifications` | One report sent | attempt or certification, channel (email, slack), recipient, sent\_at |

# 

# \*\*Row-level security on every table:\*\* `vfda\_admin` sees everything. `doctor` sees only their own office (rules, gap questions, VA progress, SOPs to approve). `va` sees only their own progress and only the scenarios of a day open to them, never `answer`, `correct\_response`, `critical\_fail` or `options\_rule` (serve through a server-only view or function).

# 

# \## 5. Screens

# 

# \*\*VFDA admin\*\*

# 

# 1\. Offices: list with status (setup, rules in review, gap list with doctor, scenarios in review, VA training, done). Add office, invite doctor.

# 2\. Office setup: profile + office fields; upload card PDFs; proposed rules review (quote and source document beside each, accept/edit/reject; conflicting rules side by side); progress by workflow.

# 3\. Scenario review: each day's filled scenarios and repeat variants beside the master; edit, approve per day.

# 4\. VA progress: every VA, current day, first-try scores, repeats, flags (fast finishes, heavy pasting, critical errors, items waiting for review), workflow certification grid (10 workflows × status).

# 5\. Attempt review: per item, first answer + score + missed steps, repeat answer + score; override with a note; approve unlock or assign retake.

# 6\. Library: read-only view of the 10 standard workflows and their scenarios.

# 

# \*\*Doctor\*\*

# 

# 1\. Office setup: profile questions, office fields, "Keep VFDA default?" approvals, and "Questions for you" (gap list).

# 2\. My office's rules: every accepted rule with its source; doctor can approve or correct.

# 3\. My VA: progress, reports, workflow certification grid.

# 4\. SOP approvals: each SOP the VA wrote, beside the standard workflow and office rules; Approve / Correct (with notes) / Reject.

# 

# \*\*VA\*\*

# 

# 1\. Today: the one open day, or exactly what is blocking it; "Mark today's cards done".

# 2\. Scenario screen: one per screen. Multiple choice as buttons. Situational as boxes: Steps / Say / Document-Escalate (`steps\_say\_doc`) or Say / Do / Book (`say\_do\_book`). After submitting a situational item, show missed steps; if below 2/2, show the repeat scenario right away.

# 3\. Write SOP: per workflow when it becomes due, using the workflow's SOP outline.

# 4\. Proof of work: upload files or a Loom link per day.

# 5\. My results: scores, repeats, feedback, certification statuses (after VFDA releases feedback).

# 

# \## 6. Rules

# 

# \*\*Which days and scenarios an office gets.\*\* Use `schedule\_days.condition` and scenario `condition` with `settings.conditions`. W1D1–W1D5, W2D1, W2D2 for everyone. W2D3 only if BILLS\_INSURANCE = yes. W2D4 if BILLING\_TYPE is insurance, cash or both (insurance → Parts A+B; cash → C+D; both → A+C). W2D5 only if HAS\_GRAY\_CARDS = yes, built from gray card workflows with `gray\_formulas` and `gray\_split`. W1D5 uses Part B or B-alt by HAS\_REEXAM\_CARD. W2D1 uses B3 or B3-alt by remote access. A skipped day gets 20 extra phone scenarios.

# 

# \*\*Unlocking.\*\* A day opens only when all are true, checked on the server: previous day passed (or approved from review); today's cards marked done; that training day reached (from va\_start\_date); VFDA approved that day's scenarios for the office; previous day's proof of work accepted.

# 

# \*\*Scoring.\*\*

# 

# \- Multiple choice: app compares to the stored answer, 1 point. Shuffle options per VA.

# \- Situational: Claude API scores 0, 1 or 2 against correct\_response, critical\_fail and the office's related rules. Required JSON: `{score, reason, missed\_steps: \[], critical\_error, critical\_quote, confidence}`. Validate, retry once. Server only.

# \- Below 2/2 → immediate repeat with that scenario's repeat variant (generated per office from the same correct\_response, VFDA-approved). Store and report both scores.

# \- Day result: pass = first-try points ≥ pass\_points, no critical error, and every missed item corrected on repeat (2/2). Review = first-try ≥ review\_min\_points, or a repeat still below 2/2, or any low-confidence grade. Retake = below review\_min\_points or any critical error → version B the next day. Failing version B → call with VFDA.

# \- Workflow certification (settings.certification): Certified when all its scenarios are passed or corrected, zero critical errors, its pass\_standard met, and the doctor approved the SOP. Retrain on a critical error, an uncorrected repeat, or a rejected SOP. Pending otherwise. Recheck date = certified\_at + 90 days by default.

# \- Don't penalize grammar or English level. Grade the approach.

# 

# \*\*Reports.\*\* After every attempt: email the doctor and VFDA, post to Slack: VA, office, day, first-try score, result, items repeated with first and repeat scores, critical errors with the VA's exact words, 3 weakest items with missed steps, time spent, workflow statuses. After every SOP decision: notify VFDA.

# 

# \*\*Keeping it honest.\*\* Only the open day's scenarios reach the browser, never answer keys. No going back after submitting an item. Flag unusually fast finishes. Log, don't block, pasting.

# 

# \*\*Privacy.\*\* Fake patients only. Never store EHR, phone, portal or email logins, card numbers, or real patient details. Uploaded card PDFs must not contain real patient information; warn on upload.

