// lib/nameGuard.js: the display-name guard.
// SHAPE_SAMPLES holds one sample per SECRET_SHAPE_PATTERNS name in lib/nameGuard.js; the rows here read nothing
// outside the product.
import {test, assertEqual} from './harness.js';
// The member names are read through the namespace, so a missing export fails its row rather than the whole run.
import * as nameGuard from '../extensions/resource-pulse@zvibaratz.github.io/lib/nameGuard.js';

const REDACTED = '—';

// One synthetic string per shape, built at runtime from made-up characters so no token-shaped literal is committed.
const SHAPE_SAMPLES = {
    'github-token': 'ghp_' + 'A1'.repeat(18),
    'github-pat': 'github_pat_' + 'B2'.repeat(15),
    'anthropic-key': 'sk-ant-' + 'c3'.repeat(15),
    'slack-token': 'xoxb-' + '1234'.repeat(3),
    'aws-access-key-id': 'AKIA' + 'Q7'.repeat(8),
    'aws-temp-key-id': 'ASIA' + 'Z9'.repeat(8),
    'aws-secret': 'aws_secret_access_key = ' + 'k/+'.repeat(11),
    'gitlab-pat': 'glpat-' + 'd4'.repeat(12),
    'notion-token': 'ntn_' + 'E5'.repeat(22),
    'linear-key': 'lin_api_' + 'f6'.repeat(17),
    'saml-request': 'SAMLRequest=' + 'ab%2B'.repeat(6),
    'vpn-auth-challenge': 'CRV1:' + 'R:instance-' + 'x'.repeat(8),
    'bearer': 'Bearer ' + 'tok.en-'.repeat(4),
    'private-key': '-----BEGIN RSA ' + 'PRIVATE KEY-----',
    'url-password': 'https://' + 'user' + ':' + 'hunter2' + '@' + 'example.com',
};

test('nameGuard: an ordinary slug, a branch and a label pass through', () => {
    for (const name of ['home-sync', 'user/cockpit-stage-1', 'ABC-123 home sync', 'teammate 2.1.259'])
        assertEqual(nameGuard.guardDisplayName(name), name);
});
test('nameGuard: a name over 64 characters is redacted', () => {
    assertEqual(nameGuard.guardDisplayName('a'.repeat(65)), REDACTED);
    assertEqual(nameGuard.guardDisplayName('a'.repeat(64)), 'a'.repeat(64));
});
test('nameGuard: length is counted in characters, not UTF-16 units', () => {
    assertEqual(nameGuard.guardDisplayName('😀'.repeat(64)), '😀'.repeat(64));
    assertEqual(nameGuard.guardDisplayName('😀'.repeat(65)), REDACTED);
});
test('nameGuard: a non-string, an empty string and a control character are redacted', () => {
    assertEqual(nameGuard.guardDisplayName(null), REDACTED);
    assertEqual(nameGuard.guardDisplayName(''), REDACTED);
    assertEqual(nameGuard.guardDisplayName('a\u001bb'), REDACTED);
    assertEqual(nameGuard.guardDisplayName('a\u007fb'), REDACTED);
});
test('nameGuard: every shape pattern has a sample here', () => {
    assertEqual(Object.keys(SHAPE_SAMPLES).sort(), nameGuard.SECRET_SHAPE_PATTERNS.map(({name}) => name).sort());
});
for (const [shapeName, sample] of Object.entries(SHAPE_SAMPLES)) {
    test(`nameGuard: a ${shapeName}-shaped name is redacted`, () => {
        assertEqual(nameGuard.guardDisplayName(sample), REDACTED);
        const pattern = nameGuard.SECRET_SHAPE_PATTERNS.find(({name}) => name === shapeName).pattern;
        assertEqual(pattern.test(sample), true);
    });
}
