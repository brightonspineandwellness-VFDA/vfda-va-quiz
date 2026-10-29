import "server-only";

import { createSessionClient } from "@/lib/supabase/server";

// Master quiz bank as stored by `npm run import:bank`. Read with the signed-in
// user's session, so row-level security limits these to VFDA admins.

export type SayDoBook = { Say: string[]; Do: string[]; Book: string[] };

export type QuizTemplate = {
  id: string;
  code: string;
  week: number;
  day: number;
  title: string;
  cards: string[];
  condition: string;
  max_points: number | null;
  pass_points: number | null;
  review_min_points: number | null;
  answer_format: string;
  proof_of_work: string[];
  notes: string;
};

export type QuestionTemplate = {
  id: string;
  part: string;
  part_title: string;
  condition: string;
  code: string;
  version: string;
  type: "mc" | "situational";
  stem: string;
  options: string[] | null;
  options_rule: string | null;
  answer: string | null;
  look_for: string[] | SayDoBook | null;
  critical_fail: string | null;
  bank_ref: string;
  points: number;
  answer_format: string | null;
};

export type Tally = { key: string; label: string; count: number };

export type QuizSummary = QuizTemplate & {
  itemCount: number;
  points: number;
  byPart: Tally[];
  byCondition: Tally[];
};

function tally<T>(items: T[], key: (item: T) => string, label: (item: T) => string): Tally[] {
  const map = new Map<string, Tally>();
  for (const item of items) {
    const k = key(item);
    const entry = map.get(k) ?? { key: k, label: label(item), count: 0 };
    entry.count++;
    map.set(k, entry);
  }
  return [...map.values()];
}

export async function getBankOverview() {
  const supabase = await createSessionClient();
  const [quizzes, items, info] = await Promise.all([
    supabase.from("quiz_templates").select("*").order("week").order("day"),
    supabase
      .from("question_templates")
      .select("quiz_template_id, part, part_title, condition, points, position")
      .order("position"),
    supabase.from("settings").select("value").eq("key", "bank_info").maybeSingle(),
  ]);
  if (quizzes.error) throw quizzes.error;
  if (items.error) throw items.error;

  type ItemRow = Pick<QuestionTemplate, "part" | "part_title" | "condition" | "points"> & {
    quiz_template_id: string;
  };
  const allItems = (items.data ?? []) as ItemRow[];

  const summaries: QuizSummary[] = ((quizzes.data ?? []) as QuizTemplate[]).map((quiz) => {
    const mine = allItems.filter((i) => i.quiz_template_id === quiz.id);
    return {
      ...quiz,
      itemCount: mine.length,
      points: mine.reduce((sum, i) => sum + i.points, 0),
      byPart: tally(mine, (i) => i.part, (i) => (i.part_title ? `${i.part} · ${i.part_title}` : i.part)),
      byCondition: tally(mine, (i) => i.condition, (i) => i.condition),
    };
  });

  const bankInfo = (info.data?.value ?? null) as { version?: string; source?: string } | null;
  return { quizzes: summaries, bankInfo };
}

export async function getQuizWithItems(code: string) {
  const supabase = await createSessionClient();
  const { data: quiz, error } = await supabase
    .from("quiz_templates")
    .select("*")
    .eq("code", code)
    .maybeSingle();
  if (error) throw error;
  if (!quiz) return null;

  const { data: items, error: itemsError } = await supabase
    .from("question_templates")
    .select("*")
    .eq("quiz_template_id", quiz.id)
    .order("position");
  if (itemsError) throw itemsError;

  return { quiz: quiz as QuizTemplate, items: (items ?? []) as QuestionTemplate[] };
}
