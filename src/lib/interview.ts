// Office setup rules shared by the browser (instant show/hide, progress) and the
// server (checking saves, office progress). No server-only imports here.
// Questions are rule slots; answers are the office's direct rules.

export type AnswerType = "text" | "list" | "yesno" | "upload" | "matrix" | "choice";

// profile: setup questions · doctor: from card PDFs · default: VFDA standards ·
// auto: filled by the app (never shown to doctors)
export type Tier = "profile" | "auto" | "default" | "doctor";

export type InterviewQuestion = {
  key: string;
  tier: Tier;
  card_group: string | null;
  // VFDA's suggestion for some doctor-tier rules: a starting point the doctor
  // confirms or changes, never accepted for them.
  suggested_answer: AnswerValue;
  quiz: string; // 'PROFILE' or a training day code (rule_slots.schedule_day)
  question: string;
  answer_type: AnswerType;
  condition: string;
  source: string; // the Trello card the rule usually comes from
};

export type Attachment = { path: string; name: string; size: number; type: string };

export type MatrixRow = Record<MatrixColumnKey, string>;
export type UploadValue = { text: string; links: string[] };
export type AnswerValue = string | string[] | MatrixRow[] | UploadValue | null;

export type Answer = { value: AnswerValue; attachments: Attachment[] };

export type GrayCard = {
  id: string;
  code: string; // WF-G1, WF-G2, ...
  answers: Record<string, string>;
  risk_tag: RiskTag | null;
  position: number;
};

export const RISK_TAGS = ["high_risk", "frequent", "occasional"] as const;
export type RiskTag = (typeof RISK_TAGS)[number];

export const UPLOAD_BUCKET = "interview-uploads";
export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

// The bank's only "choice" question lists its options in the question text.
export const CHOICE_OPTIONS: Record<string, string[]> = {
  BILLING_TYPE: ["insurance", "cash", "both", "none"],
};

// APPROVED_TOOLS is saved as "Label: tool" lines, one box per label. The
// database reads these labels to fill auto rules (private.auto_rule_value):
// EHR -> EHR_NAME, Texting, Phone system, Email, Imaging, Remote access.
export const TOOL_LABELS = [
  "EHR",
  "Texting",
  "Phone system",
  "Email",
  "Payments",
  "Insurance portal",
  "Imaging",
  "Slack",
  "Remote access",
] as const;

export function parseTools(lines: string[]) {
  const byLabel: Record<string, string> = {};
  const other: string[] = [];
  for (const line of lines) {
    const i = line.indexOf(":");
    const label = i > 0 ? TOOL_LABELS.find((l) => l.toLowerCase() === line.slice(0, i).trim().toLowerCase()) : undefined;
    // Values are kept as typed (only the space after the colon is dropped),
    // so spaces typed mid-word survive each keystroke's save.
    if (label) byLabel[label] = line.slice(i + 1).replace(/^ /, "");
    else other.push(line);
  }
  return { byLabel, other };
}

export function formatTools(byLabel: Record<string, string>, other: string[]) {
  return [...TOOL_LABELS.filter((l) => byLabel[l]?.trim()).map((l) => `${l}: ${byLabel[l]}`), ...other];
}

export const MATRIX_COLUMNS = [
  { key: "visit_type", label: "Visit type" },
  { key: "duration", label: "Duration" },
  { key: "provider", label: "Provider" },
  { key: "allowed_times", label: "Allowed times" },
  { key: "buffer", label: "Buffer" },
  { key: "double_book", label: "Double-book rule" },
  { key: "approval_owner", label: "Approval owner" },
  { key: "escalation", label: "Escalation" },
  { key: "documentation", label: "Documentation" },
] as const;
export type MatrixColumnKey = (typeof MATRIX_COLUMNS)[number]["key"];

export const MATRIX_STARTING_ROWS = [
  "New patient",
  "Report of findings",
  "Follow-up / adjustment",
  "Re-exam",
];

export function blankMatrixRow(visitType = ""): MatrixRow {
  const row = Object.fromEntries(MATRIX_COLUMNS.map((c) => [c.key, ""])) as MatrixRow;
  row.visit_type = visitType;
  return row;
}

// Answers that switch quiz days and questions on or off.
export const PROFILE_SWITCH_KEYS = [
  "BILLS_INSURANCE",
  "BILLING_TYPE",
  "HAS_REEXAM_CARD",
  "HAS_GRAY_CARDS",
  "REMOTE_ACCESS_TOOL",
] as const;

const NO_REMOTE_ACCESS = ["none", "no", "n/a", "na", "nothing", "-"];

// Same rule as private.sync_profile_answer() in the database.
export function normalizeRemoteAccess(text: string): "" | "none" | string {
  const t = text.trim();
  if (!t) return "";
  return NO_REMOTE_ACCESS.includes(t.toLowerCase()) ? "none" : t;
}

export type Profile = Record<(typeof PROFILE_SWITCH_KEYS)[number], string>;

export function profileFromAnswers(answers: Record<string, Answer | undefined>): Profile {
  const text = (key: string) => {
    const v = answers[key]?.value;
    return typeof v === "string" ? v.trim() : "";
  };
  return {
    BILLS_INSURANCE: text("BILLS_INSURANCE").toLowerCase(),
    BILLING_TYPE: text("BILLING_TYPE").toLowerCase(),
    HAS_REEXAM_CARD: text("HAS_REEXAM_CARD").toLowerCase(),
    HAS_GRAY_CARDS: text("HAS_GRAY_CARDS").toLowerCase(),
    REMOTE_ACCESS_TOOL: normalizeRemoteAccess(text("REMOTE_ACCESS_TOOL")),
  };
}

// settings.conditions holds readable rules such as "BILLING_TYPE in (insurance, both)".
// Returns null when a rule can't be read, so callers decide how to treat it.
export function evaluateCondition(
  conditionKey: string,
  conditions: Record<string, string>,
  profile: Record<string, string>,
): boolean | null {
  const rule = conditions[conditionKey ?? "always"];
  if (rule === undefined) return null;
  const r = rule.trim();
  if (/^every office$/i.test(r)) return true;

  let m = r.match(/^([A-Z_]+)\s*=\s*([\w-]+)$/);
  if (m) return (profile[m[1]] ?? "") === m[2].toLowerCase();

  m = r.match(/^([A-Z_]+)\s+in\s*\(([^)]*)\)$/i);
  if (m) {
    const options = m[2].split(",").map((s) => s.trim().toLowerCase());
    return options.includes(profile[m[1]] ?? "");
  }

  m = r.match(/^([A-Z_]+)\s+answered\b/i);
  if (m) {
    const v = profile[m[1]] ?? "";
    return v !== "" && v !== "none";
  }

  m = r.match(/^([A-Z_]+)\s+is\s+none$/i);
  if (m) return (profile[m[1]] ?? "") === "none";

  return null;
}

// For the interview, a rule we can't read shows the question (asking too much is harmless).
export function applies(conditionKey: string, conditions: Record<string, string>, profile: Profile) {
  return evaluateCondition(conditionKey, conditions, profile) ?? true;
}

export function emptyValue(question: InterviewQuestion): AnswerValue {
  switch (question.answer_type) {
    case "list":
      return [];
    case "matrix":
      return MATRIX_STARTING_ROWS.map((name) => blankMatrixRow(name));
    case "upload":
      return { text: "", links: [] };
    default:
      return "";
  }
}

const filled = (s: unknown) => typeof s === "string" && s.trim() !== "";

export function isAnswered(question: InterviewQuestion, answer: Answer | undefined): boolean {
  if (!answer) return false;
  const v = answer.value;
  const hasFiles = answer.attachments.length > 0;
  switch (question.answer_type) {
    case "text":
    case "yesno":
    case "choice":
      return filled(v);
    case "list":
      return Array.isArray(v) && v.some(filled);
    case "matrix":
      // At least one visit type with something filled in beyond its name.
      return (
        Array.isArray(v) &&
        (v as MatrixRow[]).some((row) =>
          MATRIX_COLUMNS.some((c) => c.key !== "visit_type" && filled(row?.[c.key])),
        )
      );
    case "upload": {
      const u = v as UploadValue | null;
      return hasFiles || filled(u?.text) || !!u?.links?.some(filled);
    }
  }
}

// ---------------------------------------------------------------------------
// Checking values before saving (server side). Returns an error or null.
// ---------------------------------------------------------------------------

const MAX_TEXT = 20_000;
const MAX_ITEMS = 100;

const isText = (v: unknown, max = MAX_TEXT): v is string => typeof v === "string" && v.length <= max;
const isTextList = (v: unknown): v is string[] =>
  Array.isArray(v) && v.length <= MAX_ITEMS && v.every((s) => isText(s, 2_000));
const isLinkList = (v: unknown): v is string[] =>
  isTextList(v) && v.every((s) => s.trim() === "" || /^https?:\/\/\S+$/i.test(s.trim()));

export function checkAnswerValue(question: InterviewQuestion, value: unknown): string | null {
  switch (question.answer_type) {
    case "text":
      return isText(value) ? null : "Answer is too long.";
    case "yesno":
      return value === "" || value === "yes" || value === "no" ? null : "Answer yes or no.";
    case "choice": {
      const options = CHOICE_OPTIONS[question.key];
      if (!isText(value, 200)) return "Pick one option.";
      return !options || value === "" || options.includes(value) ? null : "Pick one of the options.";
    }
    case "list":
      return isTextList(value) ? null : "Too many lines, or a line is too long.";
    case "matrix":
      return Array.isArray(value) &&
        value.length <= 30 &&
        value.every(
          (row) =>
            row &&
            typeof row === "object" &&
            MATRIX_COLUMNS.every((c) => isText((row as Record<string, unknown>)[c.key] ?? "", 1_000)),
        )
        ? null
        : "The table has too many rows or a cell is too long.";
    case "upload": {
      const u = value as UploadValue;
      return u && isText(u.text) && isLinkList(u.links) ? null : "Links must start with https://";
    }
  }
}

export function checkAttachments(officeId: string, attachments: unknown): string | null {
  if (!Array.isArray(attachments) || attachments.length > 20) return "Too many files.";
  for (const a of attachments) {
    if (
      !a ||
      typeof a.path !== "string" ||
      !a.path.startsWith(`${officeId}/`) ||
      a.path.includes("..") ||
      typeof a.name !== "string" ||
      typeof a.size !== "number" ||
      typeof a.type !== "string"
    ) {
      return "Invalid file.";
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Visible questions and progress.
// ---------------------------------------------------------------------------

export type QuizInfo = { code: string; title: string; condition: string };

export type Section = { code: string; title: string; questions: InterviewQuestion[]; hidden: number };

export function buildSections(
  questions: InterviewQuestion[],
  quizzes: QuizInfo[],
  conditions: Record<string, string>,
  profile: Profile,
): Section[] {
  const profileSection: Section = {
    code: "PROFILE",
    title: "Office profile",
    questions: questions.filter((q) => q.quiz === "PROFILE"),
    hidden: 0,
  };
  const days = quizzes
    .map((quiz) => {
      const all = questions.filter((q) => q.quiz === quiz.code);
      const quizApplies = applies(quiz.condition, conditions, profile);
      const shown = quizApplies ? all.filter((q) => applies(q.condition, conditions, profile)) : [];
      return { code: quiz.code, title: quiz.title, questions: shown, hidden: all.length - shown.length };
    })
    .filter((s) => s.questions.length > 0 || s.hidden > 0);
  return [profileSection, ...days];
}

export type GrayCardQuestion = { key: string; question: string };

export const grayCardAnswered = (card: GrayCard, questions: GrayCardQuestion[]) =>
  questions.filter((q) => filled(card.answers[q.key])).length;

export type Unanswered = { anchor: string; section: string; label: string };

export function computeProgress(
  sections: Section[],
  answers: Record<string, Answer | undefined>,
  profile: Profile,
  grayCards: GrayCard[],
  grayCardQuestions: GrayCardQuestion[],
) {
  const unanswered: Unanswered[] = [];
  let total = 0;
  let done = 0;
  for (const section of sections) {
    for (const q of section.questions) {
      total++;
      if (isAnswered(q, answers[q.key])) done++;
      else unanswered.push({ anchor: `q-${q.key}`, section: section.code, label: q.question });
    }
  }
  if (profile.HAS_GRAY_CARDS === "yes") {
    if (grayCards.length === 0) {
      total++;
      unanswered.push({ anchor: "gray-cards", section: "Gray cards", label: "Add at least one gray card" });
    }
    for (const card of grayCards) {
      total++;
      const n = grayCardAnswered(card, grayCardQuestions);
      if (n === grayCardQuestions.length) done++;
      else
        unanswered.push({
          anchor: `card-${card.id}`,
          section: "Gray cards",
          label: `${card.answers.CARD_NAME?.trim() || "Untitled card"}: ${n} of ${grayCardQuestions.length} answered`,
        });
    }
  }
  return { total, done, percent: total ? Math.round((done / total) * 100) : 0, unanswered };
}
