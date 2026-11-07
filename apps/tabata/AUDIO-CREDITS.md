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

# Whistle recording

The start whistle encoded in `whistle-audio.js` is
[“Referee whistle blow, gymnasium” by SpliceSound](https://freesound.org/people/SpliceSound/sounds/218318/),
dedicated to the public domain under
[Creative Commons Zero 1.0](https://creativecommons.org/publicdomain/zero/1.0/).
No credit is required; it is listed here for provenance.

It is a single pea whistle blast recorded in a gymnasium. The copy used was an
Ogg Vorbis encode (`assets/audio/sfx/whistle/fs218318.ogg`, commit
`98642ec720a4`) from the public `robwizzie/fetch` repository, which credits the
same Freesound source as CC0 1.0. This app converts it to mono, trims silence
before the blast and after the room tail (below -55 dBFS), fades the last
20 ms, sets the peak to -1.5 dBFS and encodes 0.60 seconds at 128 kbit/s MP3.
It is embedded as base64 like the bell and plays once at reduced gain.
