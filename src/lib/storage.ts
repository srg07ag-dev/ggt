import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

const root = () => path.resolve(/*turbopackIgnore: true*/ process.env.STORAGE_DIR || ".storage");
/** Chemin complet d'une clé déjà validée (UUID/UUID) : jamais de saisie utilisateur dans le chemin. */
const full = (key: string) => path.join(/*turbopackIgnore: true*/ root(), key);
const KEY_RE = /^[0-9a-f-]{36}\/[0-9a-f-]{36}$/;

export class UploadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UploadError";
  }
}

/** Détecte le vrai type d'après le contenu : le type annoncé par le navigateur n'est jamais cru. */
export function sniffContentType(b: Buffer): { type: string; ext: string } | null {
  if (b.subarray(0, 5).toString("latin1") === "%PDF-") return { type: "application/pdf", ext: "pdf" };
  if (b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { type: "image/png", ext: "png" };
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { type: "image/jpeg", ext: "jpg" };
  if (b.subarray(0, 4).toString("latin1") === "RIFF" && b.subarray(8, 12).toString("latin1") === "WEBP") return { type: "image/webp", ext: "webp" };
  return null;
}

export function safeFilename(name: string, ext: string): string {
  const base = name.split(/[\\/]/).pop() ?? "";
  const cleaned = base.replace(/[\u0000-\u001f"<>:|?*]/g, "").trim().slice(0, 120);
  const stem = cleaned.replace(/\.[^.]*$/, "") || "justificatif";
  return `${stem}.${ext}`;
}

export async function putPrivateFile(companyId: string, data: Buffer) {
  if (data.length === 0) throw new UploadError("Fichier vide.");
  if (data.length > MAX_UPLOAD_BYTES) throw new UploadError("Fichier trop volumineux (10 Mo maximum).");
  const kind = sniffContentType(data);
  if (!kind) throw new UploadError("Format non pris en charge (PDF, PNG, JPEG ou WebP).");
  const key = `${companyId}/${randomUUID()}`;
  const target = full(key);
  await mkdir(/*turbopackIgnore: true*/ path.dirname(target), { recursive: true });
  await writeFile(/*turbopackIgnore: true*/ target, data, { flag: "wx", mode: 0o600 });
  return { key, ...kind, sizeBytes: data.length, sha256: createHash("sha256").update(data).digest("hex") };
}

export async function getPrivateFile(key: string): Promise<Buffer> {
  if (!KEY_RE.test(key)) throw new Error("Clé de stockage invalide");
  return readFile(/*turbopackIgnore: true*/ full(key));
}

export async function deletePrivateFile(key: string) {
  if (!KEY_RE.test(key)) return;
  await rm(/*turbopackIgnore: true*/ full(key), { force: true });
}
