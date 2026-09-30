import type { SketchPoint, SketchShape } from "./sketch.js";

type PathGeometry = Pick<SketchShape, "points" | "curve" | "closed" | "tension">;
const coordinates = (point: SketchPoint) => `${point.x} ${point.y}`;

// Shared by the editor and immutable SVG/PNG exports. Callers validate the scene first.
export function sketchPathData(shape: PathGeometry): string {
    const { points, curve = "linear", closed = false, tension = 0 } = shape;
    if (points.length < 2) throw new Error("A sketch path needs at least two points.");
    const commands = [`M ${coordinates(points[0])}`];
    if (curve === "catmull-rom") {
        const last = points.at(-1)!;
        const knots = closed && last.x === points[0].x && last.y === points[0].y ? points.slice(0, -1) : points;
        const count = knots.length;
        const knot = (index: number) => knots[closed ? (index + count) % count : Math.max(0, Math.min(count - 1, index))];
        const scale = (1 - tension) / 6;
        for (let index = 0; count > 1 && index < (closed ? count : count - 1); index++) {
            const previous = knot(index - 1), start = knot(index), end = knot(index + 1), next = knot(index + 2);
            const first = { x: start.x + (end.x - previous.x) * scale, y: start.y + (end.y - previous.y) * scale };
            const second = { x: end.x - (next.x - start.x) * scale, y: end.y - (next.y - start.y) * scale };
            commands.push(`C ${coordinates(first)} ${coordinates(second)} ${coordinates(end)}`);
        }
    } else {
        const stride = curve === "quadratic" ? 2 : curve === "cubic" ? 3 : 1;
        const command = curve === "quadratic" ? "Q" : curve === "cubic" ? "C" : "L";
        for (let index = 1; index < points.length; index += stride) {
            commands.push(`${command} ${points.slice(index, index + stride).map(coordinates).join(" ")}`);
        }
    }
    if (closed) commands.push("Z");
    return commands.join(" ");
}
