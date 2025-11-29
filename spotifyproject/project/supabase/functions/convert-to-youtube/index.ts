import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { Innertube, UniversalCache } from "npm:youtubei.js";

// ---------------- CONFIG ----------------
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

// ---------------- HELPERS ----------------

async function getClient() {
  if (!yt) {
    yt = await Innertube.create({
      cache: new UniversalCache(false),
      retrieve_player: false,
    });
  }
  return yt;
}

const normalize = (text: string) =>
  text.toLowerCase().replace(/[^\w\s]/g, " ").replace(/\s+/g, " ").trim();

// Levenshtein similarity function
function similarity(a: string, b: string): number {
  if (!a || !b) return 0;
  const matrix = [];
  for (let i = 0; i <= b.length; i++) matrix[i] = [i];
  for (let j = 0; j <= a.length; j++) matrix[0][j] = j;

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1,
        );
      }
    }
  }

  const score = 1 - matrix[b.length][a.length] / Math.max(a.length, b.length);
  return score;
}

function cleanTitle(title: string): string {
  return title
    .replace(/\(feat.*?\)/gi, "")
    .replace(/ - from ".*?"/gi, "")
    .replace(/\[.*]/g, "")
    .replace(/\(.*?version.*?\)/gi, "")
    .replace(/\s+official.*$/gi, "")
    .trim();
}

// Search + fuzzy match scoring
async function searchYouTubeTrack(name: string, artist: string) {
  const yt = await getClient();

  const queries = [
    `${name} ${artist}`,
    `${name} official audio`,
    `${name} original song`,
    `${name} ${artist} lyrics`,
    `${name} movie song`,
  ];

  let bestMatch = null;
  let bestScore = 0;

  for (const q of queries) {
    const res = [...await yt.music.search(q), ...await yt.search(q)];

    for (const r of res as any[]) {
      const titleNorm = normalize(r.title ?? "");
      const artistNorm = normalize((r.author || r.artists?.map((x: any) => x.name).join(" ")) ?? "");

      let score = similarity(normalize(name), titleNorm) * 2;

      if (artist && artistNorm.includes(normalize(artist))) score += 1;
      if (/official|audio|soundtrack|ost/.test(titleNorm)) score += 0.3;
      if (/slowed|reverb|sped up|remix|live/.test(titleNorm)) score -= 1;

      if (score > bestScore) {
        bestScore = score;
        bestMatch = r;
      }
    }
  }

  return bestScore >= 0.55 ? bestMatch?.id ?? null : null;
}

// ---------------- MAIN FUNCTION ----------------
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });

  try {
    const { tracks, playlistName, spotifyUrl } = await req.json();

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    let final: Track[] = [];
    let success = 0;

    for (const track of tracks) {
      const cleaned = cleanTitle(track.name);
      const id = await searchYouTubeTrack(cleaned, track.artists[0]);

      final.push({ ...track, youtubeId: id || undefined, found: !!id });
      if (id) success++;
    }

    await supabase.from("conversion_history").insert({
      playlistName,
      spotifyUrl,
      trackCount: tracks.length,
      successCount: success,
    });

    return new Response(
      JSON.stringify({ tracks: final, total: tracks.length, success }),
      { status: 200, headers: corsHeaders },
    );

  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: corsHeaders });
  }
});
