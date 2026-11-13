import nextConfig from "eslint-config-next/core-web-vitals";

const config = [
  ...nextConfig,
  // Overleaf's own source, vendored as upstream wrote it. The host glue
  // (ol-host, ol-shims) is ours and stays linted.
  {
    ignores: ["app", "codemirror", "frontend", "libraries", "types"].map(
      (dir) => `src/features/report/vendor/overleaf/${dir}/**`,
    ),
  },
  {
    plugins: nextConfig[0].plugins,
    rules: {
      "react-hooks/exhaustive-deps": "error",
      "react-hooks/set-state-in-effect": "off",
      "react-hooks/refs": "off",
      "react-hooks/preserve-manual-memoization": "warn",
      "react-hooks/purity": "warn",
      "react-hooks/immutability": "warn",
      "react-hooks/use-memo": "warn",
    },
  },
];

export default config;
