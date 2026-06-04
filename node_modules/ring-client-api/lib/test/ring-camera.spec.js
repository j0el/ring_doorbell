"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const index_1 = require("../index");
describe('Ring Camera', () => {
    describe('battery level', () => {
        it('should handle string battery life', () => {
            expect((0, index_1.getBatteryLevel)({
                battery_life: '49',
            })).toEqual(49);
        });
        it('should handle null battery life', () => {
            expect((0, index_1.getBatteryLevel)({ battery_life: null })).toEqual(null);
        });
        it('should handle right battery only', () => {
            expect((0, index_1.getBatteryLevel)({ battery_life: null, battery_life_2: 24 })).toEqual(24);
        });
        it('should handle left battery only', () => {
            expect((0, index_1.getBatteryLevel)({ battery_life: 76, battery_life_2: null })).toEqual(76);
        });
        it('should handle dual batteries', () => {
            expect((0, index_1.getBatteryLevel)({ battery_life: '92', battery_life_2: 84 })).toEqual(84);
            expect((0, index_1.getBatteryLevel)({ battery_life: '92', battery_life_2: 100 })).toEqual(92);
        });
    });
    describe('cleanSnapshotUuid', () => {
        it('should return the original uuid if it is already clean', () => {
            expect((0, index_1.cleanSnapshotUuid)('c2a0a397-3538-422d-bb4e-51837a56b870')).toBe('c2a0a397-3538-422d-bb4e-51837a56b870');
        });
        it('should return remove anything after :', () => {
            expect((0, index_1.cleanSnapshotUuid)('c2a0a397-3538-422d-bb4e-51837a56b870:122429140')).toBe('c2a0a397-3538-422d-bb4e-51837a56b870');
        });
        it('should handle falsy values', () => {
            expect((0, index_1.cleanSnapshotUuid)(undefined)).toBe(undefined);
            expect((0, index_1.cleanSnapshotUuid)(null)).toBe(null);
        });
    });
});
