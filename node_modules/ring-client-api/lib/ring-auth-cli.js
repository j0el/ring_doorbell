#!/usr/bin/env node
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const refresh_token_1 = require("./refresh-token");
(0, refresh_token_1.logRefreshToken)().catch((e) => {
    // eslint-disable-next-line no-console
    console.error(e);
    process.exit(1);
});
