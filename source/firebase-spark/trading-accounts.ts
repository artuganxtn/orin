import {readDemoWallet} from './demo-wallet';
import { collection, doc, documentId, getDoc, getDocs, limit, orderBy, query, runTransaction, serverTimestamp, startAfter, type Firestore, type QueryDocumentSnapshot } from 'firebase/firestore';
import type { AccountDirectory, TradingAccount, TradingAccountType } from '../lib/trading-accounts';

class AccountError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}
class NumberCollision extends Error {}
// Numbers are independent of Firebase identity; a Firestore transaction claims them globally.
export function newAccountNumber() {
  let digits = '';
  while (digits.length < 12) {
    for (const byte of crypto.getRandomValues(new Uint8Array(24))) {
      if (byte >= 250 || (!digits.length && byte % 10 === 0)) continue;
      digits += String(byte % 10);
      if (digits.length === 12) break;
    }
  }
  return digits;
}
const validId = (id: unknown): id is string => typeof id === 'string' && (id === 'primary' || /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(id));
const ref = (db: Firestore, uid: string, id: string) => doc(db, 'sparkTradingAccounts', uid, 'accounts', id);
const selectionRef = (db: Firestore, uid: string) => doc(db, 'sparkAccountSelections', uid);

export function tradingAccountsApi(db: Firestore) {
  async function create(uid: string, type: TradingAccountType, id: string) {
    if (!['real', 'demo'].includes(type) || !validId(id) || (id === 'primary' && type !== 'demo'))
      throw new AccountError('بيانات الحساب غير صالحة. / Invalid account details.');
    for (let attempt = 0; attempt < 4; attempt++) {
      const accountNumber = newAccountNumber();
      try {
        await runTransaction(db, async tx => {
          const accountRef = ref(db, uid, id), existing = await tx.get(accountRef);
          // The request ID is stable across retries, including a lost success response.
          if (existing.exists()) {
            if (existing.data().type !== type) throw new AccountError('طلب إنشاء الحساب مستخدم مسبقًا. / Account request already used.', 409);
            return;
          }
          const numberRef = doc(db, 'sparkAccountNumbers', accountNumber);
          if ((await tx.get(numberRef)).exists()) throw new NumberCollision();
          tx.set(accountRef, { ownerId: uid, accountNumber, type, currency: 'USD', balanceCents: 0, reservedCents: 0, realizedCents: 0, createdAt: serverTimestamp() });
          tx.set(numberRef, { ownerId: uid, accountId: id });
        });
        return;
      } catch (error) {
        // A collision owned by someone else is deliberately unreadable. Retry with a new number.
        if (attempt < 3 && (error instanceof NumberCollision || (error as {code?: string}).code === 'permission-denied')) continue;
        throw error;
      }
    }
  }
  async function list(uid: string): Promise<AccountDirectory> {
    const rows: QueryDocumentSnapshot[] = [];
    let cursor: QueryDocumentSnapshot | undefined;
    for (;;) {
      const page = await getDocs(query(collection(db, 'sparkTradingAccounts', uid, 'accounts'), orderBy(documentId()), ...(cursor ? [startAfter(cursor)] : []), limit(100)));
      rows.push(...page.docs);
      if (page.size < 100) break;
      cursor = page.docs[page.docs.length-1];
    }
    const hasReal = rows.some(r => r.data().type === 'real');
    if (!hasReal) {
      const initialRealId = crypto.randomUUID();
      await create(uid, 'real', initialRealId);
      const newDoc = await getDoc(ref(db, uid, initialRealId));
      if (newDoc.exists()) rows.push(newDoc as QueryDocumentSnapshot);
    }
    const [selection, legacy] = await Promise.all([getDoc(selectionRef(db, uid)), getDoc(doc(db, 'orinAccounts', uid))]);
    const realRows = rows.filter(r => r.data().type === 'real');
    const accounts = (await Promise.all(realRows.map(async row => {
      const d = row.data();
      return { id: row.id, accountNumber: d.accountNumber, type: 'real', currency: d.currency,
        balanceCents: d.balanceCents ?? 0, reservedCents: d.reservedCents ?? 0,
        realizedCents: d.realizedCents ?? 0, createdAt: d.createdAt?.toMillis?.() ?? 0 } as TradingAccount;
    }))).sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
    const savedId = selection.data()?.accountId;
    const savedAccount = accounts.find(a => a.id === savedId);
    const activeId = savedAccount ? savedId! : (accounts[0]?.id ?? '');
    return { accounts, activeId };
  }
  async function select(uid: string, id: string) {
    if (!validId(id)) throw new AccountError('الحساب غير متاح. / Account unavailable.', 404);
    await runTransaction(db, async tx => {
      const selected = await tx.get(ref(db, uid, id));
      if (!selected.exists()) throw new AccountError('الحساب غير متاح. / Account unavailable.', 404);
      tx.set(selectionRef(db, uid), { accountId: id, updatedAt: serverTimestamp() });
    });
    return list(uid);
  }
  return async (uid: string, method = 'GET', input: Record<string, unknown> = {}) => {
    if (method === 'GET') return list(uid);
    if (method === 'POST' && Object.keys(input).every(k => ['id', 'type'].includes(k))) {
      if (input.id === 'primary') throw new AccountError('طلب غير صالح. / Invalid request.');
      await create(uid, input.type as TradingAccountType, input.id as string);
      return list(uid);
    }
    if (method === 'PATCH' && Object.keys(input).every(k => k === 'id')) return select(uid, input.id as string);
    throw new AccountError('طلب غير صالح. / Invalid request.');
  };
}
