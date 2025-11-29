import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { Innertube, UniversalCache } from "npm:youtubei.js";

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

let yt: Innertube | null = null;

async function getClient() {
  if (!yt) {
    yt = await Innertube.create({
      cache: new UniversalCache(false),
      retrieve_player: false,
    });
  }
  return yt;
}

function normalize(text: string) {
  return text.toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanTitle(name: string) {
  return name
    .replace(/\(feat.*?\)/gi, "")
    .replace(/ - from ".*?"/gi, "")
    .replace(/\[.*?]/g, "")
    .replace(/\(.*?version.*?\)/gi, "")
    .trim();
}

async function smartSearch(query: string, title: string, artist: string) {
  const yt = await getClient();
  const cleaned = normalize(title);
  const artistNorm = normalize(artist);

  let results = await yt.music.search(query);

  if (!results || results.length === 0) {
    results = await yt.search(query);
  }

  let best = null;
  let bestScore = 0;

  for (const r of results as any[]) {
    const t = normalize(r.title ?? "");
    const a = normalize((r.artists?.map((x: any) => x.name).join(" ") || r.author || ""));

    let score = 0;

    if (r.type === "song") score += 1.5;
    if (r.isOfficial) score += 1;
    if (t.includes(cleaned)) score += 2;

    for (const w of cleaned.split(" ")) {
      if (w.length > 2 && t.includes(w)) score += 0.2;
    }

    if (artistNorm && a.includes(artistNorm)) score += 1;

    if (/official|audio|video|soundtrack|ost/.test(t)) score += 0.3;
    if (/slowed|reverb|sped up|trap|mix|live/.test(t)) score -= 1;

    if (score > bestScore) {
      bestScore = score;
      best = r;
    }
  }

  return best?.id ?? null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });

  try {
    const { tracks, playlistName, spotifyUrl } = await req.json();
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    let results: Track[] = [];
    let success = 0;

    for (const track of tracks) {
      const cleaned = cleanTitle(track.name);
      const query = `${cleaned} ${track.artists[0]}`;
      const id = await smartSearch(query, cleaned, track.artists[0]);

      results.push({ ...track, youtubeId: id || undefined, found: !!id });
      if (id) success++;
    }

    await supabase.from("conversion_history").insert({
      spotify_playlist_name: playlistName,
      spotify_playlist_url: spotifyUrl,
      track_count: tracks.length,
      successful_conversions: success,
    });

    return new Response(
      JSON.stringify({
        tracks: results,
        success,
        total: tracks.length,
      }),
      { status: 200, headers: corsHeaders }
    );

  } catch (e) {
    console.error(e);
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: corsHeaders });
  }
});
