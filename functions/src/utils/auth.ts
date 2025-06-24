import * as admin from 'firebase-admin';

// Initialize Firebase Admin if not already done
if (!admin.apps.length) {
  try {
    // For local development with emulator
    if (process.env.FUNCTIONS_EMULATOR === 'true') {
      console.log('Initializing Firebase Admin with emulator configuration');
      admin.initializeApp({
        projectId: 'alpha-vantage-proxy-api',  // Hardcoded project ID for emulator
        credential: admin.credential.applicationDefault(),
        databaseURL: 'http://localhost:8080?ns=alpha-vantage-proxy-api'
      });
      
      // Point to the auth emulator
      process.env.FIREBASE_AUTH_EMULATOR_HOST = 'localhost:9099';
    } else {
      // For production - will use Application Default Credentials
      console.log('Initializing Firebase Admin with Application Default Credentials');
      admin.initializeApp({
        credential: admin.credential.applicationDefault(),
        databaseURL: 'https://alpha-vantage-proxy-api.firebaseio.com'
      });
    }
    console.log('Firebase Admin initialized successfully');
  } catch (error) {
    console.error('Failed to initialize Firebase Admin:', error);
    throw error;
  }
}

/**
 * Verifies a Firebase ID token and returns the decoded token.
 * @param idToken The Firebase ID token to verify
 * @returns A promise that resolves with the decoded token, or null if verification fails
 */
export async function authenticateFirebaseUser(
  idToken: string
): Promise<admin.auth.DecodedIdToken | null> {
  if (!idToken) {
    console.warn('No ID token provided for authentication');
    return null;
  }

  // Remove 'Bearer ' prefix if present
  const token = idToken.startsWith('Bearer ') ? idToken.split(' ')[1] : idToken;

  try {
    console.log('Verifying ID token...');
    // For emulator, we need to disable token verification
    if (process.env.FUNCTIONS_EMULATOR === 'true') {
      console.log('Running in emulator mode, skipping token verification');
      // Just decode the token without verification in emulator
      return admin.auth().verifyIdToken(token, false);
    }
    
    // In production, verify the token with all checks
    const decodedToken = await admin.auth().verifyIdToken(token, true);
    
    if (!decodedToken) {
      console.warn('Token verification returned null');
      return null;
    }

    // Check if token is expired
    const currentTime = Math.floor(Date.now() / 1000);
    if (decodedToken.exp < currentTime) {
      console.warn('Token has expired');
      return null;
    }

    return decodedToken;
  } catch (error) {
    console.error('Error verifying ID token:', error);
    return null;
  }
}

/**
 * Validates that the request has a valid Firebase ID token in the Authorization header.
 * @param req The Express request object
 * @param res The Express response object
 * @returns The decoded token if valid, otherwise null (and sends an error response)
 */
export async function validateFirebaseAuth(
  req: any,
  res: any
): Promise<admin.auth.DecodedIdToken | null> {
  const authHeader = req.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    console.warn('No authorization token found');
    res.status(401).json({ error: 'Unauthorized', message: 'No authentication token provided' });
    return null;
  }

  const token = authHeader.split(' ')[1];
  const decodedToken = await authenticateFirebaseUser(token);

  if (!decodedToken) {
    console.warn('Invalid or expired token');
    res.status(403).json({ error: 'Forbidden', message: 'Invalid or expired token' });
    return null;
  }

  return decodedToken;
}
