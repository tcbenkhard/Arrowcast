import { randomBytes } from 'node:crypto';

console.log('Voeg deze waarde toe aan .env in de projectroot:');
console.log(`JWT_SECRET=${randomBytes(48).toString('hex')}`);
