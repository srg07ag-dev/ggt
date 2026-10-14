/**
 * Administration des règles réglementaires (opérateurs de la plateforme, JAMAIS exposé aux entreprises).
 * Aucune règle n'est livrée avec le produit : chaque règle est proposée, puis validée par une personne nommée qui cite sa source.
 *
 *   npx tsx scripts/ruleset.ts propose regle.json
 *   npx tsx scripts/ruleset.ts validate <id> --source "Texte officiel, article, date" --by "Nom de l'expert"
 *   npx tsx scripts/ruleset.ts retire <id> --to 2026-12-31
 *   npx tsx scripts/ruleset.ts list TG
 *
 * regle.json : { "jurisdiction": "TG", "kind": "tax", "code": "…", "name": "…", "validFrom": "2026-01-01", "validTo": null, "payload": { … } }
 * Exécuter avec le rôle PostgreSQL de plateforme (le rôle applicatif n'a que le droit de lecture sur `ruleset`).
 */
import { readFileSync } from "node:fs";
import { sql } from "@/db/client";
import { listValidatedRulesets, proposeRuleset, retireRuleset, validateRuleset } from "@/modules/tax/rules";

const [cmd, arg, ...rest] = process.argv.slice(2);
const flag = (name: string) => {
  const i = rest.indexOf(`--${name}`);
  return i >= 0 ? rest[i + 1] : undefined;
};

try {
  if (cmd === "propose" && arg) {
    const r = await proposeRuleset(JSON.parse(readFileSync(arg, "utf8")));
    console.log(`Brouillon créé : ${r.id} (${r.jurisdiction}/${r.kind}/${r.code} v${r.version}). Il n'est pas appliqué tant qu'il n'est pas validé.`);
  } else if (cmd === "validate" && arg) {
    const r = await validateRuleset(arg, { sourceReference: flag("source") ?? "", validatedBy: flag("by") ?? "" });
    console.log(`Règle validée : ${r.id} v${r.version}. Elle est désormais immuable.`);
  } else if (cmd === "retire" && arg) {
    const r = await retireRuleset(arg, flag("to") ?? "");
    console.log(`Règle retirée : ${r.id}, valable jusqu'au ${r.validTo}.`);
  } else if (cmd === "list" && arg) {
    for (const r of await listValidatedRulesets(arg)) console.log(`${r.id}  ${r.kind}/${r.code} v${r.version}  ${r.validFrom} → ${r.validTo ?? "…"}  ${r.status}  ${r.name}`);
  } else {
    console.error("Usage : voir l'en-tête de scripts/ruleset.ts");
    process.exitCode = 2;
  }
} catch (e) {
  // message lisible plutôt qu'une trace d'exécution
  const issues = (e as { issues?: { message: string }[] }).issues;
  console.error(`Refusé : ${issues ? issues.map((i) => i.message).join(" ; ") : (e as Error).message}`);
  process.exitCode = 1;
} finally {
  await sql.end();
}
