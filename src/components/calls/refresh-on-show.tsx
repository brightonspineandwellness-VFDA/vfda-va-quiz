"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

// Next.js keeps pages alive (hidden) between visits. Call practice pages
// show live progress, so they reload their data each time they're shown.
export function RefreshOnShow() {
  const router = useRouter();
  useEffect(() => {
    router.refresh();
  }, [router]);
  return null;
}
