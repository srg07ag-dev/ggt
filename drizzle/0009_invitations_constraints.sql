-- Une seule invitation en attente par entreprise et par e-mail.
CREATE UNIQUE INDEX invitation_pending_unique ON "invitation" (company_id, email)
  WHERE accepted_at IS NULL AND revoked_at IS NULL;--> statement-breakpoint
-- On n'invite jamais directement un propriétaire : la propriété se transmet depuis la page des membres.
ALTER TABLE "invitation" ADD CONSTRAINT invitation_not_owner CHECK (role <> 'owner');--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT invitation_email_lower CHECK (email = lower(email));
