/**
 * Shared helpers for operator-run admin HTTP functions (x-admin-secret guard
 * + symbol-list normalization). First extracted for backfillSwingSets (#127);
 * the historical-options trigger handlers carry their own copies — migrate
 * them here next time they're touched.
 */
import type { Request, Response } from 'express';
import type { SecretParam } from 'firebase-functions/params';

/** 403s and returns false unless x-admin-secret matches the secret param. */
export function requireAdminSecret(req: Request, res: Response, secret: SecretParam): boolean {
  const expected = String(secret.value() || '').trim();
  const provided = String(req.headers['x-admin-secret'] || '').trim();
  if (!expected || !provided || expected !== provided) {
    res.status(403).json({ ok: false, error: 'Forbidden' });
    return false;
  }
  return true;
}

/**
 * Normalizes a `symbols` body field (string[] or comma-separated string) to a
 * deduped uppercase list. Returns undefined when the field is absent — an
 * explicit empty result (`[]`) is preserved so callers can distinguish
 * "not provided" from "provided but empty".
 */
export function normalizeSymbolList(raw: unknown): string[] | undefined {
  const list = Array.isArray(raw)
    ? raw
    : typeof raw === 'string'
      ? raw.split(',')
      : undefined;
  return list
    ?.map((s) => String(s).trim().toUpperCase())
    .filter(Boolean)
    .filter((s, i, arr) => arr.indexOf(s) === i);
}
