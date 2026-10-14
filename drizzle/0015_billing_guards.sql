ALTER TABLE "plan" ADD CONSTRAINT plan_values CHECK (price_minor >= 0 AND trial_days BETWEEN 0 AND 365 AND currency ~ '^[A-Z]{3}$' AND code ~ '^[a-z0-9][a-z0-9-]{1,39}$');--> statement-breakpoint
-- Une seule offre par défaut active.
CREATE UNIQUE INDEX plan_single_default ON "plan" ((true)) WHERE is_default AND archived_at IS NULL;--> statement-breakpoint
ALTER TABLE "billing_invoice" ADD CONSTRAINT billing_invoice_amount CHECK (amount_minor >= 0 AND period_end > period_start);--> statement-breakpoint
-- Une seule facture d'abonnement non annulée par entreprise et par début de période : le renouvellement est idempotent.
CREATE UNIQUE INDEX billing_invoice_period_unique ON "billing_invoice" (company_id, period_start) WHERE status <> 'void';--> statement-breakpoint

-- Une facture d'abonnement émise est figée : seuls le statut et les informations de paiement évoluent (open → paid ou void, définitifs).
CREATE FUNCTION billing_invoice_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Une facture d''abonnement ne peut pas être supprimée : annulez-la';
  END IF;
  IF (to_jsonb(NEW) - 'status' - 'paid_at' - 'payment_method' - 'payment_reference' - 'provider')
     IS DISTINCT FROM (to_jsonb(OLD) - 'status' - 'paid_at' - 'payment_method' - 'payment_reference' - 'provider') THEN
    RAISE EXCEPTION 'Une facture d''abonnement émise ne peut pas être modifiée';
  END IF;
  IF OLD.status <> 'open' AND (NEW.status <> OLD.status OR NEW.paid_at IS DISTINCT FROM OLD.paid_at) THEN
    RAISE EXCEPTION 'Une facture payée ou annulée est définitive';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER billing_invoice_guard BEFORE UPDATE OR DELETE ON "billing_invoice" FOR EACH ROW EXECUTE FUNCTION billing_invoice_guard();--> statement-breakpoint

CREATE FUNCTION platform_audit_guard() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Le journal d''audit de la plateforme est en ajout seul';
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER platform_audit_guard BEFORE UPDATE OR DELETE ON "platform_audit_log" FOR EACH ROW EXECUTE FUNCTION platform_audit_guard();--> statement-breakpoint

ALTER TABLE "platform_settings" ADD CONSTRAINT platform_settings_singleton CHECK (id = 1 AND grace_days BETWEEN 0 AND 60);--> statement-breakpoint
INSERT INTO "platform_settings" (id) VALUES (1) ON CONFLICT DO NOTHING;--> statement-breakpoint

-- Défense en profondeur : le droit d'administrateur de plateforme ne s'accorde que par le script d'exploitation
-- (qui active app.platform_admin_op dans sa transaction), jamais par une requête applicative ordinaire.
CREATE FUNCTION user_platform_admin_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.is_platform_admin AND coalesce(current_setting('app.platform_admin_op', true), '') <> 'on' THEN
      RAISE EXCEPTION 'Le droit d''administrateur de plateforme ne peut pas être attribué ainsi';
    END IF;
  ELSIF NEW.is_platform_admin IS DISTINCT FROM OLD.is_platform_admin AND coalesce(current_setting('app.platform_admin_op', true), '') <> 'on' THEN
    RAISE EXCEPTION 'Le droit d''administrateur de plateforme ne peut pas être modifié ainsi';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER user_platform_admin_guard BEFORE INSERT OR UPDATE ON "user" FOR EACH ROW EXECUTE FUNCTION user_platform_admin_guard();
