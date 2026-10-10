import test from 'node:test';import assert from 'node:assert/strict';
import {passwordStrength,validEmail} from '../lib/account-validation.ts';
import {safeDestination} from '../lib/orin-routes.ts';
test('password feedback and email validation cover short passwords and invalid addresses',()=>{assert.equal(passwordStrength(''),0);assert.equal(passwordStrength('abc'),0);assert.equal(passwordStrength('unique-Phrase-937'),4);assert.equal(validEmail(' member@example.com '),true);assert.equal(validEmail('bad@'),false)});
test('app routes accept the release sections and reject external or script redirects',()=>{for(const route of ['/settings/data','/admin/users','/admin/requests','/admin/content','/account/security','/terms'])assert.equal(safeDestination(route),route);for(const route of ['https://evil.test','//evil.test','javascript:alert(1)','/admin/../private','/%2Fexample.com'])assert.equal(safeDestination(route),'/notifications')});
