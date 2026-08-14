#!/usr/bin/env node
/* eslint-disable no-undef */
/* eslint-env node */
/* eslint-disable @typescript-eslint/no-require-imports */

/**
 * Test setup script for Tagify Smart Playlist testing
 * Run with: node scripts/setup-tests.js
 */

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

console.log("🚀 Setting up Tagify Smart Playlist test suite...\n");

// Check if we're in the right directory
const packageJsonPath = path.join(process.cwd(), "package.json");
if (!fs.existsSync(packageJsonPath)) {
  console.error("❌ Error: package.json not found. Please run this script from your project root.");
  process.exit(1);
}

// Check for required dependencies
const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
const requiredDeps = [
  "vitest",
  "@vitest/ui",
  "jsdom",
  "@testing-library/react",
  "@testing-library/jest-dom",
  "@testing-library/user-event",
];

const missingDeps = requiredDeps.filter(
  (dep) => !packageJson.devDependencies?.[dep] && !packageJson.dependencies?.[dep]
);

if (missingDeps.length > 0) {
  console.log("📦 Installing missing test dependencies...");
  try {
    execSync(`npm install -D ${missingDeps.join(" ")}`, { stdio: "inherit" });
    console.log("✅ Dependencies installed successfully\n");
  } catch (error) {
    console.error("❌ Failed to install dependencies:", error.message);
    process.exit(1);
  }
}

// Create test directory structure
const testDirs = [
  "src/tests",
  "src/tests/components",
  "src/tests/hooks",
  "src/tests/services",
  "src/tests/integration",
  "src/tests/performance",
  "src/tests/edge-cases",
  "src/tests/utils",
];

console.log("📁 Creating test directory structure...");
testDirs.forEach((dir) => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    console.log(`   Created: ${dir}`);
  } else {
    console.log(`   Exists: ${dir}`);
  }
});

// Update package.json with test scripts
console.log("\n📝 Updating package.json scripts...");
const updatedPackageJson = {
  ...packageJson,
  scripts: {
    ...packageJson.scripts,
    test: "vitest",
    "test:ui": "vitest --ui",
    "test:run": "vitest run",
    "test:coverage": "vitest run --coverage",
    "test:watch": "vitest --watch",
    "test:smart-playlist": "vitest run src/test/hooks/useTagData.test.ts",
    "test:components": "vitest run src/test/components/",
    "test:services": "vitest run src/test/services/",
  },
};

fs.writeFileSync(packageJsonPath, JSON.stringify(updatedPackageJson, null, 2));
console.log("✅ Package.json updated with test scripts");

// Create .gitignore entries for test coverage
const gitignorePath = path.join(process.cwd(), ".gitignore");
let gitignoreContent = "";

if (fs.existsSync(gitignorePath)) {
  gitignoreContent = fs.readFileSync(gitignorePath, "utf8");
}

const testEntries = ["# Test coverage", "coverage/", "*.lcov", ".vitest/"];

const missingEntries = testEntries.filter((entry) => !gitignoreContent.includes(entry));

if (missingEntries.length > 0) {
  console.log("\n📄 Updating .gitignore...");
  const newContent = gitignoreContent + "\n\n" + missingEntries.join("\n") + "\n";
  fs.writeFileSync(gitignorePath, newContent);
  console.log("✅ .gitignore updated");
}

// Create VS Code launch configuration for debugging
// eslint-disable-next-line no-undef
const vscodeDir = path.join(process.cwd(), ".vscode");
const launchJsonPath = path.join(vscodeDir, "launch.json");

if (!fs.existsSync(vscodeDir)) {
  fs.mkdirSync(vscodeDir);
}

if (!fs.existsSync(launchJsonPath)) {
  console.log("\n🔧 Creating VS Code debug configuration...");
  const launchConfig = {
    version: "0.2.0",
    configurations: [
      {
        name: "Debug Vitest Tests",
        type: "node",
        request: "launch",
        program: "${workspaceFolder}/node_modules/vitest/vitest.mjs",
        args: ["run", "--reporter=verbose"],
        console: "integratedTerminal",
        internalConsoleOptions: "neverOpen",
      },
    ],
  };

  fs.writeFileSync(launchJsonPath, JSON.stringify(launchConfig, null, 2));
  console.log("✅ VS Code debug configuration created");
}

// Check if vitest.config.ts exists
const vitestConfigPath = path.join(process.cwd(), "vitest.config.ts");
if (!fs.existsSync(vitestConfigPath)) {
  console.log("\n⚠️  Warning: vitest.config.ts not found.");
  console.log("   Please create this file using the provided configuration.");
}

// Check if test setup file exists
const setupPath = path.join(process.cwd(), "src/test/setup.ts");
if (!fs.existsSync(setupPath)) {
  console.log("\n⚠️  Warning: src/test/setup.ts not found.");
  console.log("   Please create this file using the provided setup configuration.");
}

// Run initial test to verify setup
console.log("\n🧪 Testing setup...");
try {
  // Create a simple test file to verify everything works
  const simpleTestPath = path.join(process.cwd(), "src/test/setup-verification.test.ts");
  const simpleTestContent = `import { describe, it, expect } from 'vitest'

describe('Test Setup Verification', () => {
  it('should verify Vitest is working', () => {
    expect(true).toBe(true)
  })

  it('should verify mocks are available', () => {
    expect(global.Spicetify).toBeDefined()
    expect(localStorage).toBeDefined()
  })
})
`;

  fs.writeFileSync(simpleTestPath, simpleTestContent);

  // Try to run the verification test
  execSync("npm run test:run setup-verification.test.ts", { stdio: "pipe" });

  // Clean up verification test
  fs.unlinkSync(simpleTestPath);

  console.log("✅ Test setup verification passed!");
} catch (error) {
  console.log("⚠️  Test verification failed, but setup is complete.");
  console.log("   You may need to create the configuration files manually.");
}

console.log("\n🎉 Test setup complete! Here's what you can do next:\n");
console.log("📋 Next Steps:");
console.log("   1. Create vitest.config.ts (configuration provided)");
console.log("   2. Create src/test/setup.ts (setup file provided)");
console.log("   3. Add test files using the provided examples");
console.log("   4. Run tests with: npm run test");
console.log("   5. View coverage with: npm run test:coverage");
console.log("   6. Use test UI with: npm run test:ui");

console.log("\n📚 Available test commands:");
Object.entries(updatedPackageJson.scripts)
  .filter(([key]) => key.startsWith("test"))
  .forEach(([key, value]) => {
    console.log(`   npm run ${key.padEnd(20)} - ${value}`);
  });

console.log("\n📖 See src/test/README.md for detailed testing documentation");
console.log("\n🚀 Happy testing!");
