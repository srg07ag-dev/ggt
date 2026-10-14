"use server";

import { redirect } from "next/navigation";
import { ZodError } from "zod";
import { requireUser } from "@/lib/session";
import { createCompany } from "@/modules/core/companies";

export async function createCompanyAction(_: { error?: string } | undefined, form: FormData) {
  const user = await requireUser();
  let id: string;
  try {
    id = (
      await createCompany(user.id, {
        name: String(form.get("name") ?? ""),
        country: String(form.get("country") ?? ""),
        currency: String(form.get("currency") ?? ""),
      })
    ).id;
  } catch (e) {
    if (e instanceof ZodError) return { error: "Vérifiez le nom, le pays et la devise." };
    throw e;
  }
  redirect(`/app/${id}`);
}
