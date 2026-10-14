CREATE EXTENSION IF NOT EXISTS btree_gist;--> statement-breakpoint
ALTER TABLE "ledger_account" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "ledger_account" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "ledger_account"
  USING (company_id = nullif(current_setting('app.company_id', true), '')::uuid)
  WITH CHECK (company_id = nullif(current_setting('app.company_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "journal" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "journal" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "journal"
  USING (company_id = nullif(current_setting('app.company_id', true), '')::uuid)
  WITH CHECK (company_id = nullif(current_setting('app.company_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "fiscal_period" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "fiscal_period" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "fiscal_period"
  USING (company_id = nullif(current_setting('app.company_id', true), '')::uuid)
  WITH CHECK (company_id = nullif(current_setting('app.company_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "journal_entry" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "journal_entry" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "journal_entry"
  USING (company_id = nullif(current_setting('app.company_id', true), '')::uuid)
  WITH CHECK (company_id = nullif(current_setting('app.company_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "journal_line" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "journal_line" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "journal_line"
  USING (company_id = nullif(current_setting('app.company_id', true), '')::uuid)
  WITH CHECK (company_id = nullif(current_setting('app.company_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "entry_counter" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "entry_counter" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "entry_counter"
  USING (company_id = nullif(current_setting('app.company_id', true), '')::uuid)
  WITH CHECK (company_id = nullif(current_setting('app.company_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "accounting_settings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "accounting_settings" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "accounting_settings"
  USING (company_id = nullif(current_setting('app.company_id', true), '')::uuid)
  WITH CHECK (company_id = nullif(current_setting('app.company_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "company_tax_profile" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "company_tax_profile" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "company_tax_profile"
  USING (company_id = nullif(current_setting('app.company_id', true), '')::uuid)
  WITH CHECK (company_id = nullif(current_setting('app.company_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "tax_obligation" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "tax_obligation" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "tax_obligation"
  USING (company_id = nullif(current_setting('app.company_id', true), '')::uuid)
  WITH CHECK (company_id = nullif(current_setting('app.company_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "tax_event" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "tax_event" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "tax_event"
  USING (company_id = nullif(current_setting('app.company_id', true), '')::uuid)
  WITH CHECK (company_id = nullif(current_setting('app.company_id', true), '')::uuid);--> statement-breakpoint

ALTER TABLE "ledger_account" ADD CONSTRAINT ledger_account_code_format CHECK (code ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,19}$');--> statement-breakpoint
ALTER TABLE "fiscal_period" ADD CONSTRAINT fiscal_period_dates CHECK (end_date >= start_date);--> statement-breakpoint
-- Deux périodes d'une même entreprise ne peuvent pas se chevaucher.
ALTER TABLE "fiscal_period" ADD CONSTRAINT fiscal_period_no_overlap EXCLUDE USING gist (company_id WITH =, daterange(start_date, end_date, '[]') WITH &&);--> statement-breakpoint
ALTER TABLE "journal_line" ADD CONSTRAINT journal_line_amounts CHECK (debit_minor >= 0 AND credit_minor >= 0 AND (debit_minor = 0 OR credit_minor = 0) AND debit_minor + credit_minor > 0);--> statement-breakpoint
-- Une écriture automatique (facture, paiement…) n'existe qu'une fois par source : la comptabilisation est idempotente.
CREATE UNIQUE INDEX journal_entry_source_unique ON "journal_entry" (company_id, source_type, source_id) WHERE source_id IS NOT NULL;--> statement-breakpoint

-- Code et type d'un compte comptable ne changent jamais (on en crée un nouveau).
CREATE FUNCTION ledger_account_guard() RETURNS trigger AS $$
BEGIN
  IF NEW.code <> OLD.code OR NEW.type <> OLD.type THEN
    RAISE EXCEPTION 'Le code et le type d''un compte comptable ne peuvent pas être modifiés';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER ledger_account_guard BEFORE UPDATE ON "ledger_account" FOR EACH ROW EXECUTE FUNCTION ledger_account_guard();--> statement-breakpoint

-- Les lignes d'une écriture validée sont figées.
CREATE FUNCTION journal_line_guard() RETURNS trigger AS $$
DECLARE parent_status journal_entry_status; parent_id uuid;
BEGIN
  parent_id := CASE WHEN TG_OP = 'INSERT' THEN NEW.entry_id ELSE OLD.entry_id END;
  SELECT status INTO parent_status FROM journal_entry WHERE id = parent_id;
  IF parent_status IS NOT NULL AND parent_status <> 'draft' THEN
    RAISE EXCEPTION 'Les lignes d''une écriture validée ne peuvent plus être modifiées';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER journal_line_guard BEFORE INSERT OR UPDATE OR DELETE ON "journal_line" FOR EACH ROW EXECUTE FUNCTION journal_line_guard();--> statement-breakpoint

-- Une écriture naît toujours brouillon ; la validation vérifie l'équilibre, la période et les comptes ; une écriture validée est immuable.
CREATE FUNCTION journal_entry_insert_guard() RETURNS trigger AS $$
BEGIN
  IF NEW.status <> 'draft' THEN
    RAISE EXCEPTION 'Une écriture est créée en brouillon puis validée';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER journal_entry_insert_guard BEFORE INSERT ON "journal_entry" FOR EACH ROW EXECUTE FUNCTION journal_entry_insert_guard();--> statement-breakpoint

CREATE FUNCTION journal_entry_guard() RETURNS trigger AS $$
DECLARE
  p fiscal_period%ROWTYPE;
  n int; d numeric; c numeric; archived int;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'draft' THEN
      RAISE EXCEPTION 'Une écriture validée ne peut pas être supprimée : contre-passez-la';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.status = 'posted' THEN
    RAISE EXCEPTION 'Une écriture validée ne peut pas être modifiée : contre-passez-la';
  END IF;
  IF NEW.status = 'posted' THEN
    IF NEW.number IS NULL OR NEW.period_id IS NULL OR NEW.posted_at IS NULL THEN
      RAISE EXCEPTION 'Numéro, période et date de validation requis';
    END IF;
    SELECT * INTO p FROM fiscal_period WHERE id = NEW.period_id;
    IF NOT FOUND OR p.status <> 'open' THEN
      RAISE EXCEPTION 'La période comptable est clôturée ou inexistante';
    END IF;
    IF NEW.entry_date < p.start_date OR NEW.entry_date > p.end_date THEN
      RAISE EXCEPTION 'La date de l''écriture est hors de sa période';
    END IF;
    SELECT count(*), coalesce(sum(debit_minor), 0), coalesce(sum(credit_minor), 0) INTO n, d, c FROM journal_line WHERE entry_id = NEW.id;
    IF n < 2 THEN RAISE EXCEPTION 'Une écriture comporte au moins deux lignes'; END IF;
    IF d <> c THEN RAISE EXCEPTION 'Écriture déséquilibrée : débit % ≠ crédit %', d, c; END IF;
    IF d <= 0 THEN RAISE EXCEPTION 'Le montant de l''écriture doit être positif'; END IF;
    SELECT count(*) INTO archived FROM journal_line l JOIN ledger_account a ON a.id = l.account_id WHERE l.entry_id = NEW.id AND a.archived_at IS NOT NULL;
    IF archived > 0 THEN RAISE EXCEPTION 'Une ligne utilise un compte archivé'; END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER journal_entry_guard BEFORE UPDATE OR DELETE ON "journal_entry" FOR EACH ROW EXECUTE FUNCTION journal_entry_guard();--> statement-breakpoint

-- Périodes : pas de modification des dates d'une période utilisée ; pas de clôture avec des brouillons dans la période.
CREATE FUNCTION fiscal_period_guard() RETURNS trigger AS $$
DECLARE used int; drafts int;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status = 'closed' THEN RAISE EXCEPTION 'Une période clôturée ne peut pas être supprimée'; END IF;
    RETURN OLD;
  END IF;
  IF (NEW.start_date <> OLD.start_date OR NEW.end_date <> OLD.end_date) THEN
    SELECT count(*) INTO used FROM journal_entry WHERE period_id = OLD.id;
    IF used > 0 OR OLD.status = 'closed' THEN RAISE EXCEPTION 'Les dates d''une période utilisée ou clôturée ne peuvent pas changer'; END IF;
  END IF;
  IF OLD.status = 'open' AND NEW.status = 'closed' THEN
    SELECT count(*) INTO drafts FROM journal_entry WHERE company_id = NEW.company_id AND status = 'draft' AND entry_date BETWEEN NEW.start_date AND NEW.end_date;
    IF drafts > 0 THEN RAISE EXCEPTION 'Validez ou supprimez les % brouillon(s) de la période avant de la clôturer', drafts; END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER fiscal_period_guard BEFORE UPDATE OR DELETE ON "fiscal_period" FOR EACH ROW EXECUTE FUNCTION fiscal_period_guard();--> statement-breakpoint

-- Règles réglementaires : une règle validée est immuable (nouvelle version pour toute évolution) et cite sa source.
ALTER TABLE "ruleset" ADD CONSTRAINT ruleset_validated_has_source CHECK (status = 'draft' OR (source_reference IS NOT NULL AND validated_by IS NOT NULL AND validated_at IS NOT NULL));--> statement-breakpoint
ALTER TABLE "ruleset" ADD CONSTRAINT ruleset_dates CHECK (valid_to IS NULL OR valid_to >= valid_from);--> statement-breakpoint
ALTER TABLE "ruleset" ADD CONSTRAINT ruleset_jurisdiction_format CHECK (jurisdiction ~ '^[A-Z]{2}$');--> statement-breakpoint
ALTER TABLE "ruleset" ADD CONSTRAINT ruleset_no_overlap EXCLUDE USING gist (jurisdiction WITH =, kind WITH =, code WITH =, daterange(valid_from, valid_to, '[]') WITH &&) WHERE (status = 'validated');--> statement-breakpoint
CREATE FUNCTION ruleset_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'draft' THEN RAISE EXCEPTION 'Une règle validée ne peut pas être supprimée : retirez-la'; END IF;
    RETURN OLD;
  END IF;
  IF OLD.status <> 'draft' THEN
    IF NEW.status = 'draft' THEN RAISE EXCEPTION 'Une règle validée ne redevient pas brouillon'; END IF;
    IF (to_jsonb(NEW) - 'status' - 'valid_to') IS DISTINCT FROM (to_jsonb(OLD) - 'status' - 'valid_to') THEN
      RAISE EXCEPTION 'Une règle validée est immuable : créez une nouvelle version';
    END IF;
    IF OLD.status = 'retired' THEN RAISE EXCEPTION 'Une règle retirée est définitive'; END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER ruleset_guard BEFORE UPDATE OR DELETE ON "ruleset" FOR EACH ROW EXECUTE FUNCTION ruleset_guard();--> statement-breakpoint

-- Historique fiscal en ajout seul.
CREATE FUNCTION tax_event_guard() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'L''historique fiscal est en ajout seul';
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER tax_event_guard BEFORE UPDATE OR DELETE ON "tax_event" FOR EACH ROW EXECUTE FUNCTION tax_event_guard();
