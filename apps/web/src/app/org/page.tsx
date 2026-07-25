import { redirect } from "next/navigation";

// People / Organization now lives inside Settings; keep the old path working.
export default function OrgPage() {
  redirect("/settings");
}
