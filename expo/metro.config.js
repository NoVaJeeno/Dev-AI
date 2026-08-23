const path = require("path");
const { getDefaultConfig } = require("expo/metro-config");
const { withRorkMetro } = require("@rork-ai/toolkit-sdk/metro");

const config = withRorkMetro(getDefaultConfig(__dirname));
const defaultResolveRequest = config.resolver.resolveRequest;

// @ai-sdk/provider-utils uses a runtime dynamic import (`import(id)`) which
// Metro cannot bundle for web. Keep the native Rork SDK, but use a browser
// adapter for Expo web so the unsupported dependency is not added to the bundle.
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (platform === "web" && moduleName === "@rork-ai/toolkit-sdk") {
    return {
      type: "sourceFile",
      filePath: path.resolve(__dirname, "utils/rork-web-shim.ts"),
    };
  }

  if (defaultResolveRequest) {
    return defaultResolveRequest(context, moduleName, platform);
  }

  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
