import { defineConfig } from 'vitest/config';

// dist/ holds compiled copies of the tests from `npm run build`. Running them
// again doubles the suite and can fail on code the source has already moved
// past.
export default defineConfig({
  test: {
    exclude: ['**/node_modules/**', '**/dist/**'],
  },
});
