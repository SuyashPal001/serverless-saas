const { neon } = require('@neondatabase/serverless');
const sql = neon(process.env.DATABASE_URL);
sql`INSERT INTO drizzle.__drizzle_migrations (hash, created_at) 
    VALUES ('0015_task_step_feedback_history', ${Date.now()})`
  .then(() => console.log('Migration recorded'))
  .catch(e => console.log('Error:', e.message));
