import { onCall } from 'firebase-functions/v2/https';
import * as logger from 'firebase-functions/logger';
import { admin, db } from '../../../firebase-admin-init';

interface ListCollectionsRequest {
  path?: string;
}

export interface ListCollectionsResponse {
  success: boolean;
  collections?: string[];
  error?: string;
  path?: string;
}

export const listCollections = onCall<ListCollectionsRequest, Promise<ListCollectionsResponse>>(
  { cors: true },
  async (request): Promise<ListCollectionsResponse> => {
    // Authentication check
    if (!request.auth) {
      logger.warn('fn listCollections: Unauthorized attempt to list collections', { auth: request.auth });
      return { 
        success: false, 
        error: 'fn listCollections: Unauthorized: You must be authenticated to list collections',
        path: request.data?.path || ''
      };
    }

    const path = request.data?.path || '';
    
    try {
      logger.info(`fn listCollections: Listing collections for path: '${path}'`, { 
        auth: request.auth,
        path
      });

      let ref: admin.firestore.Firestore | admin.firestore.DocumentReference | admin.firestore.CollectionReference;
      
      if (!path) {
        // Root collections
        ref = db;
      } else {
        // Document reference for subcollections
        const segments = path.split('/').filter(Boolean); // Filter out empty segments
        if (segments.length % 2 === 0) {
          // Even number of segments means we're at a document (e.g., 'collection/doc' = 2 segments = document)
          ref = db.doc(path);
        } else {
          // Odd number means we're at a collection (e.g., 'collection/doc/subcollection' = 3 segments = collection)
          // We can't list collections from a collection reference, return empty array
          logger.info(`fn listCollections: Path '${path}' is a collection, returning empty subcollections`);
          return {
            success: true,
            collections: [],
            path
          };
        }
      }
      
      // List all subcollections (only works on Firestore and DocumentReference)
      const collections = await (ref as admin.firestore.DocumentReference).listCollections();
      const collectionIds = collections.map(col => col.id);
      
      // Log the count and IDs of collections found
      logger.info(`fn listCollections: Found ${collectionIds.length} collections at path: '${path}': ${collectionIds.join(', ')}`, {
        collectionCount: collectionIds.length,
        collectionIds,
        path
      });
      
      return {
        success: true,
        collections: collectionIds,
        path
      };
      
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error(`fn listCollections: Error listing collections at path '${path}':`, error);
      
      return {
        success: false,
        error: `fn listCollections: Failed to list collections: ${errorMessage}`,
        path
      };
    }
  }
);
