import { getActiveFinancialPolicy } from './financial-policy.ts';

/** Curated product facts, not investment promises. Financial values come from
 * the same active server policy as the wallet, never from old seeded articles. */
export const SUPPORT_KNOWLEDGE_VERSION = '2026-10-approved-facts-v2';

const FEATURES = [
  { terms: /حساب|رصيد|محفظ|account|balance|wallet/i, text: 'Accounts: ORIN has real and demo accounts. Demo balances are virtual and cannot be withdrawn. Real cash, reserved trading funds, bonus principal and bonus profit are distinct; do not call total cash withdrawable. Wallet labels must match the current application, not an assumed new naming scheme.' },
  { terms: /إيداع|ايداع|شحن|deposit|fund/i, text: 'Deposits: use the Deposit screen, choose an available currency/network and use the address produced for that payment. Never invent a deposit address or supported network. A provider confirmation is not the same as credited=true; partially paid/review payments need review. Do not promise a processing time.' },
  { terms: /سحب|تحويل|withdraw|transfer/i, text: 'Withdrawals and internal transfers are different operations. The external withdrawal fee is separate from any internal early-transfer fee. Available funds, account restrictions and current eligibility must be checked by the server; a displayed balance alone is not approval. Use the withdrawal screen for a quote, confirmation and request status.' },
  { terms: /توثيق|هوي|kyc|verif/i, text: 'Identity verification: use the dedicated identity-verification screen to submit documents and review status. Never request identity images, passwords, OTPs or access tokens in chat. Report only the verified account status supplied by the server; do not claim you inspected a document.' },
  { terms: /صفق|تداول|كود|trade|contract|signal|code/i, text: 'Trading: official codes have their own published asset, direction, duration, opening/closing time and settlement terms. A chart quote is not a contract execution guarantee. Read the current scheduled slots and contract terms; never invent a code or fixed schedule. The assistant cannot execute trades or move money.' },
  { terms: /بونص|إحال|احال|دعوة|فريق|وكال|bonus|referr|invite|team|agency/i, text: 'Programs: the app includes bonus, referrals, team levels, agency and badges screens. Eligibility and reward rates depend on their currently published server configuration and actual account activity. Do not invent a reward amount or say a reward is approved without a record.' },
  { terms: /أمان|امان|دخول|مرور|security|login|password|session/i, text: 'Security: account settings include password/security and session controls. Use official sign-in/recovery screens. An email, account number or transaction reference can locate a record but never proves ownership. Never ask a customer to paste an ID token, password, verification code or API key.' },
  { terms: /إشعار|اشعار|لغة|إعداد|اعداد|notification|language|setting/i, text: 'Settings: the app includes profile, language/display preferences, notification preferences and an in-app notification center. Preferences do not change contract terms, fees or account eligibility.' },
  { terms: /دعم|شكوى|موظف|support|complaint|human|vino|فينو/i, text: 'Support: Adam is an AI assistant, not a human employee. Team follow-up creates a ticket; a ticket does not prove someone is online or reviewing it now. Vino connectivity is not established by this source release; never claim it is connected. External account lookup requires a verified ORIN session and an authorized backend integration.' }
];

export function approvedKnowledge(query: string): string[] {
  const relevant = FEATURES.filter(f => f.terms.test(query));
  return [
    'ORIN product support: answer the actual question briefly and give a concrete next step. If a fact is unavailable, say so rather than guessing. No guaranteed profit, guaranteed doubling, invented processing time or default investment pitch.',
    ...(relevant.length ? relevant : FEATURES).map(f => f.text)
  ];
}

export async function financialKnowledge(query: string, client?: any): Promise<string[]> {
  if (!/إيداع|ايداع|سحب|تحويل|رسوم|عمول|خصم|ربح|أرباح|ارباح|مضاعف|استثمار|deposit|withdraw|transfer|fee|commission|profit|return|doubl|invest/i.test(query)) return [];
  const policy = await getActiveFinancialPolicy(client);
  const facts = [
    `ACTIVE_FINANCIAL_POLICY: ${JSON.stringify(policy)}`,
    'Describe only the relevant part of the runtime policy returned above. When the server reports signal-doubling-v1 active, qualifying realized signal net profit reaching aggregated post-cutover new principal permanently waives the account early-transfer fee, including later deposits; this is not a promise that the threshold will be reached. If the returned policy is legacy or not activated, do not claim the prospective policy is active. External withdrawal fees remain separate. Old funds follow the explicit grandfathering policy without recalculating historical transactions. Never invent a calendar deadline, repeat a legacy day count by default, or claim a particular account has qualified without a server eligibility result. Account-specific transfer quotes are authoritative.'
  ];
  return facts;
}

/** Free-form articles cannot override financial policy or live schedules. */
export function safeSupplementalArticle(title: unknown, content: unknown): boolean {
  const text = `${String(title || '')} ${String(content || '')}`;
  return text.length <= 6000 && !/[0-9٠-٩۰-۹]|[%$€٪]|(?:profit|return|yield|doubl|deposit|withdraw|transfer|fee|commission|schedule|trade\s*time|guarantee|إيداع|ايداع|سحب|تحويل|رسوم|عمول|ربح|أرباح|ارباح|مضاعف|عائد|مضمون|مواعيد|موعد)/i.test(text);
}
