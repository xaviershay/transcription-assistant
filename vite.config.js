import { defineConfig } from 'vite'

export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/transcription-assistant/' : '/',
  test: {
    environment: 'node',
  },
}))
