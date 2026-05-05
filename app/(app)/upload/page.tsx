import { redirect } from "next/navigation";
import { getCurrentUser, getUserRole } from "@/lib/auth";
import { UploadForm } from "@/components/UploadForm";

export const dynamic = "force-dynamic";

export default async function UploadPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const role = await getUserRole(user.id);
  if (role !== "admin") {
    return (
      <div className="container">
        <div className="flash error">Admins only.</div>
      </div>
    );
  }

  return (
    <div className="container">
      <h1>Upload trip</h1>
      <p style={{ color: "var(--muted)", marginTop: -8 }}>
        Upload a <code>track_metrics.csv</code> + <code>metadata.json</code>{" "}
        pair from a processed log session.
      </p>
      <UploadForm />
    </div>
  );
}
