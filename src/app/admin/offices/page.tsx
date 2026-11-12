import Link from "next/link";
import { Suspense } from "react";
import { Loading, SignedInPage } from "@/components/signed-in-page";
import { Badge, EmptyState, linkClass, PageHeader, StatusBadge, Table, td, th } from "@/components/ui";
import { requireRole } from "@/lib/auth";
import { currentStep } from "@/lib/doctor-flow";
import { loadOffices } from "@/lib/interview-data";
import type { Tone } from "@/lib/theme";
import { AddOfficeForm } from "./add-office-form";

const STATUS_LABELS: Record<string, string> = {
  setup: "Setup",
  rules_in_review: "Rules in review",
  gap_list: "Gap list with doctor",
  scenarios_in_review: "Scenarios in review",
  va_training: "VA training",
  done: "Done",
};

const STATUS_TONES: Record<string, Tone> = {
  setup: "neutral",
  rules_in_review: "warning",
  gap_list: "warning",
  scenarios_in_review: "warning",
  va_training: "primary",
  done: "success",
};

export default function OfficesPage() {
  return (
    <SignedInPage area="VFDA admin">
      <PageHeader
        title="Offices"
        description="Every office, its doctors and where it is in setup."
        breadcrumbs={[{ label: "Admin", href: "/admin" }, { label: "Offices" }]}
      />
      <Suspense fallback={<Loading />}>
        <Offices />
      </Suspense>
    </SignedInPage>
  );
}

async function Offices() {
  await requireRole("vfda_admin");
  const offices = await loadOffices();

  return (
    <>
      <AddOfficeForm />
      {offices.length === 0 ? (
        <EmptyState title="No offices yet">Add the first office above. The doctor gets an invite by email.</EmptyState>
      ) : (
        <Table>
          <thead>
            <tr>
              <th className={th}>Office</th>
              <th className={th}>Status</th>
              <th className={th}>Doctors</th>
              <th className={th}>Doctor setup step</th>
              <th className={th}>Open</th>
            </tr>
          </thead>
          <tbody>
            {offices.map((office) => (
              <tr key={office.id}>
                <td className={`${td} font-medium`}>
                  <Link href={`/admin/offices/${office.id}`} className={linkClass}>
                    {office.name}
                  </Link>
                </td>
                <td className={td}>
                  <StatusBadge label={STATUS_LABELS[office.status] ?? office.status} tone={STATUS_TONES[office.status]} />
                </td>
                <td className={td}>
                  {office.doctors.length
                    ? office.doctors.map((d) => (
                        <span key={d.email} className="block">
                          {d.name || d.email}
                          {d.primary && office.doctors.length > 1 && (
                            <Badge tone="success" className="ml-1.5">
                              Primary
                            </Badge>
                          )}
                          {d.name && <span className="block text-xs text-muted">{d.email}</span>}
                        </span>
                      ))
                    : "—"}
                </td>
                <td className={td}>
                  <SetupStep steps={office.steps} />
                </td>
                <td className={`${td} text-sm`}>
                  <Link href={`/admin/offices/${office.id}`} className={`${linkClass} block`}>
                    VAs
                  </Link>
                  <Link href={`/admin/offices/${office.id}/rules`} className={`${linkClass} block`}>
                    Cards &amp; rules
                  </Link>
                  <Link href={`/admin/offices/${office.id}/interview`} className={`${linkClass} block`}>
                    Standards &amp; must-ask rules
                  </Link>
                  <Link href={`/admin/offices/${office.id}/scenarios`} className={`${linkClass} block`}>
                    Scenarios
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </>
  );
}

function SetupStep({ steps }: { steps: Parameters<typeof currentStep>[0] }) {
  const current = currentStep(steps);
  return (
    <span>
      {current ? (
        <>
          Step {current.index + 1} of {steps.length}: {current.step.label}
          <span className="block text-xs text-muted">{current.step.detail}</span>
        </>
      ) : (
        <StatusBadge label={`All ${steps.length} steps done ✓`} tone="success" />
      )}
    </span>
  );
}
