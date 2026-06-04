#!/usr/bin/env node
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const device_data_1 = require("./device-data");
(0, device_data_1.logDeviceData)().catch((e) => {
    // eslint-disable-next-line no-console
    console.error(e);
    process.exit(1);
});
