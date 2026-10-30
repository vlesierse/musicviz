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

Each visual reacts to the whole mix, not just the bass:

- **Kick** (`bass`, `beat`) drives the big motion.
- **Snares and claps** (mid onsets) trigger their own accents.
- **Hi-hats and cymbals** (treble onsets) add sparkle and glints.
- The **spectral brightness** of the track shifts the colours.

Every visual has 5–6 colour palettes. The palette crossfades every 32 beats and switches quickly on a drop.

| # | Visual | Kick | Snare / mids | Hats / highs | Drop |
| --- | --- | --- | --- | --- | --- |
| 1 | Wormhole of Souls | speed, flash, warp jolt | shockwave rings, bats twitch, twist | wall glints, souls flash | new tunnel colour |
| 2 | Pumpkin Particle Morph | 70k particles explode and morph (pumpkin, skull, bat, "BOO!") | shockwaves ripple through the particles | random particles glint | new accent colour |
| 3 | Haunted Graveyard | moon and fog | lanterns and fog flare, trees creak | stars flare, wisps spark | lightning |
| 4 | Ghost Flow Field | swirl toward you | ghosts lunge and shout "boo!" | ectoplasm motes sparkle | new ghost colours |
| 5 | Spider-Web Spectrum | ripples spread from the hub; each spoke is a frequency band | a coloured pluck on a random strand, the spider twitches | dew drops flash | the spider drops |
| 6 | Witch's Cauldron | big bubbles, fire heat | ripple rings on the surface, smoke | fizz of tiny bubbles | eruption and a new potion |
| 7 | The Eye | pupil dilation, blink and dart | iris ripple, twitch, veins glow | iris flecks, dust glints | new iris colour |
| 8 | Spectral Terrain | spectrum-history terrain | a wave rolls to the horizon | grid and star glints | new palette |
| 9 | Bat Storm | flock speed and scatter | one flock swirls, lightning in the clouds | stars twinkle, bat eyes glint | eclipse |
| 10 | Portal to the Underworld | portal heat, ember bursts | shockwave ring, the swirl jolts | white-hot embers, rim sparks | new fire palette |
| 11 | Blood Rain | big drops, splash crowns, pool ripples | horizon lightning, crown splash in the pool | droplet mist, glints | blood sweeps down the screen |
| 12 | Dracula's Bite | jaw opens and snaps | snarl, a light sweeps across, dripping fangs | glints on the teeth, candle flicker | chomp, splatter, bats |
| 13 | Zombie Horde | lurch, hands burst from the ground | zombies jerk and reach, eyes flare | motes flash | the horde surges |
| 14 | Haunted Forest | branches sway and reach | carved faces shriek, branches twitch | leaves glint, wisps brighten | every face opens its eyes |
| 15 | Haunted Mansion | gravestones rise and hop; the windows are an equalizer | windows knock white-hot, the door flares | stars twinkle, grave lights flicker | lightning |
| 16 | Eyes in the Dark | blinks; each pair of eyes follows a band | eye groups snap wide, hidden eyes peek out | star glints in the eyes | every eye stares at you |
| 17 | Skeleton Dance | dance moves | random skeletons twitch, floor shockwave | dust glints, spotlight | big synchronized move |
| 18 | Possessed TV | glitches, ghostly face | picture lines tear sideways | VHS dropouts, standby LED blinks | channel 13 |
| 19 | Pumpkin Patch EQ | a wave of light from the centre; each column is a band | a sideways flicker-and-hop wave | pumpkins spit sparks | flames and jumps |
| 20 | Witches' Flight | flight speed, sparkle bursts | a witch casts a ring of sparks | stars glint in the spell colour | a flock swoops past the camera |

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
