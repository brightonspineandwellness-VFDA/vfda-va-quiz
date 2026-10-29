# VFDA VA Quiz App — SPEC

## 1. What we're building

One web app for every VFDA office. VFDA interviews the doctor, and the app turns the VFDA VA Quiz Bank (`seed/quiz-bank.json`) into that office's own quizzes. It releases them to the office's VA one day at a time, grades each one against the doctor's answers, and sends the results to VFDA and the doctor.

| Decision | Choice |
| --- | --- |
| App | New, separate app (not part of the VFDA AI Tools Hub) |
| Built with | Claude Code |
| Stack | Next.js (App Router, TypeScript, Tailwind), Supabase (database, auth, storage), Vercel (hosting), Claude API (grading) |
| Users | VFDA admins, doctors, VAs. One app for every office |
| Content | 10 quizzes in `seed/quiz-bank.json`, filled per office from the interview |
| Order | Week 1: 5 quizzes, one per day. Week 2: 5 quizzes, one per day. Each opens only after the previous one is passed |
| Pass | 80% with zero critical errors. VFDA reviews borderline scores. Below that = retake with version B |
| Results | Email (Resend) to VFDA and the doctor, plus a Slack webhook post to VFDA |
| Data | Fake patients only. Never store real patient data, logins, passwords or card numbers |
| Pilot | 5 offices |

## 2. How it works

1. Doctor interview (doctor or VFDA fills it in).
2. Build quizzes: the app replaces every `{PLACEHOLDER}` with the office's answers.
3. VFDA approves the office's quizzes. If answers are missing or wrong, go back to the interview.
4. Quiz unlocks for the VA when: previous quiz passed, today's cards marked done, training day reached, VFDA approved the quiz.
5. VA takes the quiz (one item per screen).
6. Graded: multiple choice by the app, situational by the Claude API.
7. Report sent: email and Slack to VFDA and the doctor.
8. Result:
   - **Pass** → the next day's quiz unlocks.
   - **Not a clean pass** → VFDA review → approve, or assign a retake (version B, next day).

## 3. Accounts and environment variables

Secrets live only in `.env.local` (git-ignored) and in Vercel's environment settings. Provide `.env.example` with names only:

```
SUPABASE_URL=
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
ANTHROPIC_API_KEY=
RESEND_API_KEY=
REPORT_FROM_EMAIL=
VFDA_REPORT_EMAIL=
SLACK_WEBHOOK_URL=
```

## 4. Database

Three layers: **Master content** (same for every office, from the Quiz Bank), **Office data** (per clinic, from the interview), **VA progress**.

| Layer | Table | One row is | Key fields |
| --- | --- | --- | --- |
| Master | `interview_questions` | One interview question (e.g. `EHR_PATH_SEARCH`) | key, quiz, question, answer_type (text, list, yesno, upload, matrix, click_path, choice), condition, source |
| Master | `quiz_templates` | One of the 10 quizzes (W1D1 … W2D5) | code, week, day, title, cards, condition, max_points, pass_points, review_min_points, answer_format, proof_of_work, notes |
| Master | `question_templates` | One quiz item, version A or B | quiz, part, part_title, condition, code, version, type (mc or situational), stem, options or options_rule, answer, look_for, critical_fail, bank_ref, points, answer_format |
| Master | `settings` | JSON settings from the Quiz Bank | conditions, derived_placeholders, gray_card_questions, gray_formulas, gray_split, gray_fill_rule, gray_checklist, grading, sequence, skipped_day_rule |
| Office | `clinics` | One office | name, status, plus profile answers (BILLS_INSURANCE, BILLING_TYPE, HAS_REEXAM_CARD, HAS_GRAY_CARDS, REMOTE_ACCESS_TOOL) |
| Office | `interview_answers` | One answer for one office | clinic, question key, value (json), attachments, answered_by, updated_at |
| Office | `gray_cards` | One extra task for one office | clinic, the gray card answers (json), risk tag, frequency |
| Office | `clinic_quizzes` | One quiz built for one office | clinic, quiz template, version, status (draft, in_review, approved), approved_by |
| Office | `clinic_questions` | One filled-in item | clinic quiz, question template, filled stem, options, answer, look_for, critical_fail, edited_by_vfda |
| People | `profiles` | One login | role (vfda_admin, doctor, va), clinic, name, email |
| Progress | `unlocks` | One VA's status on one quiz | va, clinic quiz, status (locked, open, submitted, passed, in_review, retake), cards_done_at, unlocked_at |
| Progress | `attempts` | One quiz attempt | va, clinic quiz, version, started_at, submitted_at, answers, per-item times, score, result, critical_errors, ai_evaluation, vfda_override |
| Progress | `proof_uploads` | One proof-of-work file | va, quiz, file or link, status (pending, accepted, redo) |
| Progress | `notifications` | One report sent | attempt, channel (email, slack), recipient, sent_at |

**Row-level security on every table:**

- `vfda_admin` sees everything.
- `doctor` sees only their own clinic and their own VAs' results.
- `va` sees only their own unlocks, attempts and uploads, and only the items of a quiz that is open for them. A VA must never receive `answer`, `look_for` or `critical_fail` (serve items through a server-only view or function).

## 5. Screens

**VFDA admin**

1. Offices: list of clinics with status (interview, quizzes in review, VA training, done). Add an office and invite its doctor.
2. Interview: one office's answers grouped by quiz day; profile yes/no questions switch quizzes and add-ons on or off; progress bar and list of unanswered questions.
3. Quiz review: each generated item beside its master item; edit, approve per quiz, or send back to the interview. Nothing reaches a VA until approved.
4. VA progress: every VA across offices with current day, scores and flags (fast finishes, heavy pasting, critical errors, items waiting for review).
5. Attempt review: the VA's answers, AI score and reason per item; override any score with a note; approve the unlock or assign a retake; release feedback to the VA.

**Doctor**

1. My interview: same interview screen for their own clinic; saves on every change; uploads (scripts, screenshots, Looms) per question.
2. My VA: progress through the 10 days and every result report.
3. My office's quizzes: read-only.

**VA**

1. Today: the one open quiz, or exactly which condition is still blocking it. A "Mark today's cards done" button.
2. Quiz: one item per screen. Multiple choice as buttons. Situational as separate boxes: Steps / Say / Document-Escalate (`steps_say_doc`), or Say / Do in EHR / Book (`say_do_book`, Week 2 Days 1–2). Timer shown, autosave, no reopening after submit.
3. Proof of work: upload files or a Loom link per quiz.
4. My results: scores and feedback after VFDA releases them.

## 6. Rules

**Which quizzes an office gets.** Use `quiz_templates.condition` and item `condition`, as defined in `settings.conditions`. W1D1–W1D5, W2D1 and W2D2 go to everyone. W2D3 Insurance only if BILLS_INSURANCE = yes. W2D4 Billing if BILLING_TYPE is insurance, cash or both (insurance → Parts A+B; cash → Parts C+D; both → Parts A+C). W2D5 Gray Cards only if HAS_GRAY_CARDS = yes, built from the office's gray cards using `gray_formulas` and `gray_split`. W1D5 uses Part B or Part B-alt depending on HAS_REEXAM_CARD. W2D1 uses B3 or B3-alt depending on remote access. A skipped day gets 20 extra phone drills.

**Unlocking.** A quiz opens only when all four are true, checked on the server every time:

1. The previous quiz in the office's sequence is passed (or VFDA approved it from review).
2. The VA marked that day's cards done.
3. It's that quiz's training day or later, counted from the VA's start date.
4. VFDA approved that office's version of the quiz.

**Scoring.**

- Multiple choice: compared to the stored answer, 1 point each. The app shuffles option order per VA.
- Situational: 0, 1 or 2 points from the Claude API, graded against the item's look_for, critical_fail and the office's relevant interview answers (including click paths). Required JSON reply: `{score: 0|1|2, reason, missed_points: [], critical_error: true|false, critical_quote: string|null, confidence: "high"|"low"}`. Validate it and retry once if invalid. Grading runs on the server only.
- Pass = points ≥ pass_points and no critical error → the next quiz unlocks.
- Review = points ≥ review_min_points, or any low-confidence item → VFDA decides within one working day.
- Retake = below review_min_points, or any critical error → version B the next day. Failing version B → a call with VFDA before anything else unlocks.
- Don't penalize grammar or English level. Grade the action.

**Reports.** After every submitted attempt: email the doctor and VFDA, and post to Slack. Include VA, office, quiz, score, result, any critical error with the VA's exact words, the 3 weakest items with missed points, time spent, and a link to the attempt.

**Keeping it honest.** Send the VA only the open quiz's items, never answer keys. One attempt per version, no going back after submit. Flag unusually fast finishes. Log, don't block, pasting into answer boxes.

**Privacy.** Fake patients only. Never store EHR, phone, portal or email logins, card numbers, or real patient details. Uploads must show fake patients only.
