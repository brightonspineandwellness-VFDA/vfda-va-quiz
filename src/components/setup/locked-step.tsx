import Link from "next/link";

// Shown in place of steps 4-6 until VFDA sends the reviewed rules.
export function LockedStep() {
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-foreground/15 px-4 py-4">
      <p className="font-medium">🔒 This step opens after VFDA reviews your cards.</p>
      <p className="text-sm text-foreground/70">
        Upload your cards first. Once VFDA has checked the rules we read from them, you&apos;ll confirm them here.
      </p>
      <Link href="/doctor/setup/review" className="self-start text-sm underline">
        See where things are →
      </Link>
    </div>
  );
}

export const nextButton = "self-start rounded-lg bg-foreground px-4 py-2 font-medium text-background";
