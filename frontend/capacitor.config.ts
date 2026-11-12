import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'com.ninedrive.app',
  appName: '9Drive',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
  },
  android: {
    // Self-hosted 9Drive servers are commonly reached over plain HTTP on a LAN.
    allowMixedContent: true,
  },
}

export default config
