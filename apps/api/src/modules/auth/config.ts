export interface AuthConfig {
  jwtSecret: string;
  databasePath: string;
}

export function readAuthConfig(): AuthConfig {
  const jwtSecret =
    process.env.JWT_SECRET ??
    (process.env.NODE_ENV === 'production' ? '' : 'arrowcast-development-jwt-secret-change-me');
  if (Buffer.byteLength(jwtSecret) < 32) {
    throw new Error('Stel JWT_SECRET in op een willekeurig geheim van minstens 32 bytes.');
  }
  const databasePath = process.env.DATABASE_PATH?.trim() || 'data/arrowcast.sqlite';
  return { jwtSecret, databasePath };
}
