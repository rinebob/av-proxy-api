import admin from 'firebase-admin';
import { CloudFunctionName } from '../common/common-fn.js';

if (admin.apps.length === 0) {
  admin.initializeApp();
  console.info('auth.ts: Firebase Admin SDK initialized.');
}

/**
 * Authenticates a Firebase user based on the ID token in the Authorization header.
 * Sends a 401 response if authentication fails.
 * @param req The Express request object.
 * @param res The Express response object.
 * @param functionName For logging purposes, the name of the calling Cloud Function.
 * @returns A Promise resolving with the decoded ID token (admin.auth.DecodedIdToken) if successful, or null if authentication failed and response was sent.
 */
export async function authenticateFirebaseUser(
  req: any,
  res: any,
  functionName: CloudFunctionName
): Promise<admin.auth.DecodedIdToken | null> {
  console.log(`---auth.ts: ${functionName}: Starting authentication ---`);

  const authorizationHeader = req.headers.authorization;
  if (!authorizationHeader) {
    const errorMsg = `auth.ts: ${functionName}: Unauthorized - No Authorization header provided.`;
    console.warn(errorMsg);
    res.status(401).json({ 
      error: 'Unauthorized: No Authorization header provided.',
      details: 'Missing Authorization header',
      function: functionName
    });
    return null;
  }
  
  if (!authorizationHeader.startsWith('Bearer ')) {
    const errorMsg = `auth.ts: ${functionName}: Unauthorized - Invalid Authorization header format. Expected 'Bearer <token>'`;
    console.warn(errorMsg);
    res.status(401).json({ 
      error: 'Unauthorized: Invalid token format.',
      details: 'Expected Bearer token',
      function: functionName
    });
    return null;
  }

  const idToken = authorizationHeader.split('Bearer ')[1];
  
  try {
    const decodedToken = await admin.auth().verifyIdToken(idToken, true); // Check for token revocation
    
    console.log(`auth.ts: ${functionName}: Successfully authenticated user:`, {
      uid: decodedToken.uid,
      email: decodedToken.email,
    });

    return decodedToken;

  } catch (error: any) {
    const errorMsg = `auth.ts: ${functionName}: Unauthorized - Error verifying ID token.`;
    console.error(errorMsg, error);
    res.status(401).json({ 
      error: 'Unauthorized: Invalid or expired token.',
      details: error.message,
      code: error.code,
      function: functionName
    });
    return null;
  }
}
