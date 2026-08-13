#!/usr/bin/env bash

BASE="https://spun-media-api.heisdanny64.workers.dev/v1"
OUT="/home/ubuntu/spun-api-test-results.json"
TMP="/home/ubuntu/spun-api-tmp.ndjson"
PASS=0
FAIL=0

> "$TMP"

call() {
  local label="$1"
  local url="$2"
  local response status body ok ms t1 t2 parsed

  t1=$(date +%s)
  response=$(curl -s -w "\n%{http_code}" --max-time 30 "$url")
  t2=$(date +%s)

  body=$(echo "$response" | head -n -1)
  status=$(echo "$response" | tail -n 1)
  ms=$(( t2 - t1 ))

  if [[ "$status" == "200" || "$status" == "307" ]]; then
    ok="true"
    PASS=$((PASS + 1))
    echo "  ✓  [$status] $label"
  else
    ok="false"
    FAIL=$((FAIL + 1))
    echo "  ✗  [$status] $label"
  fi

  parsed=$(echo "$body" | jq '.' 2>/dev/null)
  if [[ -z "$parsed" ]]; then
    parsed="null"
  fi

  jq -n \
    --arg label "$label" \
    --arg url "$url" \
    --arg status "$status" \
    --arg ms "${ms}s" \
    --argjson ok "$ok" \
    --argjson response "$parsed" \
    '{label:$label,url:$url,status:$status,ok:$ok,ms:$ms,response:$response}' >> "$TMP"
}

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Spün Media API — Endpoint Test Suite"
echo "  $BASE"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

echo "▶  Root & Health"
call "Root"   "$BASE/"
call "Health" "$BASE/health"

echo ""
echo "▶  Search"
call "Search all — oppenheimer"        "$BASE/search?q=oppenheimer"
call "Search movie — interstellar"     "$BASE/search/movie?q=interstellar"
call "Search TV — succession"          "$BASE/search/tv?q=succession"
call "Search anime — jujutsu kaisen"   "$BASE/search/anime?q=jujutsu+kaisen"
call "Search suggestions — naruto"     "$BASE/search/suggestions?q=naruto"

echo ""
echo "▶  Resolve"
call "Resolve by TMDB — Pulp Fiction"    "$BASE/utility/resolve?tmdb_id=680&type=movie"
call "Resolve by IMDb ID"                "$BASE/utility/resolve?imdb_id=tt0110912"
call "Resolve by AniList — Cowboy Bebop" "$BASE/utility/resolve?anilist_id=1"

echo ""
echo "▶  Fetching spun_ids for info tests..."
MOVIE_ID=$(curl -s "$BASE/search/movie?q=interstellar" | jq -r '.results[0].spun_id // empty' 2>/dev/null)
TV_ID=$(curl -s "$BASE/search/tv?q=succession" | jq -r '.results[0].spun_id // empty' 2>/dev/null)
ANIME_ID=$(curl -s "$BASE/search/anime?q=jujutsu+kaisen" | jq -r '.results[0].spun_id // empty' 2>/dev/null)

echo "  → Movie spun_id: ${MOVIE_ID:-not found}"
echo "  → TV spun_id:    ${TV_ID:-not found}"
echo "  → Anime spun_id: ${ANIME_ID:-not found}"
echo ""

echo "▶  Info"
if [[ -n "$MOVIE_ID" ]]; then
  call "Info — movie"          "$BASE/info/$MOVIE_ID"
  call "Info — movie cast"     "$BASE/info/$MOVIE_ID/cast"
  call "Info — movie related"  "$BASE/info/$MOVIE_ID/related"
fi
if [[ -n "$TV_ID" ]]; then
  call "Info — TV"             "$BASE/info/$TV_ID"
  call "Info — TV episodes"    "$BASE/info/$TV_ID/episodes"
  call "Info — TV episodes s1" "$BASE/info/$TV_ID/episodes?season=1"
  call "Info — TV cast"        "$BASE/info/$TV_ID/cast"
  call "Info — TV related"     "$BASE/info/$TV_ID/related"
fi
if [[ -n "$ANIME_ID" ]]; then
  call "Info — anime"          "$BASE/info/$ANIME_ID"
  call "Info — anime cast"     "$BASE/info/$ANIME_ID/cast"
  call "Info — anime related"  "$BASE/info/$ANIME_ID/related"
  call "Info — anime episodes" "$BASE/info/$ANIME_ID/episodes"
fi

echo ""
echo "▶  Discover"
call "Discover movies"              "$BASE/discover/movie"
call "Discover TV"                  "$BASE/discover/tv"
call "Discover anime"               "$BASE/discover/anime"
call "Discover movies — action"     "$BASE/discover/movie?genre=action"
call "Discover movies — horror"     "$BASE/discover/movie?genre=horror"
call "Discover TV — drama"          "$BASE/discover/tv?genre=drama"
call "Discover anime — isekai"      "$BASE/discover/anime?genre=isekai"
call "Discover movies — A24"        "$BASE/discover/movie?studio=a24"
call "Discover TV — HBO"            "$BASE/discover/tv?studio=hbo"
call "Discover movies — Netflix"    "$BASE/discover/movie?studio=netflix"
call "Discover page 2"              "$BASE/discover/movie?page=2"

echo ""
echo "▶  Trending / Popular / New"
call "Trending — all"               "$BASE/discover/trending"
call "Trending — movies"            "$BASE/discover/trending?type=movie"
call "Trending — TV"                "$BASE/discover/trending?type=tv"
call "Trending — anime"             "$BASE/discover/trending?type=anime"
call "Popular — movies"             "$BASE/discover/popular?type=movie"
call "Popular — TV"                 "$BASE/discover/popular?type=tv"
call "Popular — anime"              "$BASE/discover/popular?type=anime"
call "New — movies"                 "$BASE/discover/new?type=movie"
call "New — TV"                     "$BASE/discover/new?type=tv"

echo ""
echo "▶  Genres & Studios"
call "Genres — all"                 "$BASE/discover/genres"
call "Genres — anime only"          "$BASE/discover/genres?type=anime"
call "Genres — movies only"         "$BASE/discover/genres?type=movie"
call "Studios — all"                "$BASE/discover/studios"
call "Studios — streaming"          "$BASE/discover/studios?category=streaming"
call "Studios — anime"              "$BASE/discover/studios?category=anime"
call "Studios — production"         "$BASE/discover/studios?category=production"
call "Studio — MAPPA"               "$BASE/discover/studio/mappa"
call "Studio — Netflix"             "$BASE/discover/studio/netflix"
call "Studio — A24"                 "$BASE/discover/studio/a24"
call "Studio — Ufotable"            "$BASE/discover/studio/ufotable"
call "Studio — HBO"                 "$BASE/discover/studio/hbo"

echo ""
echo "▶  Home"
call "Home — all"                   "$BASE/home"
call "Home — movies"                "$BASE/home/movie"
call "Home — TV"                    "$BASE/home/tv"
call "Home — anime"                 "$BASE/home/anime"

echo ""
echo "▶  Anime — Airing & Schedule"
call "Anime airing"                 "$BASE/anime/airing"
call "Anime upcoming"               "$BASE/anime/upcoming"
call "Anime schedule"               "$BASE/anime/schedule"

echo ""
echo "▶  Anime — Rankings"
call "Rankings — all time"          "$BASE/anime/rankings/alltime"
call "Rankings — popular"           "$BASE/anime/rankings/popular"
call "Rankings — season 2024 fall"  "$BASE/anime/rankings/season/2024/fall"
call "Rankings — genre action"      "$BASE/anime/rankings/genre/action"
call "Rankings — genre romance"     "$BASE/anime/rankings/genre/romance"

echo ""
echo "▶  Anime — Browse"
call "Anime seasons list"           "$BASE/anime/seasons"
call "Anime season 2024 fall"       "$BASE/anime/seasons/2024/fall"
call "Anime season 2025 winter"     "$BASE/anime/seasons/2025/winter"
call "Anime format — TV"            "$BASE/anime/format/tv"
call "Anime format — movie"         "$BASE/anime/format/movie"
call "Anime format — OVA"           "$BASE/anime/format/ova"
call "Anime demographic — shounen"  "$BASE/anime/demographic/shounen"
call "Anime demographic — seinen"   "$BASE/anime/demographic/seinen"
call "Anime source — manga"         "$BASE/anime/source/manga"
call "Anime source — original"      "$BASE/anime/source/original"
call "Anime genre — action"         "$BASE/anime/genre/action"
call "Anime genre — romance"        "$BASE/anime/genre/romance"
call "Anime genre — fantasy"        "$BASE/anime/genre/fantasy"

echo ""
echo "▶  Anime — Studios"
call "Anime studios"                "$BASE/anime/studios"
call "Anime studios — search MAPPA" "$BASE/anime/studios?q=MAPPA"
call "Anime studio — MAPPA (569)"   "$BASE/anime/studio/569"
call "Anime studio — Ufotable (43)" "$BASE/anime/studio/43"

echo ""
echo "▶  Anime — Title-specific"
if [[ -n "$ANIME_ID" ]]; then
  call "Anime themes"               "$BASE/anime/$ANIME_ID/themes"
  call "Anime fillers"              "$BASE/anime/$ANIME_ID/fillers"
  call "Anime franchise"            "$BASE/anime/$ANIME_ID/franchise"
  call "Anime characters"           "$BASE/anime/$ANIME_ID/characters"
fi

echo ""
echo "▶  Subtitles"
if [[ -n "$MOVIE_ID" ]]; then
  call "Subtitles — movie"          "$BASE/subtitles/$MOVIE_ID"
fi
if [[ -n "$TV_ID" ]]; then
  call "Subtitles — TV ep"          "$BASE/subtitles/$TV_ID?season=1&episode=1"
fi

echo ""
echo "▶  Similar"
if [[ -n "$MOVIE_ID" ]]; then
  call "Similar — movie"              "$BASE/similar/movie/$MOVIE_ID"
fi
if [[ -n "$TV_ID" ]]; then
  call "Similar — TV"                 "$BASE/similar/tv/$TV_ID"
fi
if [[ -n "$ANIME_ID" ]]; then
  call "Similar — anime"              "$BASE/similar/anime/$ANIME_ID"
fi

echo ""
echo "▶  Stream & Download (expect 503)"
if [[ -n "$MOVIE_ID" ]]; then
  call "Stream — movie (stub)"      "$BASE/stream/$MOVIE_ID"
  call "Download — movie (stub)"    "$BASE/download/$MOVIE_ID"
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Results: ✓ $PASS passed   ✗ $FAIL failed   Total: $((PASS + FAIL))"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

jq -n \
  --slurpfile results "$TMP" \
  --arg base "$BASE" \
  --arg timestamp "$(date -u +"%Y-%m-%dT%H:%M:%SZ")" \
  --argjson pass "$PASS" \
  --argjson fail "$FAIL" \
  '{
    meta: {
      api: $base,
      tested_at: $timestamp,
      total: ($pass + $fail),
      passed: $pass,
      failed: $fail
    },
    results: $results
  }' > "$OUT"

rm -f "$TMP"

echo "Results saved → $OUT"
echo ""
