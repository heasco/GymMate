// generate-secret.js - One-time script to create a JWT secret
const crypto = require('crypto');

const secret = crypto.randomBytes(32).toString('base64url'); // 32 bytes, base64url (URL-safe)
console.log('Your JWT secret (copy this exactly):');
console.log(secret);
console.log('\nAdd to .env: JWT_SECRET=' + secret);
