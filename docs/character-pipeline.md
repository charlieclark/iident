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

## Second pass: fully stylized looks

The five-heads figure scored well but looked wrong to people: a near-photographic face on a toy body. The likeness score rewards realism, so optimizing for it had pushed the face toward a photo. The second pass asked for the opposite: one style for the whole character, face included, with the person translated into it the way a character designer would.

Six styles, four test faces, GPT Image 2.6 at high quality. "Matched" is how many of the four renders were closer to their own selfie than to the other test selfies.

| Style | Likeness score | Matched | Notes |
| --- | --- | --- | --- |
| Five-heads figure (previous) | 0.77 | 6 of 6 | Photo-like face on a stylized body |
| Painted game hero | 0.40 | 4 of 4 | Closest to realistic, small head |
| Animated film character, 6.5 heads | 0.23 | 4 of 4 | Clearly a character, each person still themselves |
| Clay puppet | 0.20 | 4 of 4 | Most distinctive; very simple eyes and mouth |
| Cel-shaded toon | 0.18 | 2 of 4 | Reads as a flat drawing |
| Soft rounded avatar | 0.12 | 3 of 4 | Faces drift toward one generic face |
| Vinyl toy | 0.05 | 1 of 4 | Most toy-like, least like the person |

The animated film character and the painted hero were each built in 3D. Neither was liked once rendered: the first still had a large head for its body, and the body proportions of both looked off in motion.

## Third pass: a photorealistic head and shoulders (abandoned)

To put all the detail into the face, a head-and-shoulders model was generated from a normalized portrait and given its own runtime: head turning without a skeleton, a modelled mouth interior, eyes redrawn from a picture of themselves (kept on the `claude/talking-head` branch). The static head was the most recognizable result of the whole project. Talking, it was creepy. A face that looks like a photo is judged like a real person, and one moved by simple rules (a picture of an eye being shifted, a mouth cut into a still surface) fails that test however much the details are polished.

## Fourth pass: back to the first look (the current house style)

The look the product started with, an animated film character with natural proportions, turned out to be the one people preferred. Its weakness had been likeness: on Nano Banana 2 the faces were generic. Four ways of drawing it, five test faces:

| | Likeness score | Matched | Notes |
| --- | --- | --- | --- |
| 1. Original prompt, Nano Banana 2 | 0.14 | 5 of 6 | Generic faces |
| 2. New wording, Nano Banana 2 | 0.15 | 4 of 5 | Little change |
| **3. New wording, Nano Banana 2.1** | 0.18 | 5 of 5 | **House style.** Same cartoon look; keeps beards going grey, age, face shape |
| 4. New wording, GPT Image 2.6 | 0.62 | 5 of 5 | Ignores the style: near-photographic faces again |

"New wording" is the original style sentence plus: the whole character is drawn in one style, the named features are carried over into it, the apparent age is kept, and the head is a normal size (seven and a half heads tall). Option 3 is the house style (`HOUSE_STYLE`, `STYLE_ID` "animated-2", image model `google/nano-banana-2.1/edit` at about 4 cents and 15 seconds). Two builds confirmed it in 3D next to the very first avatar: same look, more of the person.

The lesson for next time: the likeness score is a guide for comparing models inside one style, not a target. Chasing it leads to realism, and realism is what looked wrong.

## Real selfies: the clean portrait

Every test above used synthetic selfies that were straight on, evenly lit and relaxed. The first real selfie was taken from below, against a window, with a furrowed brow, and the character came out sad-eyed with a generic face and much thicker hair. Six fixes were tried on that selfie:

| | Result |
| --- | --- |
| Tell the cartoon model to correct for angle, light and expression | Better hairline, still a sad face |
| A clean portrait first, then the cartoon model | Neutral face, still generic |
| **A clean portrait and the selfie together, then the cartoon model** | **Chosen.** Neutral, friendly, the most like the person while staying a cartoon |
| The same plus a written description of what is distinctive | Picks up hairline, brows and ears; reads as a caricature, and a loose word in the description shows (a "reddish" beard came out orange) |
| The likeness model shown the style by example | Most like the person, but back toward a real face |

The clean portrait is the selfie redrawn by GPT Image 2.6 as the same person straight on at eye level, in even light, with a relaxed face (`PORTRAIT_PROMPT`). It is the one step where a photographic result is right, because it is a reference and never the character. It is made once per selfie, in the background at upload (`src/lib/server/portrait.ts`), at medium quality: on the six test faces that took a median of 10.7 s against 17.0 s at high, with the same likeness to the selfie (0.848 against 0.848, worst case 0.80 against 0.82) and no difference to the eye, and the first drawing waits for it. Also, the character prompt now also tells the model not to thicken or darken hair and brows, and not to copy a passing expression.

A written description of the person (from a vision model) is the next thing to try if likeness needs to go further.

## Trying looks on a mannequin

The first drawing of a person takes two model calls in a row (the portrait, then the character): 31 to 39 seconds before anything could be tried. Making it faster had run out of road, so it was taken out of the way instead: until there is a character, looks are shown on a neutral mannequin, and the person is drawn once, when they have chosen.

- The mannequin (`src/assets/mannequin.jpg`) was made from a character in the house style with the person replaced by a featureless gray figure, so it has the same proportions and pose as the characters. Mannequins drawn from a description alone came out anatomical and male.
- FLUX.3 klein dresses it from the same outfit wording the character prompt uses, plus "no logos": without that, sportswear comes with brand marks.
- The picture is filed under a key made from what the mannequin can show (outfit, accessories, a hairstyle or beard that was picked, build, free-text details). Height, and hair or facial hair left "as in the photo", are not part of it, since there is nothing of the person to show. One table, `mannequin_sketches`, and one shared folder hold the pictures for every account.
- Measured in the browser: 1.4 s from uploading the photo to a dressed mannequin, 0.2 to 0.6 s for a look tried before, 3 to 4 s for a new one, then 20 s from "Create my character" to the character (33 s when pressed within seconds of uploading, because the portrait is still being made).

What is given up: people don't see themselves until they press the button, and a body type shows only loosely on the mannequin. After the first character, sketches are of the person again (below).

## Sketches

Drawing straight from the selfie, the fast model (FLUX.3 klein) loses the person in a cartoon style: adults become generic cartoon children, beards disappear, and features named in the prompt (glasses, freckles) get added to people who don't have them. Wording changes and a style reference image did not fix it (the reference's identity leaks in). What works is not asking it to draw the person at all:

1. The first sketch is drawn from the selfie by the main model (about 15 to 20 s, 4 cents).
2. Every later sketch is the fast model *restyling that picture* with the new look (`buildSketchEditPrompt`): outfit, build, hair and facial hair all change correctly and the face stays, in 4 to 8 s for under a cent.
3. Once a final exists, sketches restyle the final instead.

Only pictures the main model drew of the current selfie in the current style are used this way (`sketchBase` in `src/lib/server/concepts.ts`).

## What was not tested

- Real selfies of real people in poor light or at odd angles.
- Likeness after the 3D step (one build per style was checked by eye, not scored).
- The current style on more than five synthetic faces and one real selfie, and its sketches on real selfies.
- Passing a tight face crop as a second reference image, which may help further.
