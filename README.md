# Snap & Cinema FX — Windows virtual webcam

Runs your effects (snap/palm to vanish, both hands = Absolute Cinema, facepalm, cash rain, blur)
and publishes them as a webcam that WhatsApp Desktop, Zoom, Teams, Discord, Meet, browsers, OBS… can select.

## Get the .exe (GitHub Actions)
1. Create a new GitHub repository, then upload/push everything in this folder (the `.github` folder must be included).
2. Open the repo → **Actions** tab → **Build Windows exe** → **Run workflow**.
   (It also runs automatically on every push.) Takes ~5–10 minutes.
3. Open the finished run → **Artifacts** → download **SnapCinemaFX-Setup** → unzip → `SnapCinemaFX-Setup-1.8.0.exe`.

## Use it
1. Install **OBS Studio** once (https://obsproject.com). Open it, click **Start Virtual Camera**, then close OBS.
   (This only registers the virtual camera driver.)
2. Install and run **Snap Cinema FX**. It opens your real camera and shows the preview.
3. In WhatsApp Desktop / Zoom / Teams / Discord / browser, choose camera **OBS Virtual Camera**.
4. Close any other app that is already holding the real webcam.

Windows may say "Windows protected your PC" (the installer isn't code-signed): click **More info → Run anyway**.

## Notes
- Hotkeys work system-wide: Alt+Shift+S snap, C cinema, M cash rain, F facepalm.
- F12 opens developer tools if something looks wrong.
- Output size (640×360 / 960×540 / 1280×720) is in the bottom bar. Use a smaller size on slow PCs.
- Everything runs locally; the mic is only analysed on your PC for the snap sound.
- Some apps (banking/ID-verification) refuse virtual cameras.

## Run from source (optional)
`pip install pyvirtualcam numpy` then `npm install` and `npm start`.
