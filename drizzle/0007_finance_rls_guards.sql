ALTER TABLE "finance_account" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "finance_account" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "finance_account"
  USING (company_id = nullif(current_setting('app.company_id', true), '')::uuid)
  WITH CHECK (company_id = nullif(current_setting('app.company_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "supplier" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "supplier" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "supplier"
  USING (company_id = nullif(current_setting('app.company_id', true), '')::uuid)
  WITH CHECK (company_id = nullif(current_setting('app.company_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "finance_category" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "finance_category" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "finance_category"
  USING (company_id = nullif(current_setting('app.company_id', true), '')::uuid)
  WITH CHECK (company_id = nullif(current_setting('app.company_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "finance_entry" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "finance_entry" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "finance_entry"
  USING (company_id = nullif(current_setting('app.company_id', true), '')::uuid)
  WITH CHECK (company_id = nullif(current_setting('app.company_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "attachment" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "attachment" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "attachment"
  USING (company_id = nullif(current_setting('app.company_id', true), '')::uuid)
  WITH CHECK (company_id = nullif(current_setting('app.company_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "finance_entry" ADD CONSTRAINT finance_entry_amounts CHECK (amount_minor > 0 AND tax_minor >= 0 AND tax_minor <= amount_minor);--> statement-breakpoint
ALTER TABLE "finance_entry" ADD CONSTRAINT finance_entry_party CHECK ((kind = 'income' AND supplier_id IS NULL) OR (kind = 'expense' AND contact_id IS NULL));--> statement-breakpoint
ALTER TABLE "attachment" ADD CONSTRAINT attachment_size CHECK (size_bytes > 0 AND size_bytes <= 10485760);--> statement-breakpoint

-- Une catégorie de dépense ne peut pas être utilisée pour une recette, et inversement.
CREATE FUNCTION finance_entry_check_category() RETURNS trigger AS $$
DECLARE cat_kind entry_kind;
BEGIN
  IF NEW.category_id IS NOT NULL THEN
    SELECT kind INTO cat_kind FROM finance_category WHERE id = NEW.category_id;
    IF cat_kind IS DISTINCT FROM NEW.kind THEN
      RAISE EXCEPTION 'La catégorie ne correspond pas au type d''opération';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER finance_entry_check_category BEFORE INSERT ON "finance_entry"
  FOR EACH ROW EXECUTE FUNCTION finance_entry_check_category();--> statement-breakpoint

-- Opérations en ajout seul : seule l'annulation (voided_at) est possible.
CREATE FUNCTION finance_entry_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Une opération ne peut pas être supprimée, annulez-la';
  END IF;
  IF OLD.voided_at IS NOT NULL OR (to_jsonb(NEW) - 'voided_at') IS DISTINCT FROM (to_jsonb(OLD) - 'voided_at') THEN
    RAISE EXCEPTION 'Une opération ne peut pas être modifiée';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER finance_entry_guard BEFORE UPDATE OR DELETE ON "finance_entry"
  FOR EACH ROW EXECUTE FUNCTION finance_entry_guard();--> statement-breakpoint

-- Justificatifs : immuables (le fichier et son empreinte ne changent jamais) ; suppression possible, tracée dans l'audit.
CREATE FUNCTION attachment_guard() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Un justificatif ne peut pas être modifié';
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER attachment_guard BEFORE UPDATE ON "attachment"
  FOR EACH ROW EXECUTE FUNCTION attachment_guard();
