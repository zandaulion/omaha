# Bundled faces

`inter_variable.ttf` and `jetbrains_mono_variable.ttf`, both SIL Open Font
License 1.1, both **subset to Latin** rather than shipped whole.

Doc 13 §10 requires these in the APK: Roboto does not reproduce doc 04's type
scale, so an Android build falling back to the system face is off-parity before
a single screen is laid out. `design/tokens.json` names them, and
`tools/gen-tokens.mjs` carries the names into `OmahaFonts`.

## Why subset, and what was kept

Whole, the pair is 1,064 KB. Doc 13 §20 measures the entire engine — QuickJS
native library plus the JS bundle — at about 900 KB on a modern phone, so
shipping the fonts unsubset would have made typography the largest thing in the
app by a comfortable margin.

Subset to Latin they are **411 KB**, a 61% reduction.

Regenerate with:

```sh
UNI="U+0000-00FF,U+0100-017F,U+2000-206F,U+20A0-20BF,U+2190-21BB,U+2212,U+2215,U+2264,U+2265,U+2022,U+2026,U+00D7"
pyftsubset Inter[opsz,wght].ttf --unicodes="$UNI" --layout-features='*' \
  --output-file=inter_variable.ttf
pyftsubset JetBrainsMono[wght].ttf --unicodes="$UNI" --layout-features='*' \
  --output-file=jetbrains_mono_variable.ttf
```

Sources are the Google Fonts originals: `ofl/inter` and `ofl/jetbrainsmono`.

**The ranges are not arbitrary.** Beyond Latin-1 and Latin Extended-A they cover
General Punctuation, currency symbols, and the arrows and maths signs this app
actually renders — `−` U+2212 for a signed percentage, `×` for a multiple, `≥`
and `≤` for checklist thresholds, `→`, `•` and `…`. Verified present after
subsetting rather than assumed.

**Both keep their `wght` axis** — 100–900 for Inter, 100–800 for JetBrains Mono
— so one file covers every weight the scale asks for (400 through 700). Static
instances per weight would have been larger, not smaller. Android supports
variable fonts from API 26, which is this project's `minSdk`.

Emoji are deliberately **not** included. Scoring output carries 💎, 🚀 and ⚠️,
and those come from the system emoji font on every Android device; bundling a
colour emoji face would add megabytes to duplicate something already present.
