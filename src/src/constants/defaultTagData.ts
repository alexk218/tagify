import { TagDataStructure } from "@/hooks/data/useTagData";

// Default tag structure with 4 main categories
export const defaultTagData: TagDataStructure = {
  categories: [
    {
      name: "Genre & Style",
      id: "genre-style",
      subcategories: [
        {
          name: "Primary Genres",
          id: "primary-genres",
          tags: [
            { name: "Rock", id: "rock" },
            { name: "Pop", id: "pop" },
            { name: "Hip-Hop", id: "hip-hop" },
            { name: "Electronic", id: "electronic" },
            { name: "Jazz", id: "jazz" },
            { name: "Classical", id: "classical" },
            { name: "Country", id: "country" },
            { name: "R&B", id: "rnb" },
          ],
        },
        {
          name: "Sub-genres",
          id: "sub-genres",
          tags: [
            { name: "Alternative", id: "alternative" },
            { name: "Indie", id: "indie" },
            { name: "Folk", id: "folk" },
            { name: "Funk", id: "funk" },
            { name: "Blues", id: "blues" },
            { name: "Reggae", id: "reggae" },
          ],
        },
        {
          name: "Era & Decade",
          id: "era-decade",
          tags: [
            { name: "Vintage", id: "vintage" },
            { name: "80s", id: "80s" },
            { name: "90s", id: "90s" },
            { name: "2000s", id: "2000s" },
            { name: "Modern", id: "modern" },
          ],
        },
      ],
    },
    {
      name: "Mood & Energy",
      id: "mood-energy",
      subcategories: [
        {
          name: "Energy Level",
          id: "energy-level",
          tags: [
            { name: "High Energy", id: "high-energy" },
            { name: "Upbeat", id: "upbeat" },
            { name: "Moderate", id: "moderate" },
            { name: "Chill", id: "chill" },
            { name: "Mellow", id: "mellow" },
            { name: "Slow", id: "slow" },
          ],
        },
        {
          name: "Emotional Tone",
          id: "emotional-tone",
          tags: [
            { name: "Happy", id: "happy" },
            { name: "Sad", id: "sad" },
            { name: "Angry", id: "angry" },
            { name: "Romantic", id: "romantic" },
            { name: "Nostalgic", id: "nostalgic" },
            { name: "Peaceful", id: "peaceful" },
            { name: "Dramatic", id: "dramatic" },
          ],
        },
        {
          name: "Atmosphere",
          id: "atmosphere",
          tags: [
            { name: "Dark", id: "dark" },
            { name: "Bright", id: "bright" },
            { name: "Dreamy", id: "dreamy" },
            { name: "Intense", id: "intense" },
            { name: "Mysterious", id: "mysterious" },
            { name: "Playful", id: "playful" },
          ],
        },
      ],
    },
    {
      name: "Musical Elements",
      id: "musical-elements",
      subcategories: [
        {
          name: "Vocals",
          id: "vocals",
          tags: [
            { name: "Male Vocals", id: "male-vocals" },
            { name: "Female Vocals", id: "female-vocals" },
            { name: "Duet", id: "duet" },
            { name: "Choir", id: "choir" },
            { name: "Instrumental", id: "instrumental" },
            { name: "Rap", id: "rap" },
          ],
        },
        {
          name: "Instruments",
          id: "instruments",
          tags: [
            { name: "Guitar", id: "guitar" },
            { name: "Piano", id: "piano" },
            { name: "Strings", id: "strings" },
            { name: "Brass", id: "brass" },
            { name: "Drums", id: "drums" },
            { name: "Synth", id: "synth" },
            { name: "Bass", id: "bass" },
          ],
        },
        {
          name: "Production Style",
          id: "production-style",
          tags: [
            { name: "Acoustic", id: "acoustic" },
            { name: "Electric", id: "electric" },
            { name: "Live Recording", id: "live-recording" },
            { name: "Studio", id: "studio" },
            { name: "Lo-fi", id: "lo-fi" },
            { name: "Polished", id: "polished" },
          ],
        },
      ],
    },
    {
      name: "Usage & Context",
      id: "usage-context",
      subcategories: [
        {
          name: "Activity",
          id: "activity",
          tags: [
            { name: "Workout", id: "workout" },
            { name: "Study", id: "study" },
            { name: "Party", id: "party" },
            { name: "Relaxation", id: "relaxation" },
            { name: "Driving", id: "driving" },
            { name: "Sleep", id: "sleep" },
          ],
        },
        {
          name: "Time & Season",
          id: "time-season",
          tags: [
            { name: "Morning", id: "morning" },
            { name: "Evening", id: "evening" },
            { name: "Summer", id: "summer" },
            { name: "Winter", id: "winter" },
            { name: "Holiday", id: "holiday" },
          ],
        },
        {
          name: "Social Context",
          id: "social-context",
          tags: [
            { name: "Solo Listening", id: "solo-listening" },
            { name: "Background Music", id: "background-music" },
            { name: "Dancing", id: "dancing" },
            { name: "Singing Along", id: "singing-along" },
            { name: "Focus Music", id: "focus-music" },
          ],
        },
      ],
    },
  ],
  tracks: {},
};