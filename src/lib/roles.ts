// Roles and the page each one lands on. Shared by proxy.ts and server code.

export type Role = "vfda_admin" | "doctor" | "va";

export const ROLE_HOME: Record<Role, string> = {
  vfda_admin: "/admin",
  doctor: "/doctor",
  va: "/va",
};

// Signed in, but VFDA hasn't given this account a role yet.
export const PENDING_HOME = "/pending";

// Every page that needs a signed-in user.
export const SIGNED_IN_AREAS = [...Object.values(ROLE_HOME), PENDING_HOME];

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && value in ROLE_HOME;
}

export function homeFor(role: Role | null): string {
  return role ? ROLE_HOME[role] : PENDING_HOME;
}

export function isUnder(pathname: string, area: string): boolean {
  return pathname === area || pathname.startsWith(`${area}/`);
}
