# Squadron Duty Scheduler (Mobile App)

An offline, single-user Expo (React Native) app for scheduling squadron duties.
All data is stored locally on the device — no backend or account required.

## Tech
- Expo SDK 54 / React Native 0.81
- expo-router (typed routes), React 19, React Compiler
- Local persistence via AsyncStorage

## Develop
```bash
npm install
npm start        # Expo dev server
npm run android  # open on Android
npm run ios      # open on iOS (requires macOS)
npm test         # run unit tests
```

## Build installable binaries (EAS)
```bash
# Android APK (installable directly on device)
npx eas-cli build -p android --profile preview

# Production app bundle (Play Store)
npx eas-cli build -p android --profile production
```
