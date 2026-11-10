declare module "cubejs" {
  export default class Cube {
    static initSolver(): void;
    static fromString(facelets: string): Cube;
    move(alg: string): Cube;
    asString(): string;
    solve(maxDepth?: number): string;
  }
}
