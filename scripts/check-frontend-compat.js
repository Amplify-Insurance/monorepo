const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

function compile() {
  try {
    execSync('npx hardhat compile', { stdio: 'inherit' });
  } catch (err) {
    console.error('Failed to compile contracts');
    process.exit(1);
  }
}

function checkAbis() {
  const root = path.resolve(__dirname, '..');
  const abiDir = path.join(root, 'frontend', 'abi');
  const artifactsDir = path.join(root, 'artifacts');

  const files = fs.readdirSync(abiDir).filter(f => f.endsWith('.json'));
  let mismatched = false;

  for (const file of files) {
    const abiPath = path.join(abiDir, file);
    const abiJson = JSON.parse(fs.readFileSync(abiPath, 'utf8'));
    const src = abiJson.sourceName; // e.g. contracts/core/PolicyManager.sol
    const contract = abiJson.contractName; // e.g. PolicyManager
    const artifactPath = path.join(artifactsDir, src, `${contract}.json`);
    if (!fs.existsSync(artifactPath)) {
      console.error(`Artifact not found for ${contract} at ${artifactPath}`);
      mismatched = true;
      continue;
    }
    const artJson = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
    if (JSON.stringify(artJson.abi) !== JSON.stringify(abiJson.abi)) {
      console.error(`ABI mismatch for ${contract}`);
      mismatched = true;
    }
  }

  if (mismatched) {
    console.error('Frontend ABI files are out of sync with compiled artifacts.');
    process.exit(1);
  } else {
    console.log('Frontend ABI files match compiled contract artifacts.');
  }
}

compile();
checkAbis();

