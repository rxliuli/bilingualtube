# BilingualTube

A browser extension that adds bilingual subtitles to YouTube videos. Displays original and translated subtitles simultaneously, or uses official YouTube translations when available.

## Features

- **Bilingual Subtitles**: Shows original and translated text together
- **Official Translation Priority**: Uses YouTube's official translations when available
- **API Translation Fallback**: Supports Microsoft Translator and OpenAI for videos without official translations
- **Cross-browser Support**: Works on Chrome, Edge, Firefox, and Safari

## Installation

Install from your browser's extension store:

- [Chrome / Edge](https://chromewebstore.google.com/detail/bilingualtube/ombapcolopdeailifakdgaijhoncgpgn)
- [Firefox](https://addons.mozilla.org/firefox/addon/bilingualtube/)
- [Safari](https://apps.apple.com/app/id6757694666)

Or build from source:

```sh
git clone https://github.com/rxliuli/bilingual-tube.git
cd bilingual-tube
pnpm install
pnpm build
```

Load the extension from `.output/chrome-mv3` (Chrome/Edge) or `.output/firefox-mv3` (Firefox).

## Configuration

Open the extension options page to configure:

- **Target Language**: Select your preferred translation language
- **Translation Engine**: Choose between Microsoft (default, no API key required) or OpenAI
- **OpenAI Settings**: Configure API key, model, base URL, and custom prompts (when using OpenAI)

## Development

Start the development server:

```sh
pnpm dev
```

This creates a development build in `.output/chrome-mv3-dev`. Load it in Chrome via `chrome://extensions` with Developer mode enabled.

## Building

### Chrome, Edge, and Firefox

```sh
pnpm zip && pnpm zip:firefox
```

### Safari

Requires macOS and Xcode:

1. Update `developmentTeam` in [wxt.config.ts](wxt.config.ts) with your Apple Developer Team ID
2. Run `pnpm build:safari`
3. Build and test in Xcode

## License

GPL-3.0
