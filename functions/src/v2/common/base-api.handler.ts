import { Request, Response } from 'express';
import * as admin from 'firebase-admin';
import { DocumentPathOptions, VendorType } from './refresh.types';
import { refreshLogger } from '../services/refresh-logger.service';
import { getDocumentPath } from './firestore-paths';

export abstract class BaseApiHandler<T = any> {
  protected vendor: VendorType;
  protected endpoint: string;
  protected db: admin.firestore.Firestore;

  constructor(vendor: VendorType, endpoint: string) {
    this.vendor = vendor;
    this.endpoint = endpoint;
    this.db = admin.firestore();
  }

  /**
   * Main handler method to be implemented by subclasses
   */
  public abstract handleRequest(req: Request, res: Response): Promise<void>;

  /**
   * Fetches data from Firestore, checking if it needs to be refreshed
   */
  protected async fetchData(
    symbol?: string,
    forceRefresh = false
  ): Promise<{ data: T | null; fromCache: boolean }> {
    const options: DocumentPathOptions = { 
      vendor: this.vendor, 
      endpoint: this.endpoint, 
      symbol 
    };
    
    const docRef = this.db.doc(getDocumentPath(options));
    const doc = await docRef.get();

    // If document doesn't exist or needs refresh, return null to trigger a fetch
    if (!doc.exists || this.needsRefresh(doc.data()?.metadata, forceRefresh)) {
      return { data: null, fromCache: false };
    }

    return { 
      data: doc.data()?.data as T, 
      fromCache: true 
    };
  }

  /**
   * Determines if data needs to be refreshed
   */
  private needsRefresh(
    metadata: { nextRefreshAt?: admin.firestore.Timestamp } | undefined,
    forceRefresh: boolean
  ): boolean {
    if (forceRefresh) return true;
    if (!metadata?.nextRefreshAt) return true;

    const now = admin.firestore.Timestamp.now();
    return now >= metadata.nextRefreshAt;
  }

  /**
   * Logs a successful refresh
   */
  protected async logSuccess(
    symbol: string | undefined,
    durationMs: number,
    responseSize: number,
    endpointParams: Record<string, any> = {}
  ): Promise<void> {
    await refreshLogger.logRefreshEvent(
      {
        status: 'success',
        durationMs,
        responseSize,
        httpStatus: 200,
        triggeredBy: 'api',
        endpointParams,
        endpoint: this.endpoint,
        vendor: this.vendor,
        error: null
      },
      {
        vendor: this.vendor,
        endpoint: this.endpoint,
        symbol
      }
    );
  }

  /**
   * Logs a failed refresh
   */
  protected async logError(
    symbol: string | undefined,
    error: Error,
    durationMs: number,
    endpointParams: Record<string, any> = {}
  ): Promise<void> {
    await refreshLogger.logRefreshEvent(
      {
        status: 'failure',
        durationMs,
        error: error.message,
        triggeredBy: 'api',
        endpointParams,
        endpoint: this.endpoint,
        vendor: this.vendor,
        responseSize: 0,
        httpStatus: 500
      },
      {
        vendor: this.vendor,
        endpoint: this.endpoint,
        symbol
      }
    );
  }

  /**
   * Sends a standardized error response
   */
  protected sendErrorResponse(
    res: Response, 
    status: number, 
    message: string,
    error?: any
  ): void {
    console.error(`[${this.vendor.toUpperCase()}:${this.endpoint}] Error:`, message, error);
    
    res.status(status).json({
      success: false,
      error: message,
      timestamp: admin.firestore.Timestamp.now().toDate().toISOString()
    });
  }

  /**
   * Sends a standardized success response
   */
  protected sendSuccessResponse(
    res: Response,
    data: any,
    fromCache: boolean,
    ttlSeconds?: number
  ): void {
    res.status(200).json({
      success: true,
      data,
      metadata: {
        fromCache,
        timestamp: admin.firestore.Timestamp.now().toDate().toISOString(),
        ...(ttlSeconds && {
          ttlSeconds,
          nextRefreshAt: new Date(Date.now() + ttlSeconds * 1000).toISOString()
        })
      }
    });
  }

  /**
   * Saves data to Firestore with refresh metadata
   */
  protected async saveToFirestore(
    data: T,
    symbol?: string,
    ttlSeconds: number = 3600
  ): Promise<void> {
    const options: DocumentPathOptions = { 
      vendor: this.vendor, 
      endpoint: this.endpoint, 
      symbol 
    };
    
    const docRef = this.db.doc(getDocumentPath(options));
    const now = admin.firestore.Timestamp.now();
    
    await docRef.set({
      data,
      metadata: {
        lastUpdated: now,
        nextRefreshAt: admin.firestore.Timestamp.fromMillis(now.toMillis() + ttlSeconds * 1000),
        ttlSeconds,
        vendor: this.vendor,
        endpoint: this.endpoint,
        ...(symbol && { symbol }),
        lastRefreshEvent: {
          timestamp: now,
          status: 'success',
          durationMs: 0, // Will be updated by the logger
          error: null
        }
      }
    }, { merge: true });
  }
}
