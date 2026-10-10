// Next's own defaults (a config file replaces them), then the `:is()` split last, on the final selectors.
module.exports = {
  plugins: [
    "next/dist/compiled/postcss-flexbugs-fixes",
    [
      "next/dist/compiled/postcss-preset-env",
      {
        browsers: require("next/dist/shared/lib/modern-browserslist-target.js"),
        autoprefixer: { flexbox: "no-2009" },
        stage: 3,
        features: { "custom-properties": false },
      },
    ],
    require.resolve("./src/app/styles/postcss-expand-is.cjs"),
  ],
};
