import { deflateSync } from "node:zlib";
import type { DslSketchDocument } from "../../src/sketch.js";
import { buttonScreen, createDocument } from "./ui-dsl-fixture.js";

export function sketchDocument(): DslSketchDocument {
    return {
        version: 2,
        screens: [buttonScreen({
            id: "main", title: "Main", purpose: "Complete the primary task.", decisionIds: ["usage"],
            width: 320, height: 240, notes: "Keep the primary action visible.",
            ui: createDocument({ tokens: { "space.1": 20 } }),
        })],
        transitions: [],
    };
}

export function screenPng(width = 320, height = 240): string {
    const crc = (bytes: Buffer) => {
        let value = 0xffffffff;
        for (const byte of bytes) {
            value ^= byte;
            for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0);
        }
        return (value ^ 0xffffffff) >>> 0;
    };
    const chunk = (type: string, data: Buffer) => {
        const head = Buffer.alloc(4); head.writeUInt32BE(data.length);
        const body = Buffer.concat([Buffer.from(type), data]);
        const tail = Buffer.alloc(4); tail.writeUInt32BE(crc(body));
        return Buffer.concat([head, body, tail]);
    };
    const header = Buffer.alloc(13);
    header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4);
    header[8] = 8; header[9] = 6;
    const pixels = Buffer.alloc(height * (1 + width * 4), 255);
    for (let row = 0; row < height; row++) pixels[row * (1 + width * 4)] = 0;
    return Buffer.concat([
        Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
        chunk("IHDR", header), chunk("IDAT", deflateSync(pixels)), chunk("IEND", Buffer.alloc(0)),
    ]).toString("base64");
}
