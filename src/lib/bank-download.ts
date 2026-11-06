import "server-only";

// "Download PDF" / "Download CSV" of the scenario bank, one day or the whole
// office, answer key included. VFDA, or the office's doctors when shared;
// never VAs (each route checks canReadBank first).

import { bankCsv, filterBank } from "@/lib/bank-export";
import { bankPdf } from "@/lib/bank-pdf";
import { loadBank } from "@/lib/scenario-bank";
import { createAdminClient } from "@/lib/supabase/server";

const DAY_CODE = /^W\dD\d$/;

export async function bankDownload(officeId: string, url: URL): Promise<Response> {
  const format = url.searchParams.get("format") === "csv" ? "csv" : "pdf";
  const day = url.searchParams.get("day");
  if (day && !DAY_CODE.test(day)) return new Response("Not found.", { status: 404 });
  const bank = await loadBank(createAdminClient(), officeId);
  if (!bank) return new Response("Not found.", { status: 404 });
  const items = filterBank(bank.items, { day: day ?? undefined });
  const name = `${bank.office.name.replace(/[^\w .-]+/g, "")} - scenario bank${day ? ` - ${day}` : ""}`;
  const headers = (type: string, ext: string) => ({
    "Content-Type": type,
    "Content-Disposition": `attachment; filename="${name}.${ext}"`,
    "Cache-Control": "private, no-store",
  });
  if (format === "csv") return new Response(bankCsv(items), { headers: headers("text/csv; charset=utf-8", "csv") });
  const pdf = await bankPdf({
    officeName: bank.office.name,
    title: day ? `${day}${bank.days.find((d) => d.code === day)?.title ? `: ${bank.days.find((d) => d.code === day)!.title}` : ""}` : "Scenario bank",
    items,
    dayTitles: Object.fromEntries(bank.days.map((d) => [d.code, d.title])),
  });
  return new Response(Buffer.from(pdf), { headers: headers("application/pdf", "pdf") });
}
