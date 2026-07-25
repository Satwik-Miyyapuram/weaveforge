import { redirect } from "next/navigation";

/** Legacy route — Notes moved to /notes. */
export default function VaultRedirectPage() {
  redirect("/notes");
}
