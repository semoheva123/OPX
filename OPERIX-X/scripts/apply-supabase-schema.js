require('dotenv').config({ path: '.env' });
const fs = require('fs');
const path = require('path');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const DATABASE_URL = process.env.SUPABASE_DATABASE_URL || process.env.DATABASE_URL;

const sqlPath = path.join(__dirname, '..', 'supabase', 'schema.sql');
const sql = fs.readFileSync(sqlPath, 'utf8');

async function applyWithPostgres() {
  if (!DATABASE_URL) {
    return false;
  }

  const { Client } = require('pg');
  const client = new Client({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();
  await client.query(sql);
  await client.end();
  return true;
}

async function applyWithRest() {
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    return false;
  }

  const url = `${SUPABASE_URL.replace(/\/$/, '')}/rest/v1/sql`;
  console.log('Applying Supabase schema to:', url);
  console.log('SQL length:', sql.length);

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      apikey: SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation'
    },
    body: JSON.stringify({ query: sql })
  });

  const text = await response.text();
  console.log('Status:', response.status, response.statusText);
  console.log(text.slice(0, 2000));

  if (!response.ok) {
    throw new Error(`Supabase REST SQL endpoint rejected the schema: ${response.status} ${response.statusText}`);
  }

  return true;
}

async function main() {
  try {
    if (DATABASE_URL) {
      console.log('Using direct PostgreSQL connection for schema creation.');
      await applyWithPostgres();
      console.log('Schema applied successfully with PostgreSQL connection.');
      return;
    }

    if (SUPABASE_URL && SERVICE_ROLE_KEY) {
      try {
        await applyWithRest();
        console.log('Schema applied successfully using Supabase REST endpoint.');
        return;
      } catch (restError) {
        console.error('REST SQL execution failed:', restError.message);
        console.error('This project is not configured for raw DDL execution through the REST endpoint. Use Supabase SQL Editor or add SUPABASE_DATABASE_URL / DATABASE_URL.');
        process.exit(1);
      }
    }

    console.error('No valid database connection is configured. Set either SUPABASE_DATABASE_URL or DATABASE_URL, or run the SQL manually in the Supabase SQL editor.');
    process.exit(1);
  } catch (err) {
    console.error('Fatal error:', err);
    process.exit(1);
  }
}

main();
