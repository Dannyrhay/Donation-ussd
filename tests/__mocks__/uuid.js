'use strict';

let counter = 0;
const v4 = () => `test-uuid-${++counter}`;
const v1 = () => `test-uuid-v1-${++counter}`;

module.exports = { v4, v1 };
