import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import type { AppContext } from "../context.js";
import { WanderlogValidationError } from "../errors.js";

/**
 * Local, authenticated, AES-256-GCM state for sensitive trip snapshots and planning drafts.
 *
 * A deliberately explicit storage key is required. Session cookies are not suitable
 * encryption keys: rotating a session would make stored backups impossible to restore.
 */
type Kind = "previews" | "protections" | "backups" | "restore-previews";
type Encrypted = { version: 1; iv: string; tag: string; ciphertext: string };

const KEY_NAME = "WANDERLOG_MCP_STATE_KEY";
const STATE_DIR = "WANDERLOG_MCP_STATE_DIR";

export function stateKey(): Buffer {
  const source = process.env[KEY_NAME] ?? "";
  const validHex = /^[a-f0-9]{64}$/i.test(source);
  const bytes = validHex ? Buffer.from(source, "hex") : Buffer.from(source, "base64");
  if (bytes.length !== 32) {
    throw new WanderlogValidationError(
      "Encrypted advanced tools require WANDERLOG_MCP_STATE_KEY (32 bytes, hex or base64).",
      "Generate a stable secret with 'openssl rand -hex 32' and configure it privately.",
    );
  }
  return bytes;
}

export function stateHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function statePath(ctx: AppContext, trip: string, kind: Kind, id: string) {
  if (!/^[a-zA-Z0-9_-]{4,100}$/.test(trip) || !/^[a-zA-Z0-9_-]{1,100}$/.test(id)) {
    throw new WanderlogValidationError("Invalid trip key or state identifier.");
  }
  if (!Number.isSafeInteger(ctx.userId) || !ctx.userId || ctx.userId < 1) {
    throw new WanderlogValidationError("Authenticated user ID is required for stored state.");
  }
  const root = process.env[STATE_DIR] || join(homedir(), ".wanderlog-mcp", "state");
  return join(root, String(ctx.userId), trip, kind, id + ".json");
}

export function newStateId(): string {
  return randomUUID();
}

export async function saveState(
  ctx: AppContext,
  trip: string,
  kind: Kind,
  id: string,
  value: unknown,
): Promise<void> {
  const key = stateKey();
  const path = statePath(ctx, trip, kind, id);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const data = Buffer.from(JSON.stringify(value), "utf8");
  const ciphertext = Buffer.concat([cipher.update(data), cipher.final()]);
  const encrypted: Encrypted = {
    version: 1,
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    ciphertext: ciphertext.toString("base64"),
  };
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = path + "." + randomUUID() + ".tmp";
  await writeFile(temporary, JSON.stringify(encrypted), { flag: "wx", mode: 0o600 });
  await rename(temporary, path);
}

export async function loadState<T>(
  ctx: AppContext,
  trip: string,
  kind: Kind,
  id: string,
): Promise<T> {
  const key = stateKey();
  const path = statePath(ctx, trip, kind, id);
  let content: Encrypted;
  try {
    content = JSON.parse(await readFile(path, "utf8")) as Encrypted;
  } catch {
    throw new WanderlogValidationError("Stored record not found or unavailable.");
  }
  try {
    if (content.version !== 1) throw new Error("Unsupported state format");
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(content.iv, "base64"));
    decipher.setAuthTag(Buffer.from(content.tag, "base64"));
    return JSON.parse(
      Buffer.concat([
        decipher.update(Buffer.from(content.ciphertext, "base64")),
        decipher.final(),
      ]).toString("utf8"),
    ) as T;
  } catch {
    throw new WanderlogValidationError("Stored record could not be decrypted or verified.");
  }
}

export async function listStateIds(ctx: AppContext, trip: string, kind: Kind): Promise<string[]> {
  stateKey();
  const dir = dirname(statePath(ctx, trip, kind, "dummy"));
  try {
    const names = await readdir(dir);
    return names
      .filter((name) => /^[a-zA-Z0-9_-]{1,100}\.json$/.test(name))
      .map((name) => name.slice(0, -5));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}
