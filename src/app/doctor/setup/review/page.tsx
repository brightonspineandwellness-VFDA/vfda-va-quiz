import { redirect } from "next/navigation";

// "Waiting for VFDA review" is gone: rules read from the cards apply at once.
export default function ReviewPage() {
  redirect("/doctor/setup/standards");
}
