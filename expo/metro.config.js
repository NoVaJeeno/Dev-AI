const { getDefaultConfig } = require("expo/metro-config");
const { withRorkMetro } = require("@rork-ai/toolkit-sdk/metro");

const config = getDefaultConfig(__dirname);

// AI SDK's ESM entry contains a runtime dynamic import (`import(id)`) that
// Metro cannot statically bundle for Expo web. Disable package exports so
// Metro resolves the compatible CommonJS entry instead.
config.resolver.unstable_enablePackageExports = false;

module.exports = withRorkMetro(config);
