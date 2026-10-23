# Contributing to cmdf

Thank you for your interest in contributing to **cmdf**!

## Code of Conduct

Please maintain a welcoming, respectful, and collaborative environment.

## Development Setup

1. **Prerequisites**:
   - Node.js LTS (>= 18.0.0)
   - npm (>= 9.0.0)
   - Git

2. **Clone and Install**:
   ```bash
   git clone https://github.com/cmdf/cmdf.git
   cd cmdf
   npm install
   ```

3. **Configure Environment**:
   ```bash
   cp .env.example .env
   # Add your GEMINI_API_KEY from https://aistudio.google.com/
   ```

4. **Run Verification Commands**:
   ```bash
   npm run typecheck    # Check TypeScript types
   npm run lint         # Check ESLint rules
   npm run format:check # Check Prettier formatting
   npm run test         # Run all unit and integration tests
   npm run build        # Build dist bundle
   ```

5. **Local Link**:
   ```bash
   npm link
   cmdf doctor
   ```

## Pull Request Guidelines

- Ensure all Vitest tests pass without requiring a paid API key.
- Never commit `.env` or personal credentials.
- Add test coverage for any new action, security validator, or planning capability.
- Format code with `npm run format`.
