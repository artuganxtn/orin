import { randomUUID, createHmac, createCipheriv, randomBytes } from 'node:crypto';
import { withTx } from './db.ts';
import { recordVerifiedCustomer } from './program-ingestion.ts';

export class KycError extends Error {
  code: string;
  constructor(message: string, public status = 400, code = 'kyc_error') {
    super(message);
    this.code = code;
  }
}

export async function requireVerifiedKyc(user: { id: string }, client: any) {
  const res = await client.query(
    'SELECT verified, revoked FROM verified_customers WHERE user_id = $1',
    [user.id]
  );
  if (!res.rowCount || !res.rows[0].verified || res.rows[0].revoked) {
    throw new KycError('توثيق الهوية (KYC) مطلوب لإتمام هذه العملية. / Identity verification (KYC) is required for this action.', 403, 'kyc_required');
  }
}

function getKycFilesKey(): Buffer {
  const raw = process.env.KYC_FILES_KEY || 'orin-kyc-files-key-32-bytes-2026!';
  if (raw.length === 64 && /^[0-9a-fA-F]+$/.test(raw)) {
    return Buffer.from(raw, 'hex');
  }
  const buf = Buffer.alloc(32);
  Buffer.from(raw, 'utf8').copy(buf);
  return buf;
}

export function computeCustomerKey(country: unknown, documentType: unknown, idNumber: unknown): string {
  const normCountry = String(country ?? '').trim().toUpperCase();
  const normType = String(documentType ?? '').trim().toLowerCase();
  const normIdNumber = String(idNumber ?? '').replace(/[\s\-\.]+/g, '').toUpperCase();
  if (!normCountry || !normType || !normIdNumber) {
    throw new KycError('Missing or incomplete KYC fields (country, documentType, idNumber) for customerKey generation', 400);
  }
  const secret = process.env.KYC_HMAC_SECRET;
  if (!secret) {
    throw new KycError('KYC_HMAC_SECRET configuration required', 500);
  }
  return createHmac('sha256', secret).update(`${normCountry}:${normType}:${normIdNumber}`).digest('hex');
}

export function idLast4(idNumber: unknown): string {
  const normIdNumber = String(idNumber ?? '').replace(/[\s\-\.]+/g, '').toUpperCase();
  return normIdNumber.slice(-4);
}

function encryptAesGcm(plainText: string, keyBuffer: Buffer) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', keyBuffer, iv);
  let encrypted = cipher.update(plainText, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const tag = cipher.getAuthTag().toString('hex');
  return {
    encrypted,
    iv: iv.toString('hex'),
    tag
  };
}

export async function submitKyc(
  user: { id: string },
  input: { fullName?: string; country: string; documentType: string; idNumber: string; documentImage?: string }
) {
  const country = String(input.country || '').trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(country)) {
    throw new KycError('رمز الدولة يجب أن يتكون من حرفين (ISO-2).', 400);
  }
  const documentType = String(input.documentType || '').trim().toLowerCase();
  if (!['passport', 'id_card', 'driver_license'].includes(documentType)) {
    throw new KycError('نوع الوثيقة غير صالح.', 400);
  }
  const idNumber = String(input.idNumber || '').trim();
  if (!idNumber || idNumber.length < 4 || idNumber.length > 50) {
    throw new KycError('رقم الهوية غير صالح.', 400);
  }

  const customerKey = computeCustomerKey(country, documentType, idNumber);
  const last4 = idLast4(idNumber);

  const encKey = getKycFilesKey();

  const encId = encryptAesGcm(idNumber, encKey);
  const docImage = input.documentImage || 'placeholder_document_data';
  const encImage = encryptAesGcm(docImage, encKey);

  const kycReqId = 'kyc-req-' + randomUUID();
  const kycFileId = 'kyc-file-' + randomUUID();

  return await withTx(async (client) => {
    // 0. Check if user is already verified or has a request under review
    const verifiedCheck = await client.query('SELECT verified, revoked FROM verified_customers WHERE user_id = $1', [user.id]);
    if (verifiedCheck.rowCount && verifiedCheck.rows[0].verified && !verifiedCheck.rows[0].revoked) {
      throw new KycError('تم توثيق حسابك بنجاح مسبقًا. / Your identity is already verified.', 409, 'already_verified');
    }

    const pendingCheck = await client.query("SELECT status FROM kyc_files WHERE user_id = $1 AND status IN ('review', 'pending')", [user.id]);
    if (pendingCheck.rowCount > 0) {
      throw new KycError('طلب توثيق الهوية الخاص بك قيد المراجعة حاليًا. / Your KYC verification request is currently under review.', 409, 'kyc_pending');
    }

    // 1. Check if customer_key is registered to another user
    const existing = await client.query('SELECT user_id FROM customer_registry WHERE customer_key = $1', [customerKey]);
    if (existing.rowCount && existing.rows[0].user_id !== user.id) {
      throw new KycError('وثيقة الهوية هذه مسجلة بالفعل لحساب آخر. / This ID document is already registered to another account.', 409, 'duplicate_document');
    }

    await client.query(
      `INSERT INTO customer_registry (customer_key, user_id)
       VALUES ($1, $2)
       ON CONFLICT (customer_key) DO NOTHING`,
      [customerKey, user.id]
    );

    // 2. Insert kyc request
    await client.query(
      `INSERT INTO kyc_requests (id, user_id, customer_key, status, reason)
       VALUES ($1, $2, $3, 'pending', 'User KYC verification request')
       ON CONFLICT (id) DO NOTHING`,
      [kycReqId, user.id, customerKey]
    );

    // 3. Insert kyc file securely
    await client.query(
      `INSERT INTO kyc_files (
         id, user_id, country, document_type,
         id_number_encrypted, id_number_iv, id_number_tag,
         document_image_encrypted, document_image_iv, document_image_tag,
         status
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'review')`,
      [
        kycFileId,
        user.id,
        country,
        documentType,
        encId.encrypted,
        encId.iv,
        encId.tag,
        encImage.encrypted,
        encImage.iv,
        encImage.tag
      ]
    );

    // 4. Update profile display name if fullName provided
    if (input.fullName && input.fullName.trim()) {
      await client.query(
        `UPDATE profiles SET display_name = $1, updated_at = NOW() WHERE id = $2`,
        [input.fullName.trim(), user.id]
      );
    }

    return {
      ok: true,
      requestId: kycReqId,
      status: 'pending',
      idNumberLast4: last4,
      customerKey
    };
  });
}

export async function getKycStatus(user: { id: string }) {
  return await withTx(async (client) => {
    // Check if verified customer
    const vRes = await client.query(
      'SELECT customer_key, id_number_last4, verified, revoked FROM verified_customers WHERE user_id = $1',
      [user.id]
    );
    if (vRes.rowCount && vRes.rows[0].verified && !vRes.rows[0].revoked) {
      const pRes = await client.query('SELECT display_name FROM profiles WHERE id = $1', [user.id]);
      const kycFileRes = await client.query('SELECT country, document_type FROM kyc_files WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1', [user.id]);
      const kycFile = kycFileRes.rows[0];
      return {
        exists: true,
        status: 'verified' as const,
        verified: true,
        idNumberLast4: vRes.rows[0].id_number_last4,
        customerKey: vRes.rows[0].customer_key,
        request: {
          fullName: pRes.rows[0]?.display_name || 'Verified User',
          documentType: kycFile?.document_type || 'passport',
          idNumber: `•••• ${vRes.rows[0].id_number_last4}`,
          country: kycFile?.country || 'US',
          status: 'verified' as const
        }
      };
    }

    // Check latest kyc request / file
    const fileRes = await client.query(
      'SELECT id, country, document_type, status, created_at, updated_at FROM kyc_files WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1',
      [user.id]
    );
    if (fileRes.rowCount) {
      const row = fileRes.rows[0];
      const statusMap: Record<string, string> = { pending: 'pending', review: 'pending', approved: 'verified', verified: 'verified', rejected: 'rejected' };
      const mappedStatus = statusMap[row.status] || 'pending';
      const pRes = await client.query('SELECT display_name FROM profiles WHERE id = $1', [user.id]);
      return {
        exists: true,
        status: mappedStatus,
        verified: mappedStatus === 'verified',
        request: {
          fullName: pRes.rows[0]?.display_name || 'User',
          documentType: row.document_type || 'passport',
          idNumber: '••••',
          country: row.country || 'US',
          status: mappedStatus,
          createdAt: new Date(row.created_at).getTime(),
          updatedAt: new Date(row.updated_at).getTime()
        }
      };
    }

    return {
      exists: false,
      status: 'unverified' as const,
      verified: false
    };
  });
}

export async function verifyKycCustomer(
  admin: { id: string },
  input: { userId: string; country?: string; documentType?: string; idNumber?: string; customerKey?: string }
) {
  const target = input.userId;
  return await withTx(async (client) => {
    let customerKey = input.customerKey;
    let last4 = '0000';

    if (!customerKey) {
      if (input.country && input.documentType && input.idNumber) {
        customerKey = computeCustomerKey(input.country, input.documentType, input.idNumber);
        last4 = idLast4(input.idNumber);
      } else {
        const kycReq = await client.query(
          'SELECT customer_key FROM kyc_requests WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1',
          [target]
        );
        if (kycReq.rowCount === 0) {
          throw new KycError('طلب الهوية غير موجود للمستخدم.', 404);
        }
        customerKey = kycReq.rows[0].customer_key;
      }
    }

    const eventId = 'kyc-admin-' + randomUUID();
    await recordVerifiedCustomer(target, customerKey, eventId, last4);

    await client.query(
      `UPDATE kyc_requests
       SET status = 'approved', reviewer_id = $1, reviewed_at = NOW()
       WHERE user_id = $2 AND status = 'pending'`,
      [admin.id, target]
    );

    await client.query(
      `UPDATE kyc_files
       SET status = 'verified', updated_at = NOW()
       WHERE user_id = $1 AND status = 'review'`,
      [target]
    );

    return {
      ok: true,
      verified: true,
      userId: target,
      customerKey,
      idNumberLast4: last4
    };
  });
}

export async function listKycFiles(_staff: { id: string }) {
  return await withTx(async (client) => {
    const res = await client.query(
      `SELECT id, user_id, country, document_type, status, created_at, updated_at
       FROM kyc_files ORDER BY created_at DESC LIMIT 100`
    );
    const files = res.rows.map(r => ({
      id: r.id,
      userId: r.user_id,
      country: r.country,
      documentType: r.document_type,
      status: r.status,
      createdAt: new Date(r.created_at).getTime(),
      updatedAt: new Date(r.updated_at).getTime()
    }));
    return { files };
  });
}

export async function readKycFile(staff: { id: string }, fileId: string, reason: string) {
  if (!reason || reason.trim().length < 5) {
    throw new KycError('سبب الوصول إلى وثيقة الهوية مطلوب بحد أدنى 5 أحرف.', 400);
  }
  return await withTx(async (client) => {
    const res = await client.query(
      `SELECT id, user_id, country, document_type, status, created_at, updated_at
       FROM kyc_files WHERE id = $1`,
      [fileId]
    );
    if (res.rowCount === 0) {
      throw new KycError('ملف الهوية غير موجود.', 404);
    }
    const row = res.rows[0];

    // Log staff access
    await client.query(
      `INSERT INTO kyc_access_log (staff_id, kyc_file_id, action, reason)
       VALUES ($1, $2, 'read_metadata', $3)`,
      [staff.id, fileId, reason.trim()]
    );

    return {
      id: row.id,
      userId: row.user_id,
      country: row.country,
      documentType: row.document_type,
      status: row.status,
      createdAt: new Date(row.created_at).getTime(),
      updatedAt: new Date(row.updated_at).getTime(),
      accessLogged: true
    };
  });
}
