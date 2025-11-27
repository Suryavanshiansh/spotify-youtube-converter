/*
  # Create conversion history table

  1. New Tables
    - `conversion_history`
      - `id` (uuid, primary key) - Unique identifier for each conversion
      - `spotify_playlist_url` (text) - Original Spotify playlist URL
      - `spotify_playlist_name` (text, nullable) - Name of the Spotify playlist
      - `youtube_playlist_url` (text, nullable) - Generated YouTube Music playlist URL
      - `track_count` (integer, default 0) - Number of tracks in the playlist
      - `successful_conversions` (integer, default 0) - Number of tracks successfully found
      - `created_at` (timestamptz) - Timestamp of conversion
      - `user_ip` (text, nullable) - User IP for basic tracking
      
  2. Security
    - Enable RLS on `conversion_history` table
    - Add policy for public read access to allow users to see conversion stats
    - Add policy for public insert to allow anonymous conversions
*/

CREATE TABLE IF NOT EXISTS conversion_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  spotify_playlist_url text NOT NULL,
  spotify_playlist_name text,
  youtube_playlist_url text,
  track_count integer DEFAULT 0,
  successful_conversions integer DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  user_ip text
);

ALTER TABLE conversion_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can insert conversion history"
  ON conversion_history
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

CREATE POLICY "Anyone can read conversion history"
  ON conversion_history
  FOR SELECT
  TO anon, authenticated
  USING (true);