export type Matrix = [number, number, number, number, number, number]
export type Point = [number, number]
export const identity: Matrix = [1, 0, 0, 1, 0, 0]
export function multiply(
  [a, b, c, d, x, y]: Matrix,
  [e, f, g, h, u, v]: Matrix,
): Matrix {
  return [
    a * e + c * f,
    b * e + d * f,
    a * g + c * h,
    b * g + d * h,
    a * u + c * v + x,
    b * u + d * v + y,
  ]
}
export const transform = ([a, b, c, d, x, y]: Matrix, [u, v]: Point): Point => [
  a * u + c * v + x,
  b * u + d * v + y,
]
export function local([a, b, c, d, x, y]: Matrix, [u, v]: Point): Point {
  const det = a * d - b * c
  return [(d * (u - x) - c * (v - y)) / det, (a * (v - y) - b * (u - x)) / det]
}
export function matrix(x: number, y: number, r: number, s: Point): Matrix {
  const c = Math.cos(r),
    t = Math.sin(r)
  return [c * s[0], t * s[0], -t * s[1], c * s[1], x, y]
}
export type Hit = {
  key: string
  id: string
  matrix: Matrix
  parent: Matrix
  polygon: Point[]
  locked: boolean
}
export class PickRegistry {
  entries: Hit[] = []
  at(point: Point) {
    return this.entries
      .slice()
      .reverse()
      .filter((h) => {
        if (h.locked) return false
        const [x, y] = local(h.matrix, point),
          p = h.polygon
        let inside = false
        for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
          const [a, b] = p[i],
            [c, d] = p[j]
          if (b > y !== d > y && x < ((c - a) * (y - b)) / (d - b) + a)
            inside = !inside
        }
        return inside
      })
  }
}
