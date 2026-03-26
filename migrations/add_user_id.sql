-- Do NOT run this through code. Run this manually in the Supabase SQL Editor.
ALTER TABLE configurations
ADD COLUMN user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL;
