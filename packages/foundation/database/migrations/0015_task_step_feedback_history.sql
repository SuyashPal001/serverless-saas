-- Add feedbackHistory audit trail column to task_steps
ALTER TABLE task_steps ADD COLUMN IF NOT EXISTS feedback_history jsonb NOT NULL DEFAULT '[]'::jsonb;
