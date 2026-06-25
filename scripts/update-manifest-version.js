const fs = require("fs");
const path = require("path");

const version = process.argv[2];
if (!version) {
  console.error("Error: No version provided.");
  process.exit(1);
}

// Clean version string: remove any leading 'v' if present (e.g., v1.0.0 -> 1.0.0)
const cleanVersion = version.startsWith("v") ? version.slice(1) : version;

const manifestPath = path.resolve(__dirname, "../manifest.json");

try {
  const manifestRaw = fs.readFileSync(manifestPath, "utf8");
  const manifest = JSON.parse(manifestRaw);

  manifest.version = cleanVersion;

  fs.writeFileSync(
    manifestPath,
    JSON.stringify(manifest, null, 2) + "\n",
    "utf8",
  );
  console.log(
    `✓ Successfully updated manifest.json version to ${cleanVersion}`,
  );
} catch (error) {
  console.error("Error updating manifest.json version:", error);
  process.exit(1);
}
