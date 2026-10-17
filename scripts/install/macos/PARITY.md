# Mac and Windows manager parity

The Mac manager lives here; Windows lives in the private `alexk218/tagify-installer-dev` repository. Native layouts may differ, but shared user-facing behavior should match.

For every installer change, review both platforms before release:

- App name: **Tagify Manager**.
- Footer: **Tutorial** and **Get help on Discord** (`https://discord.gg/C4qbPUbBKV`).
- Setup: Spotify, Spicetify and Tagify status; **Logs**, **Check again**, and repair.
- Tutorial: Spicetify homepage link and purpose; desktop Spotify requirement; keep the manager for future repairs.
- Update protection: enabled by default; explain that Spotify updates remove Spicetify and Tagify; preserve pending/error feedback without a redundant saved-choice message. With **Block Spotify updates** unchecked, a protection error never stops setup; the protection status shows what still needs attention.
- When Spicetify reports that Spotify "cannot be backed up at this state", setup stops and asks for a Spotify reinstall instead of retrying or suggesting closing Spotify.
- Ordinary text is non-selectable; links remain clickable; explicit diagnostic Copy actions remain available.
- Installer updates explain changes and offer the correct platform download.

Platform-specific instructions (Spotify paths, download links, permissions, macOS packaging and Windows Store restrictions) should remain specific to their platform.

## Stronger enforcement

A checklist requires reviewer discipline. The next step is one versioned, shared product contract containing common tutorial copy, names, destinations and required actions, consumed by both native apps. Each platform's CI should validate its rendered UI against the same contract version; release preparation should require both platform checks for that version. Keep layout and operating-system integration native.

Until both repositories consume that contract, native tests and this checklist catch known omissions but do not guarantee every future change propagates automatically.
