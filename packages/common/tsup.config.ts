import { defineConfig } from 'tsup';

export default defineConfig({
  tsconfig: 'tsconfig.tsup.json',
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  sourcemap: true,
  target: 'es2022',
  noExternal: ['@bgotink/kdl'],
});
