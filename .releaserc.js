module.exports = {
  branches: ["main"],
  plugins: [
    [
      "semantic-release-gitmoji",
      {
        releaseRules: {
          major: [":boom:"],
          minor: [":sparkles:"],
          patch: [":bug:", ":ambulance:", ":lock:", ":recycle:"],
        },
      },
    ],
    [
      "@semantic-release/exec",
      {
        prepareCmd:
          "node scripts/update-manifest-version.js ${nextRelease.version} && task build",
      },
    ],
    [
      "@semantic-release/git",
      {
        assets: ["manifest.json"],
        message:
          "🔖 (release): bump version to ${nextRelease.version} [skip ci]",
      },
    ],
    [
      "@semantic-release/github",
      {
        assets: [
          {
            path: "dataprime-extension.zip",
            label: "DataPrime Extension v${nextRelease.version}",
          },
        ],
      },
    ],
  ],
};
