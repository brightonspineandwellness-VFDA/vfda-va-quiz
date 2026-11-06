import { redirect } from "next/navigation";

// "Questions for you" is gone: the doctor is never asked about rules.
export default function QuestionsPage() {
  redirect("/doctor/setup/standards");
}
