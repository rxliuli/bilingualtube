import { defineConfig, UserManifest } from 'wxt'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  modules: ['@wxt-dev/module-react', 'wxt-module-safari-xcode'],
  safariXcode: {
    projectName: 'BilingualTube',
    appCategory: 'public.app-category.productivity',
    bundleIdentifier: 'com.rxliuli.bilingualtube',
    developmentTeam: 'N2X78TUUFG',
    projectType: 'macos',
  },
  vite: () => ({
    plugins: [
      tailwindcss(),
      {
        name: 'skip-wasm-inline',
        transform(code: string) {
          if (!code.includes('ort-wasm-simd-threaded.wasm')) return
          return code.replace(
            /new URL\("ort-wasm-simd-threaded\.wasm",\s*import\.meta\.url\)/g,
            '({href:""})',
          )
        },
      },
    ] as any,
    resolve: {
      alias: {
        '@': __dirname,
      },
    },
    // build: {
    //   minify: false,
    //   sourcemap: true,
    // },
  }),
  manifestVersion: 3,
  manifest: (env) => {
    const manifest: UserManifest = {
      name: 'BilingualTube',
      description:
        'Watch YouTube with bilingual subtitles for language learning and comprehension.',
      permissions: ['storage'],
      host_permissions: ['<all_urls>'],
      author: {
        email: 'rxliuli@gmail.com',
      },
      action: {},
      homepage_url: 'https://rxliuli.com/project/bilingualtube/',
      web_accessible_resources: [
        {
          resources: [
            '/onnxruntime-web/ort-wasm-simd-threaded.wasm',
            '/sherpa-onnx-online-punct-en-2024-08-06/bpe.vocab',
            '/sherpa-onnx-online-punct-en-2024-08-06/model.int8.onnx',
          ],
          matches: ['https://www.youtube.com/*'],
        },
      ],
    }
    if (env.browser === 'firefox') {
      manifest.browser_specific_settings = {
        gecko: {
          id:
            manifest.name!.toLowerCase().replaceAll(/[^a-z0-9]/g, '-') +
            '@rxliuli.com',
          data_collection_permissions: {
            required: ['none'],
          },
        },
      }
      // https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/author
      // @ts-expect-error
      manifest.author = 'rxliuli'
    }
    return manifest
  },
  webExt: {
    disabled: true,
  },
})
