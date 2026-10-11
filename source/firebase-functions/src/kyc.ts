import { randomUUID, createHmac, createCipheriv, randomBytes } from 'node:crypto';
import { withTx } from './db.ts';
import { recordVerifiedCustomer } from './program-ingestion.ts';

export class KycError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

function getKycFilesKey(): Buffer {
  const raw = process.env.KYC_FILES_KEY;
  if (!raw) {
    throw new KycError('KYC_FILES_KEY configuration required', 500);
  }
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
  input: { country: string; documentType: string; idNumber: string; documentImage?: string }
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
    // 1. Insert customer registry mapping
    await client.query(
      `INSERT INTO customer_registry (customer_key, user_id)
       VALUES ($1, $2)
       ON CONFLICT (customer_key) DO UPDATE SET user_id = EXCLUDED.user_id`,
      [customerKey, user.id]
    );

    // 2. Insert kyc request
    await client.query(
      `INSERT INTO kyc_requests (id, user_id, customer_key, status, reason)
       VALUES ($1, $2, $3, 'pending', 'User KYC verification request')`,
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
      return {
        verified: true,
        status: 'verified',
        idNumberLast4: vRes.rows[0].id_number_last4,
        customerKey: vRes.rows[0].customer_key
      };
    }

    // Check latest kyc request
    const reqRes = await client.query(
      'SELECT id, status, reason, created_at, reviewed_at FROM kyc_requests WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1',
      [user.id]
    );
    if (reqRes.rowCount) {
      const row = reqRes.rows[0];
      return {
        verified: false,
        status: row.status,
        reason: row.reason,
        requestId: row.id,
        createdAt: row.created_at,
        reviewedAt: row.reviewed_at
      };
    }

    return {
      verified: false,
      status: 'unsubmitted'
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
    // List query NEVER returns image data or encrypted numbers
    const res = await client.query(`
      SELECT id, user_id AS "userId", country, document_type AS "documentType",
             status, created_at AS "createdAt", updated_at AS "updatedAt"
      FROM kyc_files
      ORDER BY created_at DESC
      LIMIT 50
    `);
    return { files: res.rows };
  });
}

export async function readKycFile(staff: { id: string }, fileId: string, reason: string) {
  if (!reason || !reason.trim()) {
    throw new KycError('Audit reason required for accessing KYC document', 400);
  }
  return await withTx(async (client) => {
    // 1. Read document
    const res = await client.query(
      `SELECT id, user_id AS "userId", country, document_type AS "documentType", status, created_at AS "createdAt"
       FROM kyc_files WHERE id = $1`,
      [fileId]
    );
    if (res.rowCount === 0) {
      throw new KycError('KYC file not found', 404);
    }

    // 2. Write access log in the SAME transaction
    await client.query(
      `INSERT INTO kyc_access_log (staff_id, kyc_file_id, action, reason, accessed_at)
       VALUES ($1, $2, 'view', $3, NOW())`,
      [staff.id, fileId, reason.trim()]
    );

    return {
      ok: true,
      file: res.rows[0],
      accessLogged: true
    };
  });
}
