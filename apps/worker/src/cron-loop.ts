/**
 * Cron-style loop runner for the triage → build → merge pipeline.
 *
 * Run with: pnpm --filter @support-agent/worker cron-loop
 *
 * Two independent loops:
 * - mainLoop: polls for queued runs (via API), chains completed runs
 * - chainLoop: catches any remaining chain transitions
 *
 * All operations go through the API HTTP endpoints — no direct Prisma access.
 */
import { parseEnv } from '@support-agent/config';
import { pollScenarioTargets } from './lib/polling-scenarios.js';

const POLL_INTERVAL_MS = 15_000; // 15 seconds
const CHAIN_INTERVAL_MS = 30_000;

async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function apiPost(path: string, token: string, body?: unknown): Promise<any> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
  };
  if (body) {
    headers['Content-Type'] = 'application/json';
  }
  const res = await fetch(`${process.env.API_BASE_URL ?? 'http://localhost:4441'}${path}`, {
    method: 'POST',
    headers,
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`API ${path} failed (${res.status}): ${text}`);
  }
  return res.json();
}

async function getDevToken(): Promise<string> {
  const res = await fetch(`${process.env.API_BASE_URL ?? 'http://localhost:4441'}/v1/auth/dev-login`);
  const data = await res.json() as { token: string };
  return data.token;
}

async function getRuns(token: string): Promise<any[]> {
  const res = await fetch(`${process.env.API_BASE_URL ?? 'http://localhost:4441'}/v1/runs?limit=100`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await res.json() as any;
  return Array.isArray(data) ? data : (data.items ?? data.data ?? []);
}

async function getRun(token: string, runId: string): Promise<any> {
  const res = await fetch(`${process.env.API_BASE_URL ?? 'http://localhost:4441'}/v1/runs/${runId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return res.json() as Promise<any>;
}

async function main() {
  const env = parseEnv();
  console.log('[cron-loop] Starting SupportAgent workflow loop');
  console.log(`[cron-loop] API: ${env.API_BASE_URL}`);
  console.log(`[cron-loop] Poll interval: ${POLL_INTERVAL_MS / 1000}s`);

  // Get initial token
  let token = await getDevToken();
  const lastPolledAtByTarget = new Map<string, number>();

  // Re-auth periodically (tokens expire after 24h, but get fresh one)
  async function ensureToken() {
    try {
      await fetch(`${env.API_BASE_URL}/v1/runs?limit=1`, {
        headers: { Authorization: `Bearer ${token}` },
      });
    } catch {
      token = await getDevToken();
    }
  }

  async function chainNext() {
    await ensureToken();
    try {
      const result = await apiPost('/v1/workflow-chain/chain-next', token);
      if (result.triageChained > 0 || result.buildChained > 0) {
        console.log(
          `[cron] Chained: ${result.triageChained} triage→build, ${result.buildChained} build→merge`,
        );
      }
    } catch (err) {
      console.warn('[cron] chain-next error:', err);
    }
  }

  async function dispatchNext() {
    await ensureToken();
    try {
      const result = await apiPost('/v1/dispatcher/dispatch-next', token);
      if (result.status === 'dispatched') {
        console.log(`[cron] Dispatched run: ${result.workflowRunId}`);
        return true;
      }
    } catch (err) {
      console.warn('[cron] dispatch-next error:', err);
    }
    return false;
  }

  async function pollNext() {
    await ensureToken();
    try {
      const result = await pollScenarioTargets({
        apiBaseUrl: env.API_BASE_URL,
        lastPolledAtByTarget,
        log: (message) => { console.log(message); },
        token,
      });

      if (
        result.targetsChecked > 0 ||
        result.created > 0 ||
        result.duplicate > 0 ||
        result.eventsEmitted > 0
      ) {
        console.log(
          `[polling] checked=${result.targetsChecked} events=${result.eventsEmitted} created=${result.created} duplicate=${result.duplicate}`,
        );
      }
    } catch (err) {
      console.warn('[polling] scenario scan error:', err);
    }
  }

  async function statusReport() {
    try {
      const runs = await getRuns(token);
      const counts = { queued: 0, running: 0, succeeded: 0, failed: 0, awaiting_review: 0 };
      for (const r of runs) {
        if (r.status in counts) counts[r.status as keyof typeof counts]++;
      }
      console.log(
        `[cron/status] queued=${counts.queued} running=${counts.running} ` +
        `succeeded=${counts.succeeded} failed=${counts.failed} awaiting_review=${counts.awaiting_review}`,
      );
    } catch {
      // ignore
    }
  }

  // ── Main polling loop ─────────────────────────────────────────────
  // Each tick: dispatch any queued runs, then chain any completed runs
  let cycle = 0;

  (async () => {
    // Background chain loop
    (async () => {
      while (true) {
        await sleep(CHAIN_INTERVAL_MS);
        await chainNext();
      }
    })();

    // Background status reporter
    (async () => {
      while (true) {
        await sleep(60_000);
        await statusReport();
      }
    })();

    while (true) {
      cycle++;
      const cycleId = cycle;

      // Dispatch next queued run
      const dispatched = await dispatchNext();

      // Scan any due polling targets for untriaged issues
      await pollNext();

      // Chain any completed triage/build runs
      await chainNext();

      // Log current state
      if (cycleId % 4 === 0) {
        await statusReport();
      }

      await sleep(POLL_INTERVAL_MS);
    }
  })().catch((err) => {
    console.error('[cron-loop] Fatal error:', err);
    process.exit(1);
  });
}

main();
