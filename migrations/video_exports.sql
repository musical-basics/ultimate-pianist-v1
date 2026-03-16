-- ============================================
-- Video Exports Table
-- Tracks async video rendering jobs
-- ============================================

CREATE TABLE video_exports (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  config_id     TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'queued'
                CHECK (status IN ('queued','processing','completed','failed')),
  progress      INTEGER NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
  mp4_url       TEXT,
  error_message TEXT,
  created_at    TIMESTAMPTZ DEFAULT now(),
  updated_at    TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_video_exports_config ON video_exports(config_id);
CREATE INDEX idx_video_exports_status ON video_exports(status);

-- ============================================
-- RLS Policies
-- ============================================

ALTER TABLE video_exports ENABLE ROW LEVEL SECURITY;

-- Anyone can read exports (for demo / progress UI)
CREATE POLICY "Anyone can read exports"
  ON video_exports FOR SELECT USING (true);

-- Only service role can insert/update
CREATE POLICY "Service role can manage exports"
  ON video_exports FOR ALL
  USING (auth.role() = 'service_role');

-- ============================================
-- IMPORTANT: Enable Realtime for this table
-- in the Supabase Dashboard:
-- Database → Replication → add video_exports
-- ============================================
