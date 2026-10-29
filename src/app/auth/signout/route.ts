import { NextResponse, type NextRequest } from "next/server";
import { createSessionClient } from "@/lib/supabase/server";

export async function POST(request: NextRequest) {
  const supabase = await createSessionClient();
  await supabase.auth.signOut();
  // 303 so the browser follows with a GET.
  return NextResponse.redirect(new URL("/login", request.url), { status: 303 });
}
