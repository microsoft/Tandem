import assert from "node:assert/strict";
import { test } from "node:test";
import { sketchPathData } from "../src/sketch-path.js";

const points = [{ x: 6, y: 6 }, { x: 12, y: 18 }, { x: 24, y: 6 }];

test("canonical paths preserve legacy linear bytes and emit chained quadratic and cubic Beziers", () => {
    assert.equal(sketchPathData({ points }), "M 6 6 L 12 18 L 24 6");
    assert.equal(sketchPathData({ points, closed: true }), "M 6 6 L 12 18 L 24 6 Z");
    assert.equal(sketchPathData({ points: [...points, { x: 30, y: 18 }, { x: 36, y: 6 }], curve: "quadratic" }),
        "M 6 6 Q 12 18 24 6 Q 30 18 36 6");
    assert.equal(sketchPathData({ points: [...points, { x: 30, y: 18 }, ...points], curve: "cubic", closed: true }),
        "M 6 6 C 12 18 24 6 30 18 C 6 6 12 18 24 6 Z");
});

test("open Catmull-Rom splines use clamped endpoint tangents and cardinal tension", () => {
    const before = structuredClone(points);
    assert.equal(sketchPathData({ points, curve: "catmull-rom" }),
        "M 6 6 C 7 8 9 18 12 18 C 15 18 22 8 24 6");
    assert.equal(sketchPathData({ points, curve: "catmull-rom", tension: 0.5 }),
        "M 6 6 C 6.5 7 10.5 18 12 18 C 13.5 18 23 7 24 6");
    assert.equal(sketchPathData({ points, curve: "catmull-rom", tension: 1 }),
        "M 6 6 C 6 6 12 18 12 18 C 12 18 24 6 24 6");
    assert.deepEqual(points, before);
});

test("closed Catmull-Rom splines wrap tangents and ignore a repeated closing knot", () => {
    const expected = "M 6 6 C 4 8 9 18 12 18 C 15 18 25 8 24 6 C 23 4 8 4 6 6 Z";
    assert.equal(sketchPathData({ points, curve: "catmull-rom", closed: true }), expected);
    assert.equal(sketchPathData({ points: [...points, points[0]], curve: "catmull-rom", closed: true }), expected);
    assert.equal(sketchPathData({ points: points.slice(0, 2), curve: "catmull-rom" }), "M 6 6 C 7 8 11 16 12 18");
    assert.equal(sketchPathData({ points: [points[0], points[0]], curve: "catmull-rom", closed: true }), "M 6 6 Z");
    assert.equal(sketchPathData({ points: [points[0], points[0]], curve: "catmull-rom" }), "M 6 6 C 6 6 6 6 6 6");
    assert.throws(() => sketchPathData({ points: [] }), /at least two/);
});
