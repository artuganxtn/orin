export const FINANCIAL_UNAVAILABLE = 'تشغيل العقود وحجز الأرصدة والتسوية يحتاج خادمًا آمنًا.';

export function createSparkApi(db: any, getUser: () => Promise<any>, programRequest?: any) {
  return async (path: string, init: RequestInit = {}) => {
    throw new Error('All requests must route to Express backend');
  };
}
