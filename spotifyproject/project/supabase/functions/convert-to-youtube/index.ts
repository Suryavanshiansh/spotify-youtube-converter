import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

interface Track {
  name: string;
  artists: string[];
  youtubeId?: string;
  found?: boolean;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 200,
      headers: corsHeaders,
    });
  }

  try {
    const { tracks, playlistName, spotifyUrl } = await req.json();

    if (!tracks || !Array.isArray(tracks)) {
      return new Response(
        JSON.stringify({ error: "Tracks array is required" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const youtubeApiKey = Deno.env.get("YOUTUBE_API_KEY");
    if (!youtubeApiKey) {
      throw new Error("YouTube API key not configured");
    }

    const convertedTracks: Track[] = [];
    let successfulConversions = 0;

    for (const track of tracks) {
      const searchQuery = `${track.name} ${track.artists.join(" ")} official audio`;
      const videoId = await searchYouTubeMusic(searchQuery, youtubeApiKey);
      
      convertedTracks.push({
        ...track,
        youtubeId: videoId || undefined,
        found: !!videoId,
      });

      if (videoId) {
        successfulConversions++;
      }
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    await supabase.from("conversion_history").insert({
      spotify_playlist_url: spotifyUrl,
      spotify_playlist_name: playlistName,
      track_count: tracks.length,
      successful_conversions: successfulConversions,
    });

    const youtubePlaylistUrl = convertedTracks.length > 0 
      ? `https://music.youtube.com/watch?v=${convertedTracks[0].youtubeId}&list=RD${convertedTracks[0].youtubeId}`
      : null;

    return new Response(
      JSON.stringify({
        tracks: convertedTracks,
        youtubePlaylistUrl,
        successfulConversions,
        totalTracks: tracks.length,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("Error converting to YouTube:", error);
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

async function searchYouTubeMusic(
  query: string,
  apiKey: string
): Promise<string | null> {
  try {
    const searchUrl = new URL("https://www.googleapis.com/youtube/v3/search");
    searchUrl.searchParams.append("part", "snippet");
    searchUrl.searchParams.append("q", query);
    searchUrl.searchParams.append("type", "video");
    searchUrl.searchParams.append("videoCategoryId", "10");
    searchUrl.searchParams.append("maxResults", "1");
    searchUrl.searchParams.append("key", apiKey);

    const response = await fetch(searchUrl.toString());

    if (!response.ok) {
      console.error("YouTube API error:", await response.text());
      return null;
    }

    const data = await response.json();

    if (data.items && data.items.length > 0) {
      return data.items[0].id.videoId;
    }

    return null;
  } catch (error) {
    console.error("Error searching YouTube:", error);
    return null;
  }
}