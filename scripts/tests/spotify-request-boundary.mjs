import ts from 'typescript';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

// These transports call Tagify/GitHub/PostHog, not Spotify. New raw fetch sites require review.
const otherFetchFiles = new Set([
  'src/services/VersionCheckerService.ts', 'src/services/sync/SyncRuntime.ts',
  'src/services/sync/SyncPairingService.ts', 'src/services/sync/SyncInstallRecovery.ts',
  'src/services/sync/PrivateNotes.ts', 'src/features/discovery-survey/services/tagifyUsage.ts',
  'src/features/onboarding/services/promptHistory.ts', 'src/features/community/communityDevice.ts',
  'src/features/community/communityEntityCache.ts', 'src/features/community-updates/communityUpdateService.ts',
  'src/features/update-check/components/UpdateBanner.tsx',
  'src/features/product-analytics/productAnalytics.ts',
]);
const sdk = /\b(?:PlaylistAPI|RootlistAPI|LibraryAPI|CosmosAsync|GraphQL)\b/;
const wrappers = new Set(['spotifyRead', 'spotifyWrite']);
export function findViolations(source, filename) {
  const file = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true, filename.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const aliases = new Set();
  const walk = (node, visit) => { visit(node); ts.forEachChild(node, child => walk(child, visit)); };
  const unwrap = node => {
    if (ts.isAsExpression(node) || ts.isParenthesizedExpression(node) || ts.isNonNullExpression(node)) return unwrap(node.expression);
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken) return unwrap(node.left);
    return node;
  };
  const names = name => ts.isIdentifier(name) ? [name.text] : ts.isObjectBindingPattern(name) || ts.isArrayBindingPattern(name) ? name.elements.flatMap(element => ts.isBindingElement(element) ? names(element.name) : []) : [];
  for (let pass = 0; pass < 3; pass++) walk(file, node => {
    if (!ts.isVariableDeclaration(node) || !node.initializer) return;
    const value = unwrap(node.initializer);
    if (!ts.isPropertyAccessExpression(value) && !ts.isIdentifier(value)) return;
    const text = value.getText(file);
    if (sdk.test(text) || [...aliases].some(alias => new RegExp(`^${alias}(?:\\.|\\[|$)`).test(text))) names(node.name).forEach(name => aliases.add(name));
  });
  const ancestors = node => { const result = []; for (let parent = node.parent; parent; parent = parent.parent) result.push(parent); return result; };
  const failures = [];
  let fetchCount = 0;
  const fetchLimit = filename.endsWith("/SyncRuntime.ts") ? 10 : filename.endsWith("/communityDevice.ts") ? 3 : /\/(?:PrivateNotes|SyncPairingService)\.ts$/.test(filename) ? 2 : 1;
  walk(file, node => {
    if (!ts.isCallExpression(node)) return;
    const callee = node.expression.getText(file);
    if (ts.isPropertyAccessExpression(node.expression) && ts.isArrayLiteralExpression(unwrap(node.expression.expression))) return;
    // Mentioning an SDK name in a diagnostic validation regex is not a request.
    if (ts.isPropertyAccessExpression(node.expression) && ts.isRegularExpressionLiteral(unwrap(node.expression.expression)) && /^(test|exec)$/.test(node.expression.name.text)) return;
    const parents = ancestors(node);
    const wrapped = parents.some(parent => ts.isCallExpression(parent) && wrappers.has(parent.expression.getText(file)));
    let forbidden = false;
    if (/^(?:globalThis\.|window\.)?fetch$/.test(callee)) {
      const central = filename === 'src/services/SpotifyRequests.ts' && parents.some(parent => ts.isFunctionDeclaration(parent) && parent.name?.text === 'spotifyFetch');
      forbidden = !central && (++fetchCount > fetchLimit || !otherFetchFiles.has(filename) || /https?:\/\/(?:api\.spotify\.com|spclient[^/]*\.spotify\.com)/.test(source));
    } else if (sdk.test(callee) || [...aliases].some(alias => new RegExp(`^${alias}(?:\\.|\\[|$)`).test(callee))) {
      const binding = /\.(?:bind|isReady)$/.test(callee);
      const resolver = filename === 'src/services/spicetifyGraphQL.ts' && parents.some(parent => ts.isFunctionDeclaration(parent) && parent.name?.text === 'getGraphQLRequestFunction');
      // This hook forwards Spotify's own user action; only Tagify's follow-up uses our scheduler.
      const userAction = filename === 'src/services/SmartPlaylistSyncService.ts' && callee === 'originalAdd.apply';
      forbidden = !wrapped && !binding && !resolver && !userAction;
    }
    if (forbidden) failures.push(`${filename}:${file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1}: ${callee}`);
  });
  return failures;
}
export function scan(root) {
  const failures = [];
  const visit = dir => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === '__tests__' || entry.name === 'tests' || entry.name === 'types') continue;
      const path = resolve(dir, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (/\.[jt]sx?$/.test(entry.name)) failures.push(...findViolations(readFileSync(path, 'utf8'), relative(root, path)));
    }
  };
  visit(resolve(root, 'src')); return failures;
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const failures = scan(resolve(fileURLToPath(new URL('../..', import.meta.url))));
  if (failures.length) { console.error(failures.join('\n')); process.exitCode = 1; }
  else console.log('Spotify request boundaries passed');
}
