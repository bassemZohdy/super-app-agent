import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SUPPORTED_COMPONENT_TYPES } from '../../packages/protocol-core/src/ag-ui.ts';

// P1-12: the protocol advertises a fixed set of component types, and the gateway only sends those. Each shell must draw every one of
// them, and must say so out loud (not draw nothing) for a type it does not know, so a component added to the protocol cannot reach a
// resident as a blank gap in one shell. The Flutter list sent in the handshake is generated from the same source.
const shells = [
  { name: 'React', file: 'apps/shell-react/src/components/A2UIRenderer.tsx', handles: (type: string) => new RegExp(`case '${type}':`), fallback: /Unsupported component: \{node\.type\}/ },
  { name: 'Angular', file: 'apps/shell-angular/src/app/surface-node.component.ts', handles: (type: string) => new RegExp(`ngSwitchCase="'${type}'"`), fallback: /ngSwitchDefault[^>]*>Unsupported component: \{\{ node\.type \}\}/ },
  { name: 'Flutter', file: 'apps/shell-flutter/lib/main.dart', handles: (type: string) => new RegExp(`case '${type}':`), fallback: /Unsupported component: \$\{node\['type'\]\}/ },
] as const;

for (const shell of shells) {
  test(`P1-12: the ${shell.name} renderer draws every advertised component type and names an unknown one`, () => {
    const source = readFileSync(shell.file, 'utf8');
    const missing = SUPPORTED_COMPONENT_TYPES.filter(type => !shell.handles(type).test(source));
    assert.deepEqual(missing, [], `${shell.name} has no renderer for: ${missing.join(', ')}`);
    assert.match(source, shell.fallback, `${shell.name} says "Unsupported component" for a type it does not know`);
  });
}

test('P1-12: the component list the Flutter shell advertises is the protocol list', () => {
  const generated = readFileSync('apps/shell-flutter/lib/shared/contracts.g.dart', 'utf8');
  const advertised = /supportedComponentTypes = <String>\[([^\]]*)\]/.exec(generated)?.[1].match(/"([A-Za-z]+)"/g)?.map(item => item.replaceAll('"', ''));
  assert.deepEqual(advertised, [...SUPPORTED_COMPONENT_TYPES], 'the handshake lists exactly the protocol component types, in order');
});
