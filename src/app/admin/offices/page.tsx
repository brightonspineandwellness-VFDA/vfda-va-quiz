import Link from "next/link";
import { Suspense } from "react";
import { Loading, SignedInPage } from "@/components/signed-in-page";
import { requireRole } from "@/lib/auth";
import { currentStep } from "@/lib/doctor-flow";
import { loadOffices } from "@/lib/interview-data";
import { AddOfficeForm } from "./add-office-form";

const STATUS_LABELS: Record<string, string> = {
  setup: "Setup",
  rules_in_review: "Rules in review",
  gap_list: "Gap list with doctor",
  scenarios_in_review: "Scenarios in review",
  va_training: "VA training",
  done: "Done",
};

export default function OfficesPage() {
  return (
    <SignedInPage area="VFDA admin">
      <Link href="/admin" className="text-sm text-foreground/60 hover:underline">
        ← Admin
      </Link>
      <h1 className="text-2xl font-semibold">Offices</h1>
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
        <p className="text-foreground/70">No offices yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-foreground/15 text-foreground/60">
              <tr>
                <th className="py-2 pr-4 font-medium">Office</th>
                <th className="py-2 pr-4 font-medium">Status</th>
                <th className="py-2 pr-4 font-medium">Doctors</th>
                <th className="py-2 pr-4 font-medium">Doctor setup step</th>
                <th className="py-2 pr-4 font-medium">Open</th>
              </tr>
            </thead>
            <tbody>
              {offices.map((office) => (
                <tr key={office.id} className="border-b border-foreground/10 align-top">
                  <td className="py-2 pr-4 font-medium">
                    <Link href={`/admin/offices/${office.id}`} className="underline">
                      {office.name}
                    </Link>
                  </td>
                  <td className="py-2 pr-4">{STATUS_LABELS[office.status] ?? office.status}</td>
                  <td className="py-2 pr-4">
                    {office.doctors.length
                      ? office.doctors.map((d) => (
                          <span key={d.email} className="block">
                            {d.name || d.email}
                            {d.primary && office.doctors.length > 1 && <span className="ml-1 text-xs text-green-700 dark:text-green-400">Primary</span>}
                            {d.name && <span className="block text-xs text-foreground/50">{d.email}</span>}
                          </span>
                        ))
                      : "—"}
                  </td>
                  <td className="py-2 pr-4">
                    <SetupStep steps={office.steps} />
                  </td>
                  <td className="py-2 pr-4">
                    <Link href={`/admin/offices/${office.id}`} className="block underline">
                      VAs
                    </Link>
                    <Link href={`/admin/offices/${office.id}/rules`} className="block underline">
                      Cards &amp; rules
                    </Link>
                    <Link href={`/admin/offices/${office.id}/interview`} className="block underline">
                      Standards &amp; must-ask rules
                    </Link>
                    <Link href={`/admin/offices/${office.id}/scenarios`} className="block underline">
                      Scenarios
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
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
          <span className="block text-xs text-foreground/60">{current.step.detail}</span>
        </>
      ) : (
        <span className="text-green-700 dark:text-green-400">All {steps.length} steps done ✓</span>
      )}
    </span>
  );
}
