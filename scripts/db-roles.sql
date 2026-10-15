-- Rôles PostgreSQL de production (moindre privilège). À exécuter UNE fois, en superutilisateur, sur la base cible.
-- Remplacez les mots de passe (psql -v owner_pw=… -v app_pw=… -v backup_pw=… -d ggt -f scripts/db-roles.sql).
-- Ordre : 1) ce script, 2) migrations avec ggt_owner (npm run db:migrate). Les droits par défaut ci-dessous couvrent les tables créées ensuite.
CREATE ROLE ggt_owner LOGIN PASSWORD :'owner_pw';
CREATE ROLE ggt_app LOGIN PASSWORD :'app_pw' NOBYPASSRLS NOSUPERUSER NOCREATEDB NOCREATEROLE;
CREATE ROLE ggt_backup LOGIN PASSWORD :'backup_pw' BYPASSRLS;
GRANT pg_read_all_data TO ggt_backup;

ALTER DATABASE ggt OWNER TO ggt_owner;
GRANT CONNECT ON DATABASE ggt TO ggt_app, ggt_backup;
GRANT USAGE ON SCHEMA public TO ggt_app, ggt_backup;
ALTER DEFAULT PRIVILEGES FOR ROLE ggt_owner IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ggt_app;
ALTER DEFAULT PRIVILEGES FOR ROLE ggt_owner IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO ggt_app;
-- Après les migrations, retirer au rôle applicatif tout droit d'écriture sur les règles réglementaires (voir docs/OPERATIONS.md §2) :
--   REVOKE INSERT, UPDATE, DELETE ON ruleset FROM ggt_app;
