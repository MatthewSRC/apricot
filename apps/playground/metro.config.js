const { getDefaultConfig } = require("expo/metro-config");
const { withApricot } = require("@apricotjs/metro");

module.exports = withApricot(getDefaultConfig(__dirname));
