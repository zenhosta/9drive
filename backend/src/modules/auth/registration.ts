import { prisma } from '../../config/prisma.js'
import { env } from '../../config/env.js'
import { randomToken } from '../../utils/crypto.js'
import { hashPassword } from '../../utils/password.js'

export type UserRole = 'admin' | 'user'

async function hasNoUsers() {
  return (await prisma.user.count()) === 0
}

// The first account can always be created so a fresh install can be set up,
// even when ALLOW_REGISTRATION=false.
export async function isRegistrationOpen() {
  return env.ALLOW_REGISTRATION || hasNoUsers()
}

// Only the very first account on an instance becomes the admin. Existing installs get
// their oldest account promoted by the user_roles migration; use `npm run user:set-role`
// to change it afterwards.
export async function roleForNewUser(): Promise<UserRole> {
  return (await hasNoUsers()) ? 'admin' : 'user'
}

// Google sign-in for an existing email logs into that account. A new email creates an
// account only while registration is open; otherwise this returns null.
export async function findOrCreateGoogleUser(email: string, name: string) {
  const existing = await prisma.user.findUnique({ where: { email } })
  if (existing) return prisma.user.update({ where: { id: existing.id }, data: { name } })
  if (!(await isRegistrationOpen())) return null
  return prisma.user.create({ data: { email, name, passwordHash: await hashPassword(randomToken(32)), role: await roleForNewUser() } })
}
