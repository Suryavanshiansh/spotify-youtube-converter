import { useState } from 'react';
import { Music, ArrowRight, Loader2, ExternalLink, CheckCircle2 } from 'lucide-react';

interface Track {
  name: string;
  artists: string[];
  found?: boolean;
}

function App() {
  const [playlistUrl, setPlaylistUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<'idle' | 'fetching' | 'converting' | 'complete'>('idle');
  const [tracks, setTracks] = useState<Track[]>([]);
  const [youtubePlaylistUrl, setYoutubePlaylistUrl] = useState('');
  const [error, setError] = useState('');

  const handleConvert = async () => {
    if (!playlistUrl.trim()) {
      setError('Please enter a Spotify playlist URL');
      return;
    }

    setLoading(true);
    setError('');
    setStatus('fetching');
    setTracks([]);
    setYoutubePlaylistUrl('');

    try {
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

      const spotifyResponse = await fetch(
        `${supabaseUrl}/functions/v1/fetch-spotify-playlist`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${supabaseAnonKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ playlistUrl }),
        }
      );

      if (!spotifyResponse.ok) {
        const errorData = await spotifyResponse.json();
        throw new Error(errorData.error || 'Failed to fetch Spotify playlist');
      }

      const spotifyData = await spotifyResponse.json();
      setStatus('converting');

      const youtubeResponse = await fetch(
        `${supabaseUrl}/functions/v1/convert-to-youtube`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${supabaseAnonKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            tracks: spotifyData.tracks,
            playlistName: spotifyData.name,
            spotifyUrl: playlistUrl,
          }),
        }
      );

      if (!youtubeResponse.ok) {
        const errorData = await youtubeResponse.json();
        throw new Error(errorData.error || 'Failed to convert to YouTube Music');
      }

      const youtubeData = await youtubeResponse.json();
      setTracks(youtubeData.tracks);
      setYoutubePlaylistUrl(youtubeData.youtubePlaylistUrl || '');
      setStatus('complete');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
      setStatus('idle');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900">
      <div className="container mx-auto px-4 py-12">
        <div className="max-w-4xl mx-auto">
          <div className="text-center mb-12">
            <div className="flex items-center justify-center gap-3 mb-4">
              <Music className="w-12 h-12 text-emerald-400" />
              <ArrowRight className="w-8 h-8 text-slate-400" />
              <Music className="w-12 h-12 text-red-400" />
            </div>
            <h1 className="text-5xl font-bold text-white mb-3">
              Spotify to YouTube Music
            </h1>
            <p className="text-slate-300 text-lg">
              Convert your Spotify playlists to YouTube Music in seconds
            </p>
          </div>

          <div className="bg-slate-800/50 backdrop-blur-sm rounded-2xl shadow-2xl p-8 border border-slate-700">
            <div className="space-y-6">
              <div>
                <label htmlFor="playlist-url" className="block text-sm font-medium text-slate-300 mb-2">
                  Spotify Playlist URL
                </label>
                <input
                  id="playlist-url"
                  type="text"
                  value={playlistUrl}
                  onChange={(e) => setPlaylistUrl(e.target.value)}
                  placeholder="https://open.spotify.com/playlist/..."
                  className="w-full px-4 py-3 bg-slate-900 border border-slate-600 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition-all"
                  disabled={loading}
                />
                {error && (
                  <p className="mt-2 text-sm text-red-400">{error}</p>
                )}
              </div>

              <button
                onClick={handleConvert}
                disabled={loading || !playlistUrl.trim()}
                className="w-full bg-gradient-to-r from-emerald-500 to-emerald-600 hover:from-emerald-600 hover:to-emerald-700 text-white font-semibold py-3 px-6 rounded-lg transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 shadow-lg hover:shadow-emerald-500/25"
              >
                {loading ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin" />
                    {status === 'fetching' && 'Fetching Spotify playlist...'}
                    {status === 'converting' && 'Converting to YouTube Music...'}
                  </>
                ) : (
                  <>
                    Convert Playlist
                    <ArrowRight className="w-5 h-5" />
                  </>
                )}
              </button>
            </div>

            {status === 'complete' && (
              <div className="mt-8 space-y-6">
                <div className="flex items-center gap-3 text-emerald-400">
                  <CheckCircle2 className="w-6 h-6" />
                  <h2 className="text-xl font-semibold">Conversion Complete!</h2>
                </div>

                <div className="bg-slate-900/50 rounded-lg p-6 border border-slate-700">
                  <h3 className="text-lg font-medium text-white mb-4">
                    Converted Tracks ({tracks.length})
                  </h3>
                  <div className="space-y-2 max-h-64 overflow-y-auto">
                    {tracks.map((track, index) => (
                      <div
                        key={index}
                        className={`flex items-start gap-3 p-3 rounded-lg border ${
                          track.found
                            ? 'bg-slate-800/50 border-slate-700'
                            : 'bg-red-900/20 border-red-900/50'
                        }`}
                      >
                        {track.found ? (
                          <CheckCircle2 className="w-5 h-5 text-emerald-400 flex-shrink-0 mt-0.5" />
                        ) : (
                          <div className="w-5 h-5 rounded-full border-2 border-red-400 flex-shrink-0 mt-0.5" />
                        )}
                        <div className="flex-1 min-w-0">
                          <p className="text-white font-medium truncate">{track.name}</p>
                          <p className="text-slate-400 text-sm truncate">
                            {track.artists.join(', ')}
                          </p>
                          {!track.found && (
                            <p className="text-red-400 text-xs mt-1">Not found on YouTube Music</p>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {youtubePlaylistUrl && (
                  <a
                    href={youtubePlaylistUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center justify-center gap-2 w-full bg-red-500 hover:bg-red-600 text-white font-semibold py-3 px-6 rounded-lg transition-all duration-200 shadow-lg hover:shadow-red-500/25"
                  >
                    Open in YouTube Music
                    <ExternalLink className="w-5 h-5" />
                  </a>
                )}
              </div>
            )}
          </div>

          <div className="mt-8 text-center text-slate-400 text-sm">
            <p>Note: This tool requires Spotify and YouTube API access to function.</p>
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;
