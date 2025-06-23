# Myapp

This project was generated using [Angular CLI](https://github.com/angular/angular-cli) version 19.2.12.

## Development Setup

### Environment Setup

1. **Environment Variables**
   - Create a `.env.alpha-vantage-proxy-api` file in the `functions` directory
   - Add the following variable for local development:
     ```env
     # Alpha Vantage API Key for local development
     LOCAL_EMULATOR_ALPHAVANTAGE_API_KEY="your-api-key-here"
     ```

2. **Firebase Secret (for production)**
   ```bash
   # Set Alpha Vantage API Key for production
   firebase functions:secrets:set ALPHAVANTAGE_API_KEY
   ```
   When prompted, enter your Alpha Vantage API key.

### Authentication
- The application uses Firebase Authentication for user management
- Only authenticated users with valid Firebase ID tokens can access the API endpoints
- No additional user whitelisting is required beyond standard Firebase Authentication

### Test User

For local development, you can use the Firebase Authentication emulator with these test credentials:

- **Email**: `test@user.com`
- **Password**: `aaaaaa`
- **UID**: Will be generated automatically in the emulator

### Streamlined Development Workflow

For an efficient development experience with automatic data persistence and live code reloading, use the following two-terminal setup:

**Terminal 1: Start Emulators with Data Persistence**

In the project root directory (`av-proxy-api`), run:

```bash
# This starts the emulators and handles importing/exporting data
npm run emulators
```

This script will:
- Start the Firebase emulators for Functions, Firestore, and Auth.
- Automatically import data (like users) from the `./.firebase/emulator-data` directory.
- Save the current state of the emulators back to that directory when you stop the process (`Ctrl+C`).

**Terminal 2: Watch for Backend Code Changes**

In the `functions` directory (`av-proxy-api/functions`), run:

```bash
# This watches for changes and automatically recompiles the TypeScript
npm run build:watch
```

This script will automatically recompile your TypeScript functions whenever you save a file. The Functions emulator will detect the changes and hot-reload your code.

**Terminal 3: Run the Angular Frontend**

In the project root directory (`av-proxy-api`), run:

```bash
# This starts the Angular development server
ng serve
```

Now you can access the application at `http://localhost:4200/` and any changes you make to your backend or frontend code will be automatically reflected.

## Code scaffolding

Angular CLI includes powerful code scaffolding tools. To generate a new component, run:

```bash
ng generate component component-name
```

For a complete list of available schematics (such as `components`, `directives`, or `pipes`), run:

```bash
ng generate --help
```

## Building

To build the project run:

```bash
ng build
```

This will compile your project and store the build artifacts in the `dist/` directory. By default, the production build optimizes your application for performance and speed.

## Running unit tests

To execute unit tests with the [Karma](https://karma-runner.github.io) test runner, use the following command:

```bash
ng test
```

## Running end-to-end tests

For end-to-end (e2e) testing, run:

```bash
ng e2e
```

Angular CLI does not come with an end-to-end testing framework by default. You can choose one that suits your needs.

## Additional Resources

For more information on using the Angular CLI, including detailed command references, visit the [Angular CLI Overview and Command Reference](https://angular.dev/tools/cli) page.
