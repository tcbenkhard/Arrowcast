import { DatabaseConnection } from './index.js';

const database = new DatabaseConnection(process.env.DATABASE_PATH?.trim() || 'data/arrowcast.sqlite');
database.close();
console.log('Databasemigraties zijn bijgewerkt.');
