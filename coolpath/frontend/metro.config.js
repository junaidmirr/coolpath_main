const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// Exclude non-mobile paths and deeply nested node_modules from Metro file watcher
config.resolver.blockList = [
  /coolpath\/backend\/.*/,
  /data\/cache\/.*/,
  /\.git\/.*/,
  /node_modules\/.*\/node_modules\/.*/
];

module.exports = config;
