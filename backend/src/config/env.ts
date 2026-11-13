import dotenv from 'dotenv'
import { z } from 'zod'

dotenv.config()

// Custom schemes such as ninedrive://app are valid deep links but are rejected
// by zod's built-in url() validator, which only accepts http(s)-style URLs.
// Note the scheme must start with a letter: "9drive://" is not a legal URI.
const absoluteUrl = z.string().refine(
  (value) => {
    try {
      return Boolean(new URL(value).protocol)
    } catch {
      return false
    }
  },
  { message: 'Must be an absolute URL' },
)

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  APP_PORT: z.coerce.number().default(4000),
  FRONTEND_URL: z.string().url(),
  // Deep link base used by the Android app, e.g. ninedrive://app. Optional.
  MOBILE_APP_REDIRECT_URL: absoluteUrl.optional(),
  JWT_ACCESS_SECRET: z.string().min(32),
  TOKEN_ENCRYPTION_KEY: z.string().min(32),
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().default(900),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().default(30),
  MAX_UPLOAD_BYTES: z.coerce.number().default(5 * 1024 * 1024 * 1024),
  RECAPTCHA_SECRET_KEY: z.string().optional(),
  // Comma-separated emails allowed to use /system routes. Empty disables them.
  ADMIN_EMAILS: z.string().optional(),
})

export const env = envSchema.parse(process.env)
