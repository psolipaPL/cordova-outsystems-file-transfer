# Wrapper for Outsystems File Transfer Plugin

This a simple wrapper of the File Transfer Plugin, either cordova or capacitor. Handling of PWA is outside the scope of this component.

Currently, it is being used by the OutSystems OML/OAP assets.

## Outsystems' Usage

1. Run npm build
```console
npm run build
```
2. Copy the resulting `./dist/outsystems.js` file to the plugin's scripts folder
3. Call the `RequireScript` client action, with the script's url
4. Call `OSFileTransferWrapper.Instance.<method>` 