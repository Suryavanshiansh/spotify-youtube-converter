/// <reference types="https://esm.sh/jsr/@supabase/functions-js@latest/types/edge-runtime.d.ts" />
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { Innertube, UniversalCache } from "npm:youtubei.js";

const corsHeaders: Record<string, string> = {
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

// Keep a single YouTube Music client instance (hot-reload friendly)
let yt: Innertube | null = null;

async function getYouTubeMusicClient(): Promise<Innertube> {
  if (!yt) {
    yt = await Innertube.create({
      cache: new UniversalCache(false),
      retrieve_player: false,
    });
  }
  return yt;
}

Deno.serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 200,
      headers: corsHeaders,
    });
  }

  try {
    const body = await req.json().catch(() => null);

    if (!body) {
      return jsonError("Invalid JSON body", 400);
    }

    const { tracks, playlistName, spotifyUrl } = body as {
      tracks: Track[];
      playlistName?: string;
      spotifyUrl?: string;
    };

    if (!tracks || !Array.isArray(tracks)) {
      return jsonError("Tracks array is required", 400);
    }

    const convertedTracks: Track[] = [];
    let successfulConversions = 0;

    const client = await getYouTubeMusicClient();

    for (const track of tracks) {
      const cleanedName = cleanTrackName(track.name);
      const primaryArtist = track.artists?.[0] ?? "";

      // Build a query that works well for YT Music
      const query = `${cleanedName} ${primaryArtist}`.trim();

      const videoId = await searchYouTubeMusic(
        client,
        query,
        cleanedName,
        primaryArtist,
      );

      convertedTracks.push({
        ...track,
        youtubeId: videoId || undefined,
        found: !!videoId,
      });

      if (videoId) successfulConversions++;
    }

    // Save conversion summary to Supabase
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !supabaseKey) {
      console.error("Supabase credentials not configured in environment");
    } else {
      const supabase = createClient(supabaseUrl, supabaseKey);
      try {
        await supabase.from("conversion_history").insert({
          spotify_playlist_url: spotifyUrl ?? null,
          spotify_playlist_name: playlistName ?? null,
          track_count: tracks.length,
          successful_conversions: successfulConversions,
        });
      } catch (err) {
        console.error("Failed to insert conversion history:", err);
      }
    }

    const firstFound = convertedTracks.find((t) => t.youtubeId);

    const youtubePlaylistUrl = firstFound?.youtubeId
      ? `https://music.youtube.com/watch?v=${firstFound.youtubeId}&list=RD${firstFound.youtubeId}`
      : null;

    return jsonResponse(
      {
        tracks: convertedTracks,
        youtubePlaylistUrl,
        successfulConversions,
        totalTracks: tracks.length,
      },
      200,
    );
  } catch (error) {
    console.error("Error converting to YouTube Music:", error);
    return jsonResponse(
      {
        error:
          error instanceof Error ? error.message : "An unknown error occurred",
      },
      500,
    );
  }
});

/**
 * Clean Spotify track titles so they match YouTube Music titles better.
 * Removes things like: - From "Movie", (From "Movie"), (feat. ...), [Official Video], etc.
 */
function cleanTrackName(name: string): string {
  return name
    .replace(/ - From ".*"/gi, "") // Song - From "Movie"
    .replace(/\(From ".*"\)/gi, "") // Song (From "Movie")
    .replace(/\(feat\..*\)/gi, "") // Song (feat. Artist)
    .replace(/ - feat\..*/gi, "") // Song - feat. Artist
    .replace(/\s+\[[^\]]+\]/g, "") // [Official Video], [Audio], etc.
    .trim();
}

/**
 * Search on YouTube Music (via youtubei.js) and pick the best matching track.
 */
async function searchYouTubeMusic(
  yt: Innertube,
  query: string,
  cleanedTitle: string,
  primaryArtist: string,
): Promise<string | null> {
  try {
    const results = await yt.music.search(query);

    if (!results || results.length === 0) {
      return null;
    }

    const normalize = (s: string) =>
      s
        .toLowerCase()
        .replace(/[^a-z0-9\s]/gi, " ")
        .replace(/\s+/g, " ")
        .trim();

    const normTitle = normalize(cleanedTitle);
    const normArtist = normalize(primaryArtist);

    let best: any = results[0];
    let bestScore = -1;

    for (const item of results as any[]) {
      const title = normalize(item.title ?? "");
      const artists =
        (item.artists?.map((a: any) => normalize(a.name)).join(" ") ?? "") +
        " " +
        (item.author ? normalize(item.author) : "");

      let score = 0;

      // Prefer songs / official music content
      if (item.type === "song") score += 2;
      if (item.isOfficial) score += 1;

      // Title similarity
      if (title.includes(normTitle)) score += 2;
      for (const w of normTitle.split(" ")) {
        if (w && title.includes(w)) score += 0.25;
      }

      // Artist similarity
      if (normArtist && artists.includes(normArtist)) score += 1;
      for (const w of normArtist.split(" ")) {
        if (w && artists.includes(w)) score += 0.2;
      }

      if (score > bestScore) {
        bestScore = score;
        best = item;
      }
    }

    return best?.id ?? null;
  } catch (error) {
    console.error("YT Music search error:", error);
    return null;
  }
}

/** Helper to send JSON responses */
function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/** Helper to send error JSON */
function jsonError(message: string, status = 400): Response {
  return jsonResponse({ error: message }, status);
}
