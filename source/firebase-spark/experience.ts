export const DEFAULT_APP_CONFIG = {
  maintenance: false,
  messageAr: 'نعمل على تحسين ORIN. حاول بعد قليل.',
  messageEn: 'ORIN is being updated. Please try again shortly.',
  welcomeAr: '',
  welcomeEn: '',
  supportEmail: ''
};

export function experienceApi(db: any) {
  return async (u: any, path: string, method: string, input: Record<string, any>) => {
    throw new Error('Experience API runs via Express server');
  };
}
