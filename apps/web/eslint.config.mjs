import nextConfig from "eslint-config-next/core-web-vitals";

const config = [
  ...nextConfig,
  // Overleaf's own files that the app changes, kept as upstream wrote them so
  // they still diff cleanly against the submodule. The host glue (ol-host,
  // ol-shims) is ours and stays linted.
  {
    ignores: ["src/features/report/ol-host/overrides/**"],
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
