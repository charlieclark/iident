# Character images: models and house style

How the image models and the house style were chosen (November 2026). Re-run this when a new model appears; the method takes about an hour and a few dollars.

## Method

- **Test set:** six photoreal synthetic selfies (three women, three men, ages 24 to 58, varied skin tones, one with glasses and a beard). Nobody real.
- **Likeness score:** cosine similarity between ArcFace face embeddings (InsightFace `buffalo_l`) of the selfie and of the rendered character. Same person in two photos typically scores above 0.5; different people around 0.0 to 0.15. "Top-1" asks whether a render is closer to its own selfie than to the other five.
- **Caveat:** the score rewards realism. A model that barely stylizes scores high, so every result was also checked by eye for style.
- All models ran through fal with the same prompt, one image per face.

## Final image model

Old prompt ("keep them recognizable"), animated style, six faces:

| Model | Likeness | Worst face | Time | Price per image |
| --- | --- | --- | --- | --- |
| Qwen Image 3 edit | 0.75 | 0.65 | 190 s | $0.04 |
| GPT Image 2.6 (high) | 0.61 | 0.40 | 22 s | $0.041 |
| GPT Image 2.6 (medium) | 0.56 | 0.44 | 21 s | $0.034 |
| FLUX.3 edit | 0.40 | 0.35 | 35 s | $0.048 |
| Seedream 5 Pro edit | 0.33 | 0.18 | 45 s | $0.068 |
| Nano Banana 2.1 edit | 0.17 | 0.11 | 15 s | $0.042 |
| Nano Banana 2 edit (previous default) | 0.14 | 0.02 | 13 s | $0.08 |

Times were measured with all requests running at once. Qwen scored highest because its output is close to a photo, and it is far too slow. **GPT Image 2.6 at high quality** is the pick: it keeps the face while still drawing a character, and costs half of the previous model.

## Sketch model

Target: a few seconds and about a cent, for redrawing as the creator changes outfits.

| Model | Likeness | Time | Price per image |
| --- | --- | --- | --- |
| FLUX.3 klein edit | 0.65 | 7 s (2 to 3.5 s with prompt expansion off) | $0.008 |
| Nano Banana Lite edit | 0.25 | 8 s | token-billed |
| Muse Image edit | 0.15 | 29 s | $0.01 |
| GPT Image 1 mini (low) | 0.02 | 16 s | about $0.01 |
| FLUX.2 flash edit | -0.03 | 5 s | about $0.01 |

**FLUX.3 klein** is the only cheap model that keeps both the identity and the outfit. Its `enable_prompt_expansion` default rewrites the prompt and doubles the wait without helping likeness, so it is turned off.

## Prompt and house style

Two changes mattered as much as the model:

1. **Spell out what to keep.** Replacing "keep their face recognizable" with an explicit list (face shape, jawline, nose, eye shape and spacing, eyebrows, lips, skin tone, hairline, distinguishing details, apparent age, no beautifying) lifted GPT Image 2.6 from 0.61 to 0.70 in the same style.
2. **One style with a larger head.** Styles compared on GPT Image 2.6 (and on the sketch model):

| Style | Likeness (final) | Likeness (sketch) | Notes |
| --- | --- | --- | --- |
| Animated film character | 0.70 | 0.48 | Sketch model drifts into generic cartoon faces |
| Vinyl toy, head one third of height | 0.68 | 0.62 | Reads as a bobblehead |
| Stylized figure, natural proportions | 0.77 | 0.77 | Small head: little face for the 3D step |
| **Collectible figure, five heads tall** | **0.77** (worst 0.74) | 0.72 | House style |
| Collectible figure, four heads tall | 0.79 | 0.76 | Slightly higher score, but too squat |

The house style (`HOUSE_STYLE` in `src/lib/avatar/options.ts`) is the five-heads-tall collectible figure: recognizable for every test face, distinct enough to become associated with the platform, a large face for the image-to-3D step, and a sculpted finish that avoids an uncanny photographic face on a painted-mouth rig.

Net effect on the six test faces: likeness **0.14 before, 0.77 now**, at half the price per final image.

## Second pass: a fully stylized look (the current house style)

The five-heads figure scored well but looked wrong to people: a near-photographic face on a toy body. The likeness score rewards realism, so optimizing for it had pushed the face toward a photo. The second pass asked for the opposite: one style for the whole character, face included, with the person translated into it the way a character designer would.

Six styles, four test faces, GPT Image 2.6 at high quality. "Matched" is how many of the four renders were closer to their own selfie than to the other test selfies.

| Style | Likeness score | Matched | Notes |
| --- | --- | --- | --- |
| Five-heads figure (previous) | 0.77 | 6 of 6 | Photo-like face on a stylized body |
| Painted game hero | 0.40 | 4 of 4 | Closest to realistic, small head |
| **Animated film character** | 0.23 | 4 of 4 | **House style.** Clearly a character, each person still themselves |
| Clay puppet | 0.20 | 4 of 4 | Most distinctive; very simple eyes and mouth |
| Cel-shaded toon | 0.18 | 2 of 4 | Reads as a flat drawing |
| Soft rounded avatar | 0.12 | 3 of 4 | Faces drift toward one generic face |
| Vinyl toy | 0.05 | 1 of 4 | Most toy-like, least like the person |

The animated film style (`HOUSE_STYLE`, `STYLE_ID` "film-1") was picked by eye from the sheet. One real build confirmed it converts to 3D, rigs, and that the browser finds the face for lip sync (mouth shapes checked by eye).

**Sketches changed with it.** Drawing straight from the selfie, the fast model (FLUX.3 klein) loses the person in this style: adults become generic cartoon children, beards disappear, and features named in the prompt (glasses, freckles) get added to people who don't have them. Wording changes and a style reference image did not fix it (the reference's identity leaks in). What works is not asking it to draw the person at all:

1. The first sketch is drawn from the selfie by the main model at low quality (about 15 s, $0.02).
2. Every later sketch is the fast model *restyling that picture* with the new look (`buildSketchEditPrompt`): outfit, build, hair and facial hair all change correctly and the face stays, in 4 to 7 s for under a cent.
3. Once a final exists, sketches restyle the final instead.

Only pictures the main model drew of the current selfie in the current style are used this way (`sketchBase` in `src/lib/server/concepts.ts`).

## What was not tested

- Real selfies of real people in poor light or at odd angles.
- Likeness after the 3D step (one build per style was checked by eye, not scored).
- The animated film style on more than four faces, and its sketches on real selfies.
- Passing a tight face crop as a second reference image, which may help further.
