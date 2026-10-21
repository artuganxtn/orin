// src/db.ts
import pg from "pg";
var { Pool } = pg;
var connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL environment variable is required");
}
if (!connectionString.includes("client_encoding")) {
  connectionString += (connectionString.includes("?") ? "&" : "?") + "client_encoding=UTF8";
}
var isLocal = connectionString.includes("localhost") || connectionString.includes("127.0.0.1");
var pool = new Pool({
  connectionString,
  ssl: isLocal ? false : { rejectUnauthorized: false },
  max: 8
});
pool.on("error", (err, _client) => {
  console.error("Unexpected error on idle PostgreSQL client", err);
});
async function withTx(fn, maxRetries = 5) {
  let attempt = 0;
  while (true) {
    const client = await pool.connect();
    try {
      await client.query("SET client_encoding TO 'UTF8'").catch(() => {
      });
      await client.query("BEGIN");
      const result = await fn(client);
      await client.query("COMMIT");
      client.release();
      return result;
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {
      });
      client.release(err);
      if ((err.code === "40001" || err.code === "40P01") && attempt < maxRetries) {
        attempt++;
        const backoffMs = Math.floor(Math.random() * 50) * Math.pow(2, attempt);
        await new Promise((r) => setTimeout(r, backoffMs));
        continue;
      }
      throw err;
    }
  }
}

// src/programs.ts
import { randomBytes, createHash } from "node:crypto";

// ../lib/programs.ts
var TEAM_LEVELS = [
  { level: 1, direct: 3, active: 3, bps: 75, capCents: 2e3 },
  { level: 2, direct: 5, active: 15, bps: 125, capCents: 6e3 },
  { level: 3, direct: 8, active: 40, bps: 175, capCents: 15e3 },
  { level: 4, direct: 10, active: 120, bps: 225, capCents: 35e3 },
  { level: 5, direct: 15, active: 300, bps: 275, capCents: 75e3 },
  { level: 6, direct: 25, active: 700, bps: 325, capCents: 15e4 }
];
var BADGES = [
  { id: "new_user", name: "New User", ar: "\u0639\u0636\u0648 \u062C\u062F\u064A\u062F", metal: "silver" },
  { id: "verified", name: "Verified", ar: "\u0645\u0648\u062B\u0651\u0642", metal: "blue" },
  { id: "first_deposit", name: "First Deposit", ar: "\u0623\u0648\u0644 \u0625\u064A\u062F\u0627\u0639", metal: "blue" },
  { id: "trader", name: "Trader", ar: "\u0645\u062A\u062F\u0627\u0648\u0644", metal: "blue" },
  { id: "top_referrer", name: "Top Referrer", ar: "\u062F\u0627\u0639\u064D \u0645\u062A\u0645\u064A\u0632", metal: "gold" },
  { id: "team_leader", name: "Team Leader", ar: "\u0642\u0627\u0626\u062F \u0641\u0631\u064A\u0642", metal: "gold" },
  { id: "loyal_member", name: "Loyal Member", ar: "\u0639\u0636\u0648 \u0648\u0641\u064A\u0651", metal: "silver" },
  { id: "elite", name: "Elite", ar: "\u0627\u0644\u0646\u062E\u0628\u0629", metal: "platinum" },
  { id: "legend", name: "Legend", ar: "\u0627\u0644\u0623\u0633\u0637\u0648\u0631\u0629", metal: "platinum" }
];
var DEFAULT_PROGRAM_CONFIG = { bonusAmountCents: 1e4, referralAmountCents: 8e3, firstDepositCents: 1e5, requireKyc: true, levels: TEAM_LEVELS.map((l) => ({ ...l })), enabled: false, termsVersion: null, referralCriteria: null, activeTeamCriteria: null, activityPeriod: null, bonusDurationDays: null, eligibleAssets: null, bonusProfitLimitCents: null, bonusTradingTerms: null, agencyCriteria: null, badgeCriteria: {}, revision: 0 };

// src/programs.ts
var ApiError = class extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
};
var hash = (text) => createHash("sha256").update(text).digest("hex");
var cleanKey = (v) => {
  if (typeof v !== "string" || !/^[-a-zA-Z0-9_]{1,128}$/.test(v)) throw new ApiError("Invalid reference");
  return v;
};
var money = (n) => Number.isSafeInteger(n) && Number(n) >= 0 && Number(n) <= Number.MAX_SAFE_INTEGER / 4;
function validConfig(v) {
  const p = { ...DEFAULT_PROGRAM_CONFIG, ...v };
  if (Object.keys(v).some((k) => !Object.hasOwn(DEFAULT_PROGRAM_CONFIG, k)) || typeof p.enabled !== "boolean" || !Number.isInteger(p.revision) || p.revision < 0) {
    throw new ApiError("Invalid program settings");
  }
  for (const k of ["termsVersion", "referralCriteria", "activeTeamCriteria", "activityPeriod", "bonusTradingTerms", "agencyCriteria"]) {
    if (p[k] !== null && (typeof p[k] !== "string" || !p[k].trim() || p[k].length > 2e3)) throw new ApiError("Invalid terms");
  }
  if (p.bonusDurationDays !== null && (!Number.isInteger(p.bonusDurationDays) || p.bonusDurationDays <= 0)) throw new ApiError("Invalid duration");
  if (p.bonusProfitLimitCents !== null && !money(p.bonusProfitLimitCents)) throw new ApiError("Invalid profit limit");
  if (p.eligibleAssets !== null && (!Array.isArray(p.eligibleAssets) || !p.eligibleAssets.length || p.eligibleAssets.some((x) => typeof x !== "string" || !/^[A-Z0-9-]{3,20}$/.test(x)))) {
    throw new ApiError("Invalid eligible assets");
  }
  if (!p.badgeCriteria || typeof p.badgeCriteria !== "object" || Array.isArray(p.badgeCriteria) || Object.entries(p.badgeCriteria).some(([k, x]) => !BADGES.some((b) => b.id === k) || typeof x !== "string" || x.length > 2e3)) {
    throw new ApiError("Invalid badge criteria");
  }
  for (const key of ["bonusAmountCents", "referralAmountCents", "firstDepositCents"]) {
    if (!money(p[key]) || p[key] <= 0) throw new ApiError("Invalid program amount");
  }
  if (p.requireKyc !== true) throw new ApiError("Required verification cannot be bypassed");
  if (!Array.isArray(p.levels) || p.levels.length !== 6 || p.levels.some((l, i) => l.level !== i + 1 || !Number.isInteger(l.direct) || l.direct < 1 || !Number.isInteger(l.active) || l.active < l.direct || !Number.isInteger(l.bps) || l.bps < 0 || l.bps > 1e4 || !money(l.capCents) || i > 0 && (l.direct < p.levels[i - 1].direct || l.active < p.levels[i - 1].active))) {
    throw new ApiError("Invalid L1-L6 definition");
  }
  if (p.enabled && ["termsVersion", "referralCriteria", "activeTeamCriteria", "activityPeriod", "bonusTradingTerms", "agencyCriteria", "bonusDurationDays", "bonusProfitLimitCents", "eligibleAssets"].some((k) => p[k] === null)) {
    throw new ApiError("\u0627\u0639\u062A\u0645\u062F \u062C\u0645\u064A\u0639 \u0634\u0631\u0648\u0637 \u0627\u0644\u0628\u0631\u0646\u0627\u0645\u062C \u0642\u0628\u0644 \u0627\u0644\u062A\u0641\u0639\u064A\u0644. / Complete program terms before activation.", 409);
  }
  return p;
}
function enabled(c) {
  const p = validConfig(c ?? {});
  if (!p.enabled) throw new ApiError("\u0627\u0644\u0628\u0631\u0646\u0627\u0645\u062C \u063A\u064A\u0631 \u0645\u0641\u0639\u0651\u0644 \u0628\u0639\u062F. / Program is not active.", 409);
  return p;
}
async function programSummary(u) {
  return withTx(async (client) => {
    const cfgRes = await client.query("SELECT config FROM program_configuration WHERE key = 'current'");
    const c = validConfig(cfgRes.rows[0]?.config ?? {});
    const mRes = await client.query("SELECT * FROM program_members WHERE user_id = $1", [u.id]);
    const d = mRes.rows[0];
    const bRes = await client.query("SELECT * FROM bonus_wallets WHERE user_id = $1", [u.id]);
    const wallet = bRes.rows[0];
    let cashCents = 0;
    let bonusCents = 0;
    let profitCents = 0;
    let withdrawableProfitCents = 0;
    let qualifiedDepositCents = 0;
    const accRes = await client.query("SELECT * FROM accounts WHERE user_id = $1 AND type = 'real' LIMIT 1", [u.id]);
    const realAcc = accRes.rows[0];
    if (realAcc) {
      cashCents = Number(realAcc.balance_cents ?? 0);
      bonusCents = Number(realAcc.bonus_cents ?? 0);
      profitCents = Number(realAcc.bonus_profit_cents ?? 0);
    }
    if (wallet) {
      const qdRes = await client.query("SELECT amount_cents FROM qualified_deposits WHERE user_id = $1", [u.id]);
      qualifiedDepositCents = qdRes.rows[0] ? Number(qdRes.rows[0].amount_cents) : 0;
      const reqDeposit = Number(wallet.first_deposit_cents ?? c.firstDepositCents ?? 1e5);
      withdrawableProfitCents = qualifiedDepositCents >= reqDeposit ? Math.min(Number(wallet.profit_limit_cents ?? 2e4), profitCents) : 0;
    }
    const chRes = await client.query(
      `SELECT * FROM program_members WHERE ancestors @> $1::jsonb LIMIT 101`,
      [JSON.stringify([u.id])]
    );
    const rows = chRes.rows.slice(0, 100).map((x) => ({
      uid: x.user_id,
      referralId: x.referral_code,
      parentReferralId: x.parent_user_id,
      ancestors: Array.isArray(x.ancestors) ? x.ancestors : JSON.parse(x.ancestors || "[]"),
      referralStatus: "pending"
    })).sort((a, b) => a.ancestors.length - b.ancestors.length || a.referralId.localeCompare(b.referralId));
    const rewRes = await client.query("SELECT * FROM referral_rewards WHERE referrer_user_id = $1 LIMIT 100", [u.id]);
    return {
      available: true,
      config: c,
      member: d ? {
        referralId: d.referral_code,
        code: d.referral_code,
        agencyId: null,
        agencyGranted: false,
        badges: Array.isArray(d.badges) ? d.badges : JSON.parse(d.badges || "[]"),
        direct: Number(d.direct_count ?? 0),
        activeTeam: Number(d.active_team_count ?? 0),
        team: Number(d.team_count ?? 0),
        qualified: Number(d.qualified_count ?? 0),
        paidCents: Number(d.paid_cents ?? 0),
        pendingCents: Number(d.pending_cents ?? 0),
        activityRewardCents: Number(d.activity_reward_cents ?? 0)
      } : null,
      bonus: wallet ? {
        firstDepositCents: Number(wallet.first_deposit_cents ?? 1e5),
        termsVersion: c.termsVersion,
        accountId: wallet.account_id,
        cashCents,
        bonusCents,
        profitCents,
        withdrawableProfitCents,
        qualifiedDepositCents,
        claimed: wallet.claimed === true,
        eligible: true
      } : null,
      tree: rows.map((x) => ({
        id: x.referralId,
        parentId: x.parentReferralId ?? null,
        depth: x.ancestors.length - x.ancestors.indexOf(u.id),
        status: x.referralStatus ?? "pending"
      })),
      rewards: rewRes.rows.map((x) => ({
        id: x.referred_user_id,
        status: x.status,
        amountCents: Number(x.amount_cents)
      })),
      truncated: chRes.rows.length > 100
    };
  });
}
async function programAction(u, input) {
  const action = input.action;
  const requestId = cleanKey(input.requestId);
  if (!["enroll", "claim_bonus"].includes(action)) throw new ApiError("Invalid program action");
  const fingerprint = hash(JSON.stringify(input));
  const generatedCode = "ORIN-" + randomBytes(6).toString("hex").toUpperCase();
  await withTx(async (client) => {
    const cmdCheck = await client.query("SELECT fingerprint FROM commands WHERE fingerprint = $1", [fingerprint]);
    if (cmdCheck.rows.length > 0) return;
    const profRes = await client.query("SELECT disabled FROM profiles WHERE id = $1", [u.id]);
    if (profRes.rows.length === 0 || profRes.rows[0].disabled) throw new ApiError("Account restricted", 403);
    const cfgRes = await client.query("SELECT config FROM program_configuration WHERE key = 'current'");
    const c = enabled(cfgRes.rows[0]?.config);
    const mRes = await client.query("SELECT * FROM program_members WHERE user_id = $1", [u.id]);
    if (action === "enroll") {
      if (mRes.rows.length > 0) throw new ApiError("\u0639\u0636\u0648\u064A\u062A\u0643 \u0645\u0648\u062C\u0648\u062F\u0629 \u0628\u0627\u0644\u0641\u0639\u0644. / Already enrolled.", 409);
      const attrRes = await client.query("SELECT referral_code FROM referral_attributions WHERE user_id = $1", [u.id]);
      const recordedCode = attrRes.rows[0]?.referral_code;
      if (recordedCode && input.referralCode && input.referralCode !== recordedCode) {
        throw new ApiError("Referral attribution is already recorded", 409);
      }
      const referralCode = recordedCode ?? input.referralCode;
      let parentUid = null;
      let ancestors = [];
      if (referralCode) {
        if (typeof referralCode !== "string" || !/^ORIN-[A-F0-9]{12}$/.test(referralCode)) {
          throw new ApiError("Invalid referral code");
        }
        const sponsorRes = await client.query("SELECT user_id FROM referral_codes WHERE code = $1", [referralCode]);
        if (sponsorRes.rows.length === 0 || sponsorRes.rows[0].user_id === u.id) {
          throw new ApiError("Self referral or unknown code", 409);
        }
        parentUid = sponsorRes.rows[0].user_id;
        const parentMemRes = await client.query("SELECT ancestors FROM program_members WHERE user_id = $1", [parentUid]);
        if (parentMemRes.rows.length === 0) throw new ApiError("Invalid referral path");
        const parentAncestors = Array.isArray(parentMemRes.rows[0].ancestors) ? parentMemRes.rows[0].ancestors : JSON.parse(parentMemRes.rows[0].ancestors || "[]");
        if (parentAncestors.includes(u.id) || parentAncestors.length >= 32) throw new ApiError("Invalid referral path");
        const [uKyc, parentKyc] = await Promise.all([
          client.query("SELECT customer_key FROM verified_customers WHERE user_id = $1", [u.id]),
          client.query("SELECT customer_key FROM verified_customers WHERE user_id = $1", [parentUid])
        ]);
        if (uKyc.rows[0]?.customer_key && parentKyc.rows[0]?.customer_key && uKyc.rows[0].customer_key === parentKyc.rows[0].customer_key) {
          throw new ApiError("Same customer key referral rejected", 409);
        }
        ancestors = [...parentAncestors, parentUid];
      }
      await client.query(
        `INSERT INTO program_members (user_id, referral_code, parent_user_id, ancestors, badges, direct_count, team_count, qualified_count, active_team_count, paid_cents, pending_cents, activity_reward_cents)
         VALUES ($1, $2, $3, $4::jsonb, '["new_user"]'::jsonb, 0, 0, 0, 0, 0, 0, 0)`,
        [u.id, generatedCode, parentUid, JSON.stringify(ancestors)]
      );
      await client.query(
        `INSERT INTO referral_codes (code, user_id) VALUES ($1, $2) ON CONFLICT (code) DO NOTHING`,
        [generatedCode, u.id]
      );
      if (parentUid) {
        await client.query(
          "UPDATE program_members SET direct_count = direct_count + 1, team_count = team_count + 1 WHERE user_id = $1",
          [parentUid]
        );
        for (const ancId of ancestors.slice(0, -1)) {
          await client.query(
            "UPDATE program_members SET team_count = team_count + 1 WHERE user_id = $1",
            [ancId]
          );
        }
        await client.query(
          `INSERT INTO referral_rewards (referred_user_id, referrer_user_id, amount_cents, status)
           VALUES ($1, $2, $3, 'pending')
           ON CONFLICT (referred_user_id) DO NOTHING`,
          [u.id, parentUid, c.referralAmountCents]
        );
      }
    } else {
      if (mRes.rows.length === 0) throw new ApiError("Enroll first", 409);
      const accId = cleanKey(input.accountId);
      const accRes = await client.query("SELECT * FROM accounts WHERE user_id = $1 AND id = $2", [u.id, accId]);
      const a = accRes.rows[0];
      if (!a || a.type !== "real" || a.currency !== "USD") {
        throw new ApiError("\u0627\u062E\u062A\u0631 \u062D\u0633\u0627\u0628\u064B\u0627 \u062D\u0642\u064A\u0642\u064A\u064B\u0627 \u0628\u0627\u0644\u062F\u0648\u0644\u0627\u0631. / Select a real USD account.", 409);
      }
      const vcRes = await client.query("SELECT customer_key, verified, revoked FROM verified_customers WHERE user_id = $1", [u.id]);
      const v = vcRes.rows[0];
      if (!v || !v.verified || v.revoked || !v.customer_key) {
        throw new ApiError("\u0627\u0644\u062A\u062D\u0642\u0642 \u0627\u0644\u0645\u0637\u0644\u0648\u0628 \u063A\u064A\u0631 \u0645\u0643\u062A\u0645\u0644. / Required verification is incomplete.", 409);
      }
      const claimCheck = await client.query("SELECT user_id FROM bonus_claims WHERE customer_key = $1", [v.customer_key]);
      const walletCheck = await client.query("SELECT user_id FROM bonus_wallets WHERE user_id = $1", [u.id]);
      if (claimCheck.rows.length > 0 || walletCheck.rows.length > 0) {
        throw new ApiError("\u0627\u0644\u0628\u0648\u0646\u0635 \u0645\u0631\u0629 \u0648\u0627\u062D\u062F\u0629 \u0644\u0643\u0644 \u0639\u0645\u064A\u0644. / Bonus already claimed.", 409);
      }
      await client.query("INSERT INTO bonus_claims (customer_key, user_id) VALUES ($1, $2)", [v.customer_key, u.id]);
      const durationDays = c.bonusDurationDays ?? 30;
      await client.query(
        `INSERT INTO bonus_wallets (user_id, account_id, profit_limit_cents, first_deposit_cents, eligible_assets, claimed, claimed_at, expires_at)
         VALUES ($1, $2, $3, $4, $5::jsonb, true, NOW(), NOW() + interval '${durationDays} days')`,
        [u.id, accId, c.bonusProfitLimitCents ?? 2e4, c.firstDepositCents, JSON.stringify(c.eligibleAssets ?? [])]
      );
      const journalId = "bonus-" + hash(u.id);
      await client.query(
        `INSERT INTO journals (id, kind, reference)
         VALUES ($1, 'nonwithdrawable_bonus', $2)
         ON CONFLICT (id) DO NOTHING`,
        [journalId, "bonus-" + u.id]
      );
      await client.query(
        `INSERT INTO journal_entries (journal_id, user_id, account_id, bucket, amount_cents)
         VALUES
           ($1, $2, $3, 'bonus', $4),
           ($1, NULL, NULL, 'system:program-grant', $5)`,
        [journalId, u.id, accId, c.bonusAmountCents, -c.bonusAmountCents]
      );
    }
    await client.query(
      `INSERT INTO commands (fingerprint, action, result)
       VALUES ($1, $2, $3::jsonb)
       ON CONFLICT (fingerprint) DO NOTHING`,
      [fingerprint, action, JSON.stringify({ requestId })]
    );
    const auditPayload = JSON.stringify({ requestId, termsVersion: c.termsVersion });
    await client.query(
      `INSERT INTO audit (actor_id, action, reference, payload, payload_hash)
       VALUES ($1, $2, $3, $4::jsonb, $5)
       ON CONFLICT (action, reference) DO NOTHING`,
      [u.id, action, u.id, auditPayload, hash(auditPayload)]
    );
  });
  return programSummary(u);
}
async function adminPrograms(u, input) {
  return withTx(async (client) => {
    const profRes = await client.query("SELECT role, disabled FROM profiles WHERE id = $1", [u.id]);
    const prof = profRes.rows[0];
    if (!prof || prof.disabled || prof.role !== "admin" && !u.verified) {
      throw new ApiError("\u0647\u0630\u0647 \u0627\u0644\u0639\u0645\u0644\u064A\u0629 \u0644\u0644\u0625\u062F\u0627\u0631\u0629 \u0641\u0642\u0637.", 403);
    }
    if (!input) {
      const [cRes, rRes, mRes, aRes] = await Promise.all([
        client.query("SELECT config FROM program_configuration WHERE key = 'current'"),
        client.query("SELECT * FROM referral_rewards LIMIT 100"),
        client.query("SELECT * FROM program_members LIMIT 100"),
        client.query("SELECT * FROM audit ORDER BY created_at DESC LIMIT 50")
      ]);
      return {
        configuration: validConfig(cRes.rows[0]?.config ?? {}),
        rewards: rRes.rows,
        members: mRes.rows,
        audit: aRes.rows
      };
    }
    const requestId = cleanKey(input.requestId);
    const fingerprint = hash(JSON.stringify(input));
    const cmdRes = await client.query("SELECT fingerprint FROM commands WHERE fingerprint = $1", [fingerprint]);
    if (cmdRes.rows.length > 0) return;
    const cfgRes = await client.query("SELECT config FROM program_configuration WHERE key = 'current'");
    const cfg = cfgRes.rows[0]?.config ?? DEFAULT_PROGRAM_CONFIG;
    if (input.action === "configure") {
      if (input.revision !== cfg.revision) throw new ApiError("Settings changed; reload", 409);
      const next = validConfig({ ...input.configuration, revision: cfg.revision + 1 });
      if (next.termsVersion === cfg.termsVersion && JSON.stringify(next) !== JSON.stringify({ ...cfg, revision: next.revision })) {
        throw new ApiError("Use a new terms version for changed entitlements", 409);
      }
      await client.query(
        `INSERT INTO program_configuration_history (key, config, revision, changed_by)
         VALUES ('current', $1::jsonb, $2, $3)`,
        [JSON.stringify(next), next.revision, u.id]
      );
      await client.query(
        `INSERT INTO program_configuration (key, config, revision, updated_at)
         VALUES ('current', $1::jsonb, $2, NOW())
         ON CONFLICT (key) DO UPDATE SET config = EXCLUDED.config, revision = EXCLUDED.revision, updated_at = NOW()`,
        [JSON.stringify(next), next.revision]
      );
    } else {
      const c = enabled(cfg);
      const target = cleanKey(input.uid);
      const mRes = await client.query("SELECT * FROM program_members WHERE user_id = $1", [target]);
      if (mRes.rows.length === 0) throw new ApiError("Unknown program member");
      const m = mRes.rows[0];
      if (input.action === "agency") {
        if (typeof input.grant !== "boolean" || typeof input.reason !== "string" || !input.reason.trim()) {
          throw new ApiError("Grant and review reason required");
        }
      } else if (input.action === "badge") {
        const badge = BADGES.find((b) => b.id === input.badge);
        if (!badge || ["new_user", "verified", "first_deposit", "trader"].includes(badge.id) || !c.badgeCriteria[badge.id]) {
          throw new ApiError("Badge requires approved criteria or automatic server evidence", 409);
        }
        const evRes = await client.query("SELECT * FROM program_evidence WHERE id = $1", [cleanKey(input.evidenceId)]);
        const e = evRes.rows[0];
        if (!e || e.user_id !== target || e.kind !== "badge") {
          throw new ApiError("Trusted badge evidence required", 409);
        }
        const badges = Array.isArray(m.badges) ? m.badges : JSON.parse(m.badges || "[]");
        if (!badges.includes(badge.id)) badges.push(badge.id);
        await client.query("UPDATE program_members SET badges = $1::jsonb WHERE user_id = $2", [JSON.stringify(badges), target]);
      } else if (input.action === "referral") {
        const rewRes = await client.query("SELECT * FROM referral_rewards WHERE referred_user_id = $1", [target]);
        if (rewRes.rows.length === 0) throw new ApiError("Unknown referral");
        const r = rewRes.rows[0];
        if (r.status === "paid" || r.paid_at) throw new ApiError("Reward already paid", 409);
        const parentMemRes = await client.query("SELECT * FROM program_members WHERE user_id = $1", [r.referrer_user_id]);
        const p = parentMemRes.rows[0];
        if (input.status === "qualified" && r.status === "pending") {
          const vRes = await client.query("SELECT customer_key, verified, revoked FROM verified_customers WHERE user_id = $1", [target]);
          const pvRes = await client.query("SELECT customer_key, verified, revoked FROM verified_customers WHERE user_id = $1", [r.referrer_user_id]);
          const evRes = await client.query("SELECT * FROM program_evidence WHERE id = $1", [cleanKey(input.evidenceId)]);
          const v = vRes.rows[0], pv = pvRes.rows[0], e = evRes.rows[0];
          if (!v?.verified || v.revoked || !pv?.verified || pv.revoked || v.customer_key === pv.customer_key || !e || e.user_id !== target || e.kind !== "referral_qualified") {
            throw new ApiError("Verified distinct customers and eligibility evidence required", 409);
          }
          await client.query(
            "UPDATE referral_rewards SET status = 'approved', evidence_id = $1, qualified_at = NOW(), approved_at = NOW() WHERE referred_user_id = $2",
            [input.evidenceId, target]
          );
          if (p) {
            await client.query(
              "UPDATE program_members SET qualified_count = qualified_count + 1, pending_cents = pending_cents + $1 WHERE user_id = $2",
              [Number(r.amount_cents ?? 8e3), r.referrer_user_id]
            );
          }
        } else if (input.status === "rejected" && ["pending", "qualified"].includes(r.status)) {
          if (typeof input.reason !== "string" || !input.reason.trim()) throw new ApiError("Rejection reason required");
          await client.query(
            "UPDATE referral_rewards SET status = 'rejected' WHERE referred_user_id = $1",
            [target]
          );
          if (r.status === "qualified" && p) {
            await client.query(
              "UPDATE program_members SET qualified_count = qualified_count - 1, pending_cents = pending_cents - $1 WHERE user_id = $2",
              [Number(r.amount_cents ?? 8e3), r.referrer_user_id]
            );
          }
        } else if (input.status === "paid" && ["qualified", "approved"].includes(r.status)) {
          const accId = cleanKey(input.accountId);
          const accRes = await client.query("SELECT * FROM accounts WHERE user_id = $1 AND id = $2", [r.referrer_user_id, accId]);
          const data = accRes.rows[0];
          if (!data || data.type !== "real" || data.currency !== "USD") throw new ApiError("\u0627\u062E\u062A\u0631 \u062D\u0633\u0627\u0628\u064B\u0627 \u062D\u0642\u064A\u0642\u064A\u064B\u0627 \u0628\u0627\u0644\u062F\u0648\u0644\u0627\u0631.", 409);
          const amountCents = Number(r.amount_cents ?? 8e3);
          const journalId = "referral-" + target;
          await client.query(
            `INSERT INTO journals (id, kind, reference)
             VALUES ($1, 'referral_reward', $2)
             ON CONFLICT (id) DO NOTHING`,
            [journalId, "referral-" + target]
          );
          await client.query(
            `INSERT INTO journal_entries (journal_id, user_id, account_id, bucket, amount_cents)
             VALUES
               ($1, $2, $3, 'cash', $4),
               ($1, NULL, NULL, 'system:program-expense', $5)`,
            [journalId, r.referrer_user_id, accId, amountCents, -amountCents]
          );
          await client.query(
            "UPDATE referral_rewards SET status = 'paid', paid_at = NOW() WHERE referred_user_id = $1",
            [target]
          );
          if (p) {
            await client.query(
              "UPDATE program_members SET paid_cents = paid_cents + $1, pending_cents = pending_cents - $1 WHERE user_id = $2",
              [amountCents, r.referrer_user_id]
            );
          }
        } else {
          throw new ApiError("Invalid reward transition", 409);
        }
      } else if (input.action === "activity_reward") {
        const period = cleanKey(input.periodId);
        const revRes = await client.query("SELECT * FROM eligible_revenue WHERE user_id = $1 AND period_id = $2", [target, period]);
        const revenue = revRes.rows[0];
        if (!revenue || !revenue.finalized) throw new ApiError("Finalized eligible net revenue required", 409);
        const payRes = await client.query("SELECT id FROM activity_payments WHERE user_id = $1 AND period_id = $2", [target, period]);
        if (payRes.rows.length > 0) throw new ApiError("Finalized eligible net revenue required", 409);
        const level = [...c.levels].reverse().find((l) => revenue.direct >= l.direct && revenue.active_team >= l.active);
        if (!level) throw new ApiError("No eligible team level", 409);
        const cents = Math.min(level.capCents, Number(BigInt(revenue.net_revenue_cents) * BigInt(level.bps) / 10000n));
        const accId = cleanKey(input.accountId);
        const accRes = await client.query("SELECT * FROM accounts WHERE user_id = $1 AND id = $2", [target, accId]);
        const data = accRes.rows[0];
        if (!data || data.type !== "real" || data.currency !== "USD" || cents <= 0) {
          throw new ApiError("No payable activity reward", 409);
        }
        const journalId = "activity-" + target + "_" + period;
        await client.query(
          `INSERT INTO journals (id, kind, reference)
           VALUES ($1, 'team_activity', $2)
           ON CONFLICT (id) DO NOTHING`,
          [journalId, "activity-" + target + "_" + period]
        );
        await client.query(
          `INSERT INTO journal_entries (journal_id, user_id, account_id, bucket, amount_cents)
           VALUES
             ($1, $2, $3, 'cash', $4),
             ($1, NULL, NULL, 'system:program-expense', $5)`,
          [journalId, target, accId, cents, -cents]
        );
        await client.query(
          `INSERT INTO activity_payments (id, user_id, period_id, cents, approval_id)
           VALUES ($1, $2, $3, $4, 'auto')`,
          [target + "_" + period, target, period, cents]
        );
        await client.query(
          "UPDATE program_members SET activity_reward_cents = activity_reward_cents + $1 WHERE user_id = $2",
          [cents, target]
        );
      } else {
        throw new ApiError("Invalid admin action");
      }
    }
    await client.query(
      `INSERT INTO commands (fingerprint, action, result)
       VALUES ($1, $2, $3::jsonb)
       ON CONFLICT (fingerprint) DO NOTHING`,
      [fingerprint, input.action, JSON.stringify({ requestId })]
    );
    const auditPayload = JSON.stringify({ ...input, requestId });
    await client.query(
      `INSERT INTO audit (actor_id, action, reference, payload, payload_hash)
       VALUES ($1, $2, $3, $4::jsonb, $5)
       ON CONFLICT (action, reference) DO NOTHING`,
      [u.id, "PROGRAM_" + input.action, input.uid ?? "configuration", auditPayload, hash(auditPayload)]
    );
  });
}
async function accountActivity(u, accountId) {
  const id = cleanKey(accountId);
  return withTx(async (client) => {
    const accRes = await client.query("SELECT * FROM accounts WHERE user_id = $1 AND id = $2", [u.id, id]);
    if (accRes.rows.length === 0 || accRes.rows[0].type !== "real") {
      throw new ApiError("\u0627\u0644\u062D\u0633\u0627\u0628 \u063A\u064A\u0631 \u0645\u062A\u0627\u062D.", 404);
    }
    const rowsRes = await client.query(
      `SELECT je.*, j.kind, j.created_at AS effective_at
       FROM journal_entries je
       JOIN journals j ON je.journal_id = j.id
       WHERE je.user_id = $1 AND je.account_id = $2
       ORDER BY j.created_at DESC
       LIMIT 100`,
      [u.id, id]
    );
    return {
      accountId: id,
      ledger: rowsRes.rows.map((e) => ({
        id: String(e.id),
        journal_id: e.journal_id,
        accountId: id,
        account: e.bucket,
        amount_cents: Number(e.amount_cents),
        kind: e.kind,
        effective_at: new Date(e.effective_at).getTime()
      }))
    };
  });
}
async function getReferralsSummary(u) {
  return await withTx(async (client) => {
    let codeRes = await client.query("SELECT code FROM referral_codes WHERE user_id = $1", [u.id]);
    let code = codeRes.rows[0]?.code;
    if (!code) {
      const bytes = crypto.getRandomValues(new Uint8Array(6));
      code = "ORIN-" + Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("").toUpperCase();
      await client.query(
        "INSERT INTO referral_codes (code, user_id) VALUES ($1, $2) ON CONFLICT (user_id) DO NOTHING",
        [code, u.id]
      );
      codeRes = await client.query("SELECT code FROM referral_codes WHERE user_id = $1", [u.id]);
      code = codeRes.rows[0]?.code || code;
    }
    const memRes = await client.query("SELECT * FROM program_members WHERE user_id = $1", [u.id]);
    const attrRes = await client.query("SELECT * FROM referral_attributions WHERE referrer_user_id = $1", [u.id]);
    const rewRes = await client.query("SELECT * FROM referral_rewards WHERE referrer_user_id = $1", [u.id]);
    const mem = memRes.rows[0] || {};
    const invited = attrRes.rowCount || mem.direct_count || 0;
    const successful = mem.qualified_count || rewRes.rows.filter((r) => r.status === "paid" || r.status === "approved").length || 0;
    const totalRewardCents = Number(mem.paid_cents || 0) + Number(mem.pending_cents || 0);
    const rewards = rewRes.rows.map((r) => ({
      id: r.referred_user_id,
      status: r.status || "pending",
      amountCents: Number(r.amount_cents || 0),
      createdAt: r.created_at ? new Date(r.created_at).getTime() : Date.now()
    }));
    const referrals = attrRes.rows.map((r) => ({
      id: r.user_id,
      status: "approved"
    }));
    return {
      code,
      invited,
      successful,
      totalRewardCents,
      rewards: rewards || [],
      referrals: referrals || [],
      terms: "\u0628\u0631\u0646\u0627\u0645\u062C \u0627\u0644\u0625\u062D\u0627\u0644\u0627\u062A \u0627\u0644\u0645\u0639\u062A\u0645\u062F \u0645\u0646 ORIN",
      rewardsActive: true,
      summaryState: "ready"
    };
  });
}
export {
  ApiError,
  accountActivity,
  adminPrograms,
  getReferralsSummary,
  hash,
  programAction,
  programSummary,
  validConfig
};
//# sourceMappingURL=programs.js.map
