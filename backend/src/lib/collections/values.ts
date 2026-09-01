/**
 * Field types, value coercion and validation.
 *
 * Records are jsonb, so nothing stops a caller from writing a string into a
 * number column — the guarantee has to be made here instead of by the database.
 * Every write goes through `validateRecordData`, which is the single place that
 * decides what a stored value looks like per type. Keeping coercion in one
 * module also keeps the three consumers consistent: the REST API, the markdown
 * renderer and (later) the MCP tools all agree on what "a date" is.
 *
 * Rules that hold for every type:
 *   - `null` means empty and is always allowed unless the field is required
 *   - empty string is normalised to `null`, so "cleared" and "never set" are
 *     the same state and filters do not have to special-case both
 */

import type {
  CollectionFieldSelect,
  CollectionFieldType,
} from "../../db/schema";

/** Raised for a value that cannot be stored in the given field. */
export class CollectionValueError extends Error {
  constructor(
    message: string,
    /** the field key the error belongs to, so the UI can mark the input */
    public readonly fieldKey: string,
  ) {
    super(message);
    this.name = "CollectionValueError";
  }
}

const isBlank = (value: unknown): boolean =>
  value === null ||
  value === undefined ||
  (typeof value === "string" && value.trim() === "");

/** ISO date, no time component — what a "date" column stores. */
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
/** Deliberately permissive: this rejects typos, it is not an RFC validator. */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const choiceValues = (field: CollectionFieldSelect): string[] =>
  (field.options?.choices ?? []).map((c) => c.value);

/**
 * Coerce and validate one value for one field.
 * Returns the value as it should be stored (never `undefined`).
 */
export function coerceValue(
  field: CollectionFieldSelect,
  raw: unknown,
): unknown {
  const type = field.type as CollectionFieldType;

  // multiSelect is the one type whose empty state is an array, not null
  if (type === "multiSelect") {
    if (raw === null || raw === undefined) return [];
    if (!Array.isArray(raw)) {
      throw new CollectionValueError(
        `Field "${field.label}" expects a list of values`,
        field.key,
      );
    }
    const allowed = choiceValues(field);
    const values = raw.map((entry) => String(entry));
    for (const value of values) {
      if (!allowed.includes(value)) {
        throw new CollectionValueError(
          `"${value}" is not an option of field "${field.label}"`,
          field.key,
        );
      }
    }
    // de-duplicate but keep the caller's order
    return [...new Set(values)];
  }

  // checkbox has no empty state either — absent means false
  if (type === "checkbox") {
    if (raw === null || raw === undefined) return false;
    if (typeof raw === "boolean") return raw;
    if (raw === "true" || raw === "false") return raw === "true";
    throw new CollectionValueError(
      `Field "${field.label}" expects true or false`,
      field.key,
    );
  }

  if (isBlank(raw)) return null;

  switch (type) {
    case "number": {
      const num = typeof raw === "number" ? raw : Number(String(raw).trim());
      if (!Number.isFinite(num)) {
        throw new CollectionValueError(
          `Field "${field.label}" expects a number`,
          field.key,
        );
      }
      const precision = field.options?.precision;
      return typeof precision === "number"
        ? Number(num.toFixed(Math.max(0, Math.min(10, precision))))
        : num;
    }

    case "date": {
      const value = String(raw).trim();
      // accept a full ISO timestamp and keep only the day
      const day = value.length > 10 ? value.slice(0, 10) : value;
      if (!DATE_RE.test(day) || Number.isNaN(Date.parse(day))) {
        throw new CollectionValueError(
          `Field "${field.label}" expects a date (YYYY-MM-DD)`,
          field.key,
        );
      }
      return day;
    }

    case "select": {
      const value = String(raw).trim();
      const allowed = choiceValues(field);
      if (!allowed.includes(value)) {
        throw new CollectionValueError(
          `"${value}" is not an option of field "${field.label}"`,
          field.key,
        );
      }
      return value;
    }

    case "email": {
      const value = String(raw).trim();
      if (!EMAIL_RE.test(value)) {
        throw new CollectionValueError(
          `Field "${field.label}" expects an email address`,
          field.key,
        );
      }
      return value;
    }

    case "url": {
      const value = String(raw).trim();
      // a bare "example.com" is what people actually type — make it a URL
      const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(value)
        ? value
        : `https://${value}`;
      try {
        const url = new URL(candidate);
        if (url.protocol !== "http:" && url.protocol !== "https:") {
          throw new Error("unsupported protocol");
        }
        return url.toString();
      } catch {
        throw new CollectionValueError(
          `Field "${field.label}" expects a web address`,
          field.key,
        );
      }
    }

    case "text":
    case "longText":
    default:
      return String(raw);
  }
}

/**
 * Validate a whole (partial) record against the collection's fields.
 *
 * `mode: "create"` checks every required field; `mode: "patch"` only validates
 * the keys actually present, so a partial update cannot be rejected for a
 * required field it does not touch. Unknown keys are dropped rather than
 * rejected — a column deleted between a client's page load and its save should
 * not turn into an error the user cannot act on.
 */
export function validateRecordData(
  fields: CollectionFieldSelect[],
  input: Record<string, unknown>,
  mode: "create" | "patch",
): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const field of fields) {
    const present = Object.prototype.hasOwnProperty.call(input, field.key);
    if (mode === "patch" && !present) continue;

    const value = coerceValue(field, present ? input[field.key] : null);

    if (field.required) {
      const empty =
        value === null ||
        (Array.isArray(value) && value.length === 0) ||
        (field.type === "checkbox" && value === false);
      if (empty) {
        throw new CollectionValueError(
          `Field "${field.label}" is required`,
          field.key,
        );
      }
    }

    result[field.key] = value;
  }

  return result;
}

/** Human-readable rendering of a stored value — used by the markdown mirror. */
export function formatValue(
  field: CollectionFieldSelect,
  value: unknown,
): string {
  if (value === null || value === undefined) return "";
  switch (field.type as CollectionFieldType) {
    case "checkbox":
      return value ? "yes" : "no";
    case "multiSelect":
      return Array.isArray(value) ? value.join(", ") : String(value);
    case "number": {
      const suffix = field.options?.suffix;
      return suffix ? `${value} ${suffix}` : String(value);
    }
    default:
      return String(value);
  }
}
