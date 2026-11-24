// lib/pressure.js: PSI `some avg10` percents mapped to the meter's bands.
import {test, assertEqual} from './harness.js';
import {pressureBand} from '../extensions/resource-pulse@zvibaratz.github.io/lib/pressure.js';

test('PSI bands at the edges', () =>
    assertEqual([9.99, 10, 24.99, 25, 49.99, 50, null].map(pressureBand), [0, 1, 1, 2, 2, 3, null]));
