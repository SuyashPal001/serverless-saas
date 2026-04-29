-- Add summary column to task_steps for relay-written human-readable output
ALTER TABLE task_steps ADD COLUMN IF NOT EXISTS summary text;
