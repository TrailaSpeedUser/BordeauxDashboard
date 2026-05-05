import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { PasswordForm } from "./PasswordForm";

export const dynamic = "force-dynamic";

export default async function PasswordPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  return (
    <div className="container" style={{ maxWidth: 480 }}>
      <h1>Set a new password</h1>
      <p style={{ color: "var(--muted)", marginTop: -8 }}>
        Signed in as <strong>{user.email}</strong>.
      </p>
      <PasswordForm />
    </div>
  );
}
