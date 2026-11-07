# Boxing bell recording

The audio encoded in `bell-audio.js` is an excerpt from
[“Boxing Bell 1.wav” by Benboncan](https://freesound.org/people/Benboncan/sounds/66952/),
licensed under [Creative Commons Attribution 4.0 International](https://creativecommons.org/licenses/by/4.0/).

The original is a recording of a real boxing bell struck once. This app uses the
publicly available high-quality MP3 preview, converted from dual mono to mono,
trimmed to the first three seconds and faded out over the final 0.4 seconds.
It is encoded at 128 kbit/s and embedded as base64 so the same sample works in
standalone builds, offline launches and direct local-file source previews.
The recording is played at its original pitch. Multiple strikes reuse the same
sample, separated by 0.18 seconds, at reduced gain to retain headroom.

Source preview:
https://cdn.freesound.org/previews/66/66952_634166-hq.mp3

The title, author, source, license and modifications are also credited in Settings.
No endorsement by the recording's author is implied.

# Whistle

The start whistle uses no recording. `scripts/tabata-whistle.mjs` renders it
from a model of a pea whistle and writes `whistle-audio.js`:

- Blowing pressure rises over 18 ms, sags 8 % and tails off over 110 ms. It
  sets the pitch (about 3.15 kHz at full pressure) and the loudness.
- The spinning pea chops the airflow at about 38 Hz. Each pass dips the level
  by up to 80 % and bends the pitch by 2.5 %.
- Breath noise resonates in the chamber through a band-pass that follows the
  pitch, 9 dB below the tone, with a hiss that is strongest at the start.
- A 60 ms room tail at -20 dB follows the dry sound.

A fixed random seed makes the output identical on every run. The 0.91 s result
is encoded with ffmpeg (libmp3lame, 128 kbit/s mono) and embedded as base64,
like the bell. Run `node scripts/tabata-whistle.mjs` to regenerate it.
