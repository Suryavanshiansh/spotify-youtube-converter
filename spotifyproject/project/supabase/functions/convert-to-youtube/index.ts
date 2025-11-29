import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, X-Client-Info, Apikey",
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
        },
      );
    }

    const youtubeApiKey = Deno.env.get("YOUTUBE_API_KEY");
    if (!youtubeApiKey) {
      throw new Error("YouTube API key not configured");
    }

    const convertedTracks: Track[] = [];
    let successfulConversions = 0;

    for (const track of tracks as Track[]) {
      // Clean the Spotify title to better match YouTube titles
      const cleanedName = cleanTrackName(track.name);
      const primaryArtist = track.artists?.[0] ?? "";

      const searchQuery = `${cleanedName} ${primaryArtist} official audio`;

      const videoId = await searchYouTubeMusic(
        searchQuery,
        cleanedName,
        youtubeApiKey,
      );

      convertedTracks.push({
        ...track,
        youtubeId: videoId || undefined,
        found: !!videoId,
      });

      if (videoId) {
        successfulConversions++;
      }
    }

    // Save conversion summary to Supabase
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    await supabase.from("conversion_history").insert({
      spotify_playlist_url: spotifyUrl,
      spotify_playlist_name: playlistName,
      track_count: tracks.length,
      successful_conversions: successfulConversions,
    });

    const youtubePlaylistUrl =
      convertedTracks.length > 0 && convertedTracks[0].youtubeId
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
      },
    );
  } catch (error) {
    console.error("Error converting to YouTube:", error);
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : "An error occurred",
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});

/**
 * Clean Spotify track titles so they match YouTube titles better.
 * Removes things like: - From "Movie", (From "Movie"), (feat. ...), etc.
 */
function cleanTrackName(name: string): string {
  return name
    .replace(/ - From ".*"/i, "")       // Sauda Khara Khara - From "Good Newwz"
    .replace(/\(From ".*"\)/i, "")      // Sauda Khara Khara (From "Good Newwz")
    .replace(/\(feat\..*\)/i, "")       // Song (feat. Artist)
    .replace(/ - feat\..*/i, "")        // Song - feat. Artist
    .replace(/\s+\[[^\]]+\]/g, "")      // [Official Video], [Audio], etc.
    .trim();
}

/**
 * Search YouTube for the best matching music video.
 * Uses top 5 results and picks the closest title match.
 */
async function searchYouTubeMusic(
  query: string,
  cleanedTitle: string,
  apiKey: string,
): Promise<string | null> {
  try {
    const searchUrl = new URL("https://www.googleapis.com/youtube/v3/search");
    searchUrl.searchParams.append("part", "snippet");
    searchUrl.searchParams.append("q", query);
    searchUrl.searchParams.append("type", "video");
    // Don't restrict to videoCategoryId=10; many music uploads aren't tagged as "Music"
    searchUrl.searchParams.append("maxResults", "5");
    searchUrl.searchParams.append("key", apiKey);

    const response = await fetch(searchUrl.toString());

    if (!response.ok) {
      console.error("YouTube API error:", await response.text());
      return null;
    }

    const data = await response.json();

    if (!data.items || data.items.length === 0) {
      return null;
    }

    // Normalize helper for loose matching
    const normalize = (s: string) =>
      s.toLowerCase()
        .replace(/[^a-z0-9\s]/gi, " ")
        .replace(/\s+/g, " ")
        .trim();

    const normalizedTitle = normalize(cleanedTitle);
    let bestItem = data.items[0];
    let bestScore = 0;

    for (const item of data.items) {
      const title = normalize(item.snippet?.title ?? "");
      let score = 0;

      // Strong bonus if entire cleaned title appears inside candidate title
      if (title.includes(normalizedTitle)) score += 2;

      // Light bonus for overlapping words
      for (const w of normalizedTitle.split(" ")) {
        if (w && title.includes(w)) score += 0.25;
      }

      if (score > bestScore) {
        bestScore = score;
        bestItem = item;
      }
    }

    return bestItem.id?.videoId ?? null;
  } catch (error) {
    console.error("Error searching YouTube:", error);
    return null;
  }
}
