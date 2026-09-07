/**
 * Real calls to Sumplus production services. Everything here is read-only:
 * the cashier demonstrates control and proof, it does not move funds.
 */

export const ARSENAL = "https://arsenal.sumplus.xyz";
export const ROUTER = "https://router.sumplus.xyz";

/** Published rate per call, in micro-dollars. Metering uses these, not guesses. */
export const RATE_CARD: Record<string, number> = {
  "catalog.read": 1_000,
  "skill.search": 4_000,
  "quote.read": 12_000,
  "attestation.read": 1_000,
  // Priced above the per-call ceiling on purpose: the demo needs a call the
  // policy has to refuse, or the controls are never seen doing anything.
  "portfolio.rebalance": 90_000,
};

/**
 * The local proxy drops long-lived TLS connections at about five seconds, so a
 * single failure says nothing about whether the upstream is healthy.
 */
async function getJson<T>(url: string, tries = 4, timeoutMs = 20_000): Promise<T> {
  let last: unknown;
  for (let attempt = 0; attempt < tries; attempt += 1) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      const res = await fetch(url, {
        signal: controller.signal,
        cache: "no-store",
        headers: { accept: "application/json" },
      });
      clearTimeout(timer);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()) as T;
    } catch (err) {
      last = err;
      await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
    }
  }
  throw last instanceof Error ? last : new Error(String(last));
}

export type Categories = { categories: string[]; count: number };

export async function arsenalCategories(): Promise<Categories> {
  return getJson<Categories>(`${ARSENAL}/api/categories`);
}

export type SkillHit = { id?: string; name?: string; description?: string; category?: string };

export async function arsenalSkills(query: string): Promise<SkillHit[]> {
  const body = await getJson<unknown>(
    `${ARSENAL}/api/skills?search=${encodeURIComponent(query)}&limit=8`,
  );
  if (Array.isArray(body)) return body as SkillHit[];
  const wrapped = body as { skills?: SkillHit[]; results?: SkillHit[]; data?: SkillHit[] };
  return wrapped.skills ?? wrapped.results ?? wrapped.data ?? [];
}

export type Attestation = {
  mode: string;
  measurement: string;
  audience: string;
  providers: string[];
  uptime_seconds: number;
  build: { binary_sha256: string; models_digest: string; providers_digest: string };
};

export async function routerAttestation(): Promise<Attestation> {
  return getJson<Attestation>(`${ROUTER}/attestation`);
}

export type RekorAnchor = {
  anchored: boolean;
  rekor: {
    log_index: number;
    log_id: string;
    uuid: string;
    rekor_url: string;
    integrated_time: number;
    anchored_entry: { binary_sha256: string; measurement: string; index: number };
  };
};

export async function routerRekor(): Promise<RekorAnchor> {
  return getJson<RekorAnchor>(`${ROUTER}/v1/rekor`);
}

/** Where anyone can look the anchor up, on infrastructure Sumplus does not run. */
export function rekorPublicUrl(logIndex: number): string {
  return `https://search.sigstore.dev/?logIndex=${logIndex}`;
}
