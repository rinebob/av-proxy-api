# Myapp

This project was generated using [Angular CLI](https://github.com/angular/angular-cli) version 19.2.12.

## Development Setup

### Environment Setup

1. **Environment Variables**
   - Create a `.env.alpha-vantage-proxy-api` file in the `functions` directory
   - Add the following variables:
     ```env
     # Alpha Vantage API Key for local development
     LOCAL_EMULATOR_ALPHAVANTAGE_API_KEY="your-api-key-here"
     
     # Comma-separated list of allowed user UIDs for local development
     SECRET_ALLOWED_USER_UIDS="user-uid-1,user-uid-2"
     ```

2. **Firebase Secrets (for production)**
   ```bash
   # Set Alpha Vantage API Key (only needed if different from local key)
   firebase functions:secrets:set ALPHAVANTAGE_API_KEY
   
   # Set allowed user UIDs
   firebase functions:secrets:set SECRET_ALLOWED_USER_UIDS
   ```
   When prompted, enter the respective values.

### Test User

For local development, you can use the Firebase Authentication emulator with these test credentials:

- **Email**: `test@user.com`
- **Password**: `aaaaaa`
- **UID**: Will be generated automatically in the emulator

### Running Locally

1. Start the Firebase emulators:
   ```bash
   firebase emulators:start --only "auth,firestore,functions" --project alpha-vantage-proxy-api
   ```

2. In a separate terminal, start the Angular development server:
   ```bash
   ng serve
   ```

3. Access the application at `http://localhost:4200/`

### Authentication in Development

In development mode, the application uses the Firebase Authentication emulator. Any request with a valid Firebase ID token will be accepted if the UID is in the `ALLOWED_USER_UIDS` list from your `.env.alpha-vantage-proxy-api` file.

### Starting the Development Server

To start a local development server, run:

```bash
# Start the Angular development server
ng serve

# In a separate terminal, start the Firebase emulators
firebase emulators:start --only "auth,firestore,functions" --project alpha-vantage-proxy-api
```

### Authentication in Development

In development mode, any request with a valid Firebase ID token will be accepted if the UID matches the hardcoded test user UID (`testuser123`). No additional setup is required.

Once the server is running, open your browser and navigate to `http://localhost:4200/`. The application will automatically reload whenever you modify any of the source files.

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
