/**
 * Secret redaction utility for security logs, error messages, and history.
 */

export function redactSecrets(
  text: string,
  additionalSecrets: string[] = [],
): string {
  if (!text) return text;
  let redacted = text;

  // Redact known explicit secrets if provided
  for (const secret of additionalSecrets) {
    if (secret && secret.length >= 6) {
      redacted = redacted.replaceAll(secret, "[REDACTED_SECRET]");
    }
  }

  // Redact Gemini / Google AI keys
  redacted = redacted.replace(
    /AIza[0-9A-Za-z\-_]{30,45}/g,
    "[REDACTED_SECRET]",
  );
  redacted = redacted.replace(
    /AQ\.[0-9A-Za-z\-_]{30,80}/g,
    "[REDACTED_SECRET]",
  );

  // Redact other well-known token formats
  redacted = redacted.replace(
    /gh[pousr]_[A-Za-z0-9_]{36,255}/g,
    "[REDACTED_SECRET]",
  );
  redacted = redacted.replace(/AKIA[0-9A-Z]{16}/g, "[REDACTED_SECRET]");
  redacted = redacted.replace(
    /-----BEGIN [A-Z]+ PRIVATE KEY-----[^-]+-----END [A-Z]+ PRIVATE KEY-----/gs,
    "[REDACTED_SECRET]",
  );

  // Redact generic key: value or key=value patterns
  redacted = redacted.replace(
    /(api[_-]?key|secret|token|password|auth|bearer)(\s*[:=]\s*['"]?)[a-zA-Z0-9_\-\.]{8,}['"]?/gi,
    "$1$2[REDACTED]",
  );

  return redacted;
}

export function redactObject<T>(obj: T, additionalSecrets: string[] = []): T {
  if (typeof obj === "string") {
    return redactSecrets(obj, additionalSecrets) as unknown as T;
  }
  if (Array.isArray(obj)) {
    return obj.map((item) =>
      redactObject(item, additionalSecrets),
    ) as unknown as T;
  }
  if (obj !== null && typeof obj === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      if (
        /key|secret|token|password|auth/i.test(key) &&
        typeof value === "string"
      ) {
        result[key] = "[REDACTED]";
      } else {
        result[key] = redactObject(value, additionalSecrets);
      }
    }
    return result as T;
  }
  return obj;
}
