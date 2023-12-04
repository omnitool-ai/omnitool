import simpleGit from 'simple-git';
import fs from 'node:fs';
import yaml from 'js-yaml';
import path from 'node:path';
import { compareVersions } from 'compare-versions';

interface IExtensionYaml {
  title: string;
  version?: string;
  minSDKVersion?: string;
  description: string;
  author: string;
  origin?: string;
  client?: {
    addToWorkbench?: boolean;
    minimizeChat?: boolean;
  };
}

interface ExtensionMinSDKVersionChange {
  commit_hash: string;
  old_version: string | null;
  new_version: string;
}

interface ExtensionUpdateStatus {
  latestHash: string;
  currentHash: string;
  didUpdate: boolean;
}

interface IKnownExtensionsManifestEntry {
  title: string;
  id: string;
  url: string;
  deprecated?: boolean;
  installed?: boolean;
  isCore?: boolean;
  isLocal?: boolean;
  error?: string;
  manifest?: IExtensionYaml;
}

interface IKnownExtensionsManifest {
  core_extensions?: IKnownExtensionsManifestEntry[];
  known_extensions?: IKnownExtensionsManifestEntry[];
  community_known_extensions_url?: string;
}

async function revParseShort(localPath: string, rev: string): Promise<string> {
  return await simpleGit(localPath).revparse(['--short', rev]);
}

async function resetToLatestCompatibleCommit(
  extensionId: string,
  manifest: IExtensionYaml,
  localPath: string,
  sdkVersion: string
): Promise<ExtensionUpdateStatus> {
  // order by oldest to newest
  const commits = (await getRemoteMinSDKVersions(localPath)).reverse();
  const currentHash = await revParseShort(localPath, 'HEAD');
  const latestHash = await revParseShort(localPath, 'origin/main');

  // we go backwards until either we find a commit that satisfies the minSDKVersion
  // flip the order
  for (const commit of commits) {
    console.info(`Checking commit ${commit.commit_hash} at old_version ${commit.old_version}`);
    // first v commit will be null, we'll use that too as the last compatible commit
    if (commit.old_version === null || compareVersions(sdkVersion, commit.old_version) >= 0) {
      const targetHash = await revParseShort(localPath, `${commit.commit_hash}~1`);
      if (currentHash === targetHash) {
        // nothing to do
        return { latestHash, currentHash, didUpdate: false };
      }
      omnilog.info(`Found compatible commit ${targetHash} for extension ${manifest.title}`);
      // roll back in history to the last compatible commit
      void (await simpleGit(localPath).reset(['--hard', `${commit.commit_hash}~1`]));
      const newHash = await revParseShort(localPath, 'HEAD');
      omnilog.status_success(`${extensionId} pinned to commit ${newHash}`);
      return { latestHash, currentHash: newHash, didUpdate: true };
    }
  }

  omnilog.warn(`Unable to find a compatible commit for extension ${manifest.title} 
  with minSDKVersion ${manifest.minSDKVersion} and server version ${sdkVersion}. Defaulting to latest commit.`);
  const pullResult = await simpleGit(localPath).pull();

  if (pullResult.summary.changes === 0) {
    return { latestHash, currentHash, didUpdate: false };
  } else {
    const newHash = await revParseShort(localPath, 'HEAD');
    return { latestHash, currentHash: newHash, didUpdate: true };
  }
}

async function getRemoteMinSDKVersions(cwd: string): Promise<Array<ExtensionMinSDKVersionChange>> {
  const git = simpleGit(cwd);
  await git.fetch('origin');
  // Get the list of all commits for 'extension.yaml', from newest to oldest
  const logs = await git.log(['origin/main', '--', 'extension.yaml']);
  // @ts-ignore
  const commits = logs.all.reverse(); // Reverse to start from the oldest

  let lastVersion = null;
  const minSDKVersionChanges = [];

  for (const commit of commits) {
    // Get the content of 'extension.yaml' for the specific commit
    const content = await git.show([`${commit.hash}:extension.yaml`]);
    const match = content.match(/minSDKVersion:\s*([0-9.]+)/);

    if (match) {
      const currentVersion = match[1];

      if (currentVersion !== lastVersion) {
        // Version changed, record this commit
        minSDKVersionChanges.push({
          commit_hash: commit.hash,
          old_version: lastVersion,
          new_version: currentVersion
        });
        lastVersion = currentVersion;
      }
    }
  }
  omnilog.info(minSDKVersionChanges);
  return minSDKVersionChanges;
}

function serverSatisfyMinSDKRequirements(manifest: IExtensionYaml, sdkVersion: string): boolean {
  if (!manifest.minSDKVersion) {
    return true;
  }
  omnilog.info(`Checking if server ${sdkVersion} satisfies minSDKVersion ${manifest.minSDKVersion}`);
  return compareVersions(sdkVersion, manifest.minSDKVersion) >= 0;
}

async function installExtension(
  extensionId: string,
  manifest: IExtensionYaml,
  localPath: string,
  sdkVersion: string
): Promise<void> {
  if (!manifest?.origin?.endsWith('.git')) {
    throw new Error('Manifest does not have a valid origin repository.');
  }
  // we clone regardless of whether the server can satisfy the minSDKVersion
  // to get a local copy of the extension
  void (await simpleGit().clone(manifest.origin, localPath));
  // reconcile to the minSDKVersion
  if (!serverSatisfyMinSDKRequirements(manifest, sdkVersion)) {
    omnilog.info(
      `Finding older extensions versions as the required ${manifest.minSDKVersion} is too new for server ${sdkVersion}`
    );
    const changes = await resetToLatestCompatibleCommit(extensionId, manifest, localPath, sdkVersion);
    omnilog.status_success(`${extensionId} pinned to commit ${changes.currentHash}`);
  }
}

async function updateToLatestCompatibleVersion(
  extensionId: string,
  manifest: IExtensionYaml,
  localPath: string,
  sdkVersion: string
): Promise<ExtensionUpdateStatus> {
  // reconcile to the minSDKVersion
  if (!serverSatisfyMinSDKRequirements(manifest, sdkVersion)) {
    omnilog.info(
      `Finding older extensions versions as the required ${manifest.minSDKVersion} is too new for server ${sdkVersion}`
    );
    return await resetToLatestCompatibleCommit(extensionId, manifest, localPath, sdkVersion);
  } else {
    const result = await simpleGit(localPath).pull();
    const newHash = await revParseShort(localPath, 'HEAD');
    return { latestHash: newHash, currentHash: newHash, didUpdate: result.summary.changes > 0 };
  }
}

async function validateLocalChanges(extensionBaseDir: string, extension: string): Promise<boolean> {
  // ensure critical paths can be reached on submit
  const extensionDir = path.join(extensionBaseDir, extension);
  const manifestFile = path.join(extensionDir, 'extension.yaml');
  if (!fs.existsSync(manifestFile)) {
    omnilog.error(
      `Validation error: Unable to find manifest file for extension ${extension} at ${manifestFile}. Please check your changes.`
    );
    return false;
  }
  // ensure url is valid
  const extensionYaml: any = await yaml.load(fs.readFileSync(manifestFile, 'utf-8'));
  if (!extensionYaml?.origin?.endsWith('.git')) {
    omnilog.error(
      `Validation error: Manifest does not have a valid origin repository for extension ${extension}. Please check your changes.`
    );
    return false;
  }
  const remoteManifestFile = await fetch(extensionYaml.origin);
  if (!remoteManifestFile.ok) {
    omnilog.error(
      `Validation error: Checking ${manifestFile}.\nUnable to connect to repo for origin ${extensionYaml.origin}.\nPlease check your changes.`
    );
    return false;
  }
  return true;
}

let remoteYamlCache: string | null = null;

async function loadCombinedManifest(knownExtensionsPath: string): Promise<IKnownExtensionsManifest> {
  const manifest = (await yaml.load(fs.readFileSync(knownExtensionsPath, 'utf-8'))) as IKnownExtensionsManifest;
  if (manifest.community_known_extensions_url === undefined) {
    return manifest;
  }
  try {
    if (remoteYamlCache === null) {
      omnilog.info(`Loading remote community extensions manifest from ${manifest.community_known_extensions_url}`);
      remoteYamlCache = await (await fetch(manifest.community_known_extensions_url)).text();
      const remoteYaml = (await yaml.load(remoteYamlCache)) as IKnownExtensionsManifest;
      remoteYaml.known_extensions = remoteYaml.known_extensions ?? [];
      omnilog.status_success(
        `Found ${remoteYaml.known_extensions.length} community extensions. Merging into manifest.`
      );
    }
    const remoteYaml = (await yaml.load(remoteYamlCache)) as IKnownExtensionsManifest;
    manifest.known_extensions = manifest.known_extensions ?? [];
    remoteYaml.known_extensions = remoteYaml.known_extensions ?? [];
    manifest.known_extensions = manifest.known_extensions.concat(remoteYaml.known_extensions);
  } catch (e) {
    // not fatal so we continue
    omnilog.warn(
      `Unable to load remote community extensions manifest from ${manifest.community_known_extensions_url}. With error ${e}!`
    );
  }
  return manifest;
}

const ExtensionUtils = {
  getRemoteMinSDKVersions,
  validateLocalChanges,
  installExtension,
  updateToLatestCompatibleVersion,
  loadCombinedManifest
};

export { ExtensionUtils, type IExtensionYaml, type IKnownExtensionsManifest, type IKnownExtensionsManifestEntry };
