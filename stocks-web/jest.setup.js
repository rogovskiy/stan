// Optional: configure or set up a testing framework before each test.
// If you delete this file, remove `setupFilesAfterEnv` from `jest.config.js`

// Load environment variables from .env files
import { config } from 'dotenv';
import { join } from 'path';

// Load .env.local first (highest priority), then .env
config({ path: join(process.cwd(), '.env.local') });
config({ path: join(process.cwd(), '.env') });

// Used for __tests__/testing-library.js
// Learn more: https://github.com/testing-library/jest-dom
import '@testing-library/jest-dom'

// Mock console.log to avoid noise in tests
global.console = {
  ...console,
  // Uncomment to ignore specific log levels
  // log: jest.fn(),
  // debug: jest.fn(),
  // info: jest.fn(),
  // warn: jest.fn(),
  // error: jest.fn(),
}