import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

interface SpotifyTrack {
  name: string;
  artists: string[];
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 200,
      headers: corsHeaders,
    });
  }

  try {
    const { playlistUrl } = await req.json();

    if (!playlistUrl) {
      return new Response(
        JSON.stringify({ error: "Playlist URL is required" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const playlistId = extractPlaylistId(playlistUrl);
    if (!playlistId) {
      return new Response(
        JSON.stringify({ error: "Invalid Spotify playlist URL" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const accessToken = await getSpotifyAccessToken();
    const playlistData = await fetchPlaylistData(playlistId, accessToken);

    return new Response(
      JSON.stringify(playlistData),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("Error fetching Spotify playlist:", error);
    return new Response(
      JSON.stringify({ 
        error: error instanceof Error ? error.message : "An error occurred" 
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});

function extractPlaylistId(url: string): string | null {
  const match = url.match(/playlist\/([a-zA-Z0-9]+)/);
  return match ? match[1] : null;
}

async function getSpotifyAccessToken(): Promise<string> {
  const clientId = Deno.env.get("SPOTIFY_CLIENT_ID");
  const clientSecret = Deno.env.get("SPOTIFY_CLIENT_SECRET");

  if (!clientId || !clientSecret) {
    throw new Error("Spotify credentials not configured");
  }

  const response = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "Authorization": "Basic " + btoa(`${clientId}:${clientSecret}`),
    },
    body: "grant_type=client_credentials",
  });

  if (!response.ok) {
    throw new Error("Failed to get Spotify access token");
  }

  const data = await response.json();
  return data.access_token;
}

async function fetchPlaylistData(playlistId: string, accessToken: string) {
  const response = await fetch(
    `https://api.spotify.com/v1/playlists/${playlistId}`,
    {
      headers: {
        "Authorization": `Bearer ${accessToken}`,
      },
    }
  );

  if (!response.ok) {
    throw new Error("Failed to fetch playlist from Spotify");
  }

  const data = await response.json();

  const tracks: SpotifyTrack[] = data.tracks.items.map((item: any) => ({
    name: item.track.name,
    artists: item.track.artists.map((artist: any) => artist.name),
  }));

  return {
    name: data.name,
    tracks,
    trackCount: tracks.length,
  };
}