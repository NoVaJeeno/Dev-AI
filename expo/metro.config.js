const { getDefaultConfig } = require("expo/metro-config");
const { withRorkMetro } = require("@rork-ai/toolkit-sdk/metro");

// Apply the Rork configuration first: it rebuilds Metro's resolver.
const config = withRorkMetro(getDefaultConfig(__dirname));

// AI SDK's ESM entry contains a runtime dynamic import (`import(id)`) that
// Metro cannot statically bundle for Expo web. Set this after withRorkMetro
// so the wrapper cannot overwrite the resolver configuration.
config.resolver.unstable_enablePackageExports = false;

module.exports = config;
