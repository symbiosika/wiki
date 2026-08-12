/**
 * Wiki maintenance: compact over-long block ordering keys.
 *
 * Blocks are ordered by a fractional-index key that grows by ~1 character per
 * 4 appended blocks. Before migration 0008 those keys were capped at
 * `varchar(64)`, so a page reaching ~257 blocks could no longer be saved at all
 * (Postgres rejected the INSERT, the API answered 400). The migration removed
 * the ceiling; this script repairs the keys that already grew long, so the
 * index stays small and growth restarts from a compact base.
 *
 * Safe to run against a live system and safe to repeat: each page is rewritten
 * in its own transaction that locks the page row first, block order and content
 * are preserved, and nothing that would trigger re-embedding or summary
 * regeneration is touched. Pages already below the threshold are skipped.
 *
 * Usage:
 *   bun run wiki:rebalance-positions --dry-run
 *   bun run wiki:rebalance-positions
 *   bun run wiki:rebalance-positions --tenant=<tenantId> --threshold=32
 *
 * Output: { "ok": true, "candidates": <n>, "rebalanced": <n>, "pages": [ ... ] }
 */
import {
  DEFAULT_REBALANCE_THRESHOLD,
  rebalanceBlockPositions,
} from "../src/lib/wiki/rebalance-positions";

const arg = (name: string): string | undefined => {
  const hit = process.argv.slice(2).find((a) => a.startsWith(`--${name}=`));
  return hit?.slice(name.length + 3);
};
const flag = (name: string): boolean =>
  process.argv.slice(2).includes(`--${name}`);

async function main() {
  const tenantId = arg("tenant");
  const thresholdArg = arg("threshold");
  const threshold = thresholdArg ? parseInt(thresholdArg, 10) : undefined;
  const dryRun = flag("dry-run");

  if (thresholdArg && (!threshold || threshold < 1)) {
    throw new Error(`Invalid --threshold=${thresholdArg} (expected a positive integer)`);
  }

  const result = await rebalanceBlockPositions({
    ...(tenantId ? { tenantId } : {}),
    ...(threshold ? { threshold } : {}),
    dryRun,
  });

  console.log(
    JSON.stringify(
      {
        ok: true,
        dryRun,
        threshold: threshold ?? DEFAULT_REBALANCE_THRESHOLD,
        ...result,
      },
      null,
      2
    )
  );
  process.exit(0);
}

main().catch((error) => {
  console.error(
    JSON.stringify({ ok: false, error: `${error}` }, null, 2)
  );
  process.exit(1);
});
