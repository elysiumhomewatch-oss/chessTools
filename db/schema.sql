CREATE TABLE IF NOT EXISTS games (
  code TEXT PRIMARY KEY,
  host_offer TEXT NOT NULL,
  guest_answer TEXT,
  host_ice TEXT DEFAULT '[]',
  guest_ice TEXT DEFAULT '[]',
  status TEXT DEFAULT 'waiting',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
