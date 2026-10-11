import type { DemoWallet, DemoWalletView } from '../lib/demo-wallet';

export async function readDemoWallet(db: any, uid: string, id: string): Promise<DemoWallet | null> {
  return null;
}

export function demoWalletApi(db: any) {
  return async (uid: string, method: string, input: Record<string, unknown>): Promise<DemoWalletView> => {
    return { wallet: null, operations: [] };
  };
}
