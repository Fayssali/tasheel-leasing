// Loaded before any test module, because ConfigModule validates the environment at import time.
process.env.DATABASE_URL ??= 'postgresql://unused-in-unit-tests';
process.env.JWT_ACCESS_SECRET ??= 'test-secret-for-jest-only-0123456789';
process.env.MFA_ENCRYPTION_KEY ??= Buffer.alloc(32, 7).toString('base64');
