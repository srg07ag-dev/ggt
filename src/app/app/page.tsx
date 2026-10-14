import { redirect } from "next/navigation";
import { listCompaniesForUser } from "@/modules/core/companies";
import { requireUser } from "@/lib/session";

export default async function AppIndex() {
  const user = await requireUser();
  const companies = await listCompaniesForUser(user.id);
  redirect(companies[0] ? `/app/${companies[0].id}` : "/onboarding");
}
