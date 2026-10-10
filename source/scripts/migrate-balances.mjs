#!/usr/bin/env node
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const functionsPkg = path.resolve(currentDir, '../firebase-functions/package.json');
const require = createRequire(functionsPkg);
const { initializeApp, getApps, cert } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

export function initFirestore() {
  if (getApps().length > 0) return getFirestore(getApps()[0]);
  const projectId = process.env.GCLOUD_PROJECT || process.env.FIREBASE_PROJECT_ID || 'demo-orin-auth';
  if (process.env.FIRESTORE_EMULATOR_HOST) {
    const app = initializeApp({ projectId });
    return getFirestore(app);
  }
  let sa = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!sa && fs.existsSync(path.resolve(currentDir, '../firebase-functions/.env'))) {
    const envContent = fs.readFileSync(path.resolve(currentDir, '../firebase-functions/.env'), 'utf-8');
    const match = envContent.match(/FIREBASE_SERVICE_ACCOUNT=(.*)/);
    if (match) sa = match[1].trim();
  }
  if (sa) {
    try {
      const creds = typeof sa === 'string' ? JSON.parse(sa) : sa;
      const app = initializeApp({
        credential: cert(creds),
        projectId: creds.project_id || projectId
      });
      return getFirestore(app);
    } catch {}
  }
  const app = initializeApp({ projectId });
  return getFirestore(app);
}

export async function resolveUserTradingAccount(db, uid) {
  const selectionDoc = await db.doc(`sparkAccountSelections/${uid}`).get();
  let accountId = selectionDoc.data()?.accountId;

  let sparkDoc = null;
  let sparkRef = null;
  if (accountId) {
    sparkRef = db.doc(`sparkTradingAccounts/${uid}/accounts/${accountId}`);
    const s = await sparkRef.get();
    if (s.exists) sparkDoc = s;
  }

  if (!sparkDoc || !sparkDoc.exists) {
    const realAccounts = await db.collection(`sparkTradingAccounts/${uid}/accounts`).where('type', '==', 'real').limit(1).get();
    if (!realAccounts.empty) {
      sparkDoc = realAccounts.docs[0];
      sparkRef = sparkDoc.ref;
      accountId = sparkDoc.id;
    } else {
      const anyAccounts = await db.collection(`sparkTradingAccounts/${uid}/accounts`).limit(1).get();
      if (!anyAccounts.empty) {
        sparkDoc = anyAccounts.docs[0];
        sparkRef = sparkDoc.ref;
        accountId = sparkDoc.id;
      } else {
        accountId = accountId || 'primary';
        sparkRef = db.doc(`sparkTradingAccounts/${uid}/accounts/${accountId}`);
        sparkDoc = await sparkRef.get();
      }
    }
  }

  return { accountId, sparkRef, sparkDoc };
}

export async function computeUserMigration(db, uid) {
  // 1. Resolve trading account
  const { accountId, sparkRef, sparkDoc } = await resolveUserTradingAccount(db, uid);
  const sparkBalance = Math.round(Number(sparkDoc?.data()?.balanceCents || 0));
  const sparkReserved = Math.round(Number(sparkDoc?.data()?.reservedCents || 0));

  // 2. Read orinAccounts (for reference / reporting only; NEVER overwrites spark)
  const orinDoc = await db.doc(`orinAccounts/${uid}`).get();
  const hasOrinDoc = orinDoc.exists;
  const orinBalance = hasOrinDoc ? Math.round(Number(orinDoc.data()?.balanceCents || 0)) : null;
  const orinReserved = hasOrinDoc ? Math.round(Number(orinDoc.data()?.reservedCents || 0)) : null;

  // 3. Compute tradingDelta: sum of orinJournals lines user:{uid}:cash and user:{uid}:reserved where kind in ('allocation','settlement')
  const journalsSnap = await db.collection('orinJournals').where('user_id', '==', uid).get();
  let cashDelta = 0;
  let reservedDelta = 0;
  let hasAlreadyMigrated = false;

  for (const doc of journalsSnap.docs) {
    if (doc.id === `migration-v1:${uid}`) {
      hasAlreadyMigrated = true;
    }
    const data = doc.data() || {};
    if (data.kind === 'allocation' || data.kind === 'settlement') {
      const entries = Array.isArray(data.entries) ? data.entries : [];
      for (const entry of entries) {
        const acct = entry.account;
        const amt = Math.round(Number(entry.amount_cents || 0));
        if (acct === `user:${uid}:cash` || (typeof acct === 'string' && acct.startsWith(`user:${uid}:`) && acct.endsWith(':cash'))) {
          cashDelta += amt;
        } else if (acct === `user:${uid}:reserved` || (typeof acct === 'string' && acct.startsWith(`user:${uid}:`) && acct.endsWith(':reserved'))) {
          reservedDelta += amt;
        }
      }
    }
  }

  // 4. Proposed newSpark values
  const newSparkBalance = sparkBalance + cashDelta;
  const newSparkReserved = sparkReserved + reservedDelta;

  // 5. Active positions & backfill check
  const positionsSnap = await db.collection('orinPositions').where('user_id', '==', uid).get();
  let activePositionsSum = 0;
  const activePositionsToBackfill = [];

  for (const posDoc of positionsSnap.docs) {
    const pos = posDoc.data() || {};
    if (pos.status === 'active') {
      activePositionsSum += Math.round(Number(pos.amount_cents || 0));
      if (!pos.account_id) {
        activePositionsToBackfill.push(posDoc);
      }
    }
  }

  // 6. Integrity checks
  // Check 1: newSpark.reserved == sum(amount_cents of this user's active orinPositions)
  // Check 2: newSpark.balance >= 0
  const flags = [];
  let isBlocked = false;

  if (!hasOrinDoc) {
    flags.push('NO_ORIN_DOC');
  }

  if (hasAlreadyMigrated) {
    flags.push('ALREADY_MIGRATED');
  }

  if (newSparkReserved !== activePositionsSum) {
    isBlocked = true;
    flags.push(`BLOCKED:RESERVED_MISMATCH(spark=${newSparkReserved},activeSum=${activePositionsSum})`);
  }

  if (newSparkBalance < 0) {
    isBlocked = true;
    flags.push(`BLOCKED:NEGATIVE_BALANCE(${newSparkBalance})`);
  }

  if (activePositionsToBackfill.length > 0) {
    flags.push(`BACKFILL_ACCOUNT_ID(${activePositionsToBackfill.map(p => p.id).join(',')})`);
  }

  if (!isBlocked && !hasAlreadyMigrated) {
    if (cashDelta === 0 && reservedDelta === 0 && activePositionsToBackfill.length === 0) {
      flags.push('IN_SYNC');
    } else {
      flags.push('NEEDS_MIGRATION');
    }
  }

  return {
    uid,
    accountId,
    sparkRef,
    sparkDoc,
    hasOrinDoc,
    orinBalance,
    orinReserved,
    sparkBefore: { balance: sparkBalance, reserved: sparkReserved },
    delta: { cash: cashDelta, reserved: reservedDelta },
    sparkAfter: { balance: newSparkBalance, reserved: newSparkReserved },
    activePositionsSum,
    activePositionsToBackfill,
    flags,
    isBlocked,
    hasAlreadyMigrated
  };
}

export async function discoverAllUsers(db) {
  const uids = new Set();
  const [usersSnap, orinSnap, selectionsSnap, positionsSnap, journalsSnap, sparkSnap] = await Promise.all([
    db.collection('users').get(),
    db.collection('orinAccounts').get(),
    db.collection('sparkAccountSelections').get(),
    db.collection('orinPositions').get(),
    db.collection('orinJournals').get(),
    db.collection('sparkTradingAccounts').get().catch(() => ({ forEach: () => {} }))
  ]);

  usersSnap.forEach(d => uids.add(d.id));
  orinSnap.forEach(d => uids.add(d.id));
  selectionsSnap.forEach(d => uids.add(d.id));
  positionsSnap.forEach(d => {
    const data = d.data();
    if (data.user_id) uids.add(data.user_id);
  });
  journalsSnap.forEach(d => {
    const data = d.data();
    if (data.user_id) uids.add(data.user_id);
  });
  if (sparkSnap?.forEach) {
    sparkSnap.forEach(d => uids.add(d.id));
  }

  return Array.from(uids).sort();
}

export async function runMigration(options = {}) {
  const isApply = options.apply ?? process.argv.includes('--apply');
  const isYes = options.yes ?? process.argv.includes('--yes');
  const db = options.db || initFirestore();

  if (isApply && !isYes) {
    console.error('ERROR: --apply requires --yes flag for safety.');
    process.exitCode = 1;
    return;
  }

  const modeStr = isApply ? 'APPLY MODE (--apply --yes)' : 'DRY RUN (default)';
  console.log(`================================================================================`);
  console.log(`=== ORIN Balance Migration: Spark Single Store [${modeStr}] ===`);
  console.log(`================================================================================\n`);

  const uids = await discoverAllUsers(db);
  console.log(`Discovered ${uids.length} unique user(s) across all collections.\n`);

  let totalScanned = 0;
  let totalNeedsMigration = 0;
  let totalInSync = 0;
  let totalAlreadyMigrated = 0;
  let totalBlocked = 0;
  let totalApplied = 0;
  let totalPositionsBackfilled = 0;

  let sumSparkBalBefore = 0;
  let sumSparkResBefore = 0;
  let sumCashDelta = 0;
  let sumResDelta = 0;
  let sumSparkBalAfter = 0;
  let sumSparkResAfter = 0;

  for (const uid of uids) {
    totalScanned++;
    const res = await computeUserMigration(db, uid);

    sumSparkBalBefore += res.sparkBefore.balance;
    sumSparkResBefore += res.sparkBefore.reserved;
    sumCashDelta += res.delta.cash;
    sumResDelta += res.delta.reserved;
    sumSparkBalAfter += res.sparkAfter.balance;
    sumSparkResAfter += res.sparkAfter.reserved;

    if (res.hasAlreadyMigrated) totalAlreadyMigrated++;
    else if (res.isBlocked) totalBlocked++;
    else if (res.flags.includes('NEEDS_MIGRATION')) totalNeedsMigration++;
    else totalInSync++;

    const orinStr = res.hasOrinDoc
      ? `balance: ${res.orinBalance} cents ($${(res.orinBalance / 100).toFixed(2)}) | reserved: ${res.orinReserved} cents ($${(res.orinReserved / 100).toFixed(2)})`
      : `(no orinAccounts document)`;

    const signCash = res.delta.cash >= 0 ? '+' : '';
    const signRes = res.delta.reserved >= 0 ? '+' : '';

    console.log(`--------------------------------------------------------------------------------`);
    console.log(`User: ${uid} (Account: ${res.accountId})`);
    console.log(`  Flags:         [${res.flags.join(', ')}]`);
    console.log(`  Spark Before:  balance: ${res.sparkBefore.balance} cents ($${(res.sparkBefore.balance / 100).toFixed(2)}) | reserved: ${res.sparkBefore.reserved} cents ($${(res.sparkBefore.reserved / 100).toFixed(2)})`);
    console.log(`  Trading Delta: cash: ${signCash}${res.delta.cash} cents (${signCash}${(res.delta.cash / 100).toFixed(2)}) | reserved: ${signRes}${res.delta.reserved} cents (${signRes}${(res.delta.reserved / 100).toFixed(2)})`);
    console.log(`  Spark After:   balance: ${res.sparkAfter.balance} cents ($${(res.sparkAfter.balance / 100).toFixed(2)}) | reserved: ${res.sparkAfter.reserved} cents ($${(res.sparkAfter.reserved / 100).toFixed(2)})`);
    console.log(`  Orin Values:   ${orinStr}`);
    console.log(`  Active Pos:    ${res.activePositionsToBackfill.length} lacking account_id | sum: ${res.activePositionsSum} cents ($${(res.activePositionsSum / 100).toFixed(2)})`);

    if (isApply && !res.isBlocked && !res.hasAlreadyMigrated && res.flags.includes('NEEDS_MIGRATION')) {
      const now = Date.now();
      const jid = `migration-v1:${uid}`;

      await db.runTransaction(async tx => {
        const mRef = db.doc(`orinJournals/${jid}`);
        const mSnap = await tx.get(mRef);
        if (mSnap.exists) {
          console.log(`  => [SKIPPED] ${jid} already exists.`);
          return;
        }

        const freshSpark = await tx.get(res.sparkRef);
        const curBal = freshSpark.exists ? Math.round(Number(freshSpark.data()?.balanceCents || 0)) : 0;
        const curRes = freshSpark.exists ? Math.round(Number(freshSpark.data()?.reservedCents || 0)) : 0;

        const finalBal = curBal + res.delta.cash;
        const finalRes = curRes + res.delta.reserved;

        if (finalBal < 0 || finalRes !== res.activePositionsSum) {
          throw new Error(`Integrity check failed during apply for user ${uid}`);
        }

        const entries = [];
        if (res.delta.cash !== 0) {
          entries.push([`user:${uid}:cash`, res.delta.cash]);
          entries.push([`system:migration:cash`, -res.delta.cash]);
        }
        if (res.delta.reserved !== 0) {
          entries.push([`user:${uid}:reserved`, res.delta.reserved]);
          entries.push([`system:migration:reserved`, -res.delta.reserved]);
        }

        // Apply with tx.create on deterministic id migration-v1:{uid} so reruns can't double-apply
        tx.create(mRef, {
          id: jid,
          user_id: uid,
          kind: 'migration',
          reference: `account:${res.accountId}`,
          effective_at: now,
          created_at: now,
          status: 'posted',
          entries: entries.map(([account, amount_cents], i) => ({
            id: `${jid}:${i}`,
            journal_id: jid,
            account,
            amount_cents,
            kind: 'migration',
            effective_at: now
          }))
        });

        tx.set(res.sparkRef, {
          balanceCents: finalBal,
          reservedCents: finalRes,
          updatedAt: FieldValue.serverTimestamp()
        }, { merge: true });

        for (const p of res.activePositionsToBackfill) {
          tx.update(p.ref, { account_id: res.accountId });
          totalPositionsBackfilled++;
        }

        const auditPayload = JSON.stringify({
          accountId: res.accountId,
          sparkBefore: { balanceCents: curBal, reservedCents: curRes },
          delta: { cashDelta: res.delta.cash, reservedDelta: res.delta.reserved },
          sparkAfter: { balanceCents: finalBal, reservedCents: finalRes },
          activePositionsSum: res.activePositionsSum,
          backfilledPositions: res.activePositionsToBackfill.map(p => p.id)
        });

        tx.create(db.doc(`orinAudit/${jid}`), {
          id: jid,
          actor_id: 'migration-script',
          action: 'BALANCE_MIGRATED',
          reference: uid,
          payload: auditPayload,
          payload_hash: createHash('sha256').update(auditPayload).digest('hex'),
          created_at: now
        });
      });

      console.log(`  => [APPLIED] Migration journal ${jid} posted with balance update.`);
      totalApplied++;
    } else if (res.isBlocked) {
      console.log(`  => [BLOCKED] Migration prevented due to integrity constraint failure.`);
    } else if (res.hasAlreadyMigrated) {
      console.log(`  => [ALREADY MIGRATED] deterministic migration-v1:${uid} already posted.`);
    } else if (res.flags.includes('IN_SYNC')) {
      console.log(`  => [IN SYNC] No trading delta to apply.`);
    } else {
      console.log(`  => [DRY RUN] Ready for migration. Rerun with --apply --yes to execute.`);
    }
    console.log('');
  }

  console.log(`================================================================================`);
  console.log(`=== Migration Summary ===`);
  console.log(`Total users scanned:          ${totalScanned}`);
  console.log(`Users needing migration:      ${totalNeedsMigration}`);
  console.log(`Users in sync:                ${totalInSync}`);
  console.log(`Users already migrated:       ${totalAlreadyMigrated}`);
  console.log(`Users blocked:                ${totalBlocked}`);
  if (isApply) {
    console.log(`Migrations applied:           ${totalApplied}`);
    console.log(`Active positions backfilled:  ${totalPositionsBackfilled}`);
  }

  const signCashTotal = sumCashDelta >= 0 ? '+' : '';
  const signResTotal = sumResDelta >= 0 ? '+' : '';

  console.log(`--------------------------------------------------------------------------------`);
  console.log(`Total Spark Balance Before:   ${sumSparkBalBefore} cents ($${(sumSparkBalBefore / 100).toFixed(2)})`);
  console.log(`Total Spark Balance Delta:    ${signCashTotal}${sumCashDelta} cents (${signCashTotal}${(sumCashDelta / 100).toFixed(2)})`);
  console.log(`Total Spark Balance After:    ${sumSparkBalAfter} cents ($${(sumSparkBalAfter / 100).toFixed(2)})`);
  console.log(`--------------------------------------------------------------------------------`);
  console.log(`Total Spark Reserved Before:  ${sumSparkResBefore} cents ($${(sumSparkResBefore / 100).toFixed(2)})`);
  console.log(`Total Spark Reserved Delta:   ${signResTotal}${sumResDelta} cents (${signResTotal}${(sumResDelta / 100).toFixed(2)})`);
  console.log(`Total Spark Reserved After:   ${sumSparkResAfter} cents ($${(sumSparkResAfter / 100).toFixed(2)})`);
  console.log(`================================================================================\n`);
}

// If invoked directly from CLI
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  runMigration().catch(err => {
    console.error('Migration failed:', err);
    process.exit(1);
  });
}
