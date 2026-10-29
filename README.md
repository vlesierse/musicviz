# 🎃 musicviz: Halloween party visuals

Twenty Halloween music visualizations built with [Three.js](https://threejs.org). They react to **whatever your laptop is playing** (Spotify, YouTube, a DJ app…). The app captures system audio, not the microphone, so the room noise of the party doesn't affect it.

**▶ Run it:** open **https://vlesierse.github.io/musicviz/** in Chrome. Nothing to install.

## How to use

1. Open the page in **Chrome or Edge** (desktop) and click **Summon the visuals**.
2. In the sharing dialog choose **Entire screen** and switch on **Also share system audio**.
3. Click **Share**, start your music and press **F** for fullscreen.
   (The screen video is only requested because the browser requires it. It is captured at 1 fps and never displayed.)

The visuals auto-switch every 1–2 minutes with a dissolve transition, preferring a drop or a strong beat as the moment to switch.

| Key | Action |
| --- | --- |
| `1`–`9`, `0` | Jump to visual 1–10 |
| `Shift` + `1`–`9`, `0` | Jump to visual 11–20 |
| `←` / `→` | Previous / next visual |
| `Space` | Pause / resume auto-switching |
| `F` | Fullscreen |
| `H` | Hide / show the overlay |

URL options: `?visual=3` starts on a given visual, and `?auto=0` disables auto-switching.

## The visuals

| # | Visual | Reacts to |
| --- | --- | --- |
| 1 | Wormhole of Souls | bass → speed, mids → twist, beats → flash and warp jolt |
| 2 | Pumpkin Particle Morph | 70k particles morph between pumpkin, skull, bat and "BOO!"; beats explode them |
| 3 | Haunted Graveyard | bass → moon and fog, mids → jack-o'-lantern flicker, treble → wisps, drops → lightning |
| 4 | Ghost Flow Field | loudness → flow speed, treble → shimmer, beats → swirl toward you |
| 5 | Spider-Web Spectrum | each spoke is a frequency band, chords vibrate, beats ripple, the spider drops on drops |
| 6 | Witch's Cauldron | bass → bubbles and surface, mids → smoke, beats → green flare |
| 7 | The Eye | bass → pupil dilation, beats → blink and dart, treble → vein glow |
| 8 | Spectral Terrain | the spectrum history becomes the terrain under a blood moon |
| 9 | Bat Storm | flocking bats; loudness → speed, beats → scatter, drops → eclipse |
| 10 | Portal to the Underworld | bass → portal heat, spectrum ring, beats → ember bursts |
| 11 | Blood Rain | loudness → rain density, beats → big drops and splash crowns, bass → pool ripples, drops → blood sweeps down the screen |
| 12 | Dracula's Bite | bass opens the jaw, beats snap it, blood drips from the fangs, drops → chomp, splatter and bats |
| 13 | Zombie Horde | loudness → shamble speed, beats → lurch and hands burst from the ground, drops → the horde surges |
| 14 | Haunted Forest | bass → branches sway and reach, mids → carved faces glow, drops → every face opens its eyes |
| 15 | Haunted Mansion | windows are a spectrum equalizer, gravestones rise and hop with the music, drops → lightning |
| 16 | Eyes in the Dark | each pair of eyes follows a frequency band, beats → blinks, drops → every eye stares at you |
| 17 | Skeleton Dance | skeletons dance on the beat, mids → jaw chatter, drops → a big synchronized move |
| 18 | Possessed TV | loudness → static, waveform on the screen, beats → glitches and a ghostly face, drops → channel 13 |
| 19 | Pumpkin Patch EQ | each column of jack-o'-lanterns is a band, beats → wave of light, drops → flames and jumps |
| 20 | Witches' Flight | loudness → flight speed, beats → sparkle bursts, drops → a flock swoops past the camera |

## Requirements

- **Chrome / Edge 141+ on macOS 14.2+** for system audio from the entire screen. On Windows, Chrome and Edge can share system audio as well.
- On older macOS versions where the system audio switch is missing, play the music in another Chrome tab (e.g. Spotify or YouTube in the browser) and share **that tab** with "Also share tab audio" switched on.
- Firefox and Safari don't support audio capture through screen sharing.
- A GPU from the last few years. Resolution adapts automatically to keep the frame rate smooth.

## Run locally / offline

```bash
npm install
npm run dev        # http://localhost:5173
```

For a party without internet, build once and serve the static files:

```bash
npm run build
npm run preview    # serves dist/ on http://localhost:4173
```

`localhost` counts as a secure context, so screen and audio capture work there too.

### Development

- `npm test` runs the audio feature-extraction unit tests.
- In dev mode, `?debug` replaces the capture with a synthetic 124 BPM beat (with a breakdown and a drop every 32 s) and shows the FPS, so you can work on visuals without sharing your screen. Example: `http://localhost:5173/?debug&visual=5&auto=0`.
- Visuals live in `src/visuals/` and extend `Visual` (`src/core/Visual.ts`). The audio pipeline is in `src/audio/`.

## Deployment

Every push to `main` deploys to GitHub Pages via `.github/workflows/deploy.yml`. One-time setup: **Settings → Pages → Source: GitHub Actions**.
