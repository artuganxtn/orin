import { ApiError, type Identity } from './store';

export async function controlDocument(_u: Identity, _requestId: string, _documentId: string, _res: any) {
  throw new ApiError('Cloud storage buckets are decommissioned. All KYC documents are stored encrypted in PostgreSQL kyc_files table.', 501);
}
