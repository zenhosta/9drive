import { prisma } from '../config/prisma.js'

// Usage: npm run user:set-role -- <email> <admin|user>
const [email, role] = process.argv.slice(2)

async function main() {
  if (!email || (role !== 'admin' && role !== 'user')) {
    console.error('Usage: npm run user:set-role -- <email> <admin|user>')
    process.exitCode = 1
    return
  }

  const user = await prisma.user.findUnique({ where: { email: email.trim() } })
  if (!user) {
    console.error(`No user found with email ${email}`)
    process.exitCode = 1
    return
  }

  await prisma.user.update({ where: { id: user.id }, data: { role } })
  console.log(`${user.email} is now ${role === 'admin' ? 'an admin' : 'a regular user'}.`)
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
