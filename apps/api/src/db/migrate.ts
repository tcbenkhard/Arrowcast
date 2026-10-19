import { openDatabase } from './index.js';

const database = openDatabase(process.env.DATABASE_PATH?.trim() || 'data/arrowcast.sqlite');
database.close();
console.log('Databasemigraties zijn bijgewerkt.');
