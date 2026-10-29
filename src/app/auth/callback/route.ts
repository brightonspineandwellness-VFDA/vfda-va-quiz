import type { EmailOtpType } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { homeFor, isRole } from "@/lib/roles";
import { createSessionClient } from "@/lib/supabase/server";

// The magic link lands here. Supports Supabase's default email template
// (?code=...) and the token-hash template (?token_hash=...&type=magiclink).
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const code = params.get("code");
  const tokenHash = params.get("token_hash");
  const type = params.get("type") as EmailOtpType | null;
  const failed = () => NextResponse.redirect(new URL("/login?error=link", request.url));

  const supabase = await createSessionClient();

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) return failed();
  } else if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
    if (error) return failed();
  } else if (params.has("error") || params.has("error_description")) {
    return failed();
  } else {
    // Invite links carry the session in the #fragment, which never reaches the
    // server. The browser keeps the fragment across this redirect.
    return NextResponse.redirect(new URL("/auth/confirm", request.url));
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return failed();

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();

  return NextResponse.redirect(
    new URL(homeFor(isRole(profile?.role) ? profile.role : null), request.url),
  );
}
