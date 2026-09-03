# BranchWise brand

The BranchWise logo: one head office feeding branches that step upward — the shape of
the business itself (one wholesale branch plus the retail shops, all reporting into one
place), and the upward step reads as growth.

## Files

| File | Use it for |
| --- | --- |
| `branchwise-lockup.svg` | The full logo — mark plus name. The default, on white or any light background. |
| `branchwise-lockup-dark.svg` | The same lockup on a dark background. |
| `branchwise-mark.svg` | The mark on its own, where the name is already nearby. |
| `branchwise-mark-white.svg` | The mark on a dark or coloured background. |
| `branchwise-icon.svg` | The rounded app icon — the mark in white on an indigo gradient. Used for Windows and Linux, where the artwork is expected to reach the edges. |
| `branchwise-icon-macos.svg` | The same icon inset to Apple's icon grid (824 inside 1024) with a soft shadow, so it sits at the same visual size as other Mac apps in the Dock. |
| `png/` | PNG exports of all of the above, with transparent backgrounds. Use these in Word, PowerPoint, or anywhere SVG is awkward. |

Regenerate the PNGs after editing any SVG:

```
npm run brand
```

It renders `png/lockup.png`, `png/lockup-dark.png`, `png/mark.png`, `png/mark-white.png`
`png/icon-{1024,512,256,128,64,32}.png` and `png/icon-macos-{1024,512}.png` using the
copy of Google Chrome on this machine.

The app reads its icons from two copies of these files, so update them together after a
change: `build/icon.png` and `build/icon-macos.png` are what electron-builder turns into
the packaged app's icon, and `resources/icon.png` and `resources/icon-macos.png` are what
the running app hands to the window and the Dock.

## Colours

| Hex | Where it appears |
| --- | --- |
| `#4338ca` | The head-office dot at the bottom, and the dark end of the icon gradient |
| `#4f46e5` | The tallest (right-hand) branch |
| `#6366f1` | The connecting lines, the word "Wise", and the app's own brand colour |
| `#818cf8` | The middle branch, and the light end of the icon gradient |
| `#a5b4fc` | The shortest (left-hand) branch |
| `#1e293b` | The word "Branch" |

These are the same indigo tokens the app already uses (`--color-brand` in
`frontend/renderer/src/styles/globals.css`), so the logo and the interface match.

## Using it

- Keep clear space around the logo of at least the height of the head-office dot.
- Below about 20px, use the mark on its own — the name becomes unreadable, not just small.
- Don't recolour it, stretch it, add a shadow, or put the colour lockup on a dark
  background; use the dark version instead.
- The wordmark is set in the system sans-serif (Helvetica/Arial). If it ever needs to be
  fixed for print, convert the text to outlines first.
