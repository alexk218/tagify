// Tagify's starter tags: the categories, folders and tags a new library starts with, on Tagify
// desktop and on Community. Both read them from here so a member who starts on one and links the
// other later gets one set of tags instead of duplicates.
//
// Every version is frozen once released. A library seeded with an older version keeps it, so
// desktop and Community keep recognising every version as "untouched starter tags". A new version
// is added as a new entry and becomes CURRENT_STARTER_TAG_VERSION; Community's starter_tag_nodes
// rows for it are checked against this file (lib/my-library/starter-tag-sets.test.ts).
//
// IDs are fixed. They come from Tagify desktop's legacy ID rule (tagTaxonomy.ts: "cat_"/"sub_"/
// "tag_" plus a hash of "legacy:category:<category>", "legacy:subcategory:<category>:<folder>",
// "legacy:tag:<category>:<folder>:<tag>", built from the legacyIds below). A node that survives
// into a newer version keeps its ID, kind, parent and name; only its position may change.

export type StarterTagVersion = 1 | 2;
export type StarterTagKind = "category" | "folder" | "tag";

export interface StarterTagRow {
  /** The node's client ID in every library, on desktop and Community. */
  id: string;
  kind: StarterTagKind;
  /** The containing category or folder; null for a category. */
  parentId: string | null;
  name: string;
  /** Place within its parent, from 0. Categories are numbered in their starting order. */
  position: number;
  /** The readable ID desktop hashed into `id` (see the comment at the top). */
  legacyId: string;
}

/** Tags in the shape Tagify desktop's buildTaxonomyFromCategoryTree reads; it keeps these IDs. */
export interface StarterTagTreeCategory {
  id: string;
  name: string;
  subcategories: Array<{ id: string; name: string; tags: Array<{ id: string; name: string }> }>;
}

// No `satisfies` here: Tagify desktop bundles this file with spicetify-creator's esbuild 0.14,
// which can't parse it.
export const STARTER_TAG_VERSIONS: readonly StarterTagVersion[] = [1, 2];
/** The version new libraries start with. */
export const CURRENT_STARTER_TAG_VERSION: StarterTagVersion = 2;

/** Each version's rows, parents first: a category, then each of its folders followed by its tags. */
export const STARTER_TAG_SEEDS: Readonly<Record<StarterTagVersion, readonly StarterTagRow[]>> = {
  // Version 1 (73 tags): Tagify's starter tags until November 2026.
  1: [
    { id: "cat_ntsvi4", kind: "category", parentId: null, name: "Genre & Style", position: 0, legacyId: "genre-style" },
    { id: "sub_sb6d4r", kind: "folder", parentId: "cat_ntsvi4", name: "Primary Genres", position: 0, legacyId: "primary-genres" },
    { id: "tag_2i3xsw", kind: "tag", parentId: "sub_sb6d4r", name: "Rock", position: 0, legacyId: "rock" },
    { id: "tag_tv8r5i", kind: "tag", parentId: "sub_sb6d4r", name: "Pop", position: 1, legacyId: "pop" },
    { id: "tag_1d8jf00", kind: "tag", parentId: "sub_sb6d4r", name: "Hip-Hop", position: 2, legacyId: "hip-hop" },
    { id: "tag_chp12v", kind: "tag", parentId: "sub_sb6d4r", name: "Electronic", position: 3, legacyId: "electronic" },
    { id: "tag_2hyk36", kind: "tag", parentId: "sub_sb6d4r", name: "Jazz", position: 4, legacyId: "jazz" },
    { id: "tag_1nfve76", kind: "tag", parentId: "sub_sb6d4r", name: "Classical", position: 5, legacyId: "classical" },
    { id: "tag_1dtuibf", kind: "tag", parentId: "sub_sb6d4r", name: "Country", position: 6, legacyId: "country" },
    { id: "tag_tv8sln", kind: "tag", parentId: "sub_sb6d4r", name: "R&B", position: 7, legacyId: "rnb" },
    { id: "sub_11rx725", kind: "folder", parentId: "cat_ntsvi4", name: "Sub-genres", position: 1, legacyId: "sub-genres" },
    { id: "tag_o0gb10", kind: "tag", parentId: "sub_11rx725", name: "Alternative", position: 0, legacyId: "alternative" },
    { id: "tag_evohpe", kind: "tag", parentId: "sub_11rx725", name: "Indie", position: 1, legacyId: "indie" },
    { id: "tag_h86v5", kind: "tag", parentId: "sub_11rx725", name: "Folk", position: 2, legacyId: "folk" },
    { id: "tag_h8bd1", kind: "tag", parentId: "sub_11rx725", name: "Funk", position: 3, legacyId: "funk" },
    { id: "tag_ert03k", kind: "tag", parentId: "sub_11rx725", name: "Blues", position: 4, legacyId: "blues" },
    { id: "tag_137x8og", kind: "tag", parentId: "sub_11rx725", name: "Reggae", position: 5, legacyId: "reggae" },
    { id: "sub_n1yt5", kind: "folder", parentId: "cat_ntsvi4", name: "Era & Decade", position: 2, legacyId: "era-decade" },
    { id: "tag_x852a1", kind: "tag", parentId: "sub_n1yt5", name: "Vintage", position: 0, legacyId: "vintage" },
    { id: "tag_15p9f6m", kind: "tag", parentId: "sub_n1yt5", name: "80s", position: 1, legacyId: "80s" },
    { id: "tag_15p9fxb", kind: "tag", parentId: "sub_n1yt5", name: "90s", position: 2, legacyId: "90s" },
    { id: "tag_dtn9eg", kind: "tag", parentId: "sub_n1yt5", name: "2000s", position: 3, legacyId: "2000s" },
    { id: "tag_v9lsws", kind: "tag", parentId: "sub_n1yt5", name: "Modern", position: 4, legacyId: "modern" },
    { id: "cat_4pcgqb", kind: "category", parentId: null, name: "Mood & Energy", position: 1, legacyId: "mood-energy" },
    { id: "sub_g7foo8", kind: "folder", parentId: "cat_4pcgqb", name: "Energy Level", position: 0, legacyId: "energy-level" },
    { id: "tag_86l65h", kind: "tag", parentId: "sub_g7foo8", name: "High Energy", position: 0, legacyId: "high-energy" },
    { id: "tag_12q43sv", kind: "tag", parentId: "sub_g7foo8", name: "Upbeat", position: 1, legacyId: "upbeat" },
    { id: "tag_yq0nw1", kind: "tag", parentId: "sub_g7foo8", name: "Moderate", position: 2, legacyId: "moderate" },
    { id: "tag_1fdnth2", kind: "tag", parentId: "sub_g7foo8", name: "Chill", position: 3, legacyId: "chill" },
    { id: "tag_yrvxim", kind: "tag", parentId: "sub_g7foo8", name: "Mellow", position: 4, legacyId: "mellow" },
    { id: "tag_16wq773", kind: "tag", parentId: "sub_g7foo8", name: "Slow", position: 5, legacyId: "slow" },
    { id: "sub_3a5vgi", kind: "folder", parentId: "cat_4pcgqb", name: "Emotional Tone", position: 1, legacyId: "emotional-tone" },
    { id: "tag_1ywb9qk", kind: "tag", parentId: "sub_3a5vgi", name: "Happy", position: 0, legacyId: "happy" },
    { id: "tag_qwkb9e", kind: "tag", parentId: "sub_3a5vgi", name: "Sad", position: 1, legacyId: "sad" },
    { id: "tag_1ysotsd", kind: "tag", parentId: "sub_3a5vgi", name: "Angry", position: 2, legacyId: "angry" },
    { id: "tag_sxm85", kind: "tag", parentId: "sub_3a5vgi", name: "Romantic", position: 3, legacyId: "romantic" },
    { id: "tag_s90474", kind: "tag", parentId: "sub_3a5vgi", name: "Nostalgic", position: 4, legacyId: "nostalgic" },
    { id: "tag_3tg3ab", kind: "tag", parentId: "sub_3a5vgi", name: "Peaceful", position: 5, legacyId: "peaceful" },
    { id: "tag_1pzvxgb", kind: "tag", parentId: "sub_3a5vgi", name: "Dramatic", position: 6, legacyId: "dramatic" },
    { id: "sub_ad5vv", kind: "folder", parentId: "cat_4pcgqb", name: "Atmosphere", position: 2, legacyId: "atmosphere" },
    { id: "tag_1fiqktd", kind: "tag", parentId: "sub_ad5vv", name: "Dark", position: 0, legacyId: "dark" },
    { id: "tag_1z2x0l", kind: "tag", parentId: "sub_ad5vv", name: "Bright", position: 1, legacyId: "bright" },
    { id: "tag_2x3hj5", kind: "tag", parentId: "sub_ad5vv", name: "Dreamy", position: 2, legacyId: "dreamy" },
    { id: "tag_k5welb", kind: "tag", parentId: "sub_ad5vv", name: "Intense", position: 3, legacyId: "intense" },
    { id: "tag_1gidh49", kind: "tag", parentId: "sub_ad5vv", name: "Mysterious", position: 4, legacyId: "mysterious" },
    { id: "tag_1endlz2", kind: "tag", parentId: "sub_ad5vv", name: "Playful", position: 5, legacyId: "playful" },
    { id: "cat_1heozhb", kind: "category", parentId: null, name: "Musical Elements", position: 2, legacyId: "musical-elements" },
    { id: "sub_18gezbr", kind: "folder", parentId: "cat_1heozhb", name: "Vocals", position: 0, legacyId: "vocals" },
    { id: "tag_1uqynfb", kind: "tag", parentId: "sub_18gezbr", name: "Male Vocals", position: 0, legacyId: "male-vocals" },
    { id: "tag_10dgb08", kind: "tag", parentId: "sub_18gezbr", name: "Female Vocals", position: 1, legacyId: "female-vocals" },
    { id: "tag_9o4tif", kind: "tag", parentId: "sub_18gezbr", name: "Duet", position: 2, legacyId: "duet" },
    { id: "tag_fmxarw", kind: "tag", parentId: "sub_18gezbr", name: "Choir", position: 3, legacyId: "choir" },
    { id: "tag_1f1kd6h", kind: "tag", parentId: "sub_18gezbr", name: "Instrumental", position: 4, legacyId: "instrumental" },
    { id: "tag_1cfh42i", kind: "tag", parentId: "sub_18gezbr", name: "Rap", position: 5, legacyId: "rap" },
    { id: "sub_ra6q1f", kind: "folder", parentId: "cat_1heozhb", name: "Instruments", position: 1, legacyId: "instruments" },
    { id: "tag_1hjn4z1", kind: "tag", parentId: "sub_ra6q1f", name: "Guitar", position: 0, legacyId: "guitar" },
    { id: "tag_1n53mh2", kind: "tag", parentId: "sub_ra6q1f", name: "Piano", position: 1, legacyId: "piano" },
    { id: "tag_1nxl30f", kind: "tag", parentId: "sub_ra6q1f", name: "Strings", position: 2, legacyId: "strings" },
    { id: "tag_1mxk966", kind: "tag", parentId: "sub_ra6q1f", name: "Brass", position: 3, legacyId: "brass" },
    { id: "tag_1myo91m", kind: "tag", parentId: "sub_ra6q1f", name: "Drums", position: 4, legacyId: "drums" },
    { id: "tag_1n71htl", kind: "tag", parentId: "sub_ra6q1f", name: "Synth", position: 5, legacyId: "synth" },
    { id: "tag_tea0hu", kind: "tag", parentId: "sub_ra6q1f", name: "Bass", position: 6, legacyId: "bass" },
    { id: "sub_69ukuu", kind: "folder", parentId: "cat_1heozhb", name: "Production Style", position: 2, legacyId: "production-style" },
    { id: "tag_1baw0jv", kind: "tag", parentId: "sub_69ukuu", name: "Acoustic", position: 0, legacyId: "acoustic" },
    { id: "tag_5k6bs5", kind: "tag", parentId: "sub_69ukuu", name: "Electric", position: 1, legacyId: "electric" },
    { id: "tag_9npcuw", kind: "tag", parentId: "sub_69ukuu", name: "Live Recording", position: 2, legacyId: "live-recording" },
    { id: "tag_1az1lum", kind: "tag", parentId: "sub_69ukuu", name: "Studio", position: 3, legacyId: "studio" },
    { id: "tag_16ncgn9", kind: "tag", parentId: "sub_69ukuu", name: "Lo-fi", position: 4, legacyId: "lo-fi" },
    { id: "tag_ew9e2g", kind: "tag", parentId: "sub_69ukuu", name: "Polished", position: 5, legacyId: "polished" },
    { id: "cat_v7c060", kind: "category", parentId: null, name: "Usage & Context", position: 3, legacyId: "usage-context" },
    { id: "sub_13ix0s3", kind: "folder", parentId: "cat_v7c060", name: "Activity", position: 0, legacyId: "activity" },
    { id: "tag_ki1gfu", kind: "tag", parentId: "sub_13ix0s3", name: "Workout", position: 0, legacyId: "workout" },
    { id: "tag_bn2uhy", kind: "tag", parentId: "sub_13ix0s3", name: "Study", position: 1, legacyId: "study" },
    { id: "tag_bl3a4j", kind: "tag", parentId: "sub_13ix0s3", name: "Party", position: 2, legacyId: "party" },
    { id: "tag_onuyco", kind: "tag", parentId: "sub_13ix0s3", name: "Relaxation", position: 3, legacyId: "relaxation" },
    { id: "tag_r1bw6c", kind: "tag", parentId: "sub_13ix0s3", name: "Driving", position: 4, legacyId: "driving" },
    { id: "tag_bmxer8", kind: "tag", parentId: "sub_13ix0s3", name: "Sleep", position: 5, legacyId: "sleep" },
    { id: "sub_tqj5tr", kind: "folder", parentId: "cat_v7c060", name: "Time & Season", position: 1, legacyId: "time-season" },
    { id: "tag_18kk9np", kind: "tag", parentId: "sub_tqj5tr", name: "Morning", position: 0, legacyId: "morning" },
    { id: "tag_1ao2w9", kind: "tag", parentId: "sub_tqj5tr", name: "Evening", position: 1, legacyId: "evening" },
    { id: "tag_17bizxq", kind: "tag", parentId: "sub_tqj5tr", name: "Summer", position: 2, legacyId: "summer" },
    { id: "tag_1914qkk", kind: "tag", parentId: "sub_tqj5tr", name: "Winter", position: 3, legacyId: "winter" },
    { id: "tag_164au0p", kind: "tag", parentId: "sub_tqj5tr", name: "Holiday", position: 4, legacyId: "holiday" },
    { id: "sub_1u50nsj", kind: "folder", parentId: "cat_v7c060", name: "Social Context", position: 2, legacyId: "social-context" },
    { id: "tag_1b18j2o", kind: "tag", parentId: "sub_1u50nsj", name: "Solo Listening", position: 0, legacyId: "solo-listening" },
    { id: "tag_1mme79l", kind: "tag", parentId: "sub_1u50nsj", name: "Background Music", position: 1, legacyId: "background-music" },
    { id: "tag_1on3ah9", kind: "tag", parentId: "sub_1u50nsj", name: "Dancing", position: 2, legacyId: "dancing" },
    { id: "tag_1d8qgyo", kind: "tag", parentId: "sub_1u50nsj", name: "Singing Along", position: 3, legacyId: "singing-along" },
    { id: "tag_v17hjh", kind: "tag", parentId: "sub_1u50nsj", name: "Focus Music", position: 4, legacyId: "focus-music" },
  ],
  // Version 2 (82 tags, November 2026): without Vintage, Holiday, Polished, Live Recording, Studio,
  // Lo-fi, Reggae, Blues and Country; with Metal, Punk, Soul, Ambient, 2010s, 2020s, Hopeful,
  // Melancholic, Bittersweet, Epic, Spring, Autumn and a Language folder.
  2: [
    { id: "cat_ntsvi4", kind: "category", parentId: null, name: "Genre & Style", position: 0, legacyId: "genre-style" },
    { id: "sub_sb6d4r", kind: "folder", parentId: "cat_ntsvi4", name: "Primary Genres", position: 0, legacyId: "primary-genres" },
    { id: "tag_2i3xsw", kind: "tag", parentId: "sub_sb6d4r", name: "Rock", position: 0, legacyId: "rock" },
    { id: "tag_tv8r5i", kind: "tag", parentId: "sub_sb6d4r", name: "Pop", position: 1, legacyId: "pop" },
    { id: "tag_1d8jf00", kind: "tag", parentId: "sub_sb6d4r", name: "Hip-Hop", position: 2, legacyId: "hip-hop" },
    { id: "tag_chp12v", kind: "tag", parentId: "sub_sb6d4r", name: "Electronic", position: 3, legacyId: "electronic" },
    { id: "tag_2hyk36", kind: "tag", parentId: "sub_sb6d4r", name: "Jazz", position: 4, legacyId: "jazz" },
    { id: "tag_1nfve76", kind: "tag", parentId: "sub_sb6d4r", name: "Classical", position: 5, legacyId: "classical" },
    { id: "tag_tv8sln", kind: "tag", parentId: "sub_sb6d4r", name: "R&B", position: 6, legacyId: "rnb" },
    { id: "tag_6hd1ik", kind: "tag", parentId: "sub_sb6d4r", name: "Metal", position: 7, legacyId: "metal" },
    { id: "tag_2i2sjh", kind: "tag", parentId: "sub_sb6d4r", name: "Punk", position: 8, legacyId: "punk" },
    { id: "tag_2i4l7y", kind: "tag", parentId: "sub_sb6d4r", name: "Soul", position: 9, legacyId: "soul" },
    { id: "tag_j8f3nh", kind: "tag", parentId: "sub_sb6d4r", name: "Ambient", position: 10, legacyId: "ambient" },
    { id: "sub_11rx725", kind: "folder", parentId: "cat_ntsvi4", name: "Sub-genres", position: 1, legacyId: "sub-genres" },
    { id: "tag_o0gb10", kind: "tag", parentId: "sub_11rx725", name: "Alternative", position: 0, legacyId: "alternative" },
    { id: "tag_evohpe", kind: "tag", parentId: "sub_11rx725", name: "Indie", position: 1, legacyId: "indie" },
    { id: "tag_h86v5", kind: "tag", parentId: "sub_11rx725", name: "Folk", position: 2, legacyId: "folk" },
    { id: "tag_h8bd1", kind: "tag", parentId: "sub_11rx725", name: "Funk", position: 3, legacyId: "funk" },
    { id: "sub_n1yt5", kind: "folder", parentId: "cat_ntsvi4", name: "Era & Decade", position: 2, legacyId: "era-decade" },
    { id: "tag_15p9f6m", kind: "tag", parentId: "sub_n1yt5", name: "80s", position: 0, legacyId: "80s" },
    { id: "tag_15p9fxb", kind: "tag", parentId: "sub_n1yt5", name: "90s", position: 1, legacyId: "90s" },
    { id: "tag_dtn9eg", kind: "tag", parentId: "sub_n1yt5", name: "2000s", position: 2, legacyId: "2000s" },
    { id: "tag_dtna55", kind: "tag", parentId: "sub_n1yt5", name: "2010s", position: 3, legacyId: "2010s" },
    { id: "tag_dtnavu", kind: "tag", parentId: "sub_n1yt5", name: "2020s", position: 4, legacyId: "2020s" },
    { id: "tag_v9lsws", kind: "tag", parentId: "sub_n1yt5", name: "Modern", position: 5, legacyId: "modern" },
    { id: "cat_4pcgqb", kind: "category", parentId: null, name: "Mood & Energy", position: 1, legacyId: "mood-energy" },
    { id: "sub_g7foo8", kind: "folder", parentId: "cat_4pcgqb", name: "Energy Level", position: 0, legacyId: "energy-level" },
    { id: "tag_86l65h", kind: "tag", parentId: "sub_g7foo8", name: "High Energy", position: 0, legacyId: "high-energy" },
    { id: "tag_12q43sv", kind: "tag", parentId: "sub_g7foo8", name: "Upbeat", position: 1, legacyId: "upbeat" },
    { id: "tag_yq0nw1", kind: "tag", parentId: "sub_g7foo8", name: "Moderate", position: 2, legacyId: "moderate" },
    { id: "tag_1fdnth2", kind: "tag", parentId: "sub_g7foo8", name: "Chill", position: 3, legacyId: "chill" },
    { id: "tag_yrvxim", kind: "tag", parentId: "sub_g7foo8", name: "Mellow", position: 4, legacyId: "mellow" },
    { id: "tag_16wq773", kind: "tag", parentId: "sub_g7foo8", name: "Slow", position: 5, legacyId: "slow" },
    { id: "sub_3a5vgi", kind: "folder", parentId: "cat_4pcgqb", name: "Emotional Tone", position: 1, legacyId: "emotional-tone" },
    { id: "tag_1ywb9qk", kind: "tag", parentId: "sub_3a5vgi", name: "Happy", position: 0, legacyId: "happy" },
    { id: "tag_qwkb9e", kind: "tag", parentId: "sub_3a5vgi", name: "Sad", position: 1, legacyId: "sad" },
    { id: "tag_1ysotsd", kind: "tag", parentId: "sub_3a5vgi", name: "Angry", position: 2, legacyId: "angry" },
    { id: "tag_sxm85", kind: "tag", parentId: "sub_3a5vgi", name: "Romantic", position: 3, legacyId: "romantic" },
    { id: "tag_s90474", kind: "tag", parentId: "sub_3a5vgi", name: "Nostalgic", position: 4, legacyId: "nostalgic" },
    { id: "tag_3tg3ab", kind: "tag", parentId: "sub_3a5vgi", name: "Peaceful", position: 5, legacyId: "peaceful" },
    { id: "tag_1pzvxgb", kind: "tag", parentId: "sub_3a5vgi", name: "Dramatic", position: 6, legacyId: "dramatic" },
    { id: "tag_kk9p0t", kind: "tag", parentId: "sub_3a5vgi", name: "Hopeful", position: 7, legacyId: "hopeful" },
    { id: "tag_1uzhw5l", kind: "tag", parentId: "sub_3a5vgi", name: "Melancholic", position: 8, legacyId: "melancholic" },
    { id: "tag_1vcew14", kind: "tag", parentId: "sub_3a5vgi", name: "Bittersweet", position: 9, legacyId: "bittersweet" },
    { id: "sub_ad5vv", kind: "folder", parentId: "cat_4pcgqb", name: "Atmosphere", position: 2, legacyId: "atmosphere" },
    { id: "tag_1fiqktd", kind: "tag", parentId: "sub_ad5vv", name: "Dark", position: 0, legacyId: "dark" },
    { id: "tag_1z2x0l", kind: "tag", parentId: "sub_ad5vv", name: "Bright", position: 1, legacyId: "bright" },
    { id: "tag_2x3hj5", kind: "tag", parentId: "sub_ad5vv", name: "Dreamy", position: 2, legacyId: "dreamy" },
    { id: "tag_k5welb", kind: "tag", parentId: "sub_ad5vv", name: "Intense", position: 3, legacyId: "intense" },
    { id: "tag_1gidh49", kind: "tag", parentId: "sub_ad5vv", name: "Mysterious", position: 4, legacyId: "mysterious" },
    { id: "tag_1endlz2", kind: "tag", parentId: "sub_ad5vv", name: "Playful", position: 5, legacyId: "playful" },
    { id: "tag_1firipc", kind: "tag", parentId: "sub_ad5vv", name: "Epic", position: 6, legacyId: "epic" },
    { id: "cat_1heozhb", kind: "category", parentId: null, name: "Musical Elements", position: 2, legacyId: "musical-elements" },
    { id: "sub_18gezbr", kind: "folder", parentId: "cat_1heozhb", name: "Vocals", position: 0, legacyId: "vocals" },
    { id: "tag_1uqynfb", kind: "tag", parentId: "sub_18gezbr", name: "Male Vocals", position: 0, legacyId: "male-vocals" },
    { id: "tag_10dgb08", kind: "tag", parentId: "sub_18gezbr", name: "Female Vocals", position: 1, legacyId: "female-vocals" },
    { id: "tag_9o4tif", kind: "tag", parentId: "sub_18gezbr", name: "Duet", position: 2, legacyId: "duet" },
    { id: "tag_fmxarw", kind: "tag", parentId: "sub_18gezbr", name: "Choir", position: 3, legacyId: "choir" },
    { id: "tag_1f1kd6h", kind: "tag", parentId: "sub_18gezbr", name: "Instrumental", position: 4, legacyId: "instrumental" },
    { id: "tag_1cfh42i", kind: "tag", parentId: "sub_18gezbr", name: "Rap", position: 5, legacyId: "rap" },
    { id: "sub_ra6q1f", kind: "folder", parentId: "cat_1heozhb", name: "Instruments", position: 1, legacyId: "instruments" },
    { id: "tag_1hjn4z1", kind: "tag", parentId: "sub_ra6q1f", name: "Guitar", position: 0, legacyId: "guitar" },
    { id: "tag_1n53mh2", kind: "tag", parentId: "sub_ra6q1f", name: "Piano", position: 1, legacyId: "piano" },
    { id: "tag_1nxl30f", kind: "tag", parentId: "sub_ra6q1f", name: "Strings", position: 2, legacyId: "strings" },
    { id: "tag_1mxk966", kind: "tag", parentId: "sub_ra6q1f", name: "Brass", position: 3, legacyId: "brass" },
    { id: "tag_1myo91m", kind: "tag", parentId: "sub_ra6q1f", name: "Drums", position: 4, legacyId: "drums" },
    { id: "tag_1n71htl", kind: "tag", parentId: "sub_ra6q1f", name: "Synth", position: 5, legacyId: "synth" },
    { id: "tag_tea0hu", kind: "tag", parentId: "sub_ra6q1f", name: "Bass", position: 6, legacyId: "bass" },
    { id: "sub_69ukuu", kind: "folder", parentId: "cat_1heozhb", name: "Production Style", position: 2, legacyId: "production-style" },
    { id: "tag_1baw0jv", kind: "tag", parentId: "sub_69ukuu", name: "Acoustic", position: 0, legacyId: "acoustic" },
    { id: "tag_5k6bs5", kind: "tag", parentId: "sub_69ukuu", name: "Electric", position: 1, legacyId: "electric" },
    { id: "sub_15g5rkh", kind: "folder", parentId: "cat_1heozhb", name: "Language", position: 3, legacyId: "language" },
    { id: "tag_y26m1v", kind: "tag", parentId: "sub_15g5rkh", name: "English", position: 0, legacyId: "english" },
    { id: "tag_rb86g7", kind: "tag", parentId: "sub_15g5rkh", name: "Spanish", position: 1, legacyId: "spanish" },
    { id: "tag_iuio9q", kind: "tag", parentId: "sub_15g5rkh", name: "Japanese", position: 2, legacyId: "japanese" },
    { id: "tag_d4ik1d", kind: "tag", parentId: "sub_15g5rkh", name: "Korean", position: 3, legacyId: "korean" },
    { id: "tag_asppqf", kind: "tag", parentId: "sub_15g5rkh", name: "French", position: 4, legacyId: "french" },
    { id: "tag_b2uagj", kind: "tag", parentId: "sub_15g5rkh", name: "German", position: 5, legacyId: "german" },
    { id: "cat_v7c060", kind: "category", parentId: null, name: "Usage & Context", position: 3, legacyId: "usage-context" },
    { id: "sub_13ix0s3", kind: "folder", parentId: "cat_v7c060", name: "Activity", position: 0, legacyId: "activity" },
    { id: "tag_ki1gfu", kind: "tag", parentId: "sub_13ix0s3", name: "Workout", position: 0, legacyId: "workout" },
    { id: "tag_bn2uhy", kind: "tag", parentId: "sub_13ix0s3", name: "Study", position: 1, legacyId: "study" },
    { id: "tag_bl3a4j", kind: "tag", parentId: "sub_13ix0s3", name: "Party", position: 2, legacyId: "party" },
    { id: "tag_onuyco", kind: "tag", parentId: "sub_13ix0s3", name: "Relaxation", position: 3, legacyId: "relaxation" },
    { id: "tag_r1bw6c", kind: "tag", parentId: "sub_13ix0s3", name: "Driving", position: 4, legacyId: "driving" },
    { id: "tag_bmxer8", kind: "tag", parentId: "sub_13ix0s3", name: "Sleep", position: 5, legacyId: "sleep" },
    { id: "sub_tqj5tr", kind: "folder", parentId: "cat_v7c060", name: "Time & Season", position: 1, legacyId: "time-season" },
    { id: "tag_18kk9np", kind: "tag", parentId: "sub_tqj5tr", name: "Morning", position: 0, legacyId: "morning" },
    { id: "tag_1ao2w9", kind: "tag", parentId: "sub_tqj5tr", name: "Evening", position: 1, legacyId: "evening" },
    { id: "tag_178v558", kind: "tag", parentId: "sub_tqj5tr", name: "Spring", position: 2, legacyId: "spring" },
    { id: "tag_17bizxq", kind: "tag", parentId: "sub_tqj5tr", name: "Summer", position: 3, legacyId: "summer" },
    { id: "tag_ysufv9", kind: "tag", parentId: "sub_tqj5tr", name: "Autumn", position: 4, legacyId: "autumn" },
    { id: "tag_1914qkk", kind: "tag", parentId: "sub_tqj5tr", name: "Winter", position: 5, legacyId: "winter" },
    { id: "sub_1u50nsj", kind: "folder", parentId: "cat_v7c060", name: "Social Context", position: 2, legacyId: "social-context" },
    { id: "tag_1b18j2o", kind: "tag", parentId: "sub_1u50nsj", name: "Solo Listening", position: 0, legacyId: "solo-listening" },
    { id: "tag_1mme79l", kind: "tag", parentId: "sub_1u50nsj", name: "Background Music", position: 1, legacyId: "background-music" },
    { id: "tag_1on3ah9", kind: "tag", parentId: "sub_1u50nsj", name: "Dancing", position: 2, legacyId: "dancing" },
    { id: "tag_1d8qgyo", kind: "tag", parentId: "sub_1u50nsj", name: "Singing Along", position: 3, legacyId: "singing-along" },
    { id: "tag_v17hjh", kind: "tag", parentId: "sub_1u50nsj", name: "Focus Music", position: 4, legacyId: "focus-music" },
  ],
};

/** A version's rows, parents first. */
export function starterTagRows(version: StarterTagVersion = CURRENT_STARTER_TAG_VERSION): readonly StarterTagRow[] {
  const rows = STARTER_TAG_SEEDS[version];
  if (!rows) throw new Error(`Unknown starter tag version: ${String(version)}`);
  return rows;
}

/** A version as a category tree, in order, for Tagify desktop's taxonomy builder. */
export function starterTagTree(version: StarterTagVersion = CURRENT_STARTER_TAG_VERSION): StarterTagTreeCategory[] {
  const rows = starterTagRows(version);
  const children = (parentId: string) => rows
    .filter((row) => row.parentId === parentId)
    .sort((left, right) => left.position - right.position);
  return rows
    .filter((row) => row.kind === "category")
    .sort((left, right) => left.position - right.position)
    .map((category) => ({
      id: category.id,
      name: category.name,
      subcategories: children(category.id).map((folder) => ({
        id: folder.id,
        name: folder.name,
        tags: children(folder.id).map((tag) => ({ id: tag.id, name: tag.name })),
      })),
    }));
}
