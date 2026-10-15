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
