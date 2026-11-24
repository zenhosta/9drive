process.env.DATABASE_URL ||= 'mysql://user:pass@localhost:3306/test'
process.env.FRONTEND_URL ||= 'http://localhost:5173'
process.env.JWT_ACCESS_SECRET ||= 'test-jwt-secret-at-least-32-characters-long'
process.env.TOKEN_ENCRYPTION_KEY ||= 'test-token-encryption-key-32bytes!!'
