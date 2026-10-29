"use client";

import { formatTools, parseTools, TOOL_LABELS } from "@/lib/interview";
import { inputClass, LinesAnswer } from "./answer-inputs";

// APPROVED_TOOLS: one box per kind of tool, saved as "Label: tool" lines so
// the app can fill the EHR, texting, phone, email, imaging and remote access
// rules automatically.
export function ToolsAnswer({ lines, onChange }: { lines: string[]; onChange: (lines: string[]) => void }) {
  const { byLabel, other } = parseTools(lines);
  return (
    <div className="flex flex-col gap-2">
      <div className="grid gap-2 sm:grid-cols-2">
        {TOOL_LABELS.map((label) => (
          <label key={label} className="flex flex-col gap-1 text-sm">
            <span className="text-xs font-medium text-foreground/60">{label}</span>
            <input
              value={byLabel[label] ?? ""}
              placeholder={label === "Remote access" || label === "Imaging" ? "Name, or none" : "Name"}
              onChange={(e) => onChange(formatTools({ ...byLabel, [label]: e.target.value }, other))}
              className={inputClass}
            />
          </label>
        ))}
      </div>
      <div className="flex flex-col gap-1">
        <p className="text-xs font-medium text-foreground/60">Other tools</p>
        <LinesAnswer lines={other} onChange={(next) => onChange(formatTools(byLabel, next))} addLabel="Add tool" />
      </div>
    </div>
  );
}
