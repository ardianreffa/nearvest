// TaniBot's AI brain on NEAR AI Cloud (OpenAI-compatible chat completions).
//
// The AI only SUGGESTS actions as JSON; tanibot.ts checks every suggestion
// against the game rules and the contract limits before doing anything, so a
// wrong or tricked answer can never break a rule or overspend. Every call is
// counted with its estimated cost; a daily call limit and a total dollar brake
// stop the AI (TaniBot then uses its simple rules).

import type { DB } from './db.ts';

export const DEFAULT_AI_MODEL = 'Qwen/Qwen3-VL-30B-A3B-Instruct';
export const NEAR_AI_URL = 'https://cloud-api.near.ai/v1/chat/completions';
/** US$ per 1M tokens (NEAR AI Cloud model list, 2026-11-07). Unknown models use the default price. */
const PRICES: Record<string, { input: number; output: number }> = {
  'Qwen/Qwen3-VL-30B-A3B-Instruct': { input: 0.15, output: 0.55 },
};
const DEFAULT_PRICE = { input: 0.15, output: 0.55 };
const TIMEOUT_MS = 20_000;
const MAX_REASON = 140;

export interface BrainTree {
  plot: number; // 1-based for the AI
  species: string;
  quality: string;
  stage: string;
  ripe: boolean;
  watered: boolean;
  fertilized: boolean;
}

export interface BrainInput {
  style: string;
  budget: number;
  budgetLeftToday: number;
  fertilizerInStorage: number;
  trees: BrainTree[];
  fruits: { species: string; quality: string; qty: number }[];
  darto: { species: string; price: number; normal: number }[];
  shop: { fertilizer: number };
}

export type BrainAction =
  | { action: 'harvest' | 'water' | 'fertilize'; plot: number; reason: string }
  | { action: 'buy'; item: string; qty: number; reason: string }
  | { action: 'sell'; species: string; quality: string; qty: number; reason: string };

export interface BrainDecision {
  actions: BrainAction[];
  /** Suggestions that were not even well-formed (counted as ignored). */
  malformed: number;
  summary: string;
}

export interface BrainResult {
  decision: BrainDecision;
  model: string;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
}

/** Anything that can decide a round (NEAR AI in the game, a fake in tests). */
export interface Brain {
  readonly model: string;
  decide(input: BrainInput): Promise<BrainResult>;
}

export const SYSTEM_PROMPT = `You are TaniBot, a careful AI farmer robot in the pixel farming game NEARvest. Decide this round's work in the player's garden.
Checklist, in this order:
1. Harvest every tree with "ripe": true.
2. Water every tree with "watered": false. Never skip this.
3. Fertilize according to the style. If "fertilizerInStorage" is 0, add {"action":"buy","item":"fertilizer","qty":1} BEFORE the fertilize. Buy at most 1 per round, only if "budgetLeftToday" and "budget" are both at least the shop price.
4. Sell Common fruit when Mr. Darto's price is at least the normal price (turbo: sell right away). Never sell Rare or Gold fruit: that is the player's decision.
Styles: thrifty = never buy, never fertilize; balanced = fertilize only slow trees (rambutan, durian); turbo = fertilize every growing tree.
Allowed actions:
{"action":"harvest","plot":N} {"action":"water","plot":N} {"action":"fertilize","plot":N}
{"action":"buy","item":"fertilizer","qty":1} {"action":"sell","species":"mango|rambutan|durian","quality":"common","qty":N}
Every action has "reason": a short English reason for the player, at most 15 words, friendly.
Use ONLY the data given: "ripe": true means harvest it now; "watered": true means it needs no water. Do not add actions that are not needed.
Answer ONLY with JSON: {"actions":[...],"summary":"one short English sentence about what you did"}`;

/** Reads the model's answer: plain JSON or JSON inside a ```json fence. Throws on anything else. */
export function parseDecision(text: string): BrainDecision {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = (fenced ? fenced[1] : text).trim();
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('AI answer is not JSON');
  const data = JSON.parse(raw.slice(start, end + 1)) as { actions?: unknown; summary?: unknown };
  if (!Array.isArray(data.actions)) throw new Error('AI answer has no "actions" list');
  const clean = (s: unknown) => (typeof s === 'string' ? s.replace(/\s+/g, ' ').trim().slice(0, MAX_REASON) : '');
  const actions: BrainAction[] = [];
  let malformed = 0;
  for (const a of data.actions.slice(0, 20) as Record<string, unknown>[]) {
    const reason = clean(a?.reason) || 'No reason given.';
    if (a && (a.action === 'harvest' || a.action === 'water' || a.action === 'fertilize') && Number.isInteger(a.plot)) {
      actions.push({ action: a.action, plot: a.plot as number, reason });
    } else if (a && a.action === 'buy' && typeof a.item === 'string' && Number.isInteger(a.qty ?? 1)) {
      actions.push({ action: 'buy', item: a.item, qty: (a.qty as number | undefined) ?? 1, reason });
    } else if (a && a.action === 'sell' && typeof a.species === 'string' && typeof a.quality === 'string' && Number.isInteger(a.qty)) {
      actions.push({ action: 'sell', species: a.species, quality: a.quality, qty: a.qty as number, reason });
    } else {
      malformed++;
    }
  }
  return { actions, malformed, summary: clean(data.summary) };
}

export function costUsd(model: string, tokensIn: number, tokensOut: number): number {
  const p = PRICES[model] ?? DEFAULT_PRICE;
  return (tokensIn * p.input + tokensOut * p.output) / 1_000_000;
}

/** NEAR AI Cloud. The API key is only sent in the Authorization header, never logged. */
export class NearAiBrain implements Brain {
  readonly model: string;
  private apiKey: string;
  private url: string;

  constructor(opts: { apiKey: string; model?: string; url?: string }) {
    this.apiKey = opts.apiKey;
    this.model = opts.model ?? DEFAULT_AI_MODEL;
    this.url = opts.url ?? NEAR_AI_URL;
  }

  async decide(input: BrainInput): Promise<BrainResult> {
    const res = await fetch(this.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify({
        model: this.model,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: JSON.stringify(input) },
        ],
        temperature: 0.2,
        max_tokens: 500,
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const body = (await res.json().catch(() => ({}))) as {
      choices?: { message?: { content?: string } }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number };
      error?: unknown;
    };
    const tokensIn = body.usage?.prompt_tokens ?? 0;
    const tokensOut = body.usage?.completion_tokens ?? 0;
    const cost = costUsd(this.model, tokensIn, tokensOut);
    if (!res.ok) throw Object.assign(new Error(`NEAR AI answered HTTP ${res.status}`), { tokensIn, tokensOut, costUsd: cost });
    try {
      const decision = parseDecision(body.choices?.[0]?.message?.content ?? '');
      return { decision, model: this.model, tokensIn, tokensOut, costUsd: cost };
    } catch (err) {
      throw Object.assign(err instanceof Error ? err : new Error(String(err)), { tokensIn, tokensOut, costUsd: cost });
    }
  }
}

// ---------- usage meter and brakes ----------

export interface AiLimits {
  /** Most AI calls per UTC day, for the whole game. */
  maxCallsPerDay: number;
  /** Total dollar brake over all time: no more AI calls once reached. */
  budgetUsd: number;
}

export class AiMeter {
  private db: DB;
  private limits: AiLimits;
  private log: (msg: string) => void;

  constructor(db: DB, limits: AiLimits, log: (msg: string) => void = () => undefined) {
    this.db = db;
    this.limits = limits;
    this.log = log;
  }

  private static day(nowMs: number): number {
    return Math.floor(nowMs / 86_400_000);
  }

  totals(nowMs: number) {
    const today = this.db
      .prepare('SELECT COUNT(*) AS calls, COALESCE(SUM(cost_usd), 0) AS cost FROM ai_usage WHERE day = ?')
      .get(AiMeter.day(nowMs)) as { calls: number; cost: number };
    const all = this.db
      .prepare('SELECT COUNT(*) AS calls, COALESCE(SUM(cost_usd), 0) AS cost, COALESCE(SUM(tokens_in), 0) AS tin, COALESCE(SUM(tokens_out), 0) AS tout FROM ai_usage')
      .get() as { calls: number; cost: number; tin: number; tout: number };
    return { callsToday: today.calls, costToday: today.cost, callsTotal: all.calls, costTotal: all.cost, tokensIn: all.tin, tokensOut: all.tout };
  }

  /** null = allowed; otherwise why not (the round then uses simple rules). */
  blocked(nowMs: number): string | null {
    const t = this.totals(nowMs);
    if (t.costTotal >= this.limits.budgetUsd) return `the AI budget brake (US$${this.limits.budgetUsd}) was reached`;
    if (t.callsToday >= this.limits.maxCallsPerDay) return `today's AI call limit (${this.limits.maxCallsPerDay}) was reached`;
    return null;
  }

  record(nowMs: number, e: { playerId: number | null; model: string; ok: boolean; tokensIn: number; tokensOut: number; costUsd: number; error?: string }): void {
    this.db
      .prepare('INSERT INTO ai_usage (created_at, day, player_id, model, ok, tokens_in, tokens_out, cost_usd, error) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(nowMs, AiMeter.day(nowMs), e.playerId, e.model, e.ok ? 1 : 0, e.tokensIn, e.tokensOut, e.costUsd, e.error ?? null);
    const t = this.totals(nowMs);
    this.log(
      `[ai] call ${e.ok ? 'ok' : 'FAILED'} player ${e.playerId} ${e.model}: ${e.tokensIn} in / ${e.tokensOut} out, US$${e.costUsd.toFixed(6)}` +
        ` | today ${t.callsToday}/${this.limits.maxCallsPerDay} calls US$${t.costToday.toFixed(6)} | total ${t.callsTotal} calls US$${t.costTotal.toFixed(6)} of US$${this.limits.budgetUsd}` +
        (e.error ? ` | ${e.error}` : ''),
    );
  }
}
