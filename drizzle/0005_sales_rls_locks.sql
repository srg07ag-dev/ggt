ALTER TABLE "tax_rate" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "tax_rate" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "tax_rate"
  USING (company_id = nullif(current_setting('app.company_id', true), '')::uuid)
  WITH CHECK (company_id = nullif(current_setting('app.company_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "product" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "product" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "product"
  USING (company_id = nullif(current_setting('app.company_id', true), '')::uuid)
  WITH CHECK (company_id = nullif(current_setting('app.company_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "numbering" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "numbering" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "numbering"
  USING (company_id = nullif(current_setting('app.company_id', true), '')::uuid)
  WITH CHECK (company_id = nullif(current_setting('app.company_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "numbering_counter" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "numbering_counter" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "numbering_counter"
  USING (company_id = nullif(current_setting('app.company_id', true), '')::uuid)
  WITH CHECK (company_id = nullif(current_setting('app.company_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "sales_document" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "sales_document" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "sales_document"
  USING (company_id = nullif(current_setting('app.company_id', true), '')::uuid)
  WITH CHECK (company_id = nullif(current_setting('app.company_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "sales_line" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "sales_line" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "sales_line"
  USING (company_id = nullif(current_setting('app.company_id', true), '')::uuid)
  WITH CHECK (company_id = nullif(current_setting('app.company_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "payment" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "payment" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "payment"
  USING (company_id = nullif(current_setting('app.company_id', true), '')::uuid)
  WITH CHECK (company_id = nullif(current_setting('app.company_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "sales_document" ADD CONSTRAINT sales_document_totals CHECK (total_minor = subtotal_minor + tax_minor AND total_minor >= 0);--> statement-breakpoint
ALTER TABLE "sales_line" ADD CONSTRAINT sales_line_positive CHECK (quantity_milli > 0 AND unit_price_minor >= 0 AND tax_rate_bp BETWEEN 0 AND 100000);--> statement-breakpoint
ALTER TABLE "payment" ADD CONSTRAINT payment_positive CHECK (amount_minor > 0);--> statement-breakpoint
ALTER TABLE "tax_rate" ADD CONSTRAINT tax_rate_range CHECK (rate_bp BETWEEN 0 AND 100000);--> statement-breakpoint

-- Une facture ou un avoir émis est définitivement figé. Un devis non brouillon n'accepte que des changements de statut.
CREATE FUNCTION sales_document_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'draft' THEN
      RAISE EXCEPTION 'Un document émis ne peut pas être supprimé';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.status <> 'draft' THEN
    IF OLD.type <> 'quote' THEN
      RAISE EXCEPTION 'Une facture ou un avoir émis ne peut plus être modifié';
    END IF;
    IF (to_jsonb(NEW) - 'status') IS DISTINCT FROM (to_jsonb(OLD) - 'status') THEN
      RAISE EXCEPTION 'Un devis envoyé ne peut plus être modifié';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER sales_document_guard BEFORE UPDATE OR DELETE ON "sales_document"
  FOR EACH ROW EXECUTE FUNCTION sales_document_guard();--> statement-breakpoint

CREATE FUNCTION sales_line_guard() RETURNS trigger AS $$
DECLARE parent_status doc_status; parent_id uuid;
BEGIN
  parent_id := CASE WHEN TG_OP = 'INSERT' THEN NEW.document_id ELSE OLD.document_id END;
  SELECT status INTO parent_status FROM sales_document WHERE id = parent_id;
  IF parent_status IS NOT NULL AND parent_status <> 'draft' THEN
    RAISE EXCEPTION 'Les lignes d''un document émis ne peuvent plus être modifiées';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER sales_line_guard BEFORE INSERT OR UPDATE OR DELETE ON "sales_line"
  FOR EACH ROW EXECUTE FUNCTION sales_line_guard();--> statement-breakpoint

-- Paiements : seule l'annulation (voided_at) est possible, jamais la modification ni la suppression.
CREATE FUNCTION payment_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Un paiement ne peut pas être supprimé, annulez-le';
  END IF;
  IF OLD.voided_at IS NOT NULL OR (to_jsonb(NEW) - 'voided_at') IS DISTINCT FROM (to_jsonb(OLD) - 'voided_at') THEN
    RAISE EXCEPTION 'Un paiement ne peut pas être modifié';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER payment_guard BEFORE UPDATE OR DELETE ON "payment"
  FOR EACH ROW EXECUTE FUNCTION payment_guard();
