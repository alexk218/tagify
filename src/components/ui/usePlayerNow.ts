import { useEffect, useState } from "react";

export interface PlayerNow {
  /** The song Spotify has loaded, playing or paused. */
  uri: string | null;
  playing: boolean;
}

const read = (): PlayerNow => {
  try {
    return { uri: Spicetify.Player.data?.item?.uri ?? null, playing: Spicetify.Player.isPlaying() };
  } catch {
    return { uri: null, playing: false };
  }
};

/** What Spotify is playing, so a row's Play shows Pause while its song plays. */
export function usePlayerNow(): PlayerNow {
  const [now, setNow] = useState<PlayerNow>(read);
  useEffect(() => {
    const update = () => setNow(read());
    try {
      Spicetify.Player.addEventListener("songchange", update);
      Spicetify.Player.addEventListener("onplaypause", update);
    } catch { return undefined; }
    return () => {
      try {
        Spicetify.Player.removeEventListener("songchange", update);
        Spicetify.Player.removeEventListener("onplaypause", update);
      } catch { /* Spotify is closing. */ }
    };
  }, []);
  return now;
}
