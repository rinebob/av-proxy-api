import { admin } from '../../firebase-admin-init';

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
 * Adds detailed logging for debugging token signature issues.
 * @param {string} idToken The Firebase ID token from the Authorization header.
 * @return {Promise<DecodedIdToken | null>} The decoded token or null if invalid.
 */
export async function authenticateFirebaseUser(
  idToken: string
): Promise<admin.auth.DecodedIdToken | null> {
  if (!idToken) {
    console.warn('No ID token provided for authentication.');
    return null;
  }

  // The token is expected to be passed without the 'Bearer ' prefix here.
  const token = idToken.startsWith('Bearer ') ? idToken.split(' ')[1] : idToken;

  try {
    console.log('Verifying Firebase ID token...');
    console.log(`Token received (first 15 chars): ${token.substring(0, 15)}...`);
    console.log(`Token length: ${token.length}`);
    console.log(`Auth Emulator Host from env: ${process.env.FIREBASE_AUTH_EMULATOR_HOST}`);

    // verifyIdToken will automatically use the emulator if the host env var is set.
    const decodedToken = await admin.auth().verifyIdToken(token, true);
    console.log('ID token verified successfully. UID:', decodedToken.uid);
    return decodedToken;

  } catch (error: any) {
    console.error('Error verifying Firebase ID token:', error.message);
    console.error(`Error Code: ${error.code}`);
    // Provide specific guidance for the most likely error cause.
    if (error.code === 'auth/argument-error') {
        console.error('Detailed error: The ID token is malformed or has an invalid signature. This can happen if the token is signed with a different project\'s service account, or if the Auth emulator is not configured correctly on the backend.');
    }
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
