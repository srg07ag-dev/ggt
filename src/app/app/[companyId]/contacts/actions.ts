"use server";

import { revalidatePath } from "next/cache";
import { ZodError } from "zod";
import { requireUser } from "@/lib/session";
import { createContact } from "@/modules/core/contacts";
import { ForbiddenError } from "@/modules/core/tenant";

export async function createContactAction(companyId: string, _: { error?: string } | undefined, form: FormData) {
  const user = await requireUser();
  try {
    await createContact(user.id, companyId, {
      kind: form.get("kind") === "organization" ? "organization" : "person",
      name: String(form.get("name") ?? ""),
      email: String(form.get("email") ?? ""),
      phone: String(form.get("phone") ?? "") || undefined,
    });
  } catch (e) {
    if (e instanceof ZodError) return { error: "Nom requis et e-mail valide." };
    if (e instanceof ForbiddenError) return { error: "Vous n'avez pas le droit de créer un contact." };
    throw e;
  }
  revalidatePath(`/app/${companyId}/contacts`);
  return undefined;
}
