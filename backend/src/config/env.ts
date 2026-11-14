import dotenv from 'dotenv'
import { z } from 'zod'

dotenv.config()

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  APP_PORT: z.coerce.number().default(4000),
  FRONTEND_URL: z.string().url(),
  JWT_ACCESS_SECRET: z.string().min(32),
  TOKEN_ENCRYPTION_KEY: z.string().min(32),
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().default(900),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().default(30),
  MAX_UPLOAD_BYTES: z.coerce.number().default(5 * 1024 * 1024 * 1024),
  RECAPTCHA_SECRET_KEY: z.string().optional(),
  ADMIN_EMAILS: z.string().default(''),
  COOKIE_SECURE: z.enum(['true', 'false']).default('false').transform((value) => value === 'true'),
  TRUST_PROXY: z.enum(['true', 'false']).default('false').transform((value) => value === 'true'),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
}).superRefine((config, context) => {
  if (config.NODE_ENV === 'production' && (!config.COOKIE_SECURE || !config.FRONTEND_URL.startsWith('https://'))) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['COOKIE_SECURE'], message: 'Production requires HTTPS and COOKIE_SECURE=true.' })
  }
})

export const env = envSchema.parse(process.env)
