import test from 'node:test';
import assert from 'node:assert/strict';
import { assertAngularQualificationTarget } from '../../scripts/angular-qualification-target.ts';

test('qualification rejects Angular bundles that could reach an interactive or unknown gateway', () => {
  const selected = 'http://localhost:34000';
  assert.doesNotThrow(() => assertAngularQualificationTarget('var settings={gatewayUrl:"http://localhost:34000"};', selected, 30000));
  for (const bundle of [
    'var settings={gatewayUrl:"http://localhost:4000"};',
    'var settings={gatewayUrl:"http://localhost:34000",other:{gatewayUrl:"http://localhost:4000"}};',
    'var settings={};',
  ]) assert.throws(() => assertAngularQualificationTarget(bundle, selected, 30000), /Angular qualification build/);
  assert.throws(() => assertAngularQualificationTarget('var settings={gatewayUrl:"http://localhost:4000"};', 'http://localhost:4000', 30000), /Angular qualification build/);
  assert.doesNotThrow(() => assertAngularQualificationTarget('var settings={gatewayUrl:"http://localhost:4000"};', 'http://localhost:4000', 0));
});
